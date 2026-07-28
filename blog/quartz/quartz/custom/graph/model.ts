import type { QuartzPluginData } from "../../plugins/vfile"
import type { BuildCtx } from "../../util/ctx"
import {
  type FullSlug,
  type SimpleSlug,
  isFullSlug,
  isSimpleSlug,
  simplifySlug,
} from "../../util/path"
import {
  GRAPH_ROUTE_SLUG,
  PUBLISHED_GRAPH_LIMITS,
  type PublishedGraphEdge,
  type PublishedGraphModel,
  type PublishedGraphNode,
} from "./types"

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

function graphBuildError(
  source: string,
  field: string,
  problem: string,
  impact: string,
  correction: string,
): never {
  throw new Error(
    `Published graph model build failed while emitting /graph/ for ${source}: field ${JSON.stringify(field)} ${problem}. ` +
      `${impact}. ${correction}.`,
  )
}

function sourceName(file: QuartzPluginData, index: number): string {
  return typeof file.filePath === "string"
    ? JSON.stringify(file.filePath)
    : `published file #${index + 1}`
}

const reservedGraphSlug = simplifySlug(GRAPH_ROUTE_SLUG as FullSlug)
const reservedGraphBase = reservedGraphSlug.replace(/\/$/, "")

type GraphRouteConflict = "ContentPage" | "FolderPage"

function graphRouteConflict(fullSlug: FullSlug): GraphRouteConflict | undefined {
  const simpleSlug = simplifySlug(fullSlug).replace(/\/$/, "")
  if (simpleSlug === reservedGraphBase) return "ContentPage"

  const segments = fullSlug.split("/")
  if (segments.length === 2 && segments[0] === reservedGraphBase) return "FolderPage"
  return undefined
}

function graphRouteOwnershipError(source: string, slug: string, conflictingEmitter: string): never {
  throw new Error(
    `Graph route ownership validation failed before ContentPage emission for ${source}: input slug ${JSON.stringify(slug)} ` +
      `would let the configured ${conflictingEmitter} emitter overwrite reserved graph/index.html. ` +
      "The custom /graph/ route would disappear if emission continued. Rename or move the conflicting input outside the graph route and rebuild.",
  )
}

export function assertGraphRouteOwnership(ctx: BuildCtx, files: readonly QuartzPluginData[]): void {
  for (const [index, file] of files.entries()) {
    const fullSlug = file.slug
    if (typeof fullSlug !== "string" || !isFullSlug(fullSlug)) continue
    const conflict = graphRouteConflict(fullSlug)
    if (conflict !== undefined) {
      graphRouteOwnershipError(sourceName(file, index), fullSlug, conflict)
    }
  }

  for (const inputSlug of ctx.allSlugs) {
    if (simplifySlug(inputSlug).replace(/\/$/, "") === reservedGraphBase) {
      graphRouteOwnershipError(
        `ctx.allSlugs entry from input directory ${JSON.stringify(ctx.argv.directory)}`,
        inputSlug,
        "Assets or ContentPage",
      )
    }
  }
}

export function buildPublishedGraph(files: readonly QuartzPluginData[]): PublishedGraphModel {
  if (files.length > PUBLISHED_GRAPH_LIMITS.nodes) {
    graphBuildError(
      "the published file collection",
      "allFiles node limit",
      `contains ${files.length} entries, above the declared limit of ${PUBLISHED_GRAPH_LIMITS.nodes}`,
      "The graph route cannot be generated within its deterministic node bound",
      "Reduce the number of published pages or split this site before rebuilding",
    )
  }

  const nodesBySlug = new Map<SimpleSlug, PublishedGraphNode>()
  const sourceFiles = new Map<SimpleSlug, QuartzPluginData>()

  for (const [index, file] of files.entries()) {
    const source = sourceName(file, index)
    const fullSlug = file.slug
    if (typeof fullSlug !== "string" || !isFullSlug(fullSlug)) {
      graphBuildError(
        source,
        "slug",
        `must be a valid Quartz full slug but received ${JSON.stringify(fullSlug)}`,
        "The page cannot be represented as a stable public graph node",
        "Give the published Markdown file a valid non-relative Quartz slug and rebuild",
      )
    }

    const slug = simplifySlug(fullSlug)
    const routeConflict = graphRouteConflict(fullSlug)
    if (routeConflict === "ContentPage") {
      graphBuildError(
        source,
        "slug",
        `uses reserved clean route ${JSON.stringify(slug)}`,
        "The authored page would collide with the synthetic /graph/ page",
        "Rename the authored page so the graph route remains synthetic",
      )
    }
    if (routeConflict === "FolderPage") {
      graphBuildError(
        source,
        "slug",
        `uses reserved graph folder child ${JSON.stringify(slug)}`,
        "The configured FolderPage emitter would overwrite graph/index.html after the custom route",
        "Rename or move the authored page outside the graph folder before rebuilding",
      )
    }
    if (nodesBySlug.has(slug)) {
      graphBuildError(
        source,
        "slug",
        `creates duplicate published node ${JSON.stringify(slug)}`,
        "The graph route cannot distinguish two authored pages with the same clean slug",
        "Rename one source page so every published clean slug is unique",
      )
    }

    const title = file.frontmatter?.title
    if (typeof title !== "string" || title.trim().length === 0) {
      graphBuildError(
        source,
        "frontmatter.title",
        `must be a non-empty string but received ${JSON.stringify(title)}`,
        "The textual graph would contain an unnamed navigation target",
        "Add a non-empty title to this page and rebuild",
      )
    }

    const tags = file.frontmatter?.tags ?? []
    if (!Array.isArray(tags)) {
      graphBuildError(
        source,
        "frontmatter.tags",
        "must be an array",
        "The graph cannot serialize this node deterministically",
        "Use a bounded list of tag strings and rebuild",
      )
    }
    if (tags.length > PUBLISHED_GRAPH_LIMITS.tagsPerNode) {
      graphBuildError(
        source,
        "frontmatter.tags tag limit",
        `contains ${tags.length} entries, above the declared limit of ${PUBLISHED_GRAPH_LIMITS.tagsPerNode}`,
        "The graph node exceeds its deterministic tag bound",
        "Reduce this page's tags and rebuild",
      )
    }
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.length === 0) {
        graphBuildError(
          source,
          "frontmatter.tags",
          `contains a non-string or empty entry ${JSON.stringify(tag)}`,
          "The graph cannot expose a stable tag label",
          "Remove the invalid tag and rebuild",
        )
      }
    }

    nodesBySlug.set(slug, {
      slug,
      title,
      tags: [...new Set(tags)].sort(compareText),
    })
    sourceFiles.set(slug, file)
  }

  const edges: PublishedGraphEdge[] = []
  const outgoingBySource = new Map<SimpleSlug, Set<SimpleSlug>>()
  let linkReferences = 0

  for (const [source, file] of sourceFiles) {
    const links = file.links ?? []
    if (!Array.isArray(links)) {
      graphBuildError(
        JSON.stringify(file.filePath),
        "links",
        "must be an array",
        "The graph cannot validate published edge endpoints",
        "Regenerate this page's Quartz links and rebuild",
      )
    }

    linkReferences += links.length
    if (linkReferences > PUBLISHED_GRAPH_LIMITS.edges) {
      graphBuildError(
        JSON.stringify(file.filePath),
        "links edge limit",
        `contains more than the declared limit of ${PUBLISHED_GRAPH_LIMITS.edges} link references`,
        "The graph route cannot validate links within its deterministic edge bound",
        "Reduce published links and rebuild",
      )
    }

    for (const target of links) {
      if (typeof target !== "string" || !isSimpleSlug(target)) {
        graphBuildError(
          JSON.stringify(file.filePath),
          "links",
          `contains ${JSON.stringify(target)}, which is not a valid Quartz simple slug`,
          "The graph cannot resolve this public edge safely",
          "Correct or remove the malformed link and rebuild",
        )
      }

      // Unpublished, private, and dangling destinations never become route nodes.
      if (!nodesBySlug.has(target)) continue

      const seenTargets = outgoingBySource.get(source) ?? new Set<SimpleSlug>()
      if (seenTargets.has(target)) {
        graphBuildError(
          JSON.stringify(file.filePath),
          "links",
          `contains duplicate published edge ${JSON.stringify(source)} -> ${JSON.stringify(target)}`,
          "The graph would contain ambiguous repeated relationship data",
          "Remove the duplicate link before rebuilding",
        )
      }
      seenTargets.add(target)
      outgoingBySource.set(source, seenTargets)
      edges.push({ source, target })
    }
  }

  edges.sort(
    (left, right) =>
      compareText(left.source, right.source) || compareText(left.target, right.target),
  )

  return {
    nodes: [...nodesBySlug.values()].sort((left, right) => compareText(left.slug, right.slug)),
    edges,
  }
}
