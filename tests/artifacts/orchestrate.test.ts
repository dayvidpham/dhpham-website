import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readArtifactManifest, writeArtifactManifestAtomic } from './manifest';
import {
    ARTIFACT_SPECS,
    PRIVATE_FIXTURE_SENTINELS,
    inventoryArtifact,
    orchestrateArtifacts,
    runCommandBounded,
    scanProductionSentinels,
    withAtomicDirectoryLock,
} from './orchestrate';
import {
    ArtifactFileRecord,
    ArtifactKind,
    ArtifactSpec,
    CommandRunner,
    ValidationStatus,
    VercelCredentialName,
    VercelCredentialState,
    asGitRevision,
} from './types';
import {
    inspectVercelCredentials,
    persistVercelResultIfManifestExists,
    runVercelPreviewValidation,
    VercelDependencies,
} from '../vercel-preview';

const REVISION = 'baddd2a9d51c2b6a8bc65a67feddcfbbc48d9180';

const spec = (
    kind: ArtifactKind,
    outputDirectory: string,
    maxFiles = 8,
): ArtifactSpec => ({
    kind,
    inputDirectory: kind === ArtifactKind.Production ? '.' : 'tests/fixtures/quartz-content',
    outputDirectory,
    routeMount: kind === ArtifactKind.Production ? '/' : '/blog/',
    buildCommand: ['fixture-build', kind],
    maxFiles,
    maxRoutes: 16,
    maxBytes: 16_384,
    maxFileBytes: 8_192,
});

test('declares the architecture-defined artifact paths statically with production last', () => {
    assert.deepEqual(ARTIFACT_SPECS.map((entry) => [entry.kind, entry.inputDirectory, entry.outputDirectory]), [
        [ArtifactKind.MetadataFixture, 'tests/fixtures/quartz-metadata', '.test-artifacts/quartz-metadata'],
        [ArtifactKind.ReadingRailFixture, 'tests/fixtures/quartz-reading-rail', '.test-artifacts/quartz-reading-rail'],
        [ArtifactKind.GraphFixture, 'tests/fixtures/quartz-graph', '.test-artifacts/quartz-graph'],
        [ArtifactKind.ExistingTopologyFixture, 'tests/fixtures/quartz-content', '.test-artifacts/quartz-fixture'],
        [ArtifactKind.ValidationFixture, 'tests/fixtures/quartz-validation', '.test-artifacts/quartz-validation'],
        [ArtifactKind.Production, '.', 'dist'],
    ]);
    assert.equal(ARTIFACT_SPECS.at(-1)?.kind, ArtifactKind.Production);
    assert.equal(new Set(ARTIFACT_SPECS.map((entry) => entry.outputDirectory)).size, ARTIFACT_SPECS.length);
});

test('atomic mkdir lock times out finitely under contention', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-lock-timeout-'));
    const lockDirectory = join(root, 'artifact.lock');
    await mkdir(lockDirectory);
    let now = 0;
    try {
        await assert.rejects(
            withAtomicDirectoryLock({ lockDirectory, timeoutMs: 30, retryMs: 10 }, async () => undefined, {
                now: () => now,
                sleep: async (milliseconds) => { now += milliseconds; },
            }),
            /timed out after 30ms.*still owns the atomic mkdir lock/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('atomic mkdir lock is released in finally when the operation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-lock-finally-'));
    const lockDirectory = join(root, 'artifact.lock');
    try {
        await assert.rejects(
            withAtomicDirectoryLock(
                { lockDirectory, timeoutMs: 100, retryMs: 5 },
                async () => { throw new Error('injected operation failure'); },
            ),
            /injected operation failure/,
        );
        await assert.rejects(stat(lockDirectory), { code: 'ENOENT' });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('atomic mkdir lock finally-cleanup failure preserves the original operation error as its cause', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-lock-double-failure-'));
    const lockDirectory = join(root, 'artifact.lock');
    try {
        await assert.rejects(
            withAtomicDirectoryLock(
                { lockDirectory, timeoutMs: 100, retryMs: 5 },
                async () => {
                    // Simulate the same disk-full/permission-loss condition that could plausibly
                    // fail both the build and the finally-block's rmdir cleanup: the lock
                    // directory itself is replaced by a regular file before the build reports
                    // its own failure, so cleanup's rmdir() rejects with ENOTDIR, not ENOENT.
                    await rm(lockDirectory, { recursive: true, force: true });
                    await writeFile(lockDirectory, 'lock directory replaced by a file');
                    throw new Error('injected operation failure');
                },
            ),
            (error: unknown) => {
                assert(error instanceof Error);
                assert.match(error.message, /Artifact lock release failed/);
                assert.match(error.message, /original build failure was: injected operation failure/);
                assert(error.cause instanceof Error);
                assert.equal(error.cause.message, 'injected operation failure');
                return true;
            },
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('builds sequentially, writes manifest after each success, hashes files, and scans production last', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-orchestration-'));
    const manifestPath = join(root, '.test-artifacts', 'artifact-manifest.json');
    const specs = [
        spec(ArtifactKind.ExistingTopologyFixture, '.test-artifacts/topology'),
        spec(ArtifactKind.ValidationFixture, '.test-artifacts/validation'),
        spec(ArtifactKind.Production, 'dist'),
    ] as const;
    let activeBuilds = 0;
    let maximumActiveBuilds = 0;
    const observedPriorManifestLengths: number[] = [];
    const runner: CommandRunner = async ({ command }) => {
        const rawKind = command[1];
        const currentSpec = specs.find((entry) => entry.kind === rawKind);
        assert(currentSpec);
        const kind = currentSpec.kind;
        if (kind !== ArtifactKind.ExistingTopologyFixture) {
            const prior = await readArtifactManifest(manifestPath);
            observedPriorManifestLengths.push(prior.artifacts.length);
        }
        activeBuilds += 1;
        maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
        const output = join(root, currentSpec.outputDirectory);
        await mkdir(join(output, 'nested'), { recursive: true });
        await writeFile(join(output, 'index.html'), `<h1>${kind}</h1>`);
        await writeFile(join(output, 'nested', 'data.json'), JSON.stringify({ kind }));
        activeBuilds -= 1;
        return { stdout: '', stderr: '' };
    };

    try {
        const manifest = await orchestrateArtifacts({
            workspaceRoot: root,
            specs,
            sourceRevision: REVISION,
            environment: {},
            buildTimeoutMs: 1_000,
        }, {
            runCommand: runner,
            writeManifest: writeArtifactManifestAtomic,
            lock: { now: Date.now, sleep: async (milliseconds) => {
                await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
            } },
        });

        assert.equal(maximumActiveBuilds, 1);
        assert.deepEqual(observedPriorManifestLengths, [1, 2]);
        assert.deepEqual(manifest.artifacts.map((record) => record.kind), specs.map((entry) => entry.kind));
        assert(manifest.artifacts.every((record) => record.status === ValidationStatus.Passed));
        assert.equal(manifest.artifacts.at(-1)?.kind, ArtifactKind.Production);
        const firstIndex = manifest.artifacts[0]?.files.find((file) => file.path === 'index.html');
        assert(firstIndex);
        assert.equal(
            firstIndex.sha256,
            createHash('sha256').update('<h1>existing-topology-fixture</h1>').digest('hex'),
        );
        assert.deepEqual(manifest.artifacts[0]?.routes, ['/blog/', '/blog/nested/data.json']);
        assert.equal((await stat(manifestPath)).mode & 0o777, 0o600);
        assert.equal((await readArtifactManifest(manifestPath)).artifacts.length, 3);
        await assert.rejects(stat(join(root, '.test-artifacts', 'artifact.lock')), { code: 'ENOENT' });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('rejects inventory overflow and production sentinels without leaving the lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-rejections-'));
    const overflowOutput = join(root, '.test-artifacts', 'overflow');
    await mkdir(overflowOutput, { recursive: true });
    await writeFile(join(overflowOutput, 'one.html'), 'one');
    await writeFile(join(overflowOutput, 'two.html'), 'two');
    try {
        await assert.rejects(
            inventoryArtifact(overflowOutput, spec(ArtifactKind.ValidationFixture, '.test-artifacts/overflow', 1)),
            /files exceed the declared 1 limit/,
        );

        const emptyOutput = join(root, '.test-artifacts', 'empty');
        await mkdir(emptyOutput, { recursive: true });
        await assert.rejects(
            inventoryArtifact(emptyOutput, spec(ArtifactKind.ValidationFixture, '.test-artifacts/empty')),
            /no regular files or routes/,
        );

        const collisionOutput = join(root, '.test-artifacts', 'collision');
        await mkdir(collisionOutput, { recursive: true });
        await writeFile(join(collisionOutput, 'same'), 'exact');
        await writeFile(join(collisionOutput, 'same.html'), 'clean html');
        await assert.rejects(
            inventoryArtifact(collisionOutput, spec(ArtifactKind.ValidationFixture, '.test-artifacts/collision')),
            /both resolve to route.*clean-route behavior is ambiguous/,
        );

        const productionSpec = spec(ArtifactKind.Production, 'dist');
        await assert.rejects(orchestrateArtifacts({
            workspaceRoot: root,
            specs: [productionSpec],
            sourceRevision: REVISION,
            buildTimeoutMs: 1_000,
        }, {
            runCommand: async () => {
                await mkdir(join(root, 'dist'), { recursive: true });
                await writeFile(join(root, 'dist', 'index.html'), 'Validation active');
                return { stdout: '', stderr: '' };
            },
            writeManifest: writeArtifactManifestAtomic,
            lock: { now: Date.now, sleep: async () => undefined },
        }), /Production sentinel scan failed.*Validation active/);
        await assert.rejects(stat(join(root, '.test-artifacts', 'artifact.lock')), { code: 'ENOENT' });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('production sentinel scan catches real leaked metadata fixture content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-sentinel-metadata-'));
    try {
        await writeFile(
            join(root, 'index.html'),
            '<p>PRIVATE_METADATA_FIXTURE_SENTINEL belongs only to generated test artifacts.</p>',
        );
        const files: readonly ArtifactFileRecord[] = [{ path: 'index.html', bytes: 0, sha256: '0'.repeat(64) }];
        await assert.rejects(
            scanProductionSentinels(root, files),
            /Production sentinel scan failed.*PRIVATE_METADATA_FIXTURE_SENTINEL/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('production sentinel scan catches real leaked graph fixture content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-sentinel-graph-'));
    try {
        await writeFile(join(root, 'active.html'), '<title>Graph fixture active</title>');
        const files: readonly ArtifactFileRecord[] = [{ path: 'active.html', bytes: 0, sha256: '0'.repeat(64) }];
        await assert.rejects(
            scanProductionSentinels(root, files),
            /Production sentinel scan failed.*Graph fixture/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('production sentinel scan catches a leaked reading-rail fixture by output path, since that fixture carries no distinguishing content marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-sentinel-reading-rail-'));
    try {
        const files: readonly ArtifactFileRecord[] = [{
            path: 'tests/fixtures/quartz-reading-rail/article.js.map',
            bytes: 0,
            sha256: '0'.repeat(64),
        }];
        await assert.rejects(
            scanProductionSentinels(root, files),
            /Production sentinel scan failed in path.*tests\/fixtures\/quartz-reading-rail/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('PRIVATE_FIXTURE_SENTINELS re-exports the single shared source of truth used by the standalone verifier', async () => {
    const shared = await import('../private-fixture-sentinels.mjs');
    assert.deepEqual([...PRIVATE_FIXTURE_SENTINELS], [...shared.PRIVATE_FIXTURE_SENTINELS]);
});

test('bounded subprocess runner terminates a hung command', async () => {
    await assert.rejects(runCommandBounded({
        command: [process.execPath, '-e', 'setTimeout(() => {}, 10000)'],
        cwd: process.cwd(),
        timeoutMs: 30,
        label: 'testing finite command timeout',
    }), /timed out after 30ms.*artifact is failed/);
});

test('Vercel credential boundary distinguishes absent, partial, and complete states without exposing values', () => {
    const absent = inspectVercelCredentials({});
    assert.equal(absent.state, VercelCredentialState.AllAbsent);
    assert.deepEqual(absent.missing, Object.values(VercelCredentialName));

    const partial = inspectVercelCredentials({ VERCEL_TOKEN: 'secret-token' });
    assert.equal(partial.state, VercelCredentialState.Partial);
    assert.deepEqual(partial.missing, [VercelCredentialName.OrganizationId, VercelCredentialName.ProjectId]);

    const complete = inspectVercelCredentials({
        VERCEL_TOKEN: 'secret-token',
        VERCEL_ORG_ID: 'organization',
        VERCEL_PROJECT_ID: 'project',
    });
    assert.equal(complete.state, VercelCredentialState.Complete);
});

test('Vercel no-credential state is an actionable skip preserving the known failed preview', async () => {
    let prepared = false;
    const result = await runVercelPreviewValidation({ environment: {} }, {
        runCommand: async () => { throw new Error('must not run'); },
        prepareWorkspace: async () => { prepared = true; },
        cleanupWorkspace: async () => undefined,
        resolveCli: async () => 'must-not-resolve',
        findPublicPost: async () => undefined,
        httpGet: async () => ({ status: 200 }),
    });
    assert.equal(result.status, ValidationStatus.SkippedMissingCredentials);
    assert.equal(result.knownPriorPreview, 'failed');
    assert.equal(prepared, false);
    assert.match(result.action, /Set VERCEL_TOKEN, VERCEL_ORG_ID, and VERCEL_PROJECT_ID together/);
});

test('Vercel partial credentials are a structured failure listing missing variables', async () => {
    const result = await runVercelPreviewValidation({
        environment: { VERCEL_TOKEN: 'never-print-this-token' },
    });
    assert.equal(result.status, ValidationStatus.Failed);
    assert.deepEqual(result.missingCredentials, [
        VercelCredentialName.OrganizationId,
        VercelCredentialName.ProjectId,
    ]);
    assert.doesNotMatch(JSON.stringify(result), /never-print-this-token/);
});

test('Vercel command timeout is failed and the bounded temporary workspace is cleaned in finally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-timeout-'));
    const temporaryWorkspace = join(root, '.test-artifacts', 'vercel-workspace');
    let cleanupCalls = 0;
    const dependencies: VercelDependencies = {
        runCommand: async () => {
            throw new Error('Subprocess timed out after 10ms during injected Vercel pull');
        },
        prepareWorkspace: async (_workspaceRoot, workspace) => {
            assert.equal(workspace, temporaryWorkspace);
            await mkdir(workspace, { recursive: true });
            await writeFile(join(workspace, 'bounded-input'), 'input');
        },
        cleanupWorkspace: async (workspace) => {
            cleanupCalls += 1;
            await rm(workspace, { recursive: true, force: true });
        },
        resolveCli: async () => '/pinned/vercel',
        findPublicPost: async () => undefined,
        httpGet: async () => ({ status: 200 }),
    };
    try {
        const result = await runVercelPreviewValidation({
            workspaceRoot: root,
            environment: {
                VERCEL_TOKEN: 'timeout-secret',
                VERCEL_ORG_ID: 'organization',
                VERCEL_PROJECT_ID: 'project',
            },
            subprocessTimeoutMs: 10,
        }, dependencies);
        assert.equal(result.status, ValidationStatus.Failed);
        assert.match(result.detail, /timed out after 10ms/);
        assert.doesNotMatch(JSON.stringify(result), /timeout-secret/);
        assert.equal(cleanupCalls, 1);
        await assert.rejects(stat(temporaryWorkspace), { code: 'ENOENT' });
        await assert.rejects(stat(join(root, '.vercel')), { code: 'ENOENT' });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Vercel no-public-post result remains a separate skip after required live routes pass', async () => {
    const commands: string[] = [];
    let cleanupCalls = 0;
    const result = await runVercelPreviewValidation({
        environment: {
            VERCEL_TOKEN: 'secret-token',
            VERCEL_ORG_ID: 'organization',
            VERCEL_PROJECT_ID: 'project',
        },
    }, {
        runCommand: async ({ command }) => {
            commands.push(command[1] ?? '');
            return {
                stdout: command[1] === 'deploy' ? 'Preview: https://bounded-preview.vercel.app\n' : '',
                stderr: '',
            };
        },
        prepareWorkspace: async () => undefined,
        cleanupWorkspace: async () => { cleanupCalls += 1; },
        resolveCli: async () => '/pinned/vercel',
        findPublicPost: async () => undefined,
        httpGet: async () => ({ status: 200 }),
    });
    assert.deepEqual(commands, ['pull', 'build', 'deploy']);
    assert.equal(result.status, ValidationStatus.SkippedNoPublicPost);
    assert.deepEqual(result.routes.map((route) => route.status), [
        ValidationStatus.Passed,
        ValidationStatus.Passed,
        ValidationStatus.SkippedNoPublicPost,
    ]);
    assert.equal(cleanupCalls, 1);
});

test('Vercel result atomically replaces external status only when the full manifest exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-manifest-'));
    const manifestPath = join(root, '.test-artifacts', 'artifact-manifest.json');
    const skipped = await runVercelPreviewValidation({ environment: {} });
    try {
        assert.equal(await persistVercelResultIfManifestExists(root, skipped), false);
        await writeArtifactManifestAtomic(manifestPath, {
            schemaVersion: 1,
            sourceRevision: asGitRevision(REVISION, 'constructing the Vercel persistence test manifest'),
            artifacts: [],
            vercel: {
                ...skipped,
                status: ValidationStatus.Failed,
                detail: 'Live validation has not run.',
            },
        });
        assert.equal(await persistVercelResultIfManifestExists(root, skipped), true);
        const persisted = await readArtifactManifest(manifestPath);
        assert.equal(persisted.vercel.status, ValidationStatus.SkippedMissingCredentials);
        assert.equal((await stat(manifestPath)).mode & 0o777, 0o600);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('atomic manifest reader rejects malformed evidence instead of casting it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-manifest-invalid-'));
    const manifestPath = join(root, 'manifest.json');
    try {
        await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, artifacts: 'not-an-array' }));
        await assert.rejects(readArtifactManifest(manifestPath), /does not match schema version 1/);
        assert.equal((await readFile(manifestPath, 'utf8')).includes('not-an-array'), true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('runs the real currently available topology and validation fixtures with production last', async () => {
    const availableCoreSpecs = [ARTIFACT_SPECS[3], ARTIFACT_SPECS[4], ARTIFACT_SPECS[5]] as const;
    const manifest = await orchestrateArtifacts({
        workspaceRoot: process.cwd(),
        specs: availableCoreSpecs,
        sourceRevision: REVISION,
        manifestPath: '.test-artifacts/core-artifact-manifest.json',
        lockDirectory: '.test-artifacts/core-artifact.lock',
        buildTimeoutMs: 180_000,
    });
    assert.deepEqual(manifest.artifacts.map((record) => record.kind), [
        ArtifactKind.ExistingTopologyFixture,
        ArtifactKind.ValidationFixture,
        ArtifactKind.Production,
    ]);
    assert(manifest.artifacts.every((record) => record.files.length > 0 && record.routes.length > 0));
    assert.equal(manifest.artifacts.at(-1)?.kind, ArtifactKind.Production);
});
