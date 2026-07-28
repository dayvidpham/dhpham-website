import { expect, Page, test } from '@playwright/test';

type BoundingBox = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

const waitForSceneStartup = async (page: Page): Promise<void> => {
    await expect.poll(() => page.locator('#blog-navigation').evaluate((element) => (
        element instanceof HTMLAnchorElement
        && element.style.left.endsWith('px')
        && element.style.top.endsWith('px')
    ))).toBe(true);
};

const expectNavigationHitAreaWithinViewport = async (page: Page): Promise<BoundingBox> => {
    const navigation = page.locator('a#blog-navigation');
    const box = await navigation.boundingBox();
    if (!box) {
        throw new Error('The generated Blog navigation anchor has no rendered pointer hit area.');
    }

    const viewport = page.viewportSize();
    if (!viewport) {
        throw new Error('Playwright did not provide a viewport while checking the Blog navigation hit area.');
    }

    expect(box.x).toBeGreaterThanOrEqual(-0.5);
    expect(box.y).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
    await expect.poll(() => page.evaluate(({ x, y }) => (
        document.elementFromPoint(x, y)?.id ?? null
    ), {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
    })).toBe('blog-navigation');

    return box;
};

test('generated desktop home uses native pointer Blog navigation', async ({ page }) => {
    await page.goto('/');
    await waitForSceneStartup(page);

    const blogNavigation = page.locator('a#blog-navigation');
    await expect(page.locator('#main-canvas')).toBeVisible();
    await expect(blogNavigation).toHaveAttribute('href', '/blog/');
    const navigationBox = await expectNavigationHitAreaWithinViewport(page);
    await Promise.all([
        page.waitForURL('**/blog/'),
        page.mouse.click(
            navigationBox.x + navigationBox.width / 2,
            navigationBox.y + navigationBox.height / 2,
        ),
    ]);
    await expect(page.getByRole('heading', { name: 'Coming soon', exact: true })).toBeVisible();
});

test('generated desktop home uses native keyboard Blog navigation', async ({ page }) => {
    await page.goto('/');
    await waitForSceneStartup(page);

    const blogNavigation = page.locator('a#blog-navigation');
    await blogNavigation.focus();
    await expect(blogNavigation).toBeFocused();
    await Promise.all([
        page.waitForURL('**/blog/'),
        blogNavigation.press('Enter'),
    ]);
    await expect(page.getByRole('heading', { name: 'Coming soon', exact: true })).toBeVisible();
});

test('generated mobile home keeps the scene and complete Blog pointer target on-screen', async ({ browser }) => {
    const context = await browser.newContext({
        deviceScaleFactor: 3,
        viewport: { width: 390, height: 844 },
    });
    try {
        const page = await context.newPage();
        await page.goto('/');
        await waitForSceneStartup(page);

        await expect(page.locator('#main-canvas')).toBeVisible();
        await expect(page.locator('a#blog-navigation')).toBeVisible();
        await expectNavigationHitAreaWithinViewport(page);
    } finally {
        await context.close();
    }
});

test('generated Quartz exposes an operable empty Explorer, one search result, and its stock global overlay', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
        const page = await context.newPage();
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));

        await page.goto('/blog/');
        await expect(page.getByRole('heading', { name: 'Coming soon', exact: true })).toBeVisible();

        const explorer = page.locator('#explorer');
        await expect(explorer).toBeVisible();
        await expect(explorer).toHaveAttribute('aria-expanded', 'false');
        await explorer.click();
        await expect(explorer).toHaveAttribute('aria-expanded', 'true');
        const explorerLinks = page.locator('#explorer-content a');
        await expect(explorerLinks).toHaveCount(0);

        await page.locator('#search-button').click();
        await page.locator('#search-bar').fill('Blog');
        const searchResults = page.locator('#results-container a.result-card');
        await expect(searchResults).toHaveCount(1);
        await expect(searchResults).toContainText('Blog');
        await page.keyboard.press('Escape');
        await expect(page.locator('#search-container')).not.toHaveClass(/active/);

        await page.locator('#global-graph-icon').click();
        await expect(page.locator('#global-graph-outer')).toHaveClass(/active/);
        expect(pageErrors).toEqual([]);
    } finally {
        await context.close();
    }
});
