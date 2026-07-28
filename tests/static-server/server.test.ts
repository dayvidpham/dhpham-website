import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { createStaticServer, resolveStaticRoute } from './server';
import { StaticMimeType, StaticRouteOutcome } from './types';

let fixtureRoot = '';
let outsideRoot = '';
let server: Server;
let origin = '';

const request = async (
    path: string,
    method = 'GET',
    headers: Readonly<Record<string, string>> = {},
    body?: string,
    requestOrigin = origin,
): Promise<Readonly<{ status: number, headers: Headers, body: Uint8Array }>> => {
    return await new Promise((resolveRequest, rejectRequest) => {
        const outgoing = httpRequest(`${requestOrigin}${path}`, { method, headers }, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('error', rejectRequest);
            response.on('end', () => {
                const responseHeaders = new Headers();
                for (const [name, value] of Object.entries(response.headers)) {
                    if (Array.isArray(value)) {
                        value.forEach((entry) => responseHeaders.append(name, entry));
                    } else if (value !== undefined) {
                        responseHeaders.set(name, value);
                    }
                }
                resolveRequest({
                    status: response.statusCode ?? 0,
                    headers: responseHeaders,
                    body: Buffer.concat(chunks),
                });
            });
        });
        outgoing.on('error', rejectRequest);
        outgoing.end(body);
    });
};

before(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'static-server-root-'));
    outsideRoot = await mkdtemp(join(tmpdir(), 'static-server-outside-'));
    await mkdir(join(fixtureRoot, 'nested'), { recursive: true });
    await writeFile(join(fixtureRoot, 'index.html'), '<h1>root</h1>');
    await writeFile(join(fixtureRoot, 'article.html'), '<h1>article</h1>');
    await writeFile(join(fixtureRoot, 'nested', 'index.html'), '<h1>nested</h1>');
    await writeFile(join(fixtureRoot, 'styles.css'), 'body{}');
    await writeFile(join(fixtureRoot, 'app.js'), 'export {};');
    await writeFile(join(fixtureRoot, 'data.json'), '{}');
    await writeFile(join(fixtureRoot, 'diagram.svg'), '<svg></svg>');
    await writeFile(join(fixtureRoot, 'opaque.bin'), Buffer.from([0, 1, 2]));
    await writeFile(join(outsideRoot, 'secret.html'), 'outside');
    await symlink(join(outsideRoot, 'secret.html'), join(fixtureRoot, 'escape.html'));

    server = createStaticServer({ rootDirectory: fixtureRoot, mountPath: '/blog/' });
    await new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', rejectListen);
            resolveListen();
        });
    });
    const address = server.address();
    assert(address && typeof address === 'object');
    origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
    });
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
});

test('serves mounted root, exact files, clean HTML, and directory indexes', async () => {
    const cases = [
        ['/blog/', StaticRouteOutcome.DirectoryIndex, '<h1>root</h1>'],
        ['/blog', StaticRouteOutcome.DirectoryIndex, '<h1>root</h1>'],
        ['/blog/article.html', StaticRouteOutcome.File, '<h1>article</h1>'],
        ['/blog/article', StaticRouteOutcome.CleanHtml, '<h1>article</h1>'],
        ['/blog/nested/', StaticRouteOutcome.DirectoryIndex, '<h1>nested</h1>'],
        ['/blog/nested', StaticRouteOutcome.DirectoryIndex, '<h1>nested</h1>'],
    ] as const;

    for (const [path, outcome, expectedBody] of cases) {
        const resolved = await resolveStaticRoute(
            { rootDirectory: fixtureRoot, mountPath: '/blog/' },
            path,
            'GET',
        );
        assert.equal(resolved.outcome, outcome, path);
        const response = await request(path);
        assert.equal(response.status, 200, path);
        assert.equal(new TextDecoder().decode(response.body), expectedBody, path);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    }
});

test('supports root mounts without exposing paths outside that mount', async () => {
    const atRoot = await resolveStaticRoute({ rootDirectory: fixtureRoot, mountPath: '/' }, '/article', 'GET');
    const outsideBlog = await resolveStaticRoute(
        { rootDirectory: fixtureRoot, mountPath: '/blog/' },
        '/article',
        'GET',
    );
    assert.equal(atRoot.outcome, StaticRouteOutcome.CleanHtml);
    assert.equal(outsideBlog.outcome, StaticRouteOutcome.NotFound);
});

test('GET and HEAD return matching status, MIME, nosniff, and content length', async () => {
    for (const [path, mime] of [
        ['/blog/', StaticMimeType.Html],
        ['/blog/styles.css', StaticMimeType.Css],
        ['/blog/app.js', StaticMimeType.JavaScript],
        ['/blog/data.json', StaticMimeType.Json],
        ['/blog/diagram.svg', StaticMimeType.Svg],
        ['/blog/opaque.bin', StaticMimeType.Binary],
    ] as const) {
        const get = await request(path);
        const head = await request(path, 'HEAD');
        assert.equal(get.status, 200, path);
        assert.equal(head.status, get.status, path);
        assert.equal(get.headers.get('content-type'), mime, path);
        assert.equal(head.headers.get('content-type'), mime, path);
        assert.equal(head.headers.get('content-length'), get.headers.get('content-length'), path);
        assert.equal(head.headers.get('x-content-type-options'), 'nosniff', path);
        assert.equal(head.body.byteLength, 0, path);
    }
});

test('returns bounded 404 and 405 responses with nosniff', async () => {
    const missing = await request('/blog/missing');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('x-content-type-options'), 'nosniff');

    const unsupported = await request('/blog/article', 'POST');
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.get('allow'), 'GET, HEAD');
    assert.equal(unsupported.headers.get('x-content-type-options'), 'nosniff');

    const unsupportedWithBody = await request('/blog/article', 'POST', { 'content-length': '1' }, 'x');
    assert.equal(unsupportedWithBody.status, 405);
});

test('rejects malformed, encoded, repeated-encoding, separator, backslash, NUL, and traversal paths', async () => {
    const cases = [
        ['/blog/%', StaticRouteOutcome.BadRequest],
        ['/blog/%2', StaticRouteOutcome.BadRequest],
        ['/blog/%zz', StaticRouteOutcome.BadRequest],
        ['/blog/%c0%ae', StaticRouteOutcome.BadRequest],
        ['/blog/.', StaticRouteOutcome.Forbidden],
        ['/blog/..', StaticRouteOutcome.Forbidden],
        ['/blog/%2e', StaticRouteOutcome.Forbidden],
        ['/blog/%2E%2E', StaticRouteOutcome.Forbidden],
        ['/blog/.%2e', StaticRouteOutcome.Forbidden],
        ['/blog/%252e%252e', StaticRouteOutcome.Forbidden],
        ['/blog/a%2fb', StaticRouteOutcome.Forbidden],
        ['/blog/a%5cb', StaticRouteOutcome.Forbidden],
        ['/blog/a%255cb', StaticRouteOutcome.Forbidden],
        ['/blog/a\\b', StaticRouteOutcome.Forbidden],
        ['/blog/a%00b', StaticRouteOutcome.Forbidden],
        ['/blog/a\0b', StaticRouteOutcome.Forbidden],
        ['/blog//article', StaticRouteOutcome.BadRequest],
        ['relative/path', StaticRouteOutcome.BadRequest],
    ] as const;

    for (const [path, outcome] of cases) {
        const result = await resolveStaticRoute(
            { rootDirectory: fixtureRoot, mountPath: '/blog/' },
            path,
            'GET',
        );
        assert.equal(result.outcome, outcome, path);
        assert.equal(result.filePath, undefined, path);
    }
});

test('rejects symbolic links even when their target is a regular file outside the root', async () => {
    const result = await resolveStaticRoute(
        { rootDirectory: fixtureRoot, mountPath: '/blog/' },
        '/blog/escape',
        'GET',
    );
    assert.equal(result.outcome, StaticRouteOutcome.Forbidden);
    assert.equal(result.statusCode, 403);
});

test('rejects a configured output root that is itself a symbolic link', async () => {
    const linkedRoot = join(outsideRoot, 'linked-root');
    await symlink(fixtureRoot, linkedRoot);
    try {
        await assert.rejects(
            resolveStaticRoute({ rootDirectory: linkedRoot, mountPath: '/blog/' }, '/blog/', 'GET'),
            /configured output root is a symlink/,
        );
    } finally {
        await rm(linkedRoot, { force: true });
    }
});

test('rejects request bodies and oversized request targets', async () => {
    const bodyResponse = await request('/blog/article', 'GET', { 'content-length': '1' }, 'x');
    assert.equal(bodyResponse.status, 400);

    const result = await resolveStaticRoute(
        { rootDirectory: fixtureRoot, mountPath: '/blog/', maxRequestUrlBytes: 12 },
        '/blog/article',
        'GET',
    );
    assert.equal(result.outcome, StaticRouteOutcome.BadRequest);

    const oversizedFile = await resolveStaticRoute(
        { rootDirectory: fixtureRoot, mountPath: '/blog/', maxFileBytes: 2 },
        '/blog/article',
        'GET',
    );
    assert.equal(oversizedFile.outcome, StaticRouteOutcome.Forbidden);
    assert.match(oversizedFile.detail, /above the 2-byte response bound/);
});

test('CLI entrypoint wires the same mounted production server used by Playwright', async () => {
    const reservation = createHttpServer();
    await new Promise<void>((resolveListen, rejectListen) => {
        reservation.once('error', rejectListen);
        reservation.listen(0, '127.0.0.1', () => resolveListen());
    });
    const address = reservation.address();
    assert(address && typeof address === 'object');
    const port = address.port;
    await new Promise<void>((resolveClose, rejectClose) => {
        reservation.close((error) => error ? rejectClose(error) : resolveClose());
    });

    const executable = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const entrypoint = join(process.cwd(), 'tests', 'static-server', 'server.ts');
    const child = spawn(executable, [
        entrypoint,
        '--root',
        fixtureRoot,
        '--mount',
        '/blog/',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
    ], {
        cwd: process.cwd(),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    try {
        await new Promise<void>((resolveReady, rejectReady) => {
            const timeout = setTimeout(() => {
                rejectReady(new Error(`Static-server CLI did not become ready within 5000ms. stderr: ${stderr}`));
            }, 5_000);
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk: string) => {
                if (chunk.includes('Static artifact server listening')) {
                    clearTimeout(timeout);
                    resolveReady();
                }
            });
            child.once('exit', (code) => {
                clearTimeout(timeout);
                rejectReady(new Error(`Static-server CLI exited before readiness with code ${String(code)}. stderr: ${stderr}`));
            });
        });
        const response = await request('/blog/article', 'GET', {}, undefined, `http://127.0.0.1:${port}`);
        assert.equal(response.status, 200);
        assert.equal(new TextDecoder().decode(response.body), '<h1>article</h1>');
    } finally {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            await new Promise<void>((resolveExit, rejectExit) => {
                const timeout = setTimeout(() => {
                    rejectExit(new Error('Static-server CLI did not exit within 5000ms after SIGTERM.'));
                }, 5_000);
                void once(child, 'exit').then(() => {
                    clearTimeout(timeout);
                    resolveExit();
                }, rejectExit);
            });
        }
    }
});
