// Single source of truth for private-fixture leak detection, shared by
// tests/artifacts/orchestrate.ts (production sentinel scan, via tsx) and
// tests/verify-generated-output.mjs (standalone verifier, via plain node).
// Kept as plain ESM (no TypeScript syntax) so both runtimes load the exact
// same values without a cross-runtime module-interop transform in between.
export const PRIVATE_FIXTURE_SENTINELS = Object.freeze([
    'Fixture active',
    'Fixture backlink',
    'Fixture direct',
    'Fixture distance two',
    'Fixture distance three',
    'Private fixture topology',
    'Validation topology fixture',
    'Validation active',
    'Validation backlink',
    'Validation direct',
    'Validation distance two',
    'Validation distance three',
    'PRIVATE_METADATA_FIXTURE_SENTINEL',
    'Graph fixture',
    'QUARTZ_VALIDATION_FIXTURE_ONLY',
    'tests/fixtures/quartz-content',
    'tests/fixtures/quartz-metadata',
    'tests/fixtures/quartz-reading-rail',
    'tests/fixtures/quartz-graph',
    'tests/fixtures/quartz-validation',
]);
