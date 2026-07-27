import { BrowserContext, expect, Page, test } from '@playwright/test';

const addDeterministicSceneState = async (context: BrowserContext): Promise<void> => {
    await context.addInitScript(() => {
        let randomState = 0x12345678;
        Math.random = () => {
            randomState = (1664525 * randomState + 1013904223) >>> 0;
            return randomState / 0x100000000;
        };

        let animationFrame = 0;
        const callbacks = new Map<number, FrameRequestCallback>();
        window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
            animationFrame += 1;
            callbacks.set(animationFrame, callback);
            return animationFrame;
        };
        window.cancelAnimationFrame = (id: number) => callbacks.delete(id);
        Object.assign(window, {
            __renderTestFrame: () => {
                const pending = Array.from(callbacks.values());
                callbacks.clear();
                pending.forEach((callback) => callback(1000));
            },
        });
    });
};

const renderTestFrame = async (page: Page): Promise<void> => {
    await page.evaluate(() => {
        const testWindow = window as Window & { __renderTestFrame: () => void };
        testWindow.__renderTestFrame();
    });
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
        await addDeterministicSceneState(context);
        try {
            const page = await context.newPage();
            const pageErrors: Error[] = [];
            page.on('pageerror', (error) => pageErrors.push(error));

            await page.goto('/');
            await renderTestFrame(page);
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
    await addDeterministicSceneState(page.context());
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await renderTestFrame(page);
    const canvas = page.locator('#main-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveScreenshot('scene.png');

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
    await renderTestFrame(page);
    await expect(canvas).toHaveScreenshot('scene.png');
    expect(pageErrors).toEqual([]);
});

test('matches the deterministic scene baseline', async ({ page }) => {
    await addDeterministicSceneState(page.context());
    await page.goto('/');
    await renderTestFrame(page);

    await expect(page.locator('#main-canvas')).toHaveScreenshot('scene.png');
});
