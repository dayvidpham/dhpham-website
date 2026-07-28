import { randomUUID } from 'node:crypto';
import { open, mkdir, readFile, rename, rm, chmod } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
    ArtifactKind,
    ArtifactManifest,
    ValidationStatus,
    VercelCredentialName,
} from './types';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const hasOnlyKeys = (
    value: Readonly<Record<string, unknown>>,
    allowedKeys: readonly string[],
): boolean => Object.keys(value).every((key) => allowedKeys.includes(key));

const isStringArray = (value: unknown): value is readonly string[] => (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
);

const isValidationStatus = (value: unknown): value is ValidationStatus => (
    typeof value === 'string' && Object.values(ValidationStatus).some((status) => status === value)
);

const isArtifactKind = (value: unknown): value is ArtifactKind => (
    typeof value === 'string' && Object.values(ArtifactKind).some((kind) => kind === value)
);

const isCredentialNameArray = (value: unknown): value is readonly VercelCredentialName[] => (
    Array.isArray(value)
    && value.every((entry) => typeof entry === 'string'
        && Object.values(VercelCredentialName).some((name) => name === entry))
);

const isArtifactManifest = (value: unknown): value is ArtifactManifest => {
    if (!isRecord(value)
        || !hasOnlyKeys(value, ['schemaVersion', 'sourceRevision', 'artifacts', 'vercel'])
        || value.schemaVersion !== 1
        || typeof value.sourceRevision !== 'string'
        || !/^[0-9a-f]{40}$/.test(value.sourceRevision)
        || !Array.isArray(value.artifacts)
        || !isRecord(value.vercel)) {
        return false;
    }

    const artifactsValid = value.artifacts.every((artifact) => {
        if (!isRecord(artifact)
            || !hasOnlyKeys(artifact, [
                'kind',
                'status',
                'inputRoot',
                'outputRoot',
                'buildCommand',
                'files',
                'routes',
            ])
            || !isArtifactKind(artifact.kind)
            || artifact.status !== ValidationStatus.Passed
            || typeof artifact.inputRoot !== 'string'
            || typeof artifact.outputRoot !== 'string'
            || !isStringArray(artifact.buildCommand)
            || !Array.isArray(artifact.files)
            || !isStringArray(artifact.routes)) {
            return false;
        }
        return artifact.files.every((file) => isRecord(file)
            && hasOnlyKeys(file, ['path', 'bytes', 'sha256'])
            && typeof file.path === 'string'
            && typeof file.bytes === 'number'
            && Number.isSafeInteger(file.bytes)
            && file.bytes >= 0
            && typeof file.sha256 === 'string'
            && /^[0-9a-f]{64}$/.test(file.sha256));
    });
    if (!artifactsValid) {
        return false;
    }

    const vercel = value.vercel;
    return hasOnlyKeys(vercel, [
        'provider',
        'status',
        'detail',
        'action',
        'knownPriorPreview',
        'routes',
        'missingCredentials',
    ])
        && vercel.provider === 'vercel'
        && isValidationStatus(vercel.status)
        && typeof vercel.detail === 'string'
        && typeof vercel.action === 'string'
        && vercel.knownPriorPreview === 'failed'
        && Array.isArray(vercel.routes)
        && vercel.routes.every((route) => isRecord(route)
            && hasOnlyKeys(route, ['route', 'status', 'httpStatus', 'detail'])
            && typeof route.route === 'string'
            && isValidationStatus(route.status)
            && (route.httpStatus === undefined
                || (typeof route.httpStatus === 'number' && Number.isInteger(route.httpStatus)))
            && typeof route.detail === 'string')
        && (vercel.missingCredentials === undefined || isCredentialNameArray(vercel.missingCredentials));
};

export const readArtifactManifest = async (manifestPath: string): Promise<ArtifactManifest> => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Artifact manifest read failed at ${JSON.stringify(manifestPath)}: ${reason}. `
            + 'The validation evidence cannot be trusted; rerun the serialized artifact gate to recreate it.',
            { cause: error },
        );
    }
    if (!isArtifactManifest(parsed)) {
        throw new Error(
            `Artifact manifest validation failed at ${JSON.stringify(manifestPath)}: the JSON does not match schema version 1. `
            + 'The validation evidence cannot be trusted; remove the generated manifest and rerun the artifact gate.',
        );
    }
    return parsed;
};

export const writeArtifactManifestAtomic = async (
    manifestPath: string,
    manifest: ArtifactManifest,
): Promise<void> => {
    const parentDirectory = dirname(manifestPath);
    const temporaryPath = join(
        parentDirectory,
        `.${basename(manifestPath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    await mkdir(parentDirectory, { recursive: true, mode: 0o700 });

    let temporaryFile: Awaited<ReturnType<typeof open>> | undefined;
    try {
        temporaryFile = await open(temporaryPath, 'wx', 0o600);
        await temporaryFile.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        await temporaryFile.sync();
        await temporaryFile.close();
        temporaryFile = undefined;
        await rename(temporaryPath, manifestPath);
        await chmod(manifestPath, 0o600);

        const parent = await open(parentDirectory, 'r');
        try {
            await parent.sync();
        } finally {
            await parent.close();
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Artifact manifest write failed at ${JSON.stringify(manifestPath)} during the atomic mode-0600 update: ${reason}. `
            + 'Existing evidence was not intentionally replaced; fix directory permissions and rerun validation.',
        );
    } finally {
        if (temporaryFile) {
            await temporaryFile.close().catch(() => undefined);
        }
        await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
};
