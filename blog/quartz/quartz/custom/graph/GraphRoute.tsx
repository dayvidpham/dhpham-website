import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "../../components/types"
// @ts-ignore
import script from "../../components/scripts/graph.inline"
import style from "../../components/styles/graph.scss"
import type { FullSlug, SimpleSlug } from "../../util/path"
import { resolveRelative } from "../../util/path"
import { buildPublishedGraph } from "./model"
import { GRAPH_ROUTE_SLUG, type PublishedGraphNode } from "./types"

const routeSlug = GRAPH_ROUTE_SLUG as FullSlug

function linkedNodes(
  slugs: readonly SimpleSlug[],
  nodesBySlug: ReadonlyMap<SimpleSlug, PublishedGraphNode>,
): PublishedGraphNode[] {
  return slugs.map((slug) => nodesBySlug.get(slug)).filter((node) => node !== undefined)
}

function NodeLinks({ label, nodes }: { label: string; nodes: readonly PublishedGraphNode[] }) {
  return (
    <div class="published-graph-links">
      <h4>{label}</h4>
      <ul>
        {nodes.length === 0 ? (
          <li class="published-graph-empty">None</li>
        ) : (
          nodes.map((node) => (
            <li key={node.slug}>
              <a href={resolveRelative(routeSlug, node.slug)} class="internal">
                {node.title}
              </a>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

export const GraphRouteComponent: QuartzComponent = ({ allFiles }: QuartzComponentProps) => {
  const model = buildPublishedGraph(allFiles)
  const nodesBySlug = new Map(model.nodes.map((node) => [node.slug, node]))
  const outgoingBySlug = new Map<SimpleSlug, SimpleSlug[]>()
  const backlinksBySlug = new Map<SimpleSlug, SimpleSlug[]>()
  for (const edge of model.edges) {
    const outgoing = outgoingBySlug.get(edge.source) ?? []
    outgoing.push(edge.target)
    outgoingBySlug.set(edge.source, outgoing)
    const backlinks = backlinksBySlug.get(edge.target) ?? []
    backlinks.push(edge.source)
    backlinksBySlug.set(edge.target, backlinks)
  }

  return (
    <article class="published-graph">
      <p id="published-graph-description">
        Explore links between every published page. The visualization is optional; the complete
        relationship list below remains available without JavaScript or canvas.
      </p>
      <div
        id="published-graph-container"
        class="published-graph-container"
        data-cfg={JSON.stringify({
          drag: true,
          zoom: true,
          depth: -1,
          scale: 0.9,
          repelForce: 0.5,
          centerForce: 0.3,
          linkDistance: 42,
          fontSize: 0.7,
          opacityScale: 1,
          removeTags: [],
          showTags: false,
          focusOnHover: true,
        })}
        data-graph-model={JSON.stringify(model)}
        aria-hidden="true"
      />
      <noscript>
        <p>The interactive visualization requires JavaScript; all graph links remain below.</p>
      </noscript>
      <nav aria-label="Graph relationships" aria-describedby="published-graph-description">
        {model.nodes.length === 0 ? (
          <p class="published-graph-empty">No published pages are available yet.</p>
        ) : (
          <ol class="published-graph-nodes">
            {model.nodes.map((node) => {
              const outgoing = linkedNodes(outgoingBySlug.get(node.slug) ?? [], nodesBySlug)
              const backlinks = linkedNodes(backlinksBySlug.get(node.slug) ?? [], nodesBySlug)
              return (
                <li
                  class="published-graph-node"
                  data-node-slug={node.slug}
                  data-outgoing-count={outgoing.length}
                  data-backlink-count={backlinks.length}
                  key={node.slug}
                >
                  <h3>
                    <a href={resolveRelative(routeSlug, node.slug)} class="internal">
                      {node.title}
                    </a>
                  </h3>
                  {node.tags.length > 0 && (
                    <p class="published-graph-tags">Tags: {node.tags.join(", ")}</p>
                  )}
                  <div class="published-graph-relationships">
                    <NodeLinks label="Outgoing links" nodes={outgoing} />
                    <NodeLinks label="Backlinks" nodes={backlinks} />
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </nav>
    </article>
  )
}

GraphRouteComponent.css = style
GraphRouteComponent.afterDOMLoaded = script

export default (() => GraphRouteComponent) satisfies QuartzComponentConstructor
