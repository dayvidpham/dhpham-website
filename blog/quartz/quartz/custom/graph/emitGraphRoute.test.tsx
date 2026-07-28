import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import * as nodeModule from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test, { describe } from "node:test"
import type { QuartzConfig } from "../../cfg"
import type { QuartzEmitterPluginInstance } from "../../plugins/types"
import type { BuildCtx } from "../../util/ctx"
import type { FilePath, FullSlug, SimpleSlug } from "../../util/path"
import type { StaticResources } from "../../util/resources"
import { defaultProcessedContent, type ProcessedContent } from "../../plugins/vfile"
import { parseMarkdown } from "../../processors/parse"
import { GRAPH_ROUTE_DEPENDENCY } from "./types"

type NextLoad = (url: string, context: unknown) => unknown

const registerHooks: unknown = Reflect.get(nodeModule, "registerHooks")
if (typeof registerHooks !== "function") {
  throw new Error(
    "Graph route emitter tests could not install the Node loader hooks required for Quartz inline and SCSS imports. " +
      "Run this handoff through the Nix development shell with Node 24 or newer.",
  )
}
registerHooks({
  load(url: string, context: unknown, nextLoad: NextLoad): unknown {
    if (url.endsWith(".scss")) {
      return {
        format: "module",
        shortCircuit: true,
        source: "export default '';",
      }
    }
    if (url.endsWith(".inline.ts")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url), "utf8"))};`,
      }
    }

    return nextLoad(url, context)
  },
})

const resources: StaticResources = { css: [], js: [] }

function buildContext(
  output: string,
  allSlugs: FullSlug[],
  cfg: QuartzConfig,
  directory = "fixture",
  fastRebuild = false,
): BuildCtx {
  return {
    buildId: "graph-route-test",
    argv: {
      directory,
      output,
      verbose: false,
      serve: false,
      fastRebuild,
      port: 0,
      wsPort: 0,
    },
    cfg,
    allSlugs,
  }
}

function content(slug: string, title: string, links: string[] = []): ProcessedContent {
  return defaultProcessedContent({
    slug: slug as FullSlug,
    filePath: `fixture/${slug}.md` as FilePath,
    relativePath: `${slug}.md` as FilePath,
    frontmatter: { title, tags: [] },
    links: links as SimpleSlug[],
    text: title,
    description: `${title} description`,
  })
}

async function writeSourceFixture(
  source: string,
  slug: string,
  title: string,
  wikilinks: string[] = [],
): Promise<FilePath> {
  const sourcePath = path.join(source, `${slug}.md`) as FilePath
  const body = wikilinks.map((target) => `[[${target}]]`).join(" ")
  await writeFile(
    sourcePath,
    ["---", `title: ${title}`, "kind: page", "---", "", `# ${title}`, "", body, ""].join("\n"),
  )
  return sourcePath
}

async function withOutput(run: (output: string) => Promise<void>): Promise<void> {
  const output = await mkdtemp(path.join(tmpdir(), "quartz-graph-route-"))
  try {
    await run(output)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
}

async function withWorkspace(
  run: (workspace: { source: string; output: string }) => Promise<void>,
): Promise<void> {
  const workspace = await mkdtemp(path.join(tmpdir(), "quartz-graph-composition-"))
  const source = path.join(workspace, "content")
  const output = path.join(workspace, "output")
  await mkdir(source, { recursive: true })
  try {
    await run({ source, output })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

function configuredEmitter(cfg: QuartzConfig, name: string): QuartzEmitterPluginInstance {
  const emitter = cfg.plugins.emitters.find((candidate) => candidate.name === name)
  assert.ok(emitter, `configured Quartz emitter ${name} must exist`)
  return emitter
}

async function emitConfiguredGraphComposition(
  ctx: BuildCtx,
  content: ProcessedContent[],
): Promise<FilePath[]> {
  const names = ctx.cfg.plugins.emitters.map((emitter) => emitter.name)
  assert.ok(names.indexOf("ContentPage") < names.indexOf("FolderPage"))
  assert.ok(names.indexOf("FolderPage") < names.indexOf("Assets"))

  const emitted: FilePath[] = []
  for (const name of ["ContentPage", "FolderPage", "Assets"]) {
    emitted.push(...(await configuredEmitter(ctx.cfg, name).emit(ctx, content, resources)))
  }
  return emitted
}

describe("registered ContentPage graph route", () => {
  test("tracks every source and preserves the route through configured downstream emitters", async () => {
    await withWorkspace(async ({ source, output }) => {
      const [{ default: quartzConfig }, { ContentIndex }] = await Promise.all([
        import("../../../quartz.config"),
        import("../../plugins/emitters/contentIndex"),
      ])
      const allSlugs = ["active", "direct"] as FullSlug[]
      const ctx = buildContext(output, allSlugs, quartzConfig, source)

      const activePath = await writeSourceFixture(source, "active", "Fixture active", [
        "direct",
        "private/hidden",
      ])
      const directPath = await writeSourceFixture(source, "direct", "Fixture direct", ["active"])

      // Exercise the real registered FrontMatter metadata derivation (the same
      // pipeline production builds run) so ContentIndex below sees a genuine
      // file.data.derivedPageMetadata instead of a hand-built synthetic record.
      const files = await parseMarkdown(ctx, [activePath, directPath])
      assert.equal(files.length, 2, "the registered pipeline must process every fixture source")

      const emitter = configuredEmitter(quartzConfig, "ContentPage")
      const dependencyGraph = await emitter.getDependencyGraph!(ctx, files, resources)
      const graphOutput = path.join(output, "graph/index.html") as FilePath

      for (const [, file] of files) {
        const sourcePath = file.data.filePath
        assert.ok(sourcePath)
        assert.equal(dependencyGraph.hasEdge(sourcePath, graphOutput), true)
      }

      const emitted = await emitConfiguredGraphComposition(ctx, files)
      assert.equal(emitted.includes(graphOutput), true)
      assert.equal(emitted.includes(path.join(output, "active.html") as FilePath), true)

      const graphDocument = await readFile(graphOutput, "utf8")
      assert.match(graphDocument, /<nav aria-label="Graph relationships"/)
      assert.match(graphDocument, /data-node-slug="active"/)
      assert.match(graphDocument, /data-node-slug="direct"/)
      assert.doesNotMatch(graphDocument, /private\/hidden/)
      assert.match(graphDocument, /href="\.\.\/active"/)
      assert.match(graphDocument, /href="\.\.\/direct"/)
      assert.match(graphDocument, /id="published-graph-container"/)
      assert.match(graphDocument, /id="explorer"/)
      assert.match(graphDocument, /id="search-button"/)
      assert.match(graphDocument, /class="backlinks"/)
      assert.doesNotMatch(graphDocument, /BlogPosting/)

      const activeDocument = await readFile(path.join(output, "active.html"), "utf8")
      assert.match(activeDocument, /id="graph-container" data-cfg="[^"]*&quot;depth&quot;:2/)
      assert.match(activeDocument, /class="graph-route-link internal" href="\.\/graph\/"/)

      await ContentIndex({ enableRSS: true, enableSiteMap: true }).emit(ctx, files, resources)
      const contentIndex = JSON.parse(
        await readFile(path.join(output, "static/contentIndex.json"), "utf8"),
      ) as Record<string, unknown>
      assert.deepEqual(Object.keys(contentIndex).sort(), ["active", "direct"])
      assert.equal(files.length, 2, "the synthetic route must not mutate authored content")
    })
  })

  test("rejects a configured FolderPage graph namespace collision before any page write", async () => {
    await withWorkspace(async ({ source, output }) => {
      const { default: quartzConfig } = await import("../../../quartz.config")
      const files = [content("graph/child", "Conflicting graph child")]
      const ctx = buildContext(output, ["graph/child" as FullSlug], quartzConfig, source)

      await assert.rejects(
        () => emitConfiguredGraphComposition(ctx, files),
        /graph route ownership.*graph\/child.*FolderPage.*rename/is,
      )
      await assert.rejects(() => readFile(path.join(output, "graph/index.html")))
      await assert.rejects(() => readFile(path.join(output, "graph/child.html")))
    })
  })

  test("rejects a configured Assets graph route collision before any page write", async () => {
    await withWorkspace(async ({ source, output }) => {
      const { default: quartzConfig } = await import("../../../quartz.config")
      await mkdir(path.join(source, "graph"), { recursive: true })
      await writeFile(path.join(source, "graph/index.html"), "asset collision")
      const ctx = buildContext(output, ["graph/index" as FullSlug], quartzConfig, source)

      await assert.rejects(
        () => emitConfiguredGraphComposition(ctx, []),
        /graph route ownership.*graph\/index.*Assets.*rename/is,
      )
      await assert.rejects(() => readFile(path.join(output, "graph/index.html")))
    })
  })

  test("retains and re-emits the zero-node route after final-source dependency cleanup", async () => {
    await withWorkspace(async ({ source, output }) => {
      const { default: quartzConfig } = await import("../../../quartz.config")
      const files = [content("index", "Only page")]
      const ctx = buildContext(output, ["index" as FullSlug], quartzConfig, source, true)
      const emitter = configuredEmitter(quartzConfig, "ContentPage")
      const dependencyGraph = await emitter.getDependencyGraph!(ctx, files, resources)
      const sourcePath = files[0][1].data.filePath
      assert.ok(sourcePath)
      const routePath = path.join(output, "graph/index.html") as FilePath
      assert.equal(dependencyGraph.hasEdge(GRAPH_ROUTE_DEPENDENCY, routePath), true)

      const upstreams = dependencyGraph.getLeafNodeAncestors(sourcePath)
      assert.equal(upstreams.has(GRAPH_ROUTE_DEPENDENCY), true)
      const contentMap = new Map<FilePath, ProcessedContent>([[sourcePath, files[0]!]])
      const toRemove = new Set<FilePath>([sourcePath])
      const upstreamContent = [...upstreams]
        .filter((upstream) => contentMap.has(upstream))
        .filter((upstream) => !toRemove.has(upstream))
        .map((upstream) => contentMap.get(upstream)!)
      assert.deepEqual(upstreamContent, [])
      await emitter.emit(ctx, upstreamContent, resources)

      dependencyGraph.removeNode(sourcePath)
      const orphaned = dependencyGraph.removeOrphanNodes()
      for (const orphan of orphaned) {
        if (orphan.startsWith(output)) await rm(orphan, { force: true })
      }
      assert.equal(orphaned.has(routePath), false)
      assert.equal(dependencyGraph.hasNode(routePath), true)
      const document = await readFile(routePath, "utf8")
      assert.match(document, /No published pages are available yet\./)
      assert.match(document, /data-graph-model="\{&quot;nodes&quot;:\[\],&quot;edges&quot;:\[\]\}"/)
    })
  })

  test("emits an operable empty graph route", async () => {
    await withOutput(async (output) => {
      const [{ default: quartzConfig }, { emitGraphRoute }] = await Promise.all([
        import("../../../quartz.config"),
        import("./emitGraphRoute"),
      ])
      const ctx = buildContext(output, [], quartzConfig)
      const emitted = await emitGraphRoute(ctx, [], resources)
      const document = await readFile(emitted, "utf8")

      assert.equal(emitted, path.join(output, "graph/index.html"))
      assert.match(document, /No published pages are available yet\./)
      assert.match(document, /<nav aria-label="Graph relationships"/)
      assert.match(document, /data-graph-model="\{&quot;nodes&quot;:\[\],&quot;edges&quot;:\[\]\}"/)
    })
  })
})
