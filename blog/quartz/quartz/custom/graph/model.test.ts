import assert from "node:assert/strict"
import test, { describe } from "node:test"
import type { QuartzPluginData } from "../../plugins/vfile"
import type { FilePath, FullSlug, SimpleSlug } from "../../util/path"
import { buildPublishedGraph } from "./model"
import { PUBLISHED_GRAPH_LIMITS } from "./types"

function publishedFile(
  slug: string,
  options: {
    title?: string
    tags?: string[]
    links?: string[]
  } = {},
): QuartzPluginData {
  return {
    slug: slug as FullSlug,
    filePath: `content/${slug}.md` as FilePath,
    relativePath: `${slug}.md` as FilePath,
    frontmatter: {
      title: options.title ?? slug,
      tags: options.tags ?? [],
    },
    links: (options.links ?? []) as SimpleSlug[],
  }
}

describe("buildPublishedGraph", () => {
  test("builds empty and one-node graphs truthfully", () => {
    assert.deepEqual(buildPublishedGraph([]), { nodes: [], edges: [] })

    assert.deepEqual(buildPublishedGraph([publishedFile("index", { title: "Home" })]), {
      nodes: [{ slug: "/", title: "Home", tags: [] }],
      edges: [],
    })
  })

  test("sorts nodes, tags, and published edges without mutating input", () => {
    const files = [
      publishedFile("zeta", {
        title: "Zeta",
        tags: ["systems", "notes"],
        links: ["alpha", "private/hidden"],
      }),
      publishedFile("alpha", {
        title: "Alpha",
        tags: ["welcome"],
        links: ["zeta"],
      }),
    ]
    const zeta = files[0]!
    const originalTags = [...(zeta.frontmatter?.tags ?? [])]
    const originalLinks = [...(zeta.links ?? [])]

    assert.deepEqual(buildPublishedGraph(files), {
      nodes: [
        { slug: "alpha", title: "Alpha", tags: ["welcome"] },
        { slug: "zeta", title: "Zeta", tags: ["notes", "systems"] },
      ],
      edges: [
        { source: "alpha", target: "zeta" },
        { source: "zeta", target: "alpha" },
      ],
    })
    assert.deepEqual(zeta.frontmatter?.tags, originalTags)
    assert.deepEqual(zeta.links, originalLinks)
  })

  test("filters dangling and private links instead of promoting them to nodes", () => {
    const model = buildPublishedGraph([
      publishedFile("public", { links: ["private/secret", "missing"] }),
    ])

    assert.deepEqual(
      model.nodes.map((node) => node.slug),
      ["public"],
    )
    assert.deepEqual(model.edges, [])
  })

  test("rejects duplicate public nodes and edges actionably", () => {
    assert.throws(
      () => buildPublishedGraph([publishedFile("topic"), publishedFile("topic")]),
      /duplicate published node.*topic.*graph route cannot distinguish/is,
    )
    assert.throws(
      () =>
        buildPublishedGraph([
          publishedFile("source", { links: ["target", "target"] }),
          publishedFile("target"),
        ]),
      /duplicate published edge.*source.*target.*remove the duplicate/is,
    )
  })

  test("rejects the reserved synthetic route and malformed graph data", () => {
    assert.throws(
      () => buildPublishedGraph([publishedFile("graph/index")]),
      /reserved.*graph.*synthetic.*rename/is,
    )
    assert.throws(
      () => buildPublishedGraph([publishedFile("graph")]),
      /reserved.*graph.*synthetic.*rename/is,
    )
    assert.throws(
      () => buildPublishedGraph([publishedFile("graph/child")]),
      /reserved.*graph.*folder.*overwrite.*rename/is,
    )
    assert.throws(
      () => buildPublishedGraph([publishedFile("valid", { links: ["bad target"] })]),
      /field.*links.*bad target.*valid Quartz simple slug/is,
    )
  })

  test("rejects node, edge, and per-node tag collection overflow", () => {
    const tooManyNodes = Array.from({ length: PUBLISHED_GRAPH_LIMITS.nodes + 1 }, (_, index) =>
      publishedFile(`node-${index.toString().padStart(4, "0")}`),
    )
    assert.throws(
      () => buildPublishedGraph(tooManyNodes),
      new RegExp(`node limit.*${PUBLISHED_GRAPH_LIMITS.nodes}.*reduce`, "si"),
    )

    const edgeNodes = Array.from(
      { length: 101 },
      (_, index) => `edge-${index.toString().padStart(3, "0")}`,
    )
    const tooManyEdges = edgeNodes.map((slug) =>
      publishedFile(slug, { links: edgeNodes.filter((target) => target !== slug) }),
    )
    assert.throws(
      () => buildPublishedGraph(tooManyEdges),
      new RegExp(`edge limit.*${PUBLISHED_GRAPH_LIMITS.edges}.*reduce`, "si"),
    )

    assert.throws(
      () =>
        buildPublishedGraph([
          publishedFile("tagged", {
            tags: Array.from(
              { length: PUBLISHED_GRAPH_LIMITS.tagsPerNode + 1 },
              (_, index) => `tag-${index}`,
            ),
          }),
        ]),
      new RegExp(`tag limit.*${PUBLISHED_GRAPH_LIMITS.tagsPerNode}.*reduce`, "si"),
    )
  })
})
