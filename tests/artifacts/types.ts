export type GitRevision = string & { readonly __brand: 'GitRevision' };

export enum ArtifactKind {
    MetadataFixture = 'metadata-fixture',
    ReadingRailFixture = 'reading-rail-fixture',
    GraphFixture = 'graph-fixture',
    ExistingTopologyFixture = 'existing-topology-fixture',
    ValidationFixture = 'validation-fixture',
    Production = 'production',
}

export enum ValidationStatus {
    Passed = 'passed',
    Failed = 'failed',
    SkippedMissingCredentials = 'skipped-missing-credentials',
    SkippedNoPublicPost = 'skipped-no-public-post',
}

export interface ArtifactSpec {
    readonly kind: ArtifactKind
    readonly inputDirectory: string
    readonly outputDirectory: string
    readonly routeMount: '/' | '/blog/'
    readonly buildCommand: readonly [executable: string, ...arguments_: string[]]
    readonly maxFiles: number
    readonly maxRoutes: number
    readonly maxBytes: number
    readonly maxFileBytes: number
}

export interface ArtifactFileRecord {
    readonly path: string
    readonly bytes: number
    readonly sha256: string
}

export interface ArtifactRecord {
    readonly kind: ArtifactKind
    readonly status: ValidationStatus.Passed
    readonly inputRoot: string
    readonly outputRoot: string
    readonly buildCommand: readonly string[]
    readonly files: readonly ArtifactFileRecord[]
    readonly routes: readonly string[]
}

export interface ExternalRouteRecord {
    readonly route: string
    readonly status: ValidationStatus
    readonly httpStatus?: number
    readonly detail: string
}

export interface ExternalValidationRecord {
    readonly provider: 'vercel'
    readonly status: ValidationStatus
    readonly detail: string
    readonly action: string
    readonly knownPriorPreview: 'failed'
    readonly routes: readonly ExternalRouteRecord[]
    readonly missingCredentials?: readonly VercelCredentialName[]
}

export interface ArtifactManifest {
    readonly schemaVersion: 1
    readonly sourceRevision: GitRevision
    readonly artifacts: readonly ArtifactRecord[]
    readonly vercel: ExternalValidationRecord
}

export enum VercelCredentialName {
    Token = 'VERCEL_TOKEN',
    OrganizationId = 'VERCEL_ORG_ID',
    ProjectId = 'VERCEL_PROJECT_ID',
}

export enum VercelCredentialState {
    AllAbsent = 'all-absent',
    Partial = 'partial',
    Complete = 'complete',
}

export interface CommandInvocation {
    readonly command: readonly [executable: string, ...arguments_: string[]]
    readonly cwd: string
    readonly timeoutMs: number
    readonly env?: Readonly<NodeJS.ProcessEnv>
    readonly label: string
}

export interface CommandResult {
    readonly stdout: string
    readonly stderr: string
}

export type CommandRunner = (invocation: CommandInvocation) => Promise<CommandResult>;

export const asGitRevision = (value: string, operation: string): GitRevision => {
    if (!/^[0-9a-f]{40}$/.test(value)) {
        throw new Error(
            `Artifact validation failed while ${operation}: source revision ${JSON.stringify(value)} is not a full `
            + '40-character lowercase Git commit. No manifest was written; run from a committed worktree and retry.',
        );
    }
    return value as GitRevision;
};
