import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeArtifactManifestAtomic } from './manifest';
import {
    ArtifactFileRecord,
    ArtifactKind,
    ArtifactManifest,
    ArtifactRecord,
    ArtifactSpec,
    CommandInvocation,
    CommandResult,
    CommandRunner,
    ExternalValidationRecord,
    ValidationStatus,
    VercelCredentialName,
    asGitRevision,
} from './types';
import { PRIVATE_FIXTURE_SENTINELS as PRIVATE_FIXTURE_SENTINELS_SOURCE } from '../private-fixture-sentinels.mjs';

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_LOCK_RETRY_MS = 50;
const DEFAULT_BUILD_TIMEOUT_MS = 180_000;
const MAX_COMMAND_OUTPUT_BYTES = 1_048_576;

const quartzBuildCommand = (
    inputDirectory: string,
    outputDirectory: string,
): readonly [string, ...string[]] => [
    'corepack',
    'pnpm',
    '--dir',
    'blog/quartz',
    'quartz',
    'build',
    '--directory',
    `../../${inputDirectory}`,
    '--output',
    `../../${outputDirectory}`,
];

const fixtureSpec = (
    kind: Exclude<ArtifactKind, ArtifactKind.Production>,
    inputDirectory: string,
    outputDirectory: string,
): ArtifactSpec => ({
    kind,
    inputDirectory,
    outputDirectory,
    routeMount: '/blog/',
    buildCommand: quartzBuildCommand(inputDirectory, outputDirectory),
    maxFiles: 4_096,
    maxRoutes: 4_096,
    maxBytes: 268_435_456,
    maxFileBytes: 33_554_432,
});

export const ARTIFACT_SPECS = [
    fixtureSpec(
        ArtifactKind.MetadataFixture,
        'tests/fixtures/quartz-metadata',
        '.test-artifacts/quartz-metadata',
    ),
    fixtureSpec(
        ArtifactKind.ReadingRailFixture,
        'tests/fixtures/quartz-reading-rail',
        '.test-artifacts/quartz-reading-rail',
    ),
    fixtureSpec(
        ArtifactKind.GraphFixture,
        'tests/fixtures/quartz-graph',
        '.test-artifacts/quartz-graph',
    ),
    fixtureSpec(
        ArtifactKind.ExistingTopologyFixture,
        'tests/fixtures/quartz-content',
        '.test-artifacts/quartz-fixture',
    ),
    fixtureSpec(
        ArtifactKind.ValidationFixture,
        'tests/fixtures/quartz-validation',
        '.test-artifacts/quartz-validation',
    ),
    {
        kind: ArtifactKind.Production,
        inputDirectory: '.',
        outputDirectory: 'dist',
        routeMount: '/',
        buildCommand: ['pnpm', 'run', 'build'],
        maxFiles: 8_192,
        maxRoutes: 8_192,
        maxBytes: 536_870_912,
        maxFileBytes: 33_554_432,
    },
] as const satisfies readonly ArtifactSpec[];

// Source of truth lives in ../private-fixture-sentinels.mjs so the standalone
// tests/verify-generated-output.mjs verifier (run under plain node, not tsx)
// checks against the exact same markers instead of a second, driftable list.
export const PRIVATE_FIXTURE_SENTINELS: readonly string[] = PRIVATE_FIXTURE_SENTINELS_SOURCE;

const delay = async (milliseconds: number): Promise<void> => {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
};

export interface LockDependencies {
    readonly now: () => number
    readonly sleep: (milliseconds: number) => Promise<void>
}

export interface LockOptions {
    readonly lockDirectory: string
    readonly timeoutMs: number
    readonly retryMs: number
}

const errorCode = (error: unknown): string | undefined => (
    error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
);

const releaseLock = async (lockDirectory: string): Promise<void> => {
    await rmdir(lockDirectory).catch((error: unknown) => {
        if (errorCode(error) !== 'ENOENT') {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(
                `Artifact lock release failed at ${JSON.stringify(lockDirectory)}: ${reason}. `
                + 'Build outputs may be complete, but future validation is blocked; remove only this lock directory after confirming no build is active.',
            );
        }
    });
};

export const withAtomicDirectoryLock = async <Result>(
    options: LockOptions,
    operation: () => Promise<Result>,
    dependencies: LockDependencies = { now: Date.now, sleep: delay },
): Promise<Result> => {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0
        || !Number.isFinite(options.retryMs) || options.retryMs <= 0) {
        throw new Error(
            'Artifact lock configuration failed before acquisition: timeout and retry intervals must be finite positive values. '
            + 'No build ran; configure bounded lock timing and retry.',
        );
    }

    await mkdir(dirname(options.lockDirectory), { recursive: true, mode: 0o700 });
    const deadline = dependencies.now() + options.timeoutMs;
    let acquired = false;
    while (!acquired) {
        try {
            await mkdir(options.lockDirectory, { mode: 0o700 });
            acquired = true;
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') {
                const reason = error instanceof Error ? error.message : String(error);
                throw new Error(
                    `Artifact lock acquisition failed at ${JSON.stringify(options.lockDirectory)}: ${reason}. `
                    + 'No build ran; fix the lock parent permissions and retry.',
                );
            }
            const remaining = deadline - dependencies.now();
            if (remaining <= 0) {
                throw new Error(
                    `Artifact lock acquisition timed out after ${options.timeoutMs}ms at ${JSON.stringify(options.lockDirectory)}. `
                    + 'Another artifact build still owns the atomic mkdir lock; wait for it to finish or investigate a stale lock.',
                );
            }
            await dependencies.sleep(Math.min(options.retryMs, remaining));
        }
    }

    let result: Result;
    try {
        result = await operation();
    } catch (operationError) {
        try {
            await releaseLock(options.lockDirectory);
        } catch (releaseError) {
            const releaseReason = releaseError instanceof Error ? releaseError.message : String(releaseError);
            const operationReason = operationError instanceof Error ? operationError.message : String(operationError);
            throw new Error(
                `Artifact lock release failed at ${JSON.stringify(options.lockDirectory)} while handling a prior build failure: ${releaseReason}. `
                + `The original build failure was: ${operationReason}. `
                + 'Both the build and the lock cleanup failed; build outputs are incomplete and the lock directory may still be present. '
                + 'Investigate the original build failure above first, then remove only this lock directory after confirming no build is active.',
                { cause: operationError },
            );
        }
        throw operationError;
    }

    await releaseLock(options.lockDirectory);
    return result;
};

const appendBoundedOutput = (
    chunks: Buffer[],
    chunk: Buffer,
    currentBytes: number,
): number => {
    const nextBytes = currentBytes + chunk.byteLength;
    if (nextBytes <= MAX_COMMAND_OUTPUT_BYTES) {
        chunks.push(chunk);
    }
    return nextBytes;
};

export const runCommandBounded: CommandRunner = async (
    invocation: CommandInvocation,
): Promise<CommandResult> => {
    if (!Number.isFinite(invocation.timeoutMs) || invocation.timeoutMs <= 0) {
        throw new Error(
            `Subprocess configuration failed before ${invocation.label}: timeout must be finite and positive. `
            + 'No command ran; provide a bounded timeout.',
        );
    }

    return await new Promise<CommandResult>((resolveCommand, rejectCommand) => {
        const child = spawn(invocation.command[0], invocation.command.slice(1), {
            cwd: invocation.cwd,
            env: invocation.env ? { ...invocation.env } : process.env,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let timedOut = false;
        let outputOverflow = false;
        let settled = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, invocation.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
            stdoutBytes = appendBoundedOutput(stdoutChunks, chunk, stdoutBytes);
            if (stdoutBytes > MAX_COMMAND_OUTPUT_BYTES) {
                outputOverflow = true;
                child.kill('SIGKILL');
            }
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderrBytes = appendBoundedOutput(stderrChunks, chunk, stderrBytes);
            if (stderrBytes > MAX_COMMAND_OUTPUT_BYTES) {
                outputOverflow = true;
                child.kill('SIGKILL');
            }
        });

        child.once('error', (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            rejectCommand(new Error(
                `Subprocess failed to start during ${invocation.label} in ${JSON.stringify(invocation.cwd)}: ${error.message}. `
                + 'The artifact is failed; install the pinned toolchain and retry the recorded command.',
            ));
        });
        child.once('close', (code, signal) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');
            if (timedOut) {
                rejectCommand(new Error(
                    `Subprocess timed out after ${invocation.timeoutMs}ms during ${invocation.label} in ${JSON.stringify(invocation.cwd)}. `
                    + 'The artifact is failed and no later build was started; inspect the command for a hang and retry.',
                ));
                return;
            }
            if (outputOverflow) {
                rejectCommand(new Error(
                    `Subprocess output exceeded ${MAX_COMMAND_OUTPUT_BYTES} bytes during ${invocation.label}. `
                    + 'The artifact is failed to keep validation memory bounded; reduce noisy output and retry.',
                ));
                return;
            }
            if (code !== 0) {
                rejectCommand(new Error(
                    `Subprocess exited with code ${String(code)}${signal ? ` and signal ${signal}` : ''} during ${invocation.label}. `
                    + `The artifact is failed; inspect bounded stderr: ${stderr.trim() || '(empty)'}`,
                ));
                return;
            }
            resolveCommand({ stdout, stderr });
        });
    });
};

const validateRelativePath = (value: string, field: string, allowDot = false): void => {
    if ((allowDot && value === '.')) {
        return;
    }
    const segments = value.split('/');
    if (!value || isAbsolute(value) || value.includes('\\') || value.includes('\0')
        || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error(
            `Artifact specification validation failed for ${field}=${JSON.stringify(value)}: paths must be non-empty `
            + 'project-relative POSIX paths without dot segments, backslashes, or NUL bytes. No build ran; correct the static tuple.',
        );
    }
};

const isContainedAbsolutePath = (rootDirectory: string, candidatePath: string): boolean => {
    const candidateRelative = relative(rootDirectory, candidatePath);
    return candidateRelative !== ''
        && !isAbsolute(candidateRelative)
        && candidateRelative !== '..'
        && !candidateRelative.startsWith(`..${sep}`);
};

const validateSpecs = (specs: readonly ArtifactSpec[]): void => {
    if (specs.length === 0 || specs.length > 32) {
        throw new Error(
            'Artifact specification validation failed: the static tuple must contain between 1 and 32 bounded entries. '
            + 'No build ran; declare the required artifact specs statically.',
        );
    }
    const outputDirectories = new Set<string>();
    let productionIndex = -1;
    specs.forEach((spec, index) => {
        validateRelativePath(spec.inputDirectory, `${spec.kind}.inputDirectory`, true);
        validateRelativePath(spec.outputDirectory, `${spec.kind}.outputDirectory`);
        if (spec.outputDirectory !== 'dist' && !spec.outputDirectory.startsWith('.test-artifacts/')) {
            throw new Error(
                `Artifact specification validation failed for ${spec.kind}: output ${JSON.stringify(spec.outputDirectory)} `
                + 'is outside `dist` and `.test-artifacts`. No build ran; use an isolated declared output.',
            );
        }
        if (outputDirectories.has(spec.outputDirectory)) {
            throw new Error(
                `Artifact specification validation failed: output ${JSON.stringify(spec.outputDirectory)} is shared by multiple builds. `
                + 'No build ran; give every artifact a distinct output directory.',
            );
        }
        outputDirectories.add(spec.outputDirectory);
        if (spec.kind === ArtifactKind.Production) {
            if (productionIndex >= 0) {
                throw new Error('Artifact specification validation failed: production is declared more than once. No build ran.');
            }
            productionIndex = index;
        }
        if (spec.buildCommand.length === 0
            || ![spec.maxFiles, spec.maxRoutes, spec.maxBytes, spec.maxFileBytes]
                .every((limit) => Number.isSafeInteger(limit) && limit > 0)) {
            throw new Error(
                `Artifact specification validation failed for ${spec.kind}: command and inventory limits must be non-empty finite values. `
                + 'No build ran; correct the static tuple.',
            );
        }
    });
    if (productionIndex >= 0 && productionIndex !== specs.length - 1) {
        throw new Error(
            'Artifact specification validation failed: production must be the final tuple entry so fixture output cannot contaminate dist. '
            + 'No build ran; move production to the end of the static tuple.',
        );
    }
};

const sha256File = async (filePath: string): Promise<string> => await new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', rejectHash);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolveHash(hash.digest('hex')));
});

const routeForFile = (relativePath: string, mountPath: '/' | '/blog/'): string => {
    const mounted = (suffix: string): string => {
        if (mountPath === '/') {
            return suffix ? `/${suffix}` : '/';
        }
        return suffix ? `${mountPath}${suffix}` : mountPath;
    };

    if (relativePath === 'index.html') {
        return mountPath;
    }
    if (relativePath.endsWith('/index.html')) {
        return `${mounted(relativePath.slice(0, -'/index.html'.length))}/`;
    }
    if (relativePath.endsWith('.html')) {
        return mounted(relativePath.slice(0, -'.html'.length));
    }
    return mounted(relativePath);
};

export const inventoryArtifact = async (
    outputDirectory: string,
    spec: ArtifactSpec,
): Promise<Readonly<{ files: readonly ArtifactFileRecord[], routes: readonly string[] }>> => {
    const outputStat = await lstat(outputDirectory).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Artifact inventory failed for ${spec.kind} at ${JSON.stringify(outputDirectory)}: ${reason}. `
            + 'The build did not create its declared output; inspect the build command and retry.',
        );
    });
    if (!outputStat.isDirectory()) {
        throw new Error(
            `Artifact inventory failed for ${spec.kind}: ${JSON.stringify(outputDirectory)} is not a directory. `
            + 'The artifact is failed; correct the build output and retry.',
        );
    }

    const pending = [''];
    const files: ArtifactFileRecord[] = [];
    const routes = new Map<string, string>();
    let totalBytes = 0;
    let visitedEntries = 0;
    while (pending.length > 0) {
        const relativeDirectory = pending.pop() ?? '';
        const absoluteDirectory = join(outputDirectory, relativeDirectory);
        const entries = (await readdir(absoluteDirectory, { withFileTypes: true }))
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            visitedEntries += 1;
            if (visitedEntries > spec.maxFiles * 4) {
                throw new Error(
                    `Artifact inventory failed for ${spec.kind}: directory entries exceeded the bounded ${spec.maxFiles * 4} limit. `
                    + 'The artifact is failed; reduce generated fan-out or raise the reviewed static limit.',
                );
            }
            const entryRelative = relativeDirectory
                ? posix.join(relativeDirectory.split(sep).join('/'), entry.name)
                : entry.name;
            const entryAbsolute = join(outputDirectory, ...entryRelative.split('/'));
            if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
                throw new Error(
                    `Artifact inventory failed for ${spec.kind}: ${JSON.stringify(entryRelative)} is a symlink or special file. `
                    + 'The artifact is failed because its hash inventory cannot safely follow it; emit regular files only.',
                );
            }
            if (entry.isDirectory()) {
                pending.push(entryRelative);
                continue;
            }

            if (files.length >= spec.maxFiles) {
                throw new Error(
                    `Artifact inventory failed for ${spec.kind}: files exceed the declared ${spec.maxFiles} limit. `
                    + 'The artifact is failed; reduce output or raise the reviewed static limit.',
                );
            }
            const fileStat = await lstat(entryAbsolute);
            if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
                throw new Error(
                    `Artifact inventory failed for ${spec.kind}: ${JSON.stringify(entryRelative)} changed into a symlink or special file. `
                    + 'The artifact is failed because its hash inventory cannot safely follow it; stop concurrent mutation and retry.',
                );
            }
            if (fileStat.size > spec.maxFileBytes) {
                throw new Error(
                    `Artifact inventory failed for ${spec.kind}: ${JSON.stringify(entryRelative)} is ${fileStat.size} bytes, `
                    + `above the ${spec.maxFileBytes}-byte per-file limit. The artifact is failed; reduce the file or raise the reviewed static limit.`,
                );
            }
            totalBytes += fileStat.size;
            if (totalBytes > spec.maxBytes) {
                throw new Error(
                    `Artifact inventory failed for ${spec.kind}: total bytes exceed the declared ${spec.maxBytes} limit. `
                    + 'The artifact is failed; reduce output or raise the reviewed static limit.',
                );
            }
            files.push({
                path: entryRelative,
                bytes: fileStat.size,
                sha256: await sha256File(entryAbsolute),
            });
            const route = routeForFile(entryRelative, spec.routeMount);
            const collidingFile = routes.get(route);
            if (collidingFile) {
                throw new Error(
                    `Artifact inventory failed for ${spec.kind}: ${JSON.stringify(entryRelative)} and `
                    + `${JSON.stringify(collidingFile)} both resolve to route ${JSON.stringify(route)}. `
                    + 'The artifact is failed because clean-route behavior is ambiguous; emit exactly one file per route.',
                );
            }
            routes.set(route, entryRelative);
            if (routes.size > spec.maxRoutes) {
                throw new Error(
                    `Artifact inventory failed for ${spec.kind}: routes exceed the declared ${spec.maxRoutes} limit. `
                    + 'The artifact is failed; reduce output or raise the reviewed static limit.',
                );
            }
        }
    }

    files.sort((left, right) => left.path.localeCompare(right.path));
    if (files.length === 0 || routes.size === 0) {
        throw new Error(
            `Artifact inventory failed for ${spec.kind}: the generated output has no regular files or routes. `
            + 'The artifact is failed; inspect the build command instead of recording an empty pass.',
        );
    }
    return { files, routes: [...routes.keys()].sort() };
};

export const scanProductionSentinels = async (
    outputDirectory: string,
    files: readonly ArtifactFileRecord[],
): Promise<void> => {
    const sentinelBuffers = PRIVATE_FIXTURE_SENTINELS.map((sentinel) => ({
        sentinel,
        bytes: Buffer.from(sentinel, 'utf8'),
    }));
    for (const file of files) {
        for (const { sentinel } of sentinelBuffers) {
            if (file.path.includes(sentinel)) {
                throw new Error(
                    `Production sentinel scan failed in path ${JSON.stringify(file.path)}: it contains private marker ${JSON.stringify(sentinel)}. `
                    + 'Production validation is failed; remove fixture output and rebuild production last.',
                );
            }
        }
        const contents = await readFile(join(outputDirectory, ...file.path.split('/')));
        for (const { sentinel, bytes } of sentinelBuffers) {
            if (contents.indexOf(bytes) >= 0) {
                throw new Error(
                    `Production sentinel scan failed in ${JSON.stringify(file.path)}: contents include private marker ${JSON.stringify(sentinel)}. `
                    + 'Production validation is failed; remove fixture input from the production build and rebuild production last.',
                );
            }
        }
    }
};

const initialVercelRecord = (environment: Readonly<NodeJS.ProcessEnv>): ExternalValidationRecord => {
    const names = Object.values(VercelCredentialName);
    const present = names.filter((name) => Boolean(environment[name]));
    if (present.length === 0) {
        return {
            provider: 'vercel',
            status: ValidationStatus.SkippedMissingCredentials,
            detail: 'Live Vercel validation was not run because all three local credentials are absent; the known prior GitHub preview remains failed.',
            action: 'Set VERCEL_TOKEN, VERCEL_ORG_ID, and VERCEL_PROJECT_ID together, then run `pnpm run test:vercel-preview`.',
            knownPriorPreview: 'failed',
            routes: [],
            missingCredentials: names,
        };
    }
    const missing = names.filter((name) => !environment[name]);
    return {
        provider: 'vercel',
        status: ValidationStatus.Failed,
        detail: missing.length > 0
            ? `Live Vercel validation has a partial credential boundary; missing ${missing.join(', ')}.`
            : 'All Vercel credentials are present, but the separate bounded live-preview command has not run yet.',
        action: missing.length > 0
            ? 'Set all three Vercel variables together or unset all of them, then rerun the live-preview gate.'
            : 'Run `pnpm run test:vercel-preview`; local artifact success does not replace live deployment evidence.',
        knownPriorPreview: 'failed',
        routes: [],
        ...(missing.length > 0 ? { missingCredentials: missing } : {}),
    };
};

export interface OrchestrationDependencies {
    readonly runCommand: CommandRunner
    readonly writeManifest: (path: string, manifest: ArtifactManifest) => Promise<void>
    readonly lock: LockDependencies
}

export interface OrchestrationOptions {
    readonly workspaceRoot?: string
    readonly specs?: readonly ArtifactSpec[]
    readonly manifestPath?: string
    readonly lockDirectory?: string
    readonly lockTimeoutMs?: number
    readonly lockRetryMs?: number
    readonly buildTimeoutMs?: number
    readonly sourceRevision?: string
    readonly vercel?: ExternalValidationRecord
    readonly environment?: Readonly<NodeJS.ProcessEnv>
}

const defaultDependencies: OrchestrationDependencies = {
    runCommand: runCommandBounded,
    writeManifest: writeArtifactManifestAtomic,
    lock: { now: Date.now, sleep: delay },
};

export const orchestrateArtifacts = async (
    options: OrchestrationOptions = {},
    dependencies: OrchestrationDependencies = defaultDependencies,
): Promise<ArtifactManifest> => {
    const workspaceRoot = resolve(options.workspaceRoot ?? WORKSPACE_ROOT);
    const specs = options.specs ?? ARTIFACT_SPECS;
    const manifestPath = resolve(workspaceRoot, options.manifestPath ?? '.test-artifacts/artifact-manifest.json');
    const lockDirectory = resolve(workspaceRoot, options.lockDirectory ?? '.test-artifacts/artifact.lock');
    const artifactStateRoot = resolve(workspaceRoot, '.test-artifacts');
    const buildTimeoutMs = options.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
    validateSpecs(specs);
    if (!isContainedAbsolutePath(artifactStateRoot, manifestPath)
        || !isContainedAbsolutePath(artifactStateRoot, lockDirectory)) {
        throw new Error(
            'Artifact orchestration configuration failed: manifest and lock paths must remain below the ignored '
            + '`.test-artifacts` directory. No build ran; restore the static state paths and retry.',
        );
    }
    if (![buildTimeoutMs, options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS]
        .every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error(
            'Artifact orchestration configuration failed: build and lock timeouts must be finite positive values. '
            + 'No build ran; use the reviewed bounded defaults or valid overrides.',
        );
    }

    return await withAtomicDirectoryLock({
        lockDirectory,
        timeoutMs: options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
        retryMs: options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS,
    }, async () => {
        let sourceRevision = options.sourceRevision;
        if (!sourceRevision) {
            const revisionResult = await dependencies.runCommand({
                command: ['git', 'rev-parse', 'HEAD'],
                cwd: workspaceRoot,
                timeoutMs: 5_000,
                label: 'resolving the source revision for the artifact manifest',
            });
            sourceRevision = revisionResult.stdout.trim();
        }
        const revision = asGitRevision(sourceRevision, 'recording the serialized artifact run');
        const vercel = options.vercel ?? initialVercelRecord(options.environment ?? process.env);
        const records: ArtifactRecord[] = [];

        for (const spec of specs) {
            const outputDirectory = resolve(workspaceRoot, spec.outputDirectory);
            await rm(outputDirectory, { recursive: true, force: true });
            await dependencies.runCommand({
                command: spec.buildCommand,
                cwd: workspaceRoot,
                timeoutMs: buildTimeoutMs,
                label: `building static ${spec.kind} artifact`,
            });
            const inventory = await inventoryArtifact(outputDirectory, spec);
            if (spec.kind === ArtifactKind.Production) {
                await scanProductionSentinels(outputDirectory, inventory.files);
            }
            records.push({
                kind: spec.kind,
                status: ValidationStatus.Passed,
                inputRoot: spec.inputDirectory,
                outputRoot: spec.outputDirectory,
                buildCommand: [...spec.buildCommand],
                files: inventory.files,
                routes: inventory.routes,
            });
            await dependencies.writeManifest(manifestPath, {
                schemaVersion: 1,
                sourceRevision: revision,
                artifacts: [...records],
                vercel,
            });
        }

        return {
            schemaVersion: 1,
            sourceRevision: revision,
            artifacts: records,
            vercel,
        };
    }, dependencies.lock);
};

const isMainModule = (): boolean => {
    const entry = process.argv[1];
    return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
};

const runCli = async (): Promise<void> => {
    try {
        const manifest = await orchestrateArtifacts();
        process.stdout.write(`${JSON.stringify({
            status: ValidationStatus.Passed,
            manifest: '.test-artifacts/artifact-manifest.json',
            artifacts: manifest.artifacts.map((artifact) => artifact.kind),
            productionBuiltLast: manifest.artifacts.at(-1)?.kind === ArtifactKind.Production,
            vercel: manifest.vercel.status,
        })}\n`);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${reason}\n`);
        process.exitCode = 1;
    }
};

if (isMainModule()) {
    void runCli();
}
