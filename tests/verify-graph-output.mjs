import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const workspaceRoot = process.cwd();
const outputDirectory = join(workspaceRoot, ".test-artifacts", "quartz-graph");

const fail = (detail) => {
  throw new Error(
    `Graph output verification failed for ${relative(workspaceRoot, outputDirectory)}: ${detail} ` +
      "Rebuild the private graph fixture and inspect graph/index.html plus static/contentIndex.json.",
  );
};

const requireCondition = (condition, detail) => {
  if (!condition) {
    fail(detail);
  }
};

const readGeneratedFile = async (path) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`could not read ${relative(workspaceRoot, path)} (${message}).`);
  }
};

const decodeAttribute = (value) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const readJsonAttribute = (document, elementId, attribute, documentPath) => {
  const elementPattern = new RegExp(
    `<[^>]+id="${elementId}"[^>]*${attribute}="([^"]*)"`,
  );
  const match = document.match(elementPattern);
  requireCondition(
    match,
    `${relative(workspaceRoot, documentPath)} does not emit ${attribute} on #${elementId}.`,
  );

  try {
    return JSON.parse(decodeAttribute(match[1]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(
      `${relative(workspaceRoot, documentPath)} has invalid ${attribute} JSON (${message}).`,
    );
  }
};

const expectedNodes = [
  { slug: "/", title: "Graph fixture index", tags: ["graph-index"] },
  {
    slug: "active",
    title: "Graph fixture active",
    tags: ["active"],
  },
  {
    slug: "backlink",
    title: "Graph fixture backlink",
    tags: ["incoming"],
  },
  {
    slug: "direct",
    title: "Graph fixture direct",
    tags: ["direct"],
  },
  {
    slug: "distance-three",
    title: "Graph fixture distance three",
    tags: ["distance-three"],
  },
  {
    slug: "distance-two",
    title: "Graph fixture distance two",
    tags: ["distance-two"],
  },
];

const expectedEdges = [
  { source: "/", target: "active" },
  { source: "active", target: "direct" },
  { source: "backlink", target: "active" },
  { source: "direct", target: "active" },
  { source: "direct", target: "distance-two" },
  { source: "distance-two", target: "distance-three" },
];

const expectedRelationships = {
  "/": { outgoing: ["active"], backlinks: [] },
  active: { outgoing: ["direct"], backlinks: ["/", "backlink", "direct"] },
  backlink: { outgoing: ["active"], backlinks: [] },
  direct: { outgoing: ["active", "distance-two"], backlinks: ["active"] },
  "distance-three": { outgoing: [], backlinks: ["distance-two"] },
  "distance-two": { outgoing: ["distance-three"], backlinks: ["direct"] },
};

const hrefFor = (slug) => (slug === "/" ? "../" : `../${slug}`);
const titleFor = (slug) =>
  expectedNodes.find((node) => node.slug === slug)?.title;

const assertRelationshipSection = (section, owner, direction, targets) => {
  const nextHeading =
    direction === "outgoing" ? "<h4>Backlinks</h4>" : "</div></div></li>";
  const heading =
    direction === "outgoing" ? "<h4>Outgoing links</h4>" : "<h4>Backlinks</h4>";
  const start = section.indexOf(heading);
  const end = section.indexOf(nextHeading, start + heading.length);
  requireCondition(
    start >= 0,
    `${owner} is missing the ${direction} textual heading.`,
  );
  const relationshipMarkup = section.slice(start, end >= 0 ? end : undefined);

  if (targets.length === 0) {
    requireCondition(
      relationshipMarkup.includes('class="published-graph-empty">None</li>'),
      `${owner} does not truthfully identify its empty ${direction} relationship list.`,
    );
    return;
  }

  for (const target of targets) {
    const expectedLink = `href="${hrefFor(target)}" class="internal">${titleFor(target)}</a>`;
    requireCondition(
      relationshipMarkup.includes(expectedLink),
      `${owner} ${direction} relationships omit ${target} (${expectedLink}).`,
    );
  }
};

const graphPath = join(outputDirectory, "graph", "index.html");
const graphDocument = await readGeneratedFile(graphPath);
const contentIndex = JSON.parse(
  await readGeneratedFile(join(outputDirectory, "static", "contentIndex.json")),
);
const sitemap = await readGeneratedFile(join(outputDirectory, "sitemap.xml"));
const feed = await readGeneratedFile(join(outputDirectory, "index.xml"));
const model = readJsonAttribute(
  graphDocument,
  "published-graph-container",
  "data-graph-model",
  graphPath,
);

assert.deepEqual(
  model.nodes,
  expectedNodes,
  "The embedded published graph nodes must be sorted and complete.",
);
assert.deepEqual(
  model.edges,
  expectedEdges,
  "The embedded published graph edges must be sorted and complete.",
);
assert.deepEqual(
  Object.keys(contentIndex).sort(),
  ["active", "backlink", "direct", "distance-three", "distance-two", "index"],
  "The authored ContentIndex must contain every fixture page and no synthetic graph route.",
);
assert.deepEqual(contentIndex.active.links, ["direct", "private/hidden"]);
requireCondition(
  !Object.hasOwn(contentIndex, "graph"),
  "The synthetic graph route entered Search/ContentIndex.",
);
requireCondition(
  !Object.hasOwn(contentIndex, "graph/index"),
  "The synthetic graph/index slug entered Search/ContentIndex.",
);
requireCondition(
  !graphDocument.includes("private/hidden"),
  "A dangling private link entered the graph route.",
);
requireCondition(
  !sitemap.includes("/graph"),
  "The synthetic graph route entered sitemap.xml.",
);
requireCondition(
  !feed.includes("/graph"),
  "The synthetic graph route entered the RSS feed.",
);
requireCondition(
  !graphDocument.includes("BlogPosting"),
  "The synthetic graph route claims BlogPosting metadata.",
);
requireCondition(
  graphDocument.includes('<nav aria-label="Graph relationships"'),
  "The graph route has no semantic textual relationship navigation.",
);
requireCondition(
  graphDocument.includes(
    "<noscript><p>The interactive visualization requires JavaScript; all graph links remain below.</p></noscript>",
  ),
  "The graph route does not explain its no-JavaScript fallback.",
);
requireCondition(
  !graphDocument.includes("<canvas"),
  "The static route unexpectedly makes canvas authored content.",
);
requireCondition(
  graphDocument.includes('id="explorer"'),
  "Explorer is absent from the graph route.",
);
requireCondition(
  graphDocument.includes('id="search-button"'),
  "Search is absent from the graph route.",
);
requireCondition(
  graphDocument.includes('class="backlinks"'),
  "Backlinks are absent from the graph route.",
);

const nodeSections = graphDocument
  .split('<li class="published-graph-node"')
  .slice(1);
assert.equal(
  nodeSections.length,
  expectedNodes.length,
  "Every graph node must have one textual relationship section.",
);
for (const section of nodeSections) {
  const slug = section.match(/data-node-slug="([^"]+)"/)?.[1];
  requireCondition(
    slug && Object.hasOwn(expectedRelationships, slug),
    `found unexpected node section ${slug}.`,
  );
  const expected = expectedRelationships[slug];
  requireCondition(
    section.includes(`data-outgoing-count="${expected.outgoing.length}"`),
    `${slug} has an incorrect outgoing count.`,
  );
  requireCondition(
    section.includes(`data-backlink-count="${expected.backlinks.length}"`),
    `${slug} has an incorrect backlink count.`,
  );
  requireCondition(
    section.includes(
      `href="${hrefFor(slug)}" class="internal">${titleFor(slug)}</a>`,
    ),
    `${slug} has no clean textual page link.`,
  );
  assertRelationshipSection(section, slug, "outgoing", expected.outgoing);
  assertRelationshipSection(section, slug, "backlinks", expected.backlinks);
}

for (const node of expectedNodes) {
  const authoredSlug = node.slug === "/" ? "index" : node.slug;
  const authoredPath = join(outputDirectory, `${authoredSlug}.html`);
  const document = await readGeneratedFile(authoredPath);
  const localConfig = readJsonAttribute(
    document,
    "graph-container",
    "data-cfg",
    authoredPath,
  );
  assert.equal(
    localConfig.depth,
    2,
    `${authoredSlug} must retain local graph depth 2.`,
  );
  requireCondition(
    document.includes('class="graph-route-link internal"') &&
      document.includes('href="./graph/"'),
    `${authoredSlug} does not provide the clean graph route link.`,
  );
  requireCondition(
    document.includes('id="explorer"'),
    `${authoredSlug} lost Explorer.`,
  );
  requireCondition(
    document.includes('id="search-button"'),
    `${authoredSlug} lost Search.`,
  );
  requireCondition(
    document.includes('class="backlinks"'),
    `${authoredSlug} lost Backlinks.`,
  );
}

console.log(
  `Verified deterministic graph route with ${model.nodes.length} nodes and ${model.edges.length} edges.`,
);
