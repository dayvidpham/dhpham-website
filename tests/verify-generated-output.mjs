import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { PRIVATE_FIXTURE_SENTINELS } from './private-fixture-sentinels.mjs';

const mode = process.argv[2];
const workspaceRoot = process.cwd();

const fail = (detail) => {
    throw new Error(
        `Generated-output verification failed during the ${mode ?? 'unknown'} check: ${detail} `
        + 'Run the matching build script before verification and inspect its generated output.',
    );
};

const requireCondition = (condition, detail) => {
    if (!condition) {
        fail(detail);
    }
};

const readGeneratedFile = async (path) => {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(`could not read ${relative(workspaceRoot, path)} (${message}).`);
    }
};

const readContentIndex = async (outputDirectory) => {
    const contentIndexPath = join(outputDirectory, 'static', 'contentIndex.json');
    const serializedIndex = await readGeneratedFile(contentIndexPath);

    try {
        return JSON.parse(serializedIndex);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(`could not parse ${relative(workspaceRoot, contentIndexPath)} as JSON (${message}).`);
    }
};

const readGraphConfig = (document, id, documentPath) => {
    const match = document.match(new RegExp(`<div id="${id}" data-cfg="([^"]+)"`));
    requireCondition(match, `${relative(workspaceRoot, documentPath)} does not emit ${id} graph configuration.`);

    try {
        return JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(`${relative(workspaceRoot, documentPath)} has invalid ${id} graph configuration (${message}).`);
    }
};

const collectFiles = async (directory, files = []) => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            await collectFiles(path, files);
        } else if (entry.isFile()) {
            files.push(path);
        }
        requireCondition(files.length <= 8192, 'generated file inventory exceeds the 8192-file verification bound.');
    }

    return files;
};

const assertValidationTopology = async () => {
    const outputDirectory = join(workspaceRoot, '.test-artifacts', 'quartz-validation');
    const contentIndex = await readContentIndex(outputDirectory);
    const expectedLinks = {
        index: [],
        active: ['direct'],
        backlink: ['active'],
        direct: ['distance-two'],
        'distance-two': ['distance-three'],
        'distance-three': [],
    };
    assert.deepEqual(Object.keys(contentIndex).sort(), Object.keys(expectedLinks).sort());
    for (const [slug, links] of Object.entries(expectedLinks)) {
        assert.deepEqual(contentIndex[slug].links, links, `Validation fixture ${slug} links must stay deterministic.`);
    }

    const graphPath = join(outputDirectory, 'graph', 'index.html');
    const graphDocument = await readGeneratedFile(graphPath);
    requireCondition(
        graphDocument.includes('aria-label="Graph relationships"'),
        `${relative(workspaceRoot, graphPath)} does not contain the complete textual graph alternative.`,
    );
};

const assertManifest = async () => {
    const manifestPath = join(workspaceRoot, '.test-artifacts', 'artifact-manifest.json');
    const serialized = await readGeneratedFile(manifestPath);
    let manifest;
    try {
        manifest = JSON.parse(serialized);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(`could not parse ${relative(workspaceRoot, manifestPath)} as JSON (${message}).`);
    }
    const expectedKinds = [
        'metadata-fixture',
        'reading-rail-fixture',
        'graph-fixture',
        'existing-topology-fixture',
        'validation-fixture',
        'production',
    ];
    requireCondition(manifest.schemaVersion === 1, 'artifact manifest schemaVersion is not 1.');
    requireCondition(/^[0-9a-f]{40}$/.test(manifest.sourceRevision), 'artifact manifest sourceRevision is not a full commit.');
    assert.deepEqual(manifest.artifacts.map((artifact) => artifact.kind), expectedKinds);
    requireCondition(
        manifest.artifacts.every((artifact) => artifact.status === 'passed'
            && artifact.files.length > 0
            && artifact.routes.length > 0
            && artifact.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))),
        'artifact manifest contains a non-passing, empty, or unhashed local artifact record.',
    );
    requireCondition(
        ['passed', 'failed', 'skipped-missing-credentials', 'skipped-no-public-post'].includes(manifest.vercel.status),
        'artifact manifest converts the separate Vercel result into an unknown or invented status.',
    );
    requireCondition(manifest.vercel.knownPriorPreview === 'failed', 'artifact manifest dropped the known prior failed Vercel evidence.');
    requireCondition(((await stat(manifestPath)).mode & 0o777) === 0o600, 'artifact manifest permissions are not mode 0600.');

    await assertFixtureTopology();
    await assertValidationTopology();
    await assertProductionOutput();
};

const assertFixtureTopology = async () => {
    const outputDirectory = join(workspaceRoot, '.test-artifacts', 'quartz-fixture');
    const activeDocumentPath = join(outputDirectory, 'active.html');
    const activeDocument = await readGeneratedFile(activeDocumentPath);
    const contentIndex = await readContentIndex(outputDirectory);

    assert.deepEqual(
        Object.keys(contentIndex).sort(),
        ['active', 'backlink', 'direct', 'distance-three', 'distance-two'],
        'Fixture content index must contain only the private topology nodes.',
    );
    assert.deepEqual(contentIndex.active.links, ['direct'], 'Fixture active node must link to direct.');
    assert.deepEqual(contentIndex.direct.links, ['distance-two'], 'Fixture direct node must link to distance-two.');
    assert.deepEqual(
        contentIndex['distance-two'].links,
        ['distance-three'],
        'Fixture distance-two node must link to distance-three.',
    );
    assert.deepEqual(contentIndex['distance-three'].links, [], 'Fixture distance-three node must terminate the chain.');
    assert.deepEqual(contentIndex.backlink.links, ['active'], 'Fixture backlink node must link into active.');
    assert.equal(readGraphConfig(activeDocument, 'graph-container', activeDocumentPath).depth, 2);
    assert.equal(readGraphConfig(activeDocument, 'global-graph-container', activeDocumentPath).depth, -1);
};

const assertProductionOutput = async () => {
    const outputDirectory = join(workspaceRoot, 'dist', 'blog');
    const indexPath = join(outputDirectory, 'index.html');
    const indexDocument = await readGeneratedFile(indexPath);
    const contentIndex = await readContentIndex(outputDirectory);
    const sitemap = await readGeneratedFile(join(outputDirectory, 'sitemap.xml'));
    const feed = await readGeneratedFile(join(outputDirectory, 'index.xml'));

    assert.deepEqual(Object.keys(contentIndex), ['index'], 'Production content index must expose only the Blog landing node.');
    assert.equal(contentIndex.index.title, 'Blog', 'Production content index must retain the Blog landing title.');
    requireCondition(/<h1(?:\s[^>]*)?>Coming soon/.test(indexDocument), 'dist/blog/index.html does not contain the coming-soon landing.');
    assert.equal(readGraphConfig(indexDocument, 'graph-container', indexPath).depth, 2);
    assert.equal(readGraphConfig(indexDocument, 'global-graph-container', indexPath).depth, -1);
    requireCondition(indexDocument.includes('https://dhpham.com/blog/static/og-image.png'), 'dist/blog/index.html does not emit the configured Quartz base URL.');
    requireCondition(sitemap.includes('https://dhpham.com/blog/'), 'dist/blog/sitemap.xml does not emit the configured Quartz base URL.');
    requireCondition(feed.includes('https://dhpham.com/blog/'), 'dist/blog/index.xml does not emit the configured Quartz base URL.');

    const outputFiles = await collectFiles(join(workspaceRoot, 'dist'));

    for (const outputPath of outputFiles) {
        const outputRelativePath = relative(workspaceRoot, outputPath);
        for (const sentinel of PRIVATE_FIXTURE_SENTINELS) {
            requireCondition(
                !outputRelativePath.includes(sentinel),
                `${outputRelativePath} exposes private fixture sentinel ${JSON.stringify(sentinel)} in its path.`,
            );
        }

        const contents = await readGeneratedFile(outputPath);
        for (const sentinel of PRIVATE_FIXTURE_SENTINELS) {
            requireCondition(
                !contents.includes(sentinel),
                `${outputRelativePath} exposes private fixture sentinel ${JSON.stringify(sentinel)} in its contents.`,
            );
        }
    }
};

if (mode === 'fixture') {
    await assertFixtureTopology();
} else if (mode === 'production') {
    await assertProductionOutput();
} else if (mode === 'manifest') {
    await assertManifest();
} else {
    fail('expected exactly one statically wired mode argument: fixture, production, or manifest.');
}
