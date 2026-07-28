import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const serverPort = Number(process.env.PLAYWRIGHT_PORT);
const serverUrl = `http://127.0.0.1:${serverPort}`;
if (!executablePath) {
    throw new Error(
        'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is not set. Run tests through '
        + '`nix develop --command pnpm test:e2e` so Playwright can use the Nix-provided Chromium.',
    );
}
if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new Error(
        'PLAYWRIGHT_PORT is missing or invalid. Run `pnpm test:e2e` instead of '
        + 'invoking Playwright directly so each test run receives an isolated server port.',
    );
}

export default defineConfig({
    testDir: './e2e',
    expect: {
        toHaveScreenshot: { maxDiffPixelRatio: 0.001 },
    },
    webServer: {
        command: `exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port ${serverPort} --strictPort`,
        url: serverUrl,
        reuseExistingServer: false,
    },
    use: {
        baseURL: serverUrl,
        browserName: 'chromium',
        deviceScaleFactor: 3,
        launchOptions: { executablePath },
        viewport: { width: 800, height: 600 },
    },
});
