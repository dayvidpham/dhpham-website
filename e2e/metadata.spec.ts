import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const fixtureSentinel = 'PRIVATE_METADATA_FIXTURE_SENTINEL';
const expectedCanonical = 'https://dhpham.com/blog/editorial-fixture';
const expectedRevision = 'baddd2a9d51c2b6a8bc65a67feddcfbbc48d9180';
const maxProductionFiles = 1000;

const collectProductionFiles = async (directory: string, files: string[] = []): Promise<string[]> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            await collectProductionFiles(path, files);
        } else if (entry.isFile()) {
            files.push(path);
            if (files.length > maxProductionFiles) {
                throw new Error(
                    `Metadata privacy verification failed. Operation: scan generated production output. `
                    + `File: ${JSON.stringify(relative(process.cwd(), directory))}. Field: "file inventory". `
                    + `Problem: production exceeds the ${maxProductionFiles}-file browser-test bound. `
                    + 'Impact: private metadata fixture absence cannot be exhaustively proven. '
                    + 'Fix: raise the reviewed static bound or reduce generated production files.',
                );
            }
        }
    }
    return files;
};

const assertPrivateFixtureAbsentFromProduction = async (): Promise<void> => {
    const productionRoot = join(process.cwd(), 'dist');
    const forbidden = [fixtureSentinel, 'tests/fixtures/quartz-metadata'];
    for (const path of await collectProductionFiles(productionRoot)) {
        const displayPath = relative(process.cwd(), path);
        const contents = await readFile(path, 'utf8');
        for (const sentinel of forbidden) {
            if (displayPath.includes(sentinel) || contents.includes(sentinel)) {
                throw new Error(
                    `Metadata privacy verification failed. Operation: scan generated production output. `
                    + `File: ${JSON.stringify(displayPath)}. Field: "private fixture sentinel". `
                    + `Problem: production contains ${JSON.stringify(sentinel)}. `
                    + 'Impact: private test authorship could become publicly deployable. '
                    + 'Fix: keep tests/fixtures/quartz-metadata input and .test-artifacts output outside the production build.',
                );
            }
        }
    }
};

const readGeneratedPost = async (): Promise<string> => {
    const path = join(process.cwd(), '.test-artifacts', 'quartz-metadata', 'post.html');
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Metadata browser setup failed. Operation: load generated metadata fixture. `
            + `File: ${JSON.stringify(relative(process.cwd(), path))}. Field: "generated post". `
            + `Problem: the artifact could not be read (${message}). `
            + 'Impact: browser behavior cannot verify the production metadata renderer. '
            + 'Fix: run the metadata Quartz fixture build before pnpm test:e2e.',
        );
    }
};

test('generated post exposes one consistent machine and visible metadata record', async ({ page }) => {
    await page.setContent(await readGeneratedPost(), { waitUntil: 'domcontentloaded' });

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', expectedCanonical);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
    expect(canonical).toBe(expectedCanonical);

    const structuredData = JSON.parse(
        await page.locator('script[type="application/ld+json"]').textContent() ?? '{}',
    );
    expect(structuredData['@type']).toBe('BlogPosting');
    expect(structuredData.url).toBe(canonical);
    expect(structuredData.mainEntityOfPage['@id']).toBe(canonical);
    expect(structuredData.datePublished).toBe('2026-07-02T09:30:00Z');
    expect(structuredData.isBasedOn.version).toBe(expectedRevision);

    const visibleWordCount = Number(
        (await page.locator('[data-metadata-field="word-count"]').textContent())
            ?.match(/[\d,]+/)?.[0]
            .replaceAll(',', ''),
    );
    expect(visibleWordCount).toBe(structuredData.wordCount);
    await expect(page.locator('[data-metadata-field="published"] time')).toHaveAttribute(
        'datetime',
        structuredData.datePublished,
    );
    await expect(page.locator('[data-source-revision]')).toHaveAttribute(
        'data-source-revision',
        expectedRevision,
    );
    await expect(page.locator('[data-metadata-field="crossposts"] a')).toHaveAttribute(
        'href',
        'https://notes.example.com/editorial-fixture',
    );
});

test('generated production coming-soon route stays a page and excludes private provenance', async ({ page }) => {
    await assertPrivateFixtureAbsentFromProduction();
    await page.goto('/blog/');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        'https://dhpham.com/blog/',
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        'content',
        'https://dhpham.com/blog/',
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    await expect(page.locator('[data-metadata-field="source"]')).toHaveCount(0);
    await expect(page.locator('[data-metadata-field="crossposts"]')).toHaveCount(0);
    await expect(page.locator('meta[property^="article:"]')).toHaveCount(0);

    const response = await page.request.get('/blog/static/contentIndex.json');
    expect(response.ok()).toBe(true);
    const contentIndex = await response.json();
    expect(Object.keys(contentIndex)).toEqual(['index']);
    expect(Object.keys(contentIndex.index).sort()).toEqual(['content', 'links', 'tags', 'title']);
    expect(JSON.stringify(contentIndex)).not.toContain(fixtureSentinel);
    expect(await page.locator('body').textContent()).not.toContain(fixtureSentinel);
});
