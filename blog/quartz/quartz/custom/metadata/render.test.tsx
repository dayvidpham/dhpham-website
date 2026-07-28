import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"
import test from "node:test"
import { Root } from "hast"
import { render } from "preact-render-to-string"
import { VFile } from "vfile"
import { QuartzConfig } from "../../cfg"
import Head from "../../components/Head"
import { QuartzComponentProps } from "../../components/types"
import { ContentDetails, ContentIndex } from "../../plugins/emitters/contentIndex"
import { Description } from "../../plugins/transformers/description"
import { FrontMatter } from "../../plugins/transformers/frontmatter"
import { CreatedModifiedDate } from "../../plugins/transformers/lastmod"
import { QuartzTransformerPlugin } from "../../plugins/types"
import { ProcessedContent } from "../../plugins/vfile"
import { createProcessor } from "../../processors/parse"
import { BuildCtx } from "../../util/ctx"
import { isFilePath, slugifyFilePath } from "../../util/path"
import { EditorialContentKind } from "./types"

const revision = "baddd2a9d51c2b6a8bc65a67feddcfbbc48d9180"

const scssLoader = `
export async function load(url, context, nextLoad) {
  if (url.endsWith(".scss") || url.includes(".inline.")) {
    return { format: "module", shortCircuit: true, source: "export default ''" }
  }
  return nextLoad(url, context)
}
`
register(`data:text/javascript,${encodeURIComponent(scssLoader)}`, import.meta.url)
const { default: ContentMeta } = await import("../../components/ContentMeta")
const { ObsidianFlavoredMarkdown } = await import("../../plugins/transformers/ofm")

const colorScheme = {
  light: "#fff",
  lightgray: "#eee",
  gray: "#888",
  darkgray: "#444",
  dark: "#111",
  secondary: "#246",
  tertiary: "#468",
  highlight: "#def",
  textHighlight: "#ffd",
}

const VisualMirrorProbe: QuartzTransformerPlugin = () => ({
  name: "VisualMirrorProbe",
  htmlPlugins() {
    return [
      () => (tree: Root, file) => {
        if (file.data.relativePath !== "semantic-aside.md") return
        tree.children.push({
          type: "element",
          tagName: "aside",
          properties: {
            ariaHidden: "true",
            dataReadingRailEntry: "footnote-mirror",
          },
          children: [{ type: "text", value: "Visual mirror duplicate words." }],
        })
      },
    ]
  },
})

const testConfig: QuartzConfig = {
  configuration: {
    pageTitle: "Metadata test",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "en-US",
    baseUrl: "dhpham.com/blog",
    ignorePatterns: [],
    defaultDateType: "created",
    theme: {
      fontOrigin: "local",
      cdnCaching: false,
      typography: { header: "sans", body: "sans", code: "mono" },
      colors: { lightMode: colorScheme, darkMode: colorScheme },
    },
  },
  plugins: {
    transformers: [
      FrontMatter(),
      CreatedModifiedDate({ priority: ["frontmatter", "filesystem"] }),
      ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      VisualMirrorProbe(),
      Description(),
    ],
    filters: [],
    emitters: [],
  },
}

function createContext(output: string): BuildCtx {
  return {
    buildId: "metadata-test",
    argv: {
      directory: "fixtures",
      output,
      verbose: false,
      serve: false,
      fastRebuild: false,
      port: 0,
      wsPort: 0,
      concurrency: 1,
    },
    cfg: testConfig,
    allSlugs: [],
  }
}

async function processMarkdown(
  ctx: BuildCtx,
  relativePathValue: string,
  markdown: string,
): Promise<ProcessedContent> {
  assert(isFilePath(relativePathValue))
  const slug = slugifyFilePath(relativePathValue)
  ctx.allSlugs = [slug]
  const file = new VFile({ path: relativePathValue, value: markdown })
  file.data.filePath = relativePathValue
  file.data.relativePath = relativePathValue
  file.data.slug = slug
  const processor = createProcessor(ctx)
  const tree = await processor.run(processor.parse(file), file)
  return [tree, file]
}

function componentProps(ctx: BuildCtx, [tree, file]: ProcessedContent): QuartzComponentProps {
  return {
    ctx,
    externalResources: { css: [], js: [] },
    fileData: file.data,
    cfg: ctx.cfg.configuration,
    children: [],
    tree,
    allFiles: [file.data],
  }
}

const postMarkdown = `---
title: Validated editorial fixture
description: A direct production renderer test.
kind: post
created: 2026-06-01T10:00:00Z
published: 2026-06-02T12:00:00Z
modified: 2026-06-03T14:00:00Z
tags:
  - quartz
  - metadata
canonical: https://dhpham.com/blog/canonical-fixture
source:
  repository: https://github.com/dayvidpham/dhpham-website
  revision: ${revision}
  path: blog/quartz/content/post.md
crossposts:
  - title: External edition
    url: https://notes.example.com/editorial-fixture
---

# Metadata fixture

These words exercise the actual registered Quartz processing path.
`

const browserContentContract = {
  title: "Browser content",
  links: [],
  tags: [],
  content: "JSON-safe text",
} satisfies ContentDetails
void browserContentContract

test("registered transformers derive one record for actual Head and ContentMeta renderers", async () => {
  const ctx = createContext("unused")
  const processed = await processMarkdown(ctx, "post.md", postMarkdown)
  const [, file] = processed

  assert.equal(file.data.editorial?.kind, EditorialContentKind.Post)
  assert.equal(
    file.data.derivedPageMetadata?.canonical,
    "https://dhpham.com/blog/canonical-fixture",
  )
  assert.equal(file.data.dates?.published?.toISOString(), "2026-06-02T12:00:00.000Z")

  const props = componentProps(ctx, processed)
  const HeadComponent = Head()
  const ContentMetaComponent = ContentMeta()
  const head = render(<HeadComponent {...props} />)
  const contentMeta = render(<ContentMetaComponent {...props} />)

  assert.match(head, /<link rel="canonical" href="https:\/\/dhpham\.com\/blog\/canonical-fixture"/)
  assert.match(
    head,
    /<meta property="og:url" content="https:\/\/dhpham\.com\/blog\/canonical-fixture"/,
  )
  assert.match(head, /<meta property="og:type" content="article"/)
  assert.match(head, /<meta property="article:published_time" content="2026-06-02T12:00:00Z"/)
  const structuredDataMatch = head.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)
  assert(structuredDataMatch)
  const structuredData = JSON.parse(structuredDataMatch[1])
  assert.equal(structuredData["@type"], "BlogPosting")
  assert.equal(structuredData.url, "https://dhpham.com/blog/canonical-fixture")
  assert.equal(structuredData.datePublished, "2026-06-02T12:00:00Z")
  assert.equal(structuredData.wordCount, file.data.derivedPageMetadata?.words)

  assert.match(contentMeta, /class="content-meta"/)
  assert.match(contentMeta, /data-metadata-field="published"/)
  assert.match(contentMeta, /data-metadata-field="word-count"/)
  assert.match(contentMeta, /data-source-revision=/)
  assert.match(contentMeta, new RegExp(revision))
  assert.match(contentMeta, /href="https:\/\/notes\.example\.com\/editorial-fixture"/)
})

test("reading metrics include materialized author asides but exclude visual mirrors", async () => {
  const ctx = createContext("unused")
  const processed = await processMarkdown(
    ctx,
    "semantic-aside.md",
    `---
title: Semantic reading metrics
description: Reading metrics include semantic authored content.
kind: post
published: 2026-06-02T12:00:00Z
---

Primary prose remains visible.

<aside data-reading-aside id="aside-context">Semantic author aside remains readable.</aside>
`,
  )
  const [, file] = processed
  const text = file.data.text ?? ""

  assert.match(text, /Primary prose remains visible/)
  assert.match(text, /Semantic author aside remains readable/)
  assert.doesNotMatch(text, /Visual mirror duplicate words/)
  assert.equal(file.data.derivedPageMetadata?.words, 9)
  assert.equal(file.data.derivedPageMetadata?.readingMinutes, 1)

  const props = componentProps(ctx, processed)
  const ContentMetaComponent = ContentMeta()
  const contentMeta = render(<ContentMetaComponent {...props} />)
  const HeadComponent = Head()
  const head = render(<HeadComponent {...props} />)
  const structuredDataMatch = head.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)
  assert(structuredDataMatch)
  assert.match(contentMeta, /data-metadata-field="word-count">9 words/)
  assert.match(contentMeta, /data-metadata-field="reading-time">1 min read/)
  assert.equal(JSON.parse(structuredDataMatch[1]).wordCount, 9)
})

test("visible editorial dates preserve authored offsets in multiple host timezones", async () => {
  const ctx = createContext("unused")
  const processed = await processMarkdown(
    ctx,
    "offset-date.md",
    `---
title: Offset-preserving dates
description: Visible dates retain their authored calendar values.
kind: post
published: 2026-07-02T00:30:00+14:00
modified: 2026-07-03T00:30:00+14:00
---

Timezone-independent rendering.
`,
  )
  const props = componentProps(ctx, processed)
  const ContentMetaComponent = ContentMeta()
  const priorTimezone = process.env.TZ
  let utc: string
  let kiritimati: string
  try {
    process.env.TZ = "UTC"
    utc = render(<ContentMetaComponent {...props} />)
    process.env.TZ = "Pacific/Kiritimati"
    kiritimati = render(<ContentMetaComponent {...props} />)
  } finally {
    if (priorTimezone === undefined) delete process.env.TZ
    else process.env.TZ = priorTimezone
  }

  assert.equal(utc, kiritimati)
  assert.match(utc, /Published <time datetime="2026-07-02T00:30:00\+14:00">Jul 02, 2026<\/time>/)
  assert.match(utc, /Modified <time datetime="2026-07-03T00:30:00\+14:00">Jul 03, 2026<\/time>/)

  const HeadComponent = Head()
  const head = render(<HeadComponent {...props} />)
  assert.match(head, /article:published_time" content="2026-07-02T00:30:00\+14:00"/)
  assert.match(head, /datePublished":"2026-07-02T00:30:00\+14:00"/)

  const output = await mkdtemp(join(tmpdir(), "quartz-offset-date-"))
  try {
    const emitterContext = createContext(output)
    await ContentIndex({ enableSiteMap: true, enableRSS: true }).emit(emitterContext, [processed], {
      css: [],
      js: [],
    })
    const sitemap = await readFile(join(output, "sitemap.xml"), "utf8")
    const feed = await readFile(join(output, "index.xml"), "utf8")
    assert.match(sitemap, /<lastmod>2026-07-02T10:30:00\.000Z<\/lastmod>/)
    assert.match(feed, /<pubDate>Wed, 01 Jul 2026 10:30:00 GMT<\/pubDate>/)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test("registered FrontMatter rejects invalid metadata with actionable boundary context", async () => {
  const ctx = createContext("unused")
  await assert.rejects(
    () =>
      processMarkdown(
        ctx,
        "invalid.md",
        `---
title: Invalid post
description: This URL is not safe.
kind: post
published: 2026-06-02T12:00:00Z
canonical: http://dhpham.com/blog/invalid
---

Invalid fixture.
`,
      ),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.match(error.message, /Operation: validate frontmatter/)
      assert.match(error.message, /File: "invalid\.md"/)
      assert.match(error.message, /Field: "canonical"/)
      assert.match(error.message, /Impact:/)
      assert.match(error.message, /Fix:/)
      return true
    },
  )
})

test("Head serializes hostile-but-valid text without creating a second script element", async () => {
  const ctx = createContext("unused")
  const processed = await processMarkdown(
    ctx,
    "safe-script.md",
    `---
title: "</script><script>alert('metadata')</script>"
description: Safe structured data serialization.
kind: post
published: 2026-06-02T12:00:00Z
---

Safe body.
`,
  )
  const HeadComponent = Head()
  const head = render(<HeadComponent {...componentProps(ctx, processed)} />)

  assert.equal(head.match(/<script/g)?.length, 1)
  assert.doesNotMatch(head, /<\/script><script>/)
  const structuredDataMatch = head.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)
  assert(structuredDataMatch)
  assert.equal(
    JSON.parse(structuredDataMatch[1]).headline,
    "</script><script>alert('metadata')</script>",
  )
})

test("a dated page remains website metadata rather than an article claim", async () => {
  const ctx = createContext("unused")
  const processed = await processMarkdown(
    ctx,
    "dated-page.md",
    `---
title: Dated reference page
kind: page
published: 2026-06-02T12:00:00Z
modified: 2026-06-03T14:00:00Z
tags:
  - reference
---

Reference body.
`,
  )
  const HeadComponent = Head()
  const head = render(<HeadComponent {...componentProps(ctx, processed)} />)

  assert.match(head, /<meta property="og:type" content="website"/)
  assert.doesNotMatch(head, /property="article:|application\/ld\+json/)
})

test("ContentIndex emits only explicit publication and modification dates", async () => {
  const output = await mkdtemp(join(tmpdir(), "quartz-metadata-"))
  try {
    const ctx = createContext(output)
    const page = await processMarkdown(
      ctx,
      "index.md",
      `---
title: Metadata fixture
kind: page
---

No explicit date exists here.
`,
    )
    const post = await processMarkdown(ctx, "post.md", postMarkdown)
    assert.equal(page[1].data.dates, undefined)
    const emitter = ContentIndex({
      enableSiteMap: true,
      enableRSS: true,
      rssLimit: 10,
      rssFullHtml: false,
      includeEmptyFiles: true,
    })

    await emitter.emit(ctx, [page, post], { css: [], js: [] })
    const sitemap = await readFile(join(output, "sitemap.xml"), "utf8")
    const feed = await readFile(join(output, "index.xml"), "utf8")
    const index = JSON.parse(await readFile(join(output, "static", "contentIndex.json"), "utf8"))

    assert.equal((sitemap.match(/<lastmod>/g) ?? []).length, 1)
    assert.match(sitemap, /<lastmod>2026-06-03T14:00:00\.000Z<\/lastmod>/)
    assert.match(sitemap, /<loc>https:\/\/dhpham\.com\/blog\/canonical-fixture<\/loc>/)
    assert.equal((feed.match(/<pubDate>/g) ?? []).length, 1)
    assert.match(feed, /<pubDate>Tue, 02 Jun 2026 12:00:00 GMT<\/pubDate>/)
    assert.doesNotMatch(feed, /undefined|Invalid Date/)
    assert.deepEqual(Object.keys(index).sort(), ["index", "post"])
    assert.deepEqual(Object.keys(index.post).sort(), ["content", "links", "tags", "title"])
    assert.deepEqual(Object.keys(index.index).sort(), ["content", "links", "tags", "title"])
    assert.equal(
      Object.values(index.post).every(
        (value) =>
          typeof value === "string" ||
          (Array.isArray(value) && value.every((entry) => typeof entry === "string")),
      ),
      true,
    )
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
