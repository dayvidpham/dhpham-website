import { expect, Page, test } from "@playwright/test";
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const artifactRoot = resolve(
  process.cwd(),
  ".test-artifacts",
  "quartz-reading-rail",
);
const maxRequestPathLength = 2048;
const maxResponseBytes = 2 * 1024 * 1024;
const contentTypes = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
]);

let fixtureServer: Server;
let fixtureBaseUrl: string;

const sendText = (
  response: ServerResponse,
  status: number,
  message: string,
): void => {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(message);
};

const resolveArtifactPath = (request: IncomingMessage): string | undefined => {
  const requestUrl = request.url ?? "/";
  if (requestUrl.length > maxRequestPathLength || /%2f|%5c/i.test(requestUrl)) {
    return undefined;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(requestUrl, "http://reading-rail.invalid").pathname,
    );
  } catch {
    return undefined;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return undefined;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".."))
    return undefined;
  let relativePath = segments.join("/");
  if (relativePath.length === 0) {
    relativePath = "index.html";
  } else if (relativePath.endsWith("/")) {
    relativePath += "index.html";
  } else if (extname(relativePath).length === 0) {
    relativePath += ".html";
  }

  const artifactPath = resolve(artifactRoot, relativePath);
  if (
    artifactPath !== artifactRoot &&
    !artifactPath.startsWith(`${artifactRoot}${sep}`)
  ) {
    return undefined;
  }
  return artifactPath;
};

const serveArtifact = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(
      response,
      405,
      "Method not allowed. Use GET or HEAD for reading-rail fixtures.",
    );
    return;
  }

  const artifactPath = resolveArtifactPath(request);
  if (!artifactPath) {
    sendText(
      response,
      400,
      "Malformed fixture path. Use a generated in-root route.",
    );
    return;
  }

  let contents: Buffer;
  try {
    contents = await readFile(artifactPath);
  } catch {
    sendText(
      response,
      404,
      "Generated reading-rail artifact not found. Run the recorded fixture build first.",
    );
    return;
  }
  if (contents.byteLength > maxResponseBytes) {
    sendText(
      response,
      500,
      "Generated fixture exceeds the bounded browser-test response size.",
    );
    return;
  }

  const contentType = contentTypes.get(extname(artifactPath));
  if (!contentType) {
    sendText(
      response,
      415,
      "Generated fixture has an unsupported browser-test content type.",
    );
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": contents.byteLength,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : contents);
};

const openArticle = async (page: Page): Promise<void> => {
  await page.goto(`${fixtureBaseUrl}/article`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.locator("article[data-reading-rail-content]"),
  ).toBeVisible();
};

const openIndex = async (page: Page): Promise<void> => {
  await page.goto(`${fixtureBaseUrl}/`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Private reading rail fixture" }),
  ).toBeVisible();
};

const expectUniqueRuntimeIds = async (page: Page): Promise<void> => {
  const duplicateIds = await page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(
      ({ id }) => id,
    );
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);
};

const countOccurrences = (value: string, expected: string): number =>
  value.split(expected).length - 1;

const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    )
    .toEqual(
      await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.clientWidth,
      })),
    );
};

test.beforeAll(async () => {
  try {
    await readFile(resolve(artifactRoot, "article.html"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Reading-rail browser setup could not read ${artifactRoot}/article.html (${reason}). ` +
        "Run `corepack pnpm --dir blog/quartz quartz build --directory " +
        "../../tests/fixtures/quartz-reading-rail --output " +
        "../../.test-artifacts/quartz-reading-rail` before `pnpm test:e2e`.",
    );
  }

  fixtureServer = createServer((request, response) => {
    void serveArtifact(request, response).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      sendText(
        response,
        500,
        `Fixture server failed while reading a generated artifact (${reason}). Rebuild the fixture.`,
      );
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    fixtureServer.once("error", rejectListen);
    fixtureServer.listen(0, "127.0.0.1", resolveListen);
  });
  const address = fixtureServer.address();
  if (!address || typeof address === "string") {
    throw new Error(
      "Reading-rail browser setup could not allocate a local TCP port. " +
        "Check local socket permissions and rerun the e2e gate.",
    );
  }
  fixtureBaseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (!fixtureServer) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    fixtureServer.close((error) =>
      error ? rejectClose(error) : resolveClose(),
    );
  });
});

test("wide generated article uses a non-overlapping semantic reading rail", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await openArticle(page);

    const article = page.locator("article[data-reading-rail-content]");
    const prose = article.locator(":scope > p").first();
    const metadata = article.locator(
      ':scope > [data-reading-rail-entry="metadata"]',
    );
    const authorAsides = article.locator(":scope > [data-reading-aside]");
    const mirrors = article.locator(
      ':scope > [data-reading-rail-entry="footnote-mirror"]',
    );
    const footnotes = article.locator(":scope > section[data-footnotes]");

    await expect(metadata).toBeVisible();
    await expect(authorAsides).toHaveCount(2);
    await expect(authorAsides.first()).toBeVisible();
    await expect(mirrors).toHaveCount(4);
    await expect(mirrors.first()).toBeVisible();
    await expect(footnotes).toBeVisible();
    await expect(page.locator("#reading-rail-metadata")).toHaveCount(0);

    const renderedMirror = await mirrors.first().evaluate((element) => {
      const number = element.querySelector<HTMLElement>(
        ".reading-rail-footnote-number",
      );
      const text = element.querySelector<HTMLElement>(
        ".reading-rail-footnote-text",
      );
      return {
        number: number ? getComputedStyle(number, "::before").content : "",
        semanticText: element.textContent,
        text: text ? getComputedStyle(text, "::before").content : "",
      };
    });
    expect(renderedMirror.semanticText).toBe("");
    expect(renderedMirror.number).toContain("1");
    expect(renderedMirror.text).toContain(
      "The route note remains in the canonical list",
    );

    const imageMirror = mirrors.filter({
      has: page.locator(
        '[data-reading-rail-text="A compass rose marking four directions"]',
      ),
    });
    await expect(imageMirror).toHaveCount(1);
    const renderedImageAlt = await imageMirror
      .locator(".reading-rail-footnote-text")
      .evaluate((element) => getComputedStyle(element, "::before").content);
    expect(renderedImageAlt).toContain(
      "A compass rose marking four directions",
    );

    const proseBox = await prose.boundingBox();
    const railBox = await authorAsides.first().boundingBox();
    if (!proseBox || !railBox) {
      throw new Error(
        "Wide reading-rail verification could not measure prose and aside boxes. " +
          "Inspect generated CSS and ensure both columns render.",
      );
    }
    expect(proseBox.x + proseBox.width).toBeLessThanOrEqual(railBox.x + 1);

    const geometry = await article.evaluate((element) => {
      const content = [...element.children]
        .filter((child) => !child.classList.contains("reading-rail-entry"))
        .map((child) => child.getBoundingClientRect());
      const rail = [...element.querySelectorAll(":scope > .reading-rail-entry")]
        .filter((child) => getComputedStyle(child).display !== "none")
        .map((child) => child.getBoundingClientRect());
      return {
        contentRight: Math.max(...content.map((box) => box.right)),
        railLeft: Math.min(...rail.map((box) => box.left)),
      };
    });
    expect(geometry.contentRight).toBeLessThanOrEqual(geometry.railLeft + 1);

    const ariaSnapshot = await article.ariaSnapshot();
    expect(
      ariaSnapshot.match(/The route note remains in the canonical list/g) ?? [],
    ).toHaveLength(1);
    await expect(
      mirrors.locator("a, button, input, select, textarea"),
    ).toHaveCount(0);
    await expect(footnotes).not.toHaveAttribute("aria-hidden");

    await expectUniqueRuntimeIds(page);

    const rightSidebar = page.locator(".sidebar.right");
    const articleBox = await article.boundingBox();
    const rightSidebarBox = await rightSidebar.boundingBox();
    if (!articleBox || !rightSidebarBox) {
      throw new Error(
        "Wide reading-rail verification could not measure the article and stock right controls.",
      );
    }
    expect(rightSidebarBox.y).toBeGreaterThanOrEqual(
      articleBox.y + articleBox.height - 1,
    );
    await expect(page.locator("#graph-container")).toHaveAttribute(
      "data-cfg",
      /"depth":2/,
    );
    await expect(page.locator("#explorer")).toBeVisible();
    await expect(page.locator("#search-button")).toBeVisible();
    await expect(page.locator(".backlinks")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("stock popover hides rail mirrors and keeps one canonical note without duplicate IDs", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await openIndex(page);

    const articleLink = page.locator('article a[href="./article"]').first();
    await articleLink.hover();
    const popover = articleLink.locator(":scope > .popover");
    await expect(popover).toBeVisible();

    const mirrors = popover.locator(
      '[data-reading-rail-entry="footnote-mirror"]',
    );
    await expect(mirrors).toHaveCount(4);
    await expect(mirrors.first()).toBeHidden();
    const popoverText = (await popover.textContent()) ?? "";
    expect(
      countOccurrences(
        popoverText,
        "The route note remains in the canonical list",
      ),
    ).toBe(1);
    await expect(
      popover.locator('[data-reading-rail-entry="metadata"]'),
    ).toHaveCount(1);
    await expect(popover.locator("#reading-rail-metadata")).toHaveCount(0);
    await expect(
      popover.locator('a[href="https://example.com/route"]'),
    ).toHaveCount(1);
    await expectUniqueRuntimeIds(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("stock Search preview hides rail mirrors and remains usable without duplicate IDs", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await openIndex(page);

    await page.locator("#search-button").click();
    await page.locator("#search-bar").fill("route note");
    const result = page.locator(
      '#results-container a.result-card[id="article"]',
    );
    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute("href", /\/article$/);

    const preview = page.locator("#preview-container .preview-inner");
    await expect(preview).toBeVisible();
    const mirrors = preview.locator(
      '[data-reading-rail-entry="footnote-mirror"]',
    );
    await expect(mirrors).toHaveCount(4);
    await expect(mirrors.first()).toBeHidden();
    const previewText = (await preview.textContent()) ?? "";
    expect(
      countOccurrences(
        previewText,
        "The route note remains in the canonical list",
      ),
    ).toBe(1);
    await expect(
      preview.locator('[data-reading-rail-entry="metadata"]'),
    ).toHaveCount(1);
    await expect(preview.locator("#reading-rail-metadata")).toHaveCount(0);
    await expectUniqueRuntimeIds(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

const reflowCases = [
  { name: "tablet", width: 900, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
  { name: "200% zoom equivalent", width: 720, height: 900 },
] as const;

for (const reflowCase of reflowCases) {
  test(`${reflowCase.name} keeps asides and metadata inline with canonical footnotes`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: reflowCase.width, height: reflowCase.height },
    });
    try {
      const page = await context.newPage();
      await openArticle(page);

      const article = page.locator("article[data-reading-rail-content]");
      const metadata = article.locator(
        ':scope > [data-reading-rail-entry="metadata"]',
      );
      const authorAsides = article.locator(":scope > [data-reading-aside]");
      const mirrors = article.locator(
        ':scope > [data-reading-rail-entry="footnote-mirror"]',
      );
      const footnotes = article.locator(":scope > section[data-footnotes]");

      await expect(metadata).toBeVisible();
      await expect(authorAsides.first()).toBeVisible();
      await expect(mirrors.first()).toBeHidden();
      await expect(footnotes).toBeVisible();
      await expect(page.locator("#graph-container")).toHaveAttribute(
        "data-cfg",
        /"depth":2/,
      );
      await expect(page.locator("#search-button")).toBeVisible();
      await expect(page.locator(".backlinks")).toBeVisible();

      const inlineGeometry = await article.evaluate((element) => {
        const articleBox = element.getBoundingClientRect();
        const aside = element.querySelector<HTMLElement>(
          "[data-reading-aside]",
        );
        const metadataElement = element.querySelector<HTMLElement>(
          '[data-reading-rail-entry="metadata"]',
        );
        if (!aside || !metadataElement) return null;
        const asideBox = aside.getBoundingClientRect();
        const metadataBox = metadataElement.getBoundingClientRect();
        return {
          articleLeft: articleBox.left,
          articleRight: articleBox.right,
          asideLeft: asideBox.left,
          asideRight: asideBox.right,
          metadataLeft: metadataBox.left,
          metadataRight: metadataBox.right,
        };
      });
      expect(inlineGeometry).not.toBeNull();
      expect(inlineGeometry?.asideLeft).toBeGreaterThanOrEqual(
        (inlineGeometry?.articleLeft ?? 0) - 1,
      );
      expect(inlineGeometry?.asideRight).toBeLessThanOrEqual(
        (inlineGeometry?.articleRight ?? 0) + 1,
      );
      expect(inlineGeometry?.metadataLeft).toBeGreaterThanOrEqual(
        (inlineGeometry?.articleLeft ?? 0) - 1,
      );
      expect(inlineGeometry?.metadataRight).toBeLessThanOrEqual(
        (inlineGeometry?.articleRight ?? 0) + 1,
      );
      await expectNoHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  });
}

test("no-JavaScript article remains readable and supports keyboard noteref/backref navigation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await openArticle(page);

    const article = page.locator("article[data-reading-rail-content]");
    const noteref = article.locator("a[data-footnote-ref]").first();
    const footnote = article.locator("#user-content-fn-route");
    const backref = footnote.locator("a[data-footnote-backref]").first();

    await expect(article.locator("[data-reading-aside]").first()).toBeVisible();
    await expect(
      article.locator('[data-reading-rail-entry="metadata"]'),
    ).toBeVisible();
    await expect(
      article.locator('[data-reading-rail-entry="footnote-mirror"]').first(),
    ).toBeHidden();
    await expect(article.locator("section[data-footnotes]")).toBeVisible();
    await expect(
      article.locator(
        'section[data-footnotes] img[alt="A compass rose marking four directions"]',
      ),
    ).toHaveCount(1);

    await noteref.focus();
    await expect(noteref).toBeFocused();
    await noteref.press("Enter");
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe("#user-content-fn-route");
    await expect(footnote).toBeVisible();

    await backref.focus();
    await expect(backref).toBeFocused();
    await backref.press("Enter");
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe("#user-content-fnref-route");
    await expect(noteref).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    await context.close();
  }
});
