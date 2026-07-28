import { expect, Locator, Page, test } from '@playwright/test';

enum FixtureNode {
    Index = 'index',
    Active = 'active',
    Direct = 'direct',
    DistanceTwo = 'distance-two',
    DistanceThree = 'distance-three',
    Backlink = 'backlink',
}

interface FixtureNodeExpectation {
    readonly slug: FixtureNode
    readonly title: string
    readonly route: string
    readonly outgoing: readonly FixtureNode[]
    readonly backlinks: readonly FixtureNode[]
    readonly depthTwo: readonly FixtureNode[]
}

const FIXTURE_NODES = [
    {
        slug: FixtureNode.Index,
        title: 'Validation topology fixture',
        route: '/blog/',
        outgoing: [],
        backlinks: [],
        depthTwo: [],
    },
    {
        slug: FixtureNode.Active,
        title: 'Validation active',
        route: '/blog/active',
        outgoing: [FixtureNode.Direct],
        backlinks: [FixtureNode.Backlink],
        depthTwo: [FixtureNode.Backlink, FixtureNode.Direct, FixtureNode.DistanceTwo],
    },
    {
        slug: FixtureNode.Direct,
        title: 'Validation direct',
        route: '/blog/direct',
        outgoing: [FixtureNode.DistanceTwo],
        backlinks: [FixtureNode.Active],
        depthTwo: [FixtureNode.Active, FixtureNode.Backlink, FixtureNode.DistanceThree, FixtureNode.DistanceTwo],
    },
    {
        slug: FixtureNode.DistanceTwo,
        title: 'Validation distance two',
        route: '/blog/distance-two',
        outgoing: [FixtureNode.DistanceThree],
        backlinks: [FixtureNode.Direct],
        depthTwo: [FixtureNode.Active, FixtureNode.Direct, FixtureNode.DistanceThree],
    },
    {
        slug: FixtureNode.DistanceThree,
        title: 'Validation distance three',
        route: '/blog/distance-three',
        outgoing: [],
        backlinks: [FixtureNode.DistanceTwo],
        depthTwo: [FixtureNode.Direct, FixtureNode.DistanceTwo],
    },
    {
        slug: FixtureNode.Backlink,
        title: 'Validation backlink',
        route: '/blog/backlink',
        outgoing: [FixtureNode.Active],
        backlinks: [],
        depthTwo: [FixtureNode.Active, FixtureNode.Direct],
    },
] as const satisfies readonly FixtureNodeExpectation[];

const bySlug = new Map(FIXTURE_NODES.map((node) => [node.slug, node]));

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readContentIndex = async (page: Page): Promise<Readonly<Record<string, readonly string[]>>> => {
    const response = await page.request.get('/blog/static/contentIndex.json');
    expect(response.ok()).toBe(true);
    const raw: unknown = await response.json();
    if (!isRecord(raw) || Object.keys(raw).length > 32) {
        throw new Error(
            'Generated-browser validation failed while parsing /blog/static/contentIndex.json: expected a bounded object. '
            + 'The topology evidence is invalid; inspect the validation fixture build.',
        );
    }
    const linksBySlug: Record<string, readonly string[]> = {};
    for (const [slug, entry] of Object.entries(raw)) {
        if (!isRecord(entry) || !Array.isArray(entry.links)
            || !entry.links.every((link) => typeof link === 'string')) {
            throw new Error(
                `Generated-browser validation failed at content-index node ${JSON.stringify(slug)}: links are not a string array. `
                + 'The topology evidence is invalid; fix generated contentIndex.json.',
            );
        }
        linksBySlug[slug] = [...entry.links].sort();
    }
    return linksBySlug;
};

const computeDepthTwo = (
    active: FixtureNode,
    linksBySlug: Readonly<Record<string, readonly string[]>>,
): readonly string[] => {
    const undirected = new Map<string, Set<string>>();
    for (const slug of Object.keys(linksBySlug)) {
        undirected.set(slug, new Set());
    }
    for (const [source, targets] of Object.entries(linksBySlug)) {
        for (const target of targets) {
            undirected.get(source)?.add(target);
            undirected.get(target)?.add(source);
        }
    }
    const seen = new Set<string>([active]);
    let frontier: readonly string[] = [active];
    for (let depth = 0; depth < 2; depth += 1) {
        const next: string[] = [];
        for (const slug of frontier) {
            for (const neighbor of undirected.get(slug) ?? []) {
                if (!seen.has(neighbor)) {
                    seen.add(neighbor);
                    next.push(neighbor);
                }
            }
        }
        frontier = next;
    }
    seen.delete(active);
    return [...seen].sort();
};

const normalizedHrefSlugs = async (locator: Locator): Promise<readonly string[]> => {
    const hrefs = await locator.evaluateAll((anchors) => anchors.map((anchor) => (
        anchor instanceof HTMLAnchorElement ? new URL(anchor.href).pathname : ''
    )));
    const slugs = hrefs.filter(Boolean).map((path) => {
        const withoutMount = path.replace(/^\/blog\/?/, '').replace(/\/$/, '');
        return withoutMount || FixtureNode.Index;
    });
    return [...new Set(slugs)].sort();
};

for (const node of FIXTURE_NODES) {
    test(`validates clean route, depth-2 topology, stock navigation, and errors for ${node.slug}`, async ({ page }) => {
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));

        const response = await page.goto(node.route);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', { name: node.title, exact: true }).first()).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`${node.route === '/blog/' ? '/blog/$' : `${node.route}/?$`}`));

        const linksBySlug = await readContentIndex(page);
        expect(Object.keys(linksBySlug).sort()).toEqual(FIXTURE_NODES.map((entry) => entry.slug).sort());
        expect(linksBySlug[node.slug]).toEqual([...node.outgoing].sort());
        expect(computeDepthTwo(node.slug, linksBySlug)).toEqual([...node.depthTwo].sort());

        const graphConfig = await page.locator('#graph-container').getAttribute('data-cfg');
        expect(graphConfig).not.toBeNull();
        expect(JSON.parse(graphConfig ?? '{}')).toMatchObject({ depth: 2 });

        await expect(page.locator('#explorer')).toBeVisible();
        if (await page.locator('#explorer').getAttribute('aria-expanded') === 'false') {
            await page.locator('#explorer').click();
        }
        await expect(page.locator('#explorer-content a')).toHaveCount(FIXTURE_NODES.length - 1);

        await page.locator('#search-button').click();
        await page.locator('#search-bar').fill(node.title);
        await expect(page.locator('#results-container a.result-card').first()).toContainText(node.title);
        await page.keyboard.press('Escape');

        expect(await normalizedHrefSlugs(page.locator('.backlinks a.internal'))).toEqual([...node.backlinks].sort());
        expect(pageErrors).toEqual([]);
    });
}

const graphModelSlug = (slug: FixtureNode): string => (slug === FixtureNode.Index ? '/' : slug);

test('graph route retains complete textual outgoing and backlink relationships without canvas', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    const response = await page.goto('/blog/graph/');
    expect(response?.status()).toBe(200);

    const relationships = page.getByRole('navigation', { name: 'Graph relationships' });
    await expect(relationships).toBeVisible();
    for (const node of FIXTURE_NODES) {
        const nodeRegion = relationships.locator(`[data-node-slug="${graphModelSlug(node.slug)}"]`);
        await expect(nodeRegion).toHaveCount(1);

        const titleLink = nodeRegion.locator('h3').getByRole('link', { name: node.title, exact: true });
        await expect(titleLink).toHaveCount(1);
        expect(await normalizedHrefSlugs(titleLink)).toEqual([node.slug]);

        const linkGroups = nodeRegion.locator('.published-graph-links');
        const outgoingLinks = linkGroups.filter({ hasText: 'Outgoing links' }).locator('ul a');
        const backlinkLinks = linkGroups.filter({ hasText: 'Backlinks' }).locator('ul a');
        expect(await normalizedHrefSlugs(outgoingLinks)).toEqual([...node.outgoing].sort());
        expect(await normalizedHrefSlugs(backlinkLinks)).toEqual([...node.backlinks].sort());
    }
    expect(pageErrors).toEqual([]);
});
