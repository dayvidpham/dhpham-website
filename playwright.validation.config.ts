import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const serverPort = Number(process.env.PLAYWRIGHT_PORT);
if (!executablePath) {
    throw new Error(
        'Validation Playwright startup failed because PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is absent. '
        + 'No browser evidence ran; use `nix develop --command pnpm run test:e2e:validation`.',
    );
}
if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65_535) {
    throw new Error(
        'Validation Playwright startup failed because PLAYWRIGHT_PORT is not an integer from 1 through 65535. '
        + 'No browser evidence ran; invoke the package script so it allocates a bounded isolated port.',
    );
}

const serverUrl = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
    testDir: './e2e',
    testMatch: 'artifact-neighborhood.spec.ts',
    fullyParallel: false,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    webServer: {
        command: `exec ./node_modules/.bin/tsx tests/static-server/server.ts --root .test-artifacts/quartz-validation --mount /blog/ --host 127.0.0.1 --port ${serverPort}`,
        url: `${serverUrl}/blog/`,
        timeout: 15_000,
        reuseExistingServer: false,
    },
    use: {
        baseURL: serverUrl,
        browserName: 'chromium',
        launchOptions: { executablePath },
        viewport: { width: 1440, height: 900 },
    },
});
