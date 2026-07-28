import type { FilePath, SimpleSlug } from "../../util/path"

export const GRAPH_ROUTE_SLUG = "graph/index" as const
export const GRAPH_ROUTE_DEPENDENCY = "virtual:graph-route.dep" as FilePath

export const PUBLISHED_GRAPH_LIMITS = {
  nodes: 2_000,
  edges: 10_000,
  tagsPerNode: 32,
} as const

export interface PublishedGraphNode {
  readonly slug: SimpleSlug
  readonly title: string
  readonly tags: readonly string[]
}

export interface PublishedGraphEdge {
  readonly source: SimpleSlug
  readonly target: SimpleSlug
}

export interface PublishedGraphModel {
  readonly nodes: readonly PublishedGraphNode[]
  readonly edges: readonly PublishedGraphEdge[]
}
