import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

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

const collectFiles = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(path));
        } else if (entry.isFile()) {
            files.push(path);
        }
    }

    return files;
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

    const fixtureSentinels = [
        'Fixture active',
        'Fixture direct',
        'Fixture distance two',
        'Fixture distance three',
        'Fixture backlink',
        'Private fixture topology',
        'tests/fixtures/quartz-content',
    ];
    const outputFiles = await collectFiles(join(workspaceRoot, 'dist'));

    for (const outputPath of outputFiles) {
        const outputRelativePath = relative(workspaceRoot, outputPath);
        for (const sentinel of fixtureSentinels) {
            requireCondition(
                !outputRelativePath.includes(sentinel),
                `${outputRelativePath} exposes private fixture sentinel ${JSON.stringify(sentinel)} in its path.`,
            );
        }

        const contents = await readGeneratedFile(outputPath);
        for (const sentinel of fixtureSentinels) {
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
} else {
    fail('expected exactly one mode argument: fixture or production.');
}
