import { expect, Page, test } from '@playwright/test';

const waitForSceneStartup = async (page: Page): Promise<void> => {
    await expect.poll(() => page.locator('#blog-navigation').evaluate((element) => (
        element instanceof HTMLAnchorElement
        && element.style.left.endsWith('px')
        && element.style.top.endsWith('px')
    ))).toBe(true);
};

const viewportCases = [
    { name: 'desktop DPR 1', width: 1280, height: 720, deviceScaleFactor: 1 },
    { name: 'desktop DPR 2', width: 800, height: 600, deviceScaleFactor: 2 },
    { name: 'mobile DPR 3 capped at 2', width: 390, height: 844, deviceScaleFactor: 3 },
] as const;

for (const viewportCase of viewportCases) {
    test(`sizes the production canvas for ${viewportCase.name}`, async ({ browser }) => {
        const context = await browser.newContext({
            deviceScaleFactor: viewportCase.deviceScaleFactor,
            viewport: { width: viewportCase.width, height: viewportCase.height },
        });
        try {
            const page = await context.newPage();
            const pageErrors: Error[] = [];
            page.on('pageerror', (error) => pageErrors.push(error));

            await page.goto('/');
            await waitForSceneStartup(page);
            const canvas = page.locator('#main-canvas');
            const pixelRatio = Math.min(viewportCase.deviceScaleFactor, 2);

            await expect(canvas).toBeVisible();
            await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => ({
                width: element.width,
                height: element.height,
                clientWidth: element.clientWidth,
                clientHeight: element.clientHeight,
            }))).toEqual({
                width: viewportCase.width * pixelRatio,
                height: viewportCase.height * pixelRatio,
                clientWidth: viewportCase.width,
                clientHeight: viewportCase.height,
            });
            expect(pageErrors).toEqual([]);
        } finally {
            await context.close();
        }
    });
}

test('restores the original scene after repeated viewport resizes', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await waitForSceneStartup(page);
    await page.waitForTimeout(100);
    const canvas = page.locator('#main-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveScreenshot('scene.png', {
        maxDiffPixelRatio: 0.02,
        timeout: 0,
    });

    for (const viewport of [
        { width: 400, height: 300 },
        { width: 1200, height: 900 },
        { width: 640, height: 480 },
        { width: 800, height: 600 },
    ]) {
        await page.setViewportSize(viewport);
    }

    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => ({
        width: element.width,
        height: element.height,
    }))).toEqual({ width: 1600, height: 1200 });
    await page.waitForTimeout(100);
    await expect(canvas).toHaveScreenshot('scene.png', {
        maxDiffPixelRatio: 0.02,
        timeout: 0,
    });
    expect(pageErrors).toEqual([]);
});

test('matches the celestial visual baseline during continuous motion', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.goto('/');
    await waitForSceneStartup(page);
    await page.waitForTimeout(100);

    expect(pageErrors).toEqual([]);
    await expect.poll(() => page.locator('#main-canvas').evaluate((element: HTMLCanvasElement) => {
        const context = element.getContext('webgl2') ?? element.getContext('webgl');
        return context?.isContextLost() ?? true;
    })).toBe(false);
    await expect(page.locator('#main-canvas')).toHaveScreenshot('scene.png', {
        maxDiffPixelRatio: 0.02,
        timeout: 0,
    });
});

test('uses a visible, focusable native Blog link instead of canvas routing', async ({ page }) => {
    await page.goto('/');
    await waitForSceneStartup(page);

    const blogNavigation = page.locator('a#blog-navigation');
    await expect(blogNavigation).toBeVisible();
    await expect(blogNavigation).toHaveAttribute('href', '/blog/');
    await blogNavigation.focus();
    await expect(blogNavigation).toBeFocused();

    await Promise.all([
        page.waitForURL('**/blog/'),
        blogNavigation.press('Enter'),
    ]);
});
