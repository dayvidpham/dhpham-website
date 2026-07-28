import { access, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runCommandBounded } from './artifacts/orchestrate';
import { readArtifactManifest, writeArtifactManifestAtomic } from './artifacts/manifest';
import {
    ArtifactManifest,
    CommandRunner,
    ExternalRouteRecord,
    ExternalValidationRecord,
    ValidationStatus,
    VercelCredentialName,
    VercelCredentialState,
} from './artifacts/types';

const PINNED_VERCEL_VERSION = '57.0.0';
const DEFAULT_SUBPROCESS_TIMEOUT_MS = 180_000;
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const MAX_WORKSPACE_FILES = 20_000;
const MAX_WORKSPACE_BYTES = 536_870_912;
const MAX_WORKSPACE_FILE_BYTES = 33_554_432;
const MAX_CONTENT_INDEX_ENTRIES = 4_096;

const WORKSPACE_INPUTS = [
    'blog',
    'public',
    'src',
    'index.css',
    'index.html',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'vercel.json',
] as const;

interface CompleteVercelCredentials {
    readonly token: string
    readonly organizationId: string
    readonly projectId: string
}

export type VercelCredentialInspection =
    | Readonly<{
        state: VercelCredentialState.AllAbsent
        missing: readonly VercelCredentialName[]
    }>
    | Readonly<{
        state: VercelCredentialState.Partial
        missing: readonly VercelCredentialName[]
    }>
    | Readonly<{
        state: VercelCredentialState.Complete
        credentials: CompleteVercelCredentials
        missing: readonly []
    }>;

const nonEmptyEnvironmentValue = (
    environment: Readonly<NodeJS.ProcessEnv>,
    name: VercelCredentialName,
): string | undefined => {
    const value = environment[name];
    return value && value.trim() ? value : undefined;
};

export const inspectVercelCredentials = (
    environment: Readonly<NodeJS.ProcessEnv>,
): VercelCredentialInspection => {
    const token = nonEmptyEnvironmentValue(environment, VercelCredentialName.Token);
    const organizationId = nonEmptyEnvironmentValue(environment, VercelCredentialName.OrganizationId);
    const projectId = nonEmptyEnvironmentValue(environment, VercelCredentialName.ProjectId);
    const missing = [
        ...(token ? [] : [VercelCredentialName.Token]),
        ...(organizationId ? [] : [VercelCredentialName.OrganizationId]),
        ...(projectId ? [] : [VercelCredentialName.ProjectId]),
    ];

    if (missing.length === 3) {
        return { state: VercelCredentialState.AllAbsent, missing };
    }
    if (missing.length > 0) {
        return { state: VercelCredentialState.Partial, missing };
    }
    if (!token || !organizationId || !projectId) {
        throw new Error(
            'Vercel credential inspection reached an inconsistent complete state. No deployment ran; '
            + 'set all three required variables to non-empty values and retry.',
        );
    }
    return {
        state: VercelCredentialState.Complete,
        credentials: { token, organizationId, projectId },
        missing: [],
    };
};

const missingCredentialRecord = (missing: readonly VercelCredentialName[]): ExternalValidationRecord => ({
    provider: 'vercel',
    status: ValidationStatus.SkippedMissingCredentials,
    detail: 'Live Vercel preview validation was skipped because all local credentials are absent; the known prior GitHub preview remains failed.',
    action: 'Set VERCEL_TOKEN, VERCEL_ORG_ID, and VERCEL_PROJECT_ID together, then rerun `pnpm run test:vercel-preview`.',
    knownPriorPreview: 'failed',
    routes: [],
    missingCredentials: missing,
});

const partialCredentialRecord = (missing: readonly VercelCredentialName[]): ExternalValidationRecord => ({
    provider: 'vercel',
    status: ValidationStatus.Failed,
    detail: `Live Vercel preview validation failed at the credential boundary because these variables are missing: ${missing.join(', ')}. No CLI command ran.`,
    action: 'Set all three Vercel variables together or unset all three for an explicit local skip, then rerun the gate.',
    knownPriorPreview: 'failed',
    routes: [],
    missingCredentials: missing,
});

interface CopyBudget {
    files: number
    bytes: number
}

const copyBounded = async (
    sourcePath: string,
    destinationPath: string,
    budget: CopyBudget,
): Promise<void> => {
    const sourceStat = await lstat(sourcePath);
    if (sourceStat.isSymbolicLink() || (!sourceStat.isDirectory() && !sourceStat.isFile())) {
        throw new Error(
            `Vercel workspace preparation rejected ${JSON.stringify(sourcePath)} because it is a symlink or special file. `
            + 'No deployment ran; replace it with bounded regular project input.',
        );
    }
    if (sourceStat.isDirectory()) {
        await mkdir(destinationPath, { recursive: true, mode: 0o700 });
        const entries = (await readdir(sourcePath, { withFileTypes: true }))
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            if (['.git', '.test-artifacts', 'dist', 'node_modules', 'out'].includes(entry.name)) {
                continue;
            }
            await copyBounded(join(sourcePath, entry.name), join(destinationPath, entry.name), budget);
        }
        return;
    }

    budget.files += 1;
    budget.bytes += sourceStat.size;
    if (budget.files > MAX_WORKSPACE_FILES
        || budget.bytes > MAX_WORKSPACE_BYTES
        || sourceStat.size > MAX_WORKSPACE_FILE_BYTES) {
        throw new Error(
            `Vercel workspace preparation exceeded a static copy bound at ${JSON.stringify(sourcePath)} `
            + `(files=${budget.files}, bytes=${budget.bytes}, fileBytes=${sourceStat.size}). `
            + 'No deployment ran; reduce project inputs or review and raise the declared limits.',
        );
    }
    await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
    const destinationMode = (sourceStat.mode & 0o111) === 0 ? 0o600 : 0o700;
    await writeFile(destinationPath, await readFile(sourcePath), { mode: destinationMode });
};

export const prepareVercelWorkspace = async (
    workspaceRoot: string,
    temporaryWorkspace: string,
): Promise<void> => {
    await rm(temporaryWorkspace, { recursive: true, force: true });
    await mkdir(temporaryWorkspace, { recursive: true, mode: 0o700 });
    const budget: CopyBudget = { files: 0, bytes: 0 };
    for (const input of WORKSPACE_INPUTS) {
        await copyBounded(join(workspaceRoot, input), join(temporaryWorkspace, input), budget);
    }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const resolvePinnedVercelCli = async (workspaceRoot: string): Promise<string> => {
    const packagePath = join(workspaceRoot, 'node_modules', 'vercel', 'package.json');
    let packageJson: unknown;
    try {
        packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Vercel CLI validation failed while reading ${JSON.stringify(packagePath)}: ${reason}. `
            + `No deployment ran; install the frozen root lockfile containing vercel@${PINNED_VERCEL_VERSION}.`,
        );
    }
    if (!isRecord(packageJson) || packageJson.version !== PINNED_VERCEL_VERSION) {
        throw new Error(
            `Vercel CLI validation failed: installed version is ${JSON.stringify(isRecord(packageJson) ? packageJson.version : undefined)}, `
            + `not the required ${PINNED_VERCEL_VERSION}. No deployment ran; run the frozen root install and retry.`,
        );
    }
    const executable = join(workspaceRoot, 'node_modules', '.bin', 'vercel');
    await access(executable, constants.X_OK).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Vercel CLI validation failed while checking ${JSON.stringify(executable)}: ${reason}. `
            + 'No deployment ran; restore the frozen root installation and retry.',
        );
    });
    return executable;
};

const cleanPublicSlug = (slug: string): string | undefined => {
    const segments = slug.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..'
        || segment.includes('\\') || segment.includes('\0') || segment.includes('%'))) {
        return undefined;
    }
    return segments.map(encodeURIComponent).join('/');
};

export const findFirstPublicCleanPost = async (temporaryWorkspace: string): Promise<string | undefined> => {
    const contentIndexPath = join(
        temporaryWorkspace,
        '.vercel',
        'output',
        'static',
        'blog',
        'static',
        'contentIndex.json',
    );
    let parsed: unknown;
    try {
        parsed = JSON.parse(await readFile(contentIndexPath, 'utf8'));
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Vercel public-post discovery failed while reading ${JSON.stringify(contentIndexPath)} after `
            + `the preview build: ${reason}. Deployment was not attempted; inspect Vercel's prebuilt static output.`,
        );
    }
    if (!isRecord(parsed)) {
        throw new Error(
            `Vercel public-post discovery failed at ${JSON.stringify(contentIndexPath)}: contentIndex.json is not an object. `
            + 'Deployment was not attempted; fix the generated Quartz content index.',
        );
    }
    const entries = Object.entries(parsed);
    if (entries.length > MAX_CONTENT_INDEX_ENTRIES) {
        throw new Error(
            `Vercel public-post discovery failed: contentIndex.json has ${entries.length} entries, above the `
            + `${MAX_CONTENT_INDEX_ENTRIES}-entry bound. Deployment was not attempted; review the public inventory limit.`,
        );
    }

    for (const [slug, rawEntry] of entries.sort(([left], [right]) => left.localeCompare(right))) {
        if (slug === 'index' || slug === 'graph/index' || slug.startsWith('tags/')) {
            continue;
        }
        if (isRecord(rawEntry) && rawEntry.kind !== undefined && rawEntry.kind !== 'post') {
            continue;
        }
        const safeSlug = cleanPublicSlug(slug);
        if (safeSlug) {
            return `/blog/${safeSlug}`;
        }
    }
    return undefined;
};

const parseDeploymentUrl = (stdout: string): URL => {
    const withoutAnsi = stdout.replace(/\u001b\[[0-9;]*m/g, '');
    const candidates = withoutAnsi.match(/https:\/\/[^\s]+/g) ?? [];
    const rawUrl = candidates.at(-1);
    if (!rawUrl) {
        throw new Error(
            'Vercel deployment failed while parsing the bounded CLI output: no HTTPS preview URL was returned. '
            + 'The live gate is failed; inspect the deployment logs and retry.',
        );
    }
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error(
            'Vercel deployment failed while parsing the bounded CLI output: no valid HTTPS preview URL was returned. '
            + 'The live gate is failed; inspect the deployment logs and retry.',
        );
    }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app')
        || url.username || url.password || url.search || url.hash) {
        throw new Error(
            `Vercel deployment failed while validating returned host ${JSON.stringify(url.hostname)}: `
            + 'expected a credential-free HTTPS *.vercel.app preview URL. The live gate is failed; inspect the CLI target.',
        );
    }
    return url;
};

export interface HttpResult {
    readonly status: number
}

const boundedHttpGet = async (url: URL, timeoutMs: number): Promise<HttpResult> => {
    const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return { status: response.status };
};

export interface VercelDependencies {
    readonly runCommand: CommandRunner
    readonly prepareWorkspace: (workspaceRoot: string, temporaryWorkspace: string) => Promise<void>
    readonly cleanupWorkspace: (temporaryWorkspace: string) => Promise<void>
    readonly resolveCli: (workspaceRoot: string) => Promise<string>
    readonly findPublicPost: (temporaryWorkspace: string) => Promise<string | undefined>
    readonly httpGet: (url: URL, timeoutMs: number) => Promise<HttpResult>
}

export interface VercelOptions {
    readonly workspaceRoot?: string
    readonly environment?: Readonly<NodeJS.ProcessEnv>
    readonly subprocessTimeoutMs?: number
    readonly httpTimeoutMs?: number
}

const defaultDependencies: VercelDependencies = {
    runCommand: runCommandBounded,
    prepareWorkspace: prepareVercelWorkspace,
    cleanupWorkspace: async (temporaryWorkspace) => {
        await rm(temporaryWorkspace, { recursive: true, force: true });
    },
    resolveCli: resolvePinnedVercelCli,
    findPublicPost: findFirstPublicCleanPost,
    httpGet: boundedHttpGet,
};

const redactSecrets = (message: string, credentials: CompleteVercelCredentials): string => {
    let redacted = message;
    for (const secret of [credentials.token, credentials.organizationId, credentials.projectId]) {
        redacted = redacted.replaceAll(secret, '[REDACTED]');
    }
    return redacted;
};

const failedRecord = (detail: string, routes: readonly ExternalRouteRecord[] = []): ExternalValidationRecord => ({
    provider: 'vercel',
    status: ValidationStatus.Failed,
    detail,
    action: 'Inspect the named Vercel step, correct credentials/project output/network behavior, and rerun `pnpm run test:vercel-preview`.',
    knownPriorPreview: 'failed',
    routes,
});

export const runVercelPreviewValidation = async (
    options: VercelOptions = {},
    dependencies: VercelDependencies = defaultDependencies,
): Promise<ExternalValidationRecord> => {
    const environment = options.environment ?? process.env;
    const inspection = inspectVercelCredentials(environment);
    if (inspection.state === VercelCredentialState.AllAbsent) {
        return missingCredentialRecord(inspection.missing);
    }
    if (inspection.state === VercelCredentialState.Partial) {
        return partialCredentialRecord(inspection.missing);
    }

    const subprocessTimeoutMs = options.subprocessTimeoutMs ?? DEFAULT_SUBPROCESS_TIMEOUT_MS;
    const httpTimeoutMs = options.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    if (![subprocessTimeoutMs, httpTimeoutMs].every((value) => Number.isFinite(value) && value > 0)) {
        return failedRecord(
            'Live Vercel preview validation failed before workspace creation because subprocess and HTTP timeouts must be finite positive values.',
        );
    }

    const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    const temporaryWorkspace = join(workspaceRoot, '.test-artifacts', 'vercel-workspace');
    if (temporaryWorkspace !== resolve(workspaceRoot, '.test-artifacts/vercel-workspace')) {
        return failedRecord('Live Vercel preview validation rejected an unsafe temporary workspace path before any CLI command ran.');
    }

    const credentials = inspection.credentials;
    const childEnvironment: NodeJS.ProcessEnv = {
        ...environment,
        VERCEL_TOKEN: credentials.token,
        VERCEL_ORG_ID: credentials.organizationId,
        VERCEL_PROJECT_ID: credentials.projectId,
    };
    const routes: ExternalRouteRecord[] = [];
    let result: ExternalValidationRecord | undefined;
    let cleanupFailure: string | undefined;
    try {
        await dependencies.prepareWorkspace(workspaceRoot, temporaryWorkspace);
        const cli = await dependencies.resolveCli(workspaceRoot);
        await dependencies.runCommand({
            command: [cli, 'pull', '--yes', '--environment=preview'],
            cwd: temporaryWorkspace,
            timeoutMs: subprocessTimeoutMs,
            env: childEnvironment,
            label: 'linking the bounded temporary Vercel preview workspace',
        });
        await dependencies.runCommand({
            command: [cli, 'build', '--yes'],
            cwd: temporaryWorkspace,
            timeoutMs: subprocessTimeoutMs,
            env: childEnvironment,
            label: 'building the bounded temporary Vercel preview workspace',
        });
        const publicPostRoute = await dependencies.findPublicPost(temporaryWorkspace);
        const deployment = await dependencies.runCommand({
            command: [cli, 'deploy', '--prebuilt', '--yes'],
            cwd: temporaryWorkspace,
            timeoutMs: subprocessTimeoutMs,
            env: childEnvironment,
            label: 'deploying the bounded prebuilt Vercel preview',
        });
        const previewUrl = parseDeploymentUrl(deployment.stdout);
        const requiredRoutes = ['/blog/', '/blog/graph/'] as const;
        for (const route of requiredRoutes) {
            const response = await dependencies.httpGet(new URL(route, previewUrl), httpTimeoutMs);
            const passed = response.status >= 200 && response.status < 300;
            routes.push({
                route,
                status: passed ? ValidationStatus.Passed : ValidationStatus.Failed,
                httpStatus: response.status,
                detail: passed
                    ? 'The bounded live preview request returned a successful HTTP status.'
                    : 'The bounded live preview request returned a non-success HTTP status.',
            });
            if (!passed) {
                result = failedRecord(
                    `Live Vercel preview validation failed at route ${route} with HTTP ${response.status}; the known prior failed preview is not replaced.`,
                    routes,
                );
                break;
            }
        }

        if (!result && !publicPostRoute) {
            routes.push({
                route: '<first-public-clean-post>',
                status: ValidationStatus.SkippedNoPublicPost,
                detail: 'No authored public post exists in the bounded generated content index, so no clean post route was claimed as successful.',
            });
            result = {
                provider: 'vercel',
                status: ValidationStatus.SkippedNoPublicPost,
                detail: 'The live preview root and graph routes passed, but clean-post validation was separately skipped because no public post exists.',
                action: 'After publishing the first validated post, rerun this gate so its extensionless route receives live evidence.',
                knownPriorPreview: 'failed',
                routes,
            };
        }

        if (!result && publicPostRoute) {
            const response = await dependencies.httpGet(new URL(publicPostRoute, previewUrl), httpTimeoutMs);
            const passed = response.status >= 200 && response.status < 300;
            routes.push({
                route: publicPostRoute,
                status: passed ? ValidationStatus.Passed : ValidationStatus.Failed,
                httpStatus: response.status,
                detail: passed
                    ? 'The first authored public post resolved through its extensionless clean route.'
                    : 'The first authored public post clean route returned a non-success HTTP status.',
            });
            result = passed ? {
                provider: 'vercel',
                status: ValidationStatus.Passed,
                detail: 'The bounded live Vercel preview, required routes, and first public clean post passed; this real run replaces the prior failed status.',
                action: 'Retain this structured result with the artifact manifest for implementation UAT.',
                knownPriorPreview: 'failed',
                routes,
            } : failedRecord(
                `Live Vercel preview validation failed at clean post route ${publicPostRoute} with HTTP ${response.status}; the prior failure remains current.`,
                routes,
            );
        }
    } catch (error) {
        const reason = redactSecrets(error instanceof Error ? error.message : String(error), credentials);
        result = failedRecord(
            `Live Vercel preview validation failed during a bounded workspace, CLI, or HTTP step: ${reason} The known prior failed preview remains current.`,
            routes,
        );
    } finally {
        try {
            await dependencies.cleanupWorkspace(temporaryWorkspace);
        } catch (error) {
            cleanupFailure = error instanceof Error ? error.message : String(error);
        }
    }

    if (cleanupFailure) {
        return failedRecord(
            `Live Vercel preview validation failed while cleaning ${JSON.stringify(temporaryWorkspace)} in finally: ${cleanupFailure}. `
            + 'Temporary project linkage may remain; remove only that ignored workspace before retrying.',
            routes,
        );
    }
    return result ?? failedRecord(
        'Live Vercel preview validation ended without a typed result after cleanup. The prior failed preview remains current.',
        routes,
    );
};

const errorHasCode = (error: unknown, expectedCode: string): boolean => {
    let current = error;
    for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
        if ('code' in current && current.code === expectedCode) {
            return true;
        }
        current = current.cause;
    }
    return false;
};

export const persistVercelResultIfManifestExists = async (
    workspaceRoot: string,
    vercel: ExternalValidationRecord,
): Promise<boolean> => {
    const manifestPath = join(resolve(workspaceRoot), '.test-artifacts', 'artifact-manifest.json');
    let manifest: ArtifactManifest;
    try {
        manifest = await readArtifactManifest(manifestPath);
    } catch (error) {
        if (errorHasCode(error, 'ENOENT')) {
            return false;
        }
        throw error;
    }
    await writeArtifactManifestAtomic(manifestPath, { ...manifest, vercel });
    return true;
};

const isMainModule = (): boolean => {
    const entry = process.argv[1];
    return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
};

const runCli = async (): Promise<void> => {
    let result = await runVercelPreviewValidation();
    try {
        await persistVercelResultIfManifestExists(process.cwd(), result);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result = failedRecord(
            `Live Vercel validation produced a result but failed to atomically update the existing artifact manifest: ${reason}`,
            result.routes,
        );
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === ValidationStatus.Failed) {
        process.exitCode = 1;
    }
};

if (isMainModule()) {
    void runCli();
}
