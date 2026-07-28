import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    ResolvedStaticRoute,
    STATIC_MIME_BY_EXTENSION,
    StaticFileExtension,
    StaticMimeType,
    StaticRouteOutcome,
    StaticServerOptions,
} from './types';

const DEFAULT_MAX_REQUEST_URL_BYTES = 8_192;
const DEFAULT_MAX_FILE_BYTES = 33_554_432;
const MAX_PATH_SEGMENTS = 128;
const NO_SNIFF_HEADER = 'nosniff';

class RouteRejection extends Error {
    public constructor(
        public readonly outcome: StaticRouteOutcome.BadRequest | StaticRouteOutcome.Forbidden,
        message: string,
    ) {
        super(message);
    }
}

const statusForOutcome = (outcome: StaticRouteOutcome): number => {
    switch (outcome) {
        case StaticRouteOutcome.File:
        case StaticRouteOutcome.CleanHtml:
        case StaticRouteOutcome.DirectoryIndex:
            return 200;
        case StaticRouteOutcome.BadRequest:
            return 400;
        case StaticRouteOutcome.Forbidden:
            return 403;
        case StaticRouteOutcome.NotFound:
            return 404;
        case StaticRouteOutcome.MethodNotAllowed:
            return 405;
    }
};

const rejectionResult = (
    outcome: StaticRouteOutcome.BadRequest | StaticRouteOutcome.Forbidden,
    detail: string,
): ResolvedStaticRoute => ({ outcome, statusCode: statusForOutcome(outcome), detail });

const normalizeMountPath = (mountPath: string): string => {
    if (!mountPath.startsWith('/') || (mountPath !== '/' && mountPath.includes('//'))
        || mountPath.includes('\\') || mountPath.includes('\0') || mountPath.includes('%')) {
        throw new Error(
            `Static-server configuration failed while validating mount path ${JSON.stringify(mountPath)}: `
            + 'mounts must be decoded absolute URL paths without percent escapes, backslashes, or NUL bytes. '
            + 'No server was started; use `/` or a path such as `/blog/`.',
        );
    }

    const segments = mountPath.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
        throw new Error(
            `Static-server configuration failed while validating mount path ${JSON.stringify(mountPath)}: `
            + 'dot segments can escape the declared route mount. No server was started; remove `.` and `..` segments.',
        );
    }

    return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
};

const rawPathFromRequestTarget = (requestTarget: string): string => {
    const delimiterIndexes = [requestTarget.indexOf('?'), requestTarget.indexOf('#')]
        .filter((index) => index >= 0);
    const end = delimiterIndexes.length === 0 ? requestTarget.length : Math.min(...delimiterIndexes);
    return requestTarget.slice(0, end);
};

const decodeSegment = (rawSegment: string): string => {
    if (rawSegment.includes('\\') || rawSegment.includes('\0')) {
        throw new RouteRejection(
            StaticRouteOutcome.Forbidden,
            'the request path contains a literal backslash or NUL byte, which can change filesystem path semantics',
        );
    }
    if (/%(?![0-9a-fA-F]{2})/.test(rawSegment)) {
        throw new RouteRejection(
            StaticRouteOutcome.BadRequest,
            'the request path contains malformed percent encoding',
        );
    }

    let decoded: string;
    try {
        decoded = decodeURIComponent(rawSegment);
    } catch {
        throw new RouteRejection(
            StaticRouteOutcome.BadRequest,
            'the request path is not valid percent-encoded UTF-8',
        );
    }

    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
        throw new RouteRejection(
            StaticRouteOutcome.Forbidden,
            'the request path contains an encoded separator, backslash, or NUL byte',
        );
    }
    if (decoded === '.' || decoded === '..') {
        throw new RouteRejection(
            StaticRouteOutcome.Forbidden,
            'the request path contains a literal or encoded dot segment that could traverse outside the output root',
        );
    }
    if (decoded.includes('%')) {
        throw new RouteRejection(
            StaticRouteOutcome.Forbidden,
            'the request path contains an encoded percent sign that could become a traversal token after repeated decoding',
        );
    }
    if ([...decoded].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
        throw new RouteRejection(
            StaticRouteOutcome.BadRequest,
            'the request path contains a control character that cannot identify a generated file',
        );
    }

    return decoded;
};

interface DecodedRequestPath {
    readonly segments: readonly string[]
    readonly trailingSlash: boolean
}

const decodeRequestPath = (requestTarget: string, maxRequestUrlBytes: number): DecodedRequestPath => {
    if (Buffer.byteLength(requestTarget, 'utf8') > maxRequestUrlBytes) {
        throw new RouteRejection(
            StaticRouteOutcome.BadRequest,
            `the request target exceeds the ${maxRequestUrlBytes}-byte static-server limit`,
        );
    }

    const rawPath = rawPathFromRequestTarget(requestTarget);
    if (!rawPath.startsWith('/')) {
        throw new RouteRejection(
            StaticRouteOutcome.BadRequest,
            'the request target is not an absolute URL path',
        );
    }
    if (rawPath.includes('//')) {
        throw new RouteRejection(
            StaticRouteOutcome.BadRequest,
            'the request path contains an empty interior segment and would be normalized differently by common proxies',
        );
    }

    const rawSegments = rawPath.split('/').slice(1);
    const trailingSlash = rawPath.endsWith('/');
    if (trailingSlash) {
        rawSegments.pop();
    }
    if (rawSegments.length > MAX_PATH_SEGMENTS) {
        throw new RouteRejection(
            StaticRouteOutcome.BadRequest,
            `the request path exceeds the ${MAX_PATH_SEGMENTS}-segment static-server limit`,
        );
    }

    return {
        segments: rawSegments.map(decodeSegment),
        trailingSlash,
    };
};

const isContainedPath = (rootDirectory: string, candidatePath: string): boolean => {
    const candidateRelative = relative(rootDirectory, candidatePath);
    return candidateRelative === ''
        || (!isAbsolute(candidateRelative)
            && candidateRelative !== '..'
            && !candidateRelative.startsWith(`..${sep}`));
};

const isMissingError = (error: unknown): boolean => (
    error instanceof Error && 'code' in error && error.code === 'ENOENT'
);

type CandidateInspection = 'missing' | 'not-file' | 'forbidden' | Readonly<{
    filePath: string
    contentLength: number
}>;

const inspectCandidate = async (rootDirectory: string, candidatePath: string): Promise<CandidateInspection> => {
    if (!isContainedPath(rootDirectory, candidatePath)) {
        return 'forbidden';
    }

    const candidateRelative = relative(rootDirectory, candidatePath);
    let currentPath = rootDirectory;
    for (const segment of candidateRelative.split(sep).filter(Boolean)) {
        currentPath = join(currentPath, segment);
        try {
            const entry = await lstat(currentPath);
            if (entry.isSymbolicLink()) {
                return 'forbidden';
            }
        } catch (error) {
            if (isMissingError(error)) {
                return 'missing';
            }
            throw error;
        }
    }

    const canonicalCandidate = await realpath(candidatePath);
    if (!isContainedPath(rootDirectory, canonicalCandidate)) {
        return 'forbidden';
    }
    const candidateStat = await stat(canonicalCandidate);
    if (!candidateStat.isFile()) {
        return candidateStat.isDirectory() ? 'not-file' : 'forbidden';
    }

    return { filePath: canonicalCandidate, contentLength: candidateStat.size };
};

const mimeTypeForPath = (filePath: string): StaticMimeType => {
    const extension = extname(filePath).toLowerCase();
    const knownExtension = Object.values(StaticFileExtension).find((candidate) => candidate === extension);
    return knownExtension
        ? STATIC_MIME_BY_EXTENSION[knownExtension]
        : StaticMimeType.Binary;
};

interface RouteCandidate {
    readonly path: string
    readonly outcome: StaticRouteOutcome.File | StaticRouteOutcome.CleanHtml | StaticRouteOutcome.DirectoryIndex
}

export const resolveStaticRoute = async (
    options: StaticServerOptions,
    requestTarget: string,
    method: string,
): Promise<ResolvedStaticRoute> => {
    if (method !== 'GET' && method !== 'HEAD') {
        return {
            outcome: StaticRouteOutcome.MethodNotAllowed,
            statusCode: 405,
            detail: `method ${JSON.stringify(method)} is unsupported; generated artifacts are read-only and accept GET or HEAD`,
        };
    }

    const mountPath = normalizeMountPath(options.mountPath);
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
        throw new Error(
            `Static-server configuration failed while validating maxFileBytes=${JSON.stringify(maxFileBytes)}: `
            + 'the response-file bound must be a positive safe integer. No artifact was served; restore the reviewed bound.',
        );
    }
    let decoded: DecodedRequestPath;
    try {
        decoded = decodeRequestPath(requestTarget, options.maxRequestUrlBytes ?? DEFAULT_MAX_REQUEST_URL_BYTES);
    } catch (error) {
        if (error instanceof RouteRejection) {
            return rejectionResult(error.outcome, error.message);
        }
        throw error;
    }

    const mountSegments = mountPath.split('/').filter(Boolean);
    const mounted = mountSegments.every((segment, index) => decoded.segments[index] === segment);
    if (!mounted || decoded.segments.length < mountSegments.length) {
        return {
            outcome: StaticRouteOutcome.NotFound,
            statusCode: 404,
            detail: `the request is outside the configured ${mountPath} route mount`,
        };
    }

    const routeSegments = decoded.segments.slice(mountSegments.length);
    const configuredRoot = resolve(options.rootDirectory);
    let canonicalRoot: string;
    try {
        const rootEntry = await lstat(configuredRoot);
        if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
            throw new Error('the configured output root is a symlink or is not a directory');
        }
        canonicalRoot = await realpath(configuredRoot);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Static-server resolution failed while opening output root ${JSON.stringify(configuredRoot)}: ${reason}. `
            + 'No artifact was served; build the declared output directory and retry.',
        );
    }

    const routePath = join(canonicalRoot, ...routeSegments);
    const candidates: readonly RouteCandidate[] = routeSegments.length === 0 || decoded.trailingSlash
        ? [{ path: join(routePath, 'index.html'), outcome: StaticRouteOutcome.DirectoryIndex }]
        : [
            { path: routePath, outcome: StaticRouteOutcome.File },
            { path: `${routePath}.html`, outcome: StaticRouteOutcome.CleanHtml },
            { path: join(routePath, 'index.html'), outcome: StaticRouteOutcome.DirectoryIndex },
        ];

    for (const candidate of candidates) {
        const inspection = await inspectCandidate(canonicalRoot, candidate.path);
        if (inspection === 'forbidden') {
            return rejectionResult(
                StaticRouteOutcome.Forbidden,
                'the resolved request crosses a symbolic link or leaves the configured output root',
            );
        }
        if (inspection === 'missing' || inspection === 'not-file') {
            continue;
        }
        if (inspection.contentLength > maxFileBytes) {
            return rejectionResult(
                StaticRouteOutcome.Forbidden,
                `the resolved generated file is ${inspection.contentLength} bytes, above the ${maxFileBytes}-byte response bound`,
            );
        }

        return {
            outcome: candidate.outcome,
            statusCode: 200,
            filePath: inspection.filePath,
            mimeType: mimeTypeForPath(inspection.filePath),
            contentLength: inspection.contentLength,
            detail: 'the request resolved to a bounded generated artifact',
        };
    }

    return {
        outcome: StaticRouteOutcome.NotFound,
        statusCode: 404,
        detail: 'no exact file, clean HTML file, or directory index exists for the request',
    };
};

const sendErrorResponse = (
    response: ServerResponse,
    method: string,
    result: ResolvedStaticRoute,
): void => {
    const body = Buffer.from(
        `${result.statusCode} ${result.outcome}: ${result.detail}. `
        + 'No generated file was served; correct the route or rebuild the declared artifact.\n',
        'utf8',
    );
    response.statusCode = result.statusCode;
    response.setHeader('Content-Type', StaticMimeType.Text);
    response.setHeader('Content-Length', body.byteLength);
    response.setHeader('X-Content-Type-Options', NO_SNIFF_HEADER);
    if (result.outcome === StaticRouteOutcome.MethodNotAllowed) {
        response.setHeader('Allow', 'GET, HEAD');
    }
    response.end(method === 'HEAD' ? undefined : body);
};

const hasRequestBody = (request: IncomingMessage): boolean => {
    const transferEncoding = request.headers['transfer-encoding'];
    const contentLength = request.headers['content-length'];
    if (transferEncoding !== undefined) {
        return true;
    }
    if (contentLength === undefined) {
        return false;
    }
    return !/^0+$/.test(contentLength);
};

export const createStaticServer = (options: StaticServerOptions): Server => {
    normalizeMountPath(options.mountPath);
    const server = createServer(async (request, response) => {
        const method = request.method ?? '';
        try {
            if (method !== 'GET' && method !== 'HEAD') {
                request.resume();
                sendErrorResponse(response, method, {
                    outcome: StaticRouteOutcome.MethodNotAllowed,
                    statusCode: 405,
                    detail: `method ${JSON.stringify(method)} is unsupported; generated artifacts are read-only and accept GET or HEAD`,
                });
                return;
            }
            if (hasRequestBody(request)) {
                request.resume();
                sendErrorResponse(response, method, rejectionResult(
                    StaticRouteOutcome.BadRequest,
                    'GET and HEAD requests to generated artifacts must not contain a request body',
                ));
                return;
            }

            const result = await resolveStaticRoute(options, request.url ?? '', method);
            if (!result.filePath || !result.mimeType) {
                sendErrorResponse(response, method, result);
                return;
            }

            const file = await open(result.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
            let contents: Buffer;
            try {
                const openedStat = await file.stat();
                if (!openedStat.isFile()) {
                    throw new Error('the resolved artifact stopped being a regular file before it could be read');
                }
                if (openedStat.size > (options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)) {
                    throw new Error('the resolved artifact grew beyond the bounded response-file limit before it could be read');
                }
                contents = await file.readFile();
            } finally {
                await file.close();
            }

            response.statusCode = 200;
            response.setHeader('Content-Type', result.mimeType);
            response.setHeader('Content-Length', contents.byteLength);
            response.setHeader('X-Content-Type-Options', NO_SNIFF_HEADER);
            response.end(method === 'HEAD' ? undefined : contents);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            sendErrorResponse(response, method, {
                outcome: StaticRouteOutcome.Forbidden,
                statusCode: 403,
                detail: `the generated file could not be opened safely (${reason})`,
            });
        }
    });
    server.headersTimeout = 5_000;
    server.requestTimeout = 5_000;
    server.keepAliveTimeout = 1_000;
    server.maxConnections = 32;
    return server;
};

interface CliOptions extends StaticServerOptions {
    readonly host: '127.0.0.1' | '::1'
    readonly port: number
}

const parseCliOptions = (arguments_: readonly string[]): CliOptions => {
    const values = new Map<string, string>();
    for (let index = 0; index < arguments_.length; index += 2) {
        const flag = arguments_[index];
        const value = arguments_[index + 1];
        if (!flag || !value || !['--root', '--mount', '--host', '--port'].includes(flag) || values.has(flag)) {
            throw new Error(
                'Static-server startup failed while parsing CLI options: expected each of '
                + '`--root`, `--mount`, `--host`, and `--port` exactly once. No server was started; '
                + 'invoke the validation script through its recorded package command.',
            );
        }
        values.set(flag, value);
    }

    const rootDirectory = values.get('--root');
    const mountPath = values.get('--mount');
    const host = values.get('--host');
    const rawPort = values.get('--port');
    const port = Number(rawPort);
    if (!rootDirectory || !mountPath || (host !== '127.0.0.1' && host !== '::1')
        || !Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(
            'Static-server startup failed while validating CLI options: root and mount must be non-empty, '
            + 'host must be loopback, and port must be an integer from 1 through 65535. No server was started; '
            + 'use the generated Playwright validation command.',
        );
    }

    return { rootDirectory: resolve(rootDirectory), mountPath, host, port };
};

export const startStaticServer = async (options: CliOptions): Promise<Server> => {
    const server = createStaticServer(options);
    await new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(options.port, options.host, () => {
            server.off('error', rejectListen);
            resolveListen();
        });
    });
    return server;
};

const isMainModule = (): boolean => {
    const entry = process.argv[1];
    return entry !== undefined && import.meta.url === pathToFileURL(fileURLToPath(pathToFileURL(entry))).href;
};

const runCli = async (): Promise<void> => {
    try {
        const options = parseCliOptions(process.argv.slice(2));
        const server = await startStaticServer(options);
        process.stdout.write(`Static artifact server listening at http://${options.host}:${options.port}${normalizeMountPath(options.mountPath)}\n`);
        const close = (): void => {
            server.close((error) => {
                if (error) {
                    process.stderr.write(`Static-server shutdown failed: ${error.message}\n`);
                    process.exitCode = 1;
                }
            });
        };
        process.once('SIGINT', close);
        process.once('SIGTERM', close);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${reason}\n`);
        process.exitCode = 1;
    }
};

if (isMainModule()) {
    void runCli();
}
