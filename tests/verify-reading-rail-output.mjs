import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const workspaceRoot = process.cwd();
const outputRoot = resolve(
  workspaceRoot,
  ".test-artifacts",
  "quartz-reading-rail",
);
const maxGeneratedFileBytes = 2 * 1024 * 1024;
const maxRailEntries = 64;

const fail = (detail) => {
  throw new Error(
    `Reading-rail generated-output verification failed: ${detail} ` +
      "Run the recorded Quartz fixture build, inspect .test-artifacts/quartz-reading-rail, " +
      "and correct the production transformer or layout.",
  );
};

const requireCondition = (condition, detail) => {
  if (!condition) {
    fail(detail);
  }
};

const readGeneratedFile = async (path) => {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`could not read ${relative(workspaceRoot, path)} (${reason}).`);
  }
  requireCondition(
    Buffer.byteLength(contents) <= maxGeneratedFileBytes,
    `${relative(workspaceRoot, path)} exceeds the ${maxGeneratedFileBytes}-byte verification bound.`,
  );
  return contents;
};

const openingTags = (document, tagName, attribute) =>
  [
    ...document.matchAll(
      new RegExp(
        `<${tagName}\\b(?=[^>]*\\b${attribute}(?:=|\\s|>))[^>]*>`,
        "g",
      ),
    ),
  ].map((match) => match[0]);

const elementBlocks = (document, tagName, attribute, value) =>
  [
    ...document.matchAll(
      new RegExp(
        `<${tagName}\\b(?=[^>]*\\b${attribute}="${value}")[^>]*>[\\s\\S]*?</${tagName}>`,
        "g",
      ),
    ),
  ].map((match) => match[0]);

const attributeValue = (tag, attribute) => {
  const match = tag.match(new RegExp(`\\b${attribute}="([^"]*)"`));
  return match?.[1];
};

const articlePath = join(outputRoot, "article.html");
const indexPath = join(outputRoot, "index.html");
const stylesheetPath = join(outputRoot, "index.css");
const contentIndexPath = join(outputRoot, "static", "contentIndex.json");
const rssPath = join(outputRoot, "index.xml");
const [article, indexDocument, stylesheet, serializedContentIndex, rss] =
  await Promise.all([
    readGeneratedFile(articlePath),
    readGeneratedFile(indexPath),
    readGeneratedFile(stylesheetPath),
    readGeneratedFile(contentIndexPath),
    readGeneratedFile(rssPath),
  ]);

let contentIndex;
try {
  contentIndex = JSON.parse(serializedContentIndex);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  fail(
    `could not parse ${relative(workspaceRoot, contentIndexPath)} (${reason}).`,
  );
}

const countOccurrences = (value, expected) => value.split(expected).length - 1;
const canonicalRoutePhrase = "The route note remains in the canonical list";

requireCondition(
  /<article\b[^>]*data-reading-rail-content/.test(article),
  "article.html does not use the real Content reading-rail production path.",
);
requireCondition(
  /href="\.\/article"/.test(indexDocument),
  "index.html does not retain its generated clean link to the private article fixture.",
);

const ids = [...article.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(
  new Set(ids).size,
  ids.length,
  "Generated article IDs must be unique.",
);

const canonicalSections = openingTags(article, "section", "data-footnotes");
assert.equal(
  canonicalSections.length,
  1,
  "Exactly one canonical GFM footnote section must remain.",
);
assert.equal(
  attributeValue(canonicalSections[0], "id"),
  "reading-rail-footnotes",
);
requireCondition(
  !/\baria-hidden=|\bhidden(?:=|\s|>)/.test(canonicalSections[0]),
  "The canonical bottom footnote section must remain visible and accessible.",
);

const noterefs = openingTags(article, "a", "data-footnote-ref");
const backrefs = openingTags(article, "a", "data-footnote-backref");
assert.equal(
  noterefs.length,
  4,
  "The fixture must retain all four generated GFM noterefs.",
);
assert.equal(
  backrefs.length,
  4,
  "The fixture must retain one canonical backref per noteref.",
);

for (const noteref of noterefs) {
  const id = attributeValue(noteref, "id");
  const href = attributeValue(noteref, "href");
  requireCondition(
    id && ids.includes(id),
    `noteref ${JSON.stringify(id)} has no stable page ID.`,
  );
  requireCondition(
    href?.startsWith("#") && ids.includes(href.slice(1)),
    `noteref ${JSON.stringify(id)} points to unresolved target ${JSON.stringify(href)}.`,
  );
}
for (const backref of backrefs) {
  const href = attributeValue(backref, "href");
  requireCondition(
    href?.startsWith("#") && ids.includes(href.slice(1)),
    `canonical backref points to unresolved target ${JSON.stringify(href)}.`,
  );
}

const authorAsides = openingTags(article, "aside", "data-reading-aside");
assert.equal(
  authorAsides.length,
  2,
  "Both semantic author asides must remain in the article DOM.",
);
for (const authorAside of authorAsides) {
  requireCondition(
    attributeValue(authorAside, "data-reading-rail-entry") === "author-aside",
    "Each marked author aside must be validated and annotated by the production transform.",
  );
  requireCondition(
    !authorAside.includes("aria-hidden"),
    "Author asides are semantic content and must never be aria-hidden.",
  );
}

const metadataEntries = openingTags(
  article,
  "aside",
  "data-reading-rail-entry",
).filter(
  (tag) => attributeValue(tag, "data-reading-rail-entry") === "metadata",
);
assert.equal(
  metadataEntries.length,
  1,
  "Content must render one Article metadata rail entry.",
);
assert.equal(
  attributeValue(metadataEntries[0], "id"),
  undefined,
  "The metadata hook must not emit an unreferenced fixed DOM ID.",
);
requireCondition(
  !metadataEntries[0].includes("aria-hidden"),
  "The metadata entry must remain accessible in its inline fallback.",
);

const mirrors = elementBlocks(
  article,
  "aside",
  "data-reading-rail-entry",
  "footnote-mirror",
);
assert.equal(
  mirrors.length,
  noterefs.length,
  "Each noteref must receive one visual mirror.",
);
for (const mirror of mirrors) {
  const openingTag = mirror.slice(0, mirror.indexOf(">") + 1);
  const id = attributeValue(openingTag, "id");
  const referenceId = attributeValue(openingTag, "data-reading-rail-reference");
  const numberSpan = openingTags(mirror, "span", "data-reading-rail-number")[0];
  const textSpan = openingTags(mirror, "span", "data-reading-rail-text")[0];
  assert.equal(attributeValue(openingTag, "aria-hidden"), "true");
  assert.equal(id, `reading-rail-mirror-${referenceId}`);
  requireCondition(
    ids.includes(referenceId),
    `mirror ${JSON.stringify(id)} has no matching noteref.`,
  );
  requireCondition(
    !/<(?:a|button|input|select|textarea)\b/.test(mirror),
    `aria-hidden mirror ${JSON.stringify(id)} contains a focusable control.`,
  );
  requireCondition(
    numberSpan !== undefined,
    `mirror ${JSON.stringify(id)} has no number data.`,
  );
  requireCondition(
    textSpan !== undefined,
    `mirror ${JSON.stringify(id)} has no text data.`,
  );
  requireCondition(
    (attributeValue(numberSpan, "data-reading-rail-number")?.length ?? 0) <= 16,
    `mirror ${JSON.stringify(id)} exceeds its number-data bound.`,
  );
  requireCondition(
    (attributeValue(textSpan, "data-reading-rail-text")?.length ?? 0) <= 1024,
    `mirror ${JSON.stringify(id)} exceeds its text-data bound.`,
  );
  const innerMarkup = mirror.slice(
    mirror.indexOf(">") + 1,
    mirror.lastIndexOf("</aside>"),
  );
  assert.equal(
    innerMarkup.replace(/<[^>]*>/g, "").trim(),
    "",
    `mirror ${JSON.stringify(id)} must not contribute semantic HAST text.`,
  );
}

requireCondition(
  /<img\b[^>]*src="\.\/diagram\.png"[^>]*alt="A compass rose marking four directions"/.test(
    article,
  ),
  "The canonical image-only footnote lost its image or accessible alt text.",
);
requireCondition(
  mirrors.some((mirror) =>
    mirror.includes(
      'data-reading-rail-text="A compass rose marking four directions"',
    ),
  ),
  "The image-only footnote mirror does not preserve its accessible alt text.",
);

const descriptionMeta = openingTags(article, "meta", "name").find(
  (tag) => attributeValue(tag, "name") === "description",
);
const openGraphDescription = openingTags(article, "meta", "property").find(
  (tag) => attributeValue(tag, "property") === "og:description",
);
requireCondition(
  descriptionMeta !== undefined,
  "article.html has no description meta tag.",
);
requireCondition(
  openGraphDescription !== undefined,
  "article.html has no Open Graph description.",
);
assert.equal(
  countOccurrences(contentIndex.article.content, canonicalRoutePhrase),
  1,
  "Search/contentIndex must contain the canonical route note exactly once.",
);
assert.equal(
  countOccurrences(
    attributeValue(descriptionMeta, "content") ?? "",
    canonicalRoutePhrase,
  ),
  1,
  "Page description metadata must contain the route phrase exactly once.",
);
assert.equal(
  countOccurrences(
    attributeValue(openGraphDescription, "content") ?? "",
    canonicalRoutePhrase,
  ),
  1,
  "Open Graph description metadata must contain the route phrase exactly once.",
);
assert.equal(
  countOccurrences(rss, canonicalRoutePhrase),
  1,
  "RSS metadata must contain the route phrase exactly once.",
);

const railEntries = openingTags(article, "aside", "data-reading-rail-entry");
requireCondition(
  railEntries.length <= maxRailEntries,
  `article.html emits ${railEntries.length} rail entries above the ${maxRailEntries}-entry bound.`,
);

requireCondition(
  /id="graph-container"\s+data-cfg="[^"]*&quot;depth&quot;:2/.test(article),
  "The generated content page no longer retains its local graph depth of 2.",
);
requireCondition(
  article.includes('id="explorer"'),
  "The generated content page lost Explorer.",
);
requireCondition(
  article.includes('id="search-button"'),
  "The generated content page lost Search.",
);
requireCondition(
  article.includes('class="backlinks"'),
  "The generated content page lost Backlinks.",
);

requireCondition(
  stylesheet.includes("data-reading-rail-content"),
  "index.css does not include the Content reading-grid styles.",
);
requireCondition(
  stylesheet.includes("1200.01px") || stylesheet.includes("1200.01"),
  "index.css does not retain the declared wide-layout breakpoint.",
);
requireCondition(
  !/vlaci|exodrifter/i.test(`${article}\n${stylesheet}`),
  "Generated rail output contains a prohibited cited-site identifier.",
);

console.log(
  `Verified responsive reading rail: ${authorAsides.length} author asides, ` +
    `${mirrors.length} aria-hidden non-semantic mirrors, ${noterefs.length} canonical noterefs/backrefs, ` +
    "deduplicated metadata/search text, image alt text, and preserved Quartz navigation.",
);
