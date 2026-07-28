import { expect, Page, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";

type LifecycleSnapshot = Readonly<{
  animationFrames: number;
  listeners: Readonly<Record<string, number>>;
}>;

declare global {
  interface Window {
    graphLifecycleSnapshot?: () => LifecycleSnapshot;
  }
}

const execFileAsync = promisify(execFile);
const fixtureRoot = resolve(process.cwd(), ".test-artifacts", "quartz-graph");

test.beforeAll(async () => {
  try {
    await execFileAsync(
      "pnpm",
      [
        "--dir",
        "blog/quartz",
        "quartz",
        "build",
        "--directory",
        "../../tests/fixtures/quartz-graph",
        "--output",
        "../../.test-artifacts/quartz-graph",
      ],
      { cwd: process.cwd(), timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The graph browser fixture could not be built before Playwright started: ${detail}. ` +
        "Run the browser gate through `nix develop --command pnpm test:e2e` and inspect the Quartz build output.",
    );
  }
});

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".xml", "application/xml; charset=utf-8"],
]);

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });

const withFixtureServer = async (
  run: (baseUrl: string) => Promise<void>,
): Promise<void> => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      let relativePath = pathname.replace(/^\/+/, "");
      if (relativePath === "") relativePath = "index.html";
      else if (relativePath.endsWith("/")) relativePath += "index.html";
      else if (extname(relativePath) === "") relativePath += ".html";

      const outputPath = resolve(fixtureRoot, relativePath);
      if (
        outputPath !== fixtureRoot &&
        !outputPath.startsWith(`${fixtureRoot}${sep}`)
      ) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(outputPath);
      response.writeHead(200, {
        "Content-Type":
          contentTypes.get(extname(outputPath)) ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error(
        "The graph fixture server did not expose a bounded loopback TCP port.",
      );
    }
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
};

const installLifecycleProbe = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const trackedTypes = new Set(["keydown", "themechange"]);
    const listeners = new Map<
      string,
      Set<EventListenerOrEventListenerObject>
    >();
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;

    EventTarget.prototype.addEventListener = function addEventListener(
      type,
      listener,
      options,
    ) {
      if (this === document && listener && trackedTypes.has(type)) {
        const typeListeners = listeners.get(type) ?? new Set();
        typeListeners.add(listener);
        listeners.set(type, typeListeners);
      }
      originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function removeEventListener(
      type,
      listener,
      options,
    ) {
      if (this === document && listener && trackedTypes.has(type)) {
        listeners.get(type)?.delete(listener);
      }
      originalRemove.call(this, type, listener, options);
    };

    const activeFrames = new Set<number>();
    const originalRequestAnimationFrame =
      window.requestAnimationFrame.bind(window);
    const originalCancelAnimationFrame =
      window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      let handle = 0;
      handle = originalRequestAnimationFrame((time) => {
        activeFrames.delete(handle);
        callback(time);
      });
      activeFrames.add(handle);
      return handle;
    };
    window.cancelAnimationFrame = (handle) => {
      activeFrames.delete(handle);
      originalCancelAnimationFrame(handle);
    };

    window.graphLifecycleSnapshot = () => ({
      animationFrames: activeFrames.size,
      listeners: Object.fromEntries(
        [...listeners].map(([type, typeListeners]) => [
          type,
          typeListeners.size,
        ]),
      ),
    });
  });
};

const lifecycleSnapshot = async (page: Page): Promise<LifecycleSnapshot> =>
  page.evaluate(() => {
    if (!window.graphLifecycleSnapshot) {
      throw new Error(
        "The graph lifecycle probe was not installed before Quartz initialized.",
      );
    }
    return window.graphLifecycleSnapshot();
  });

const exerciseGlobalOverlay = async (
  page: Page,
  baseline: LifecycleSnapshot,
  closeWithBackdrop: boolean,
): Promise<void> => {
  const overlay = page.locator("#global-graph-outer");
  const globalGraph = page.locator("#global-graph-container");
  await page.locator("#global-graph-icon").click();
  await expect(overlay).toHaveClass(/active/);
  await expect(globalGraph.locator("canvas")).toHaveCount(1);
  await expect(globalGraph).toHaveAttribute("data-graph-nodes", /\//);
  await globalGraph.locator("canvas").evaluate((canvas) => {
    canvas.dataset.beforeThemeChange = "true";
  });

  await page.evaluate(() => {
    const themeButton = document.querySelector("#darkmode");
    if (!(themeButton instanceof HTMLButtonElement)) {
      throw new Error(
        "The production dark-mode button is unavailable while testing graph cleanup.",
      );
    }
    themeButton.click();
  });
  await expect(
    globalGraph.locator('canvas[data-before-theme-change="true"]'),
  ).toHaveCount(0);
  await expect(globalGraph.locator("canvas")).toHaveCount(1);

  if (closeWithBackdrop) {
    await overlay.click({ position: { x: 2, y: 2 } });
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(overlay).not.toHaveClass(/active/);
  await expect(globalGraph.locator("canvas")).toHaveCount(0);
  expect(await globalGraph.getAttribute("data-graph-nodes")).toBeNull();
  expect(await globalGraph.getAttribute("data-graph-error")).toBeNull();
  await expect
    .poll(async () => (await lifecycleSnapshot(page)).animationFrames)
    .toBeLessThanOrEqual(baseline.animationFrames + 2);
  expect((await lifecycleSnapshot(page)).listeners).toEqual(baseline.listeners);
};

test("serves complete graph navigation without JavaScript or canvas", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    const response = await page.goto("/blog/graph/");
    expect(response?.status()).toBe(200);

    const relationships = page.getByRole("navigation", {
      name: "Graph relationships",
    });
    await expect(relationships).toBeVisible();
    await expect(relationships.locator("[data-node-slug]")).toHaveCount(1);
    await expect(
      relationships.getByRole("link", { name: "Blog", exact: true }),
    ).toHaveAttribute("href", "../");
    await expect(
      relationships.getByRole("heading", { name: "Outgoing links" }),
    ).toBeVisible();
    await expect(
      relationships.getByRole("heading", { name: "Backlinks" }),
    ).toBeVisible();
    await expect(relationships.getByText("None", { exact: true })).toHaveCount(
      2,
    );
    await expect(page.locator("#published-graph-container canvas")).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }
});

test("renders every private fixture node through interactive and textual production paths", async ({
  browser,
}) => {
  await withFixtureServer(async (baseUrl) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const page = await context.newPage();
      const pageErrors: Error[] = [];
      page.on("pageerror", (error) => pageErrors.push(error));

      const response = await page.goto(`${baseUrl}/graph/`);
      expect(response?.status()).toBe(200);
      const relationships = page.getByRole("navigation", {
        name: "Graph relationships",
      });
      await expect(relationships.locator("[data-node-slug]")).toHaveCount(6);
      await expect(
        page.locator("#published-graph-container canvas"),
      ).toHaveCount(1);
      await expect(page.locator("#explorer")).toBeVisible();
      await expect(page.locator("#search-button")).toBeVisible();
      await expect(page.locator(".backlinks")).toBeVisible();

      const fixtureNodes = [
        {
          slug: "active",
          path: "/active",
          backlinks: 3,
          neighbourhood: ["/", "active", "backlink", "direct", "distance-two"],
        },
        {
          slug: "backlink",
          path: "/backlink",
          backlinks: 0,
          neighbourhood: ["/", "active", "backlink", "direct"],
        },
        {
          slug: "direct",
          path: "/direct",
          backlinks: 1,
          neighbourhood: [
            "/",
            "active",
            "backlink",
            "direct",
            "distance-three",
            "distance-two",
          ],
        },
        {
          slug: "distance-three",
          path: "/distance-three",
          backlinks: 1,
          neighbourhood: ["direct", "distance-three", "distance-two"],
        },
        {
          slug: "distance-two",
          path: "/distance-two",
          backlinks: 1,
          neighbourhood: ["active", "direct", "distance-three", "distance-two"],
        },
        {
          slug: "/",
          path: "/",
          backlinks: 0,
          neighbourhood: ["/", "active", "backlink", "direct"],
        },
      ] as const;

      for (const fixture of fixtureNodes) {
        const section = page.locator(
          `[data-node-slug=${JSON.stringify(fixture.slug)}]`,
        );
        await section.locator("h3 > a").click();
        await expect(page).toHaveURL(`${baseUrl}${fixture.path}`);
        await expect(page.locator("#graph-container canvas")).toHaveCount(1);
        const localConfig = JSON.parse(
          (await page.locator("#graph-container").getAttribute("data-cfg")) ??
            "{}",
        );
        expect(localConfig.depth).toBe(2);
        const renderedNodes = JSON.parse(
          (await page
            .locator("#graph-container")
            .getAttribute("data-graph-nodes")) ?? "[]",
        ) as string[];
        expect(
          renderedNodes.filter((node) => !node.startsWith("tags/")),
        ).toEqual(fixture.neighbourhood);
        await expect(page.locator("#explorer-content a")).toHaveCount(5);
        await expect(page.locator(".backlinks a")).toHaveCount(
          fixture.backlinks,
        );

        if (fixture.slug === "active") {
          await page.locator("#search-button").click();
          await page.locator("#search-bar").fill("Graph fixture");
          const results = page.locator("#results-container a.result-card");
          await expect(results).toHaveCount(6);
          const resultHrefs = await results.evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("href")),
          );
          expect(resultHrefs.some((href) => href?.includes("/graph"))).toBe(
            false,
          );
          await page.keyboard.press("Escape");
        }

        await page.locator(".graph-route-link").click();
        await expect(page).toHaveURL(`${baseUrl}/graph/`);
        await expect(
          page.locator("#published-graph-container canvas"),
        ).toHaveCount(1);
      }

      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test("keeps graph enhancement and listeners bounded across SPA navigation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await installLifecycleProbe(page);

    const response = await page.goto("/blog/graph/");
    expect(response?.status()).toBe(200);
    await expect(page.locator("#published-graph-container canvas")).toHaveCount(
      1,
    );
    await expect(page.locator("#explorer")).toBeVisible();
    await expect(page.locator("#search-button")).toBeVisible();
    await expect(page.locator(".backlinks")).toBeVisible();

    const contentIndex = await page.request.get(
      "/blog/static/contentIndex.json",
    );
    expect(contentIndex.ok()).toBe(true);
    expect(Object.keys(await contentIndex.json())).toEqual(["index"]);
    expect(
      await (await page.request.get("/blog/sitemap.xml")).text(),
    ).not.toContain("/blog/graph");
    expect(
      await (await page.request.get("/blog/index.xml")).text(),
    ).not.toContain("/blog/graph");

    const graphBaseline = await lifecycleSnapshot(page);
    let contentBaseline: LifecycleSnapshot | undefined;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      await page
        .getByRole("navigation", { name: "Graph relationships" })
        .getByRole("link", { name: "Blog", exact: true })
        .click();
      await expect(page).toHaveURL(/\/blog\/$/);
      await expect(page.locator("#graph-container canvas")).toHaveCount(1);
      const localConfig = JSON.parse(
        (await page.locator("#graph-container").getAttribute("data-cfg")) ??
          "{}",
      );
      expect(localConfig.depth).toBe(2);
      await expect(page.locator(".graph-route-link")).toHaveAttribute(
        "href",
        /\/blog\/graph\/$/,
      );
      await expect(page.locator("#explorer")).toBeVisible();
      await expect(page.locator("#search-button")).toBeVisible();
      await expect(page.locator(".backlinks")).toBeVisible();

      const contentSnapshot = await lifecycleSnapshot(page);
      contentBaseline ??= contentSnapshot;
      expect(contentSnapshot.listeners).toEqual(contentBaseline.listeners);
      expect(contentSnapshot.animationFrames).toBeLessThanOrEqual(
        contentBaseline.animationFrames + 2,
      );
      await exerciseGlobalOverlay(page, contentSnapshot, iteration % 2 === 1);

      await page.locator(".graph-route-link").click();
      await expect(page).toHaveURL(/\/blog\/graph\/$/);
      await expect(
        page.locator("#published-graph-container canvas"),
      ).toHaveCount(1);
      const graphSnapshot = await lifecycleSnapshot(page);
      expect(graphSnapshot.listeners).toEqual(graphBaseline.listeners);
      expect(graphSnapshot.animationFrames).toBeLessThanOrEqual(
        graphBaseline.animationFrames + 2,
      );
      expect(graphSnapshot.animationFrames).toBeLessThan(10);
    }

    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
