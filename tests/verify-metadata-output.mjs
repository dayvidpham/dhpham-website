import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const workspaceRoot = process.cwd();
const outputDirectory = join(workspaceRoot, '.test-artifacts', 'quartz-metadata');
const expectedCanonical = 'https://dhpham.com/blog/editorial-fixture';
const expectedRevision = 'baddd2a9d51c2b6a8bc65a67feddcfbbc48d9180';

const fail = (file, field, problem, fix) => {
    throw new Error(
        `Metadata output verification failed. Operation: verify generated metadata. File: ${JSON.stringify(file)}. `
        + `Field: ${JSON.stringify(field)}. Problem: ${problem}. `
        + 'Impact: the generated fixture cannot prove truthful public editorial metadata. '
        + `Fix: ${fix}.`,
    );
};

const requireCondition = (condition, file, field, problem, fix) => {
    if (!condition) {
        fail(file, field, problem, fix);
    }
};

const readGeneratedFile = async (path) => {
    const displayPath = relative(workspaceRoot, path);
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(
            displayPath,
            'generated file',
            `the expected artifact could not be read (${message})`,
            'run the metadata Quartz fixture build before this verifier',
        );
    }
};

const extractAttribute = (document, file, elementPattern, attribute, field) => {
    const element = document.match(elementPattern)?.[0];
    requireCondition(
        element,
        file,
        field,
        'the expected element is absent',
        `wire ${field} through the production Head component`,
    );
    const value = element.match(new RegExp(`${attribute}="([^"]*)"`))?.[1];
    requireCondition(
        value,
        file,
        field,
        `the expected ${attribute} attribute is absent`,
        `render ${attribute} from derivedPageMetadata`,
    );
    return value;
};

const parseStructuredData = (document, file) => {
    const serialized = document.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
    requireCondition(
        serialized,
        file,
        'BlogPosting JSON-LD',
        'the post has no structured-data script',
        'render BlogPosting only from the validated post record',
    );
    try {
        return JSON.parse(serialized);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(file, 'BlogPosting JSON-LD', `the script is not valid JSON (${message})`, 'serialize JSON-LD safely without HTML entity encoding');
    }
};

const postPath = join(outputDirectory, 'post.html');
const pagePath = join(outputDirectory, 'index.html');
const postFile = relative(workspaceRoot, postPath);
const pageFile = relative(workspaceRoot, pagePath);
const [post, page, sitemap, feed, serializedContentIndex] = await Promise.all([
    readGeneratedFile(postPath),
    readGeneratedFile(pagePath),
    readGeneratedFile(join(outputDirectory, 'sitemap.xml')),
    readGeneratedFile(join(outputDirectory, 'index.xml')),
    readGeneratedFile(join(outputDirectory, 'static', 'contentIndex.json')),
]);

const canonical = extractAttribute(post, postFile, /<link rel="canonical"[^>]*>/, 'href', 'canonical link');
const openGraphUrl = extractAttribute(post, postFile, /<meta property="og:url"[^>]*>/, 'content', 'og:url');
const openGraphType = extractAttribute(post, postFile, /<meta property="og:type"[^>]*>/, 'content', 'og:type');
assert.equal(canonical, expectedCanonical);
assert.equal(openGraphUrl, canonical);
assert.equal(openGraphType, 'article');

const structuredData = parseStructuredData(post, postFile);
assert.equal(structuredData['@type'], 'BlogPosting');
assert.equal(structuredData.url, canonical);
assert.equal(structuredData.mainEntityOfPage['@id'], canonical);
assert.equal(structuredData.dateCreated, '2026-07-01T08:00:00Z');
assert.equal(structuredData.datePublished, '2026-07-02T09:30:00Z');
assert.equal(structuredData.dateModified, '2026-07-03T10:45:00Z');
assert.deepEqual(structuredData.keywords, ['quartz', 'metadata']);
assert.equal(structuredData.isBasedOn.version, expectedRevision);
assert.deepEqual(structuredData.sameAs, ['https://notes.example.com/editorial-fixture']);

const visibleWords = post.match(/data-metadata-field="word-count">([\d,]+) words/)?.[1];
requireCondition(
    visibleWords,
    postFile,
    'visible word count',
    'ContentMeta does not expose the derived word count',
    'render the shared derivedPageMetadata.words value',
);
assert.equal(structuredData.wordCount, Number(visibleWords.replaceAll(',', '')));
assert.equal(structuredData.timeRequired, 'PT1M');
for (const [field, timestamp] of [
    ['created', '2026-07-01T08:00:00Z'],
    ['published', '2026-07-02T09:30:00Z'],
    ['modified', '2026-07-03T10:45:00Z'],
]) {
    requireCondition(
        post.includes(`data-metadata-field="${field}"`) && post.includes(`datetime="${timestamp}"`),
        postFile,
        field,
        'the visible timestamp does not match the explicit record',
        'render the validated ISO timestamp in ContentMeta',
    );
}
for (const expected of [
    'data-metadata-field="source"',
    expectedRevision,
    'tests/fixtures/quartz-metadata/post.md',
    'https://notes.example.com/editorial-fixture',
    'External editorial edition',
]) {
    requireCondition(
        post.includes(expected),
        postFile,
        'visible provenance',
        `the generated post omits ${JSON.stringify(expected)}`,
        'render source and cross-post fields only from their validated explicit values',
    );
}

assert.equal(
    extractAttribute(page, pageFile, /<link rel="canonical"[^>]*>/, 'href', 'canonical link'),
    'https://dhpham.com/blog/',
);
assert.equal(
    extractAttribute(page, pageFile, /<meta property="og:type"[^>]*>/, 'content', 'og:type'),
    'website',
);
for (const forbidden of [
    'application/ld+json',
    'article:published_time',
    'data-metadata-field="source"',
    'data-metadata-field="crossposts"',
    'data-metadata-field="created"',
    'data-metadata-field="published"',
    'data-metadata-field="modified"',
]) {
    requireCondition(
        !page.includes(forbidden),
        pageFile,
        'optional page metadata',
        `the page fabricated ${JSON.stringify(forbidden)}`,
        'omit absent dates and provenance and reserve BlogPosting for kind: post',
    );
}

let contentIndex;
try {
    contentIndex = JSON.parse(serializedContentIndex);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail('static/contentIndex.json', 'JSON', `the content index cannot be parsed (${message})`, 'emit valid bounded JSON');
}
assert.deepEqual(Object.keys(contentIndex).sort(), ['index', 'post']);
assert.deepEqual(contentIndex.post.tags, ['quartz', 'metadata']);
for (const [slug, details] of Object.entries(contentIndex)) {
    assert.deepEqual(
        Object.keys(details).sort(),
        ['content', 'links', 'tags', 'title'],
        `Browser content-index entry ${slug} must expose exactly its JSON-safe public contract.`,
    );
    assert.equal(
        Object.values(details).every((value) => (
            typeof value === 'string'
            || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
        )),
        true,
        `Browser content-index entry ${slug} must contain only strings and string arrays.`,
    );
}
assert.equal((sitemap.match(/<lastmod>/g) ?? []).length, 1);
assert.match(sitemap, /<lastmod>2026-07-03T10:45:00\.000Z<\/lastmod>/);
assert.match(sitemap, new RegExp(`<loc>${expectedCanonical}<\\/loc>`));
assert.equal((feed.match(/<pubDate>/g) ?? []).length, 1);
assert.match(feed, /<pubDate>Thu, 02 Jul 2026 09:30:00 GMT<\/pubDate>/);
assert.match(feed, new RegExp(`<link>${expectedCanonical}<\\/link>`));
assert.doesNotMatch(`${sitemap}\n${feed}`, /undefined|Invalid Date/);
