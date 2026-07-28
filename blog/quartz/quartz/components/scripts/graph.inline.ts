import type { ContentDetails } from "../../plugins/emitters/contentIndex"
import {
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  drag,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  select,
  zoom,
  zoomIdentity,
} from "d3"
import { Application, Circle, Container, Graphics, Text } from "pixi.js"
import { Group as TweenGroup, Tween as Tweened } from "@tweenjs/tween.js"
import { removeAllChildren } from "./util"
import {
  type FullSlug,
  type SimpleSlug,
  getFullSlug,
  isSimpleSlug,
  resolveRelative,
  simplifySlug,
} from "../../util/path"
import type { D3Config } from "../Graph"
import {
  PUBLISHED_GRAPH_LIMITS,
  type PublishedGraphEdge,
  type PublishedGraphModel,
  type PublishedGraphNode,
} from "../../custom/graph/types"

type GraphicsInfo = {
  color: string
  gfx: Graphics
  alpha: number
  active: boolean
}

type NodeData = {
  id: SimpleSlug
  text: string
  tags: string[]
} & SimulationNodeDatum

type SimpleLinkData = {
  source: SimpleSlug
  target: SimpleSlug
}

type LinkData = {
  source: NodeData
  target: NodeData
} & SimulationLinkDatum<NodeData>

type LinkRenderData = GraphicsInfo & {
  simulationData: LinkData
}

type NodeRenderData = GraphicsInfo & {
  simulationData: NodeData
  label: Text
}

type TweenNode = {
  update: (time: number) => void
  stop: () => void
}

type GraphInput = {
  nodes: Map<SimpleSlug, { title: string; tags: string[] }>
  links: SimpleLinkData[]
}

type ActiveRenderer = {
  dispose: () => void
}

const localStorageKey = "graph-visited"
const activeRenderers = new Map<string, ActiveRenderer>()
const renderGenerations = new Map<string, number>()
let navigationGeneration = 0

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

function getVisited(): Set<SimpleSlug> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(localStorageKey) ?? "[]")
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter(
        (entry): entry is SimpleSlug => typeof entry === "string" && isSimpleSlug(entry),
      ),
    )
  } catch {
    return new Set()
  }
}

function addToVisited(slug: SimpleSlug): void {
  try {
    const visited = getVisited()
    visited.add(slug)
    localStorage.setItem(localStorageKey, JSON.stringify([...visited].sort(compareText)))
  } catch {
    // Browsing and the semantic graph remain operable when storage is unavailable.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function parsePublishedGraph(serialized: string): PublishedGraphModel {
  const value: unknown = JSON.parse(serialized)
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("the embedded graph model must contain node and edge arrays")
  }
  if (value.nodes.length > PUBLISHED_GRAPH_LIMITS.nodes) {
    throw new Error(`the embedded graph exceeds the ${PUBLISHED_GRAPH_LIMITS.nodes}-node limit`)
  }
  if (value.edges.length > PUBLISHED_GRAPH_LIMITS.edges) {
    throw new Error(`the embedded graph exceeds the ${PUBLISHED_GRAPH_LIMITS.edges}-edge limit`)
  }

  const nodes: PublishedGraphNode[] = []
  const nodeSlugs = new Set<SimpleSlug>()
  for (const valueNode of value.nodes) {
    if (
      !isRecord(valueNode) ||
      typeof valueNode.slug !== "string" ||
      !isSimpleSlug(valueNode.slug) ||
      typeof valueNode.title !== "string" ||
      !isStringArray(valueNode.tags) ||
      valueNode.tags.length > PUBLISHED_GRAPH_LIMITS.tagsPerNode
    ) {
      throw new Error("an embedded graph node has an invalid slug, title, or bounded tag list")
    }
    if (nodeSlugs.has(valueNode.slug)) {
      throw new Error(`the embedded graph repeats node ${JSON.stringify(valueNode.slug)}`)
    }
    nodeSlugs.add(valueNode.slug)
    nodes.push({ slug: valueNode.slug, title: valueNode.title, tags: [...valueNode.tags] })
  }

  const edges: PublishedGraphEdge[] = []
  const targetsBySource = new Map<SimpleSlug, Set<SimpleSlug>>()
  for (const valueEdge of value.edges) {
    if (
      !isRecord(valueEdge) ||
      typeof valueEdge.source !== "string" ||
      !isSimpleSlug(valueEdge.source) ||
      typeof valueEdge.target !== "string" ||
      !isSimpleSlug(valueEdge.target) ||
      !nodeSlugs.has(valueEdge.source) ||
      !nodeSlugs.has(valueEdge.target)
    ) {
      throw new Error("an embedded graph edge has an invalid or unpublished endpoint")
    }
    const seenTargets = targetsBySource.get(valueEdge.source) ?? new Set<SimpleSlug>()
    if (seenTargets.has(valueEdge.target)) {
      throw new Error(
        `the embedded graph repeats edge ${JSON.stringify(valueEdge.source)} -> ${JSON.stringify(valueEdge.target)}`,
      )
    }
    seenTargets.add(valueEdge.target)
    targetsBySource.set(valueEdge.source, seenTargets)
    edges.push({ source: valueEdge.source, target: valueEdge.target })
  }

  return { nodes, edges }
}

async function graphInput(
  graph: HTMLElement,
  showTags: boolean,
  removeTags: string[],
): Promise<GraphInput> {
  const embedded = graph.dataset.graphModel
  if (embedded !== undefined) {
    const model = parsePublishedGraph(embedded)
    return {
      nodes: new Map(
        model.nodes.map((node) => [node.slug, { title: node.title, tags: [...node.tags] }]),
      ),
      links: model.edges.map((edge) => ({ source: edge.source, target: edge.target })),
    }
  }

  const data = new Map<SimpleSlug, ContentDetails>(
    Object.entries<ContentDetails>(await fetchData).map(([slug, details]) => [
      simplifySlug(slug as FullSlug),
      details,
    ]),
  )
  const nodes = new Map<SimpleSlug, { title: string; tags: string[] }>(
    [...data].map(([slug, details]) => [slug, { title: details.title, tags: [...details.tags] }]),
  )
  const links: SimpleLinkData[] = []
  const validLinks = new Set(nodes.keys())

  for (const [source, details] of data) {
    for (const target of details.links ?? []) {
      if (validLinks.has(target)) links.push({ source, target })
    }

    if (showTags) {
      for (const tag of details.tags.filter((tag) => !removeTags.includes(tag))) {
        const tagSlug = simplifySlug(`tags/${tag}` as FullSlug)
        if (!nodes.has(tagSlug)) nodes.set(tagSlug, { title: `#${tag}`, tags: [] })
        links.push({ source, target: tagSlug })
      }
    }
  }

  links.sort(
    (left, right) =>
      compareText(left.source, right.source) || compareText(left.target, right.target),
  )
  return { nodes, links }
}

function neighbourhoodFor(
  activeSlug: SimpleSlug,
  depth: number,
  nodes: ReadonlyMap<SimpleSlug, unknown>,
  links: readonly SimpleLinkData[],
): Set<SimpleSlug> {
  if (depth < 0) return new Set(nodes.keys())
  if (!nodes.has(activeSlug)) return new Set()

  const adjacent = new Map<SimpleSlug, Set<SimpleSlug>>()
  for (const { source, target } of links) {
    const sourceNeighbours = adjacent.get(source) ?? new Set<SimpleSlug>()
    sourceNeighbours.add(target)
    adjacent.set(source, sourceNeighbours)
    const targetNeighbours = adjacent.get(target) ?? new Set<SimpleSlug>()
    targetNeighbours.add(source)
    adjacent.set(target, targetNeighbours)
  }

  const result = new Set<SimpleSlug>([activeSlug])
  const queue: Array<{ slug: SimpleSlug; distance: number }> = [{ slug: activeSlug, distance: 0 }]
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (current.distance >= depth) continue
    for (const neighbour of adjacent.get(current.slug) ?? []) {
      if (result.has(neighbour)) continue
      result.add(neighbour)
      queue.push({ slug: neighbour, distance: current.distance + 1 })
    }
  }
  return result
}

function invalidateRenderer(containerId: string): number {
  const generation = (renderGenerations.get(containerId) ?? 0) + 1
  renderGenerations.set(containerId, generation)
  const renderer = activeRenderers.get(containerId)
  activeRenderers.delete(containerId)
  try {
    renderer?.dispose()
  } catch (error) {
    const graph = document.getElementById(containerId)
    if (graph) {
      removeAllChildren(graph)
      delete graph.dataset.graphNodes
      reportGraphFailure(graph, error)
    }
  }
  return generation
}

function disposeAllRenderers(): void {
  for (const containerId of new Set([...renderGenerations.keys(), ...activeRenderers.keys()])) {
    invalidateRenderer(containerId)
  }
}

function reportGraphFailure(graph: HTMLElement, error: unknown): void {
  graph.dataset.graphError = "true"
  const detail = error instanceof Error ? error.message : String(error)
  console.error(
    `Graph visualization failed in #${graph.id} while enhancing this page: ${detail}. ` +
      "Text links remain available; reload the page or disable canvas acceleration if this persists.",
  )
}

async function renderGraph(containerId: string, fullSlug: FullSlug): Promise<void> {
  const generation = invalidateRenderer(containerId)
  const graph = document.getElementById(containerId)
  if (!graph) return
  removeAllChildren(graph)
  delete graph.dataset.graphError
  delete graph.dataset.graphNodes

  let pendingApplication: Application | undefined
  let pendingSimulation: Simulation<NodeData, LinkData> | undefined
  try {
    const config: D3Config = JSON.parse(graph.dataset.cfg ?? "")
    const input = await graphInput(graph, config.showTags, config.removeTags)
    if (renderGenerations.get(containerId) !== generation || !graph.isConnected) return

    const activeSlug = simplifySlug(fullSlug)
    const neighbourhood = neighbourhoodFor(activeSlug, config.depth, input.nodes, input.links)
    const nodes: NodeData[] = [...neighbourhood].sort(compareText).map((id) => ({
      id,
      text: input.nodes.get(id)?.title ?? id,
      tags: input.nodes.get(id)?.tags ?? [],
    }))
    const nodesById = new Map(nodes.map((node) => [node.id, node]))
    const links: LinkData[] = input.links.flatMap((link) => {
      const source = nodesById.get(link.source)
      const target = nodesById.get(link.target)
      return source && target ? [{ source, target }] : []
    })

    const width = Math.max(graph.offsetWidth, 1)
    const height = Math.max(graph.offsetHeight, 250)
    const app = new Application()
    pendingApplication = app
    await app.init({
      width,
      height,
      antialias: true,
      autoStart: false,
      autoDensity: true,
      backgroundAlpha: 0,
      preference: "webgl",
      resolution: window.devicePixelRatio,
      eventMode: "static",
    })
    if (renderGenerations.get(containerId) !== generation || !graph.isConnected) {
      app.destroy(true, { children: true, context: true })
      pendingApplication = undefined
      return
    }

    graph.dataset.graphNodes = JSON.stringify(nodes.map((node) => node.id))
    graph.appendChild(app.canvas)
    const stage = app.stage
    stage.interactive = false
    const labelsContainer = new Container<Text>({ zIndex: 3 })
    const nodesContainer = new Container<Graphics>({ zIndex: 2 })
    const linkContainer = new Container<Graphics>({ zIndex: 1 })
    stage.addChild(nodesContainer, labelsContainer, linkContainer)

    const simulation: Simulation<NodeData, LinkData> = forceSimulation<NodeData>(nodes)
      .force("charge", forceManyBody().strength(-100 * config.repelForce))
      .force("center", forceCenter().strength(config.centerForce))
      .force("link", forceLink<NodeData, LinkData>(links).distance(config.linkDistance))
    pendingSimulation = simulation

    const degree = new Map<SimpleSlug, number>()
    for (const link of links) {
      degree.set(link.source.id, (degree.get(link.source.id) ?? 0) + 1)
      degree.set(link.target.id, (degree.get(link.target.id) ?? 0) + 1)
    }
    const nodeRadius = (node: NodeData): number => 2 + Math.sqrt(degree.get(node.id) ?? 0)
    simulation.force("collide", forceCollide<NodeData>(nodeRadius).iterations(3))

    const cssVars = [
      "--secondary",
      "--tertiary",
      "--gray",
      "--light",
      "--lightgray",
      "--dark",
      "--bodyFont",
    ] as const
    const computedStyleMap = cssVars.reduce(
      (accumulator, key) => {
        accumulator[key] = getComputedStyle(document.documentElement).getPropertyValue(key)
        return accumulator
      },
      {} as Record<(typeof cssVars)[number], string>,
    )
    const visited = getVisited()
    const color = (node: NodeData): string => {
      if (node.id === activeSlug) return computedStyleMap["--secondary"]
      if (visited.has(node.id) || node.id.startsWith("tags/")) {
        return computedStyleMap["--tertiary"]
      }
      return computedStyleMap["--gray"]
    }

    let hoveredNodeId: string | null = null
    let dragging = false
    let dragStartTime = 0
    let currentTransform = zoomIdentity
    const tweens = new Map<string, TweenNode>()
    const nodeRenderData: NodeRenderData[] = []
    const linkRenderData: LinkRenderData[] = []

    function updateHoverInfo(newHoveredId: string | null): void {
      hoveredNodeId = newHoveredId
      const neighbours = new Set<string>()
      for (const link of linkRenderData) {
        const { source, target } = link.simulationData
        link.active =
          newHoveredId !== null && (source.id === newHoveredId || target.id === newHoveredId)
        if (link.active) {
          neighbours.add(source.id)
          neighbours.add(target.id)
        }
      }
      for (const node of nodeRenderData) node.active = neighbours.has(node.simulationData.id)
    }

    function replaceTween(name: string, group: TweenGroup): void {
      tweens.get(name)?.stop()
      group.getAll().forEach((item) => item.start())
      tweens.set(name, {
        update: group.update.bind(group),
        stop: () => group.getAll().forEach((item) => item.stop()),
      })
    }

    function renderLinks(): void {
      const group = new TweenGroup()
      for (const link of linkRenderData) {
        const alpha = hoveredNodeId === null || link.active ? 1 : 0.2
        link.color = link.active ? computedStyleMap["--gray"] : computedStyleMap["--lightgray"]
        group.add(new Tweened<LinkRenderData>(link).to({ alpha }, 200))
      }
      replaceTween("links", group)
    }

    function renderLabels(): void {
      const group = new TweenGroup()
      const defaultScale = 1 / config.scale
      for (const node of nodeRenderData) {
        const active = hoveredNodeId === node.simulationData.id
        group.add(
          new Tweened<Text>(node.label).to(
            {
              alpha: active ? 1 : node.label.alpha,
              scale: {
                x: active ? defaultScale * 1.1 : defaultScale,
                y: active ? defaultScale * 1.1 : defaultScale,
              },
            },
            100,
          ),
        )
      }
      replaceTween("labels", group)
    }

    function renderNodes(): void {
      const group = new TweenGroup()
      for (const node of nodeRenderData) {
        const alpha = hoveredNodeId !== null && config.focusOnHover ? (node.active ? 1 : 0.2) : 1
        group.add(new Tweened<Graphics>(node.gfx, group).to({ alpha }, 200))
      }
      replaceTween("nodes", group)
    }

    function renderHover(): void {
      renderNodes()
      renderLinks()
      renderLabels()
    }

    for (const node of nodes) {
      const label = new Text({
        interactive: false,
        eventMode: "none",
        text: node.text,
        alpha: 0,
        anchor: { x: 0.5, y: 1.2 },
        style: {
          fontSize: config.fontSize * 15,
          fill: computedStyleMap["--dark"],
          fontFamily: computedStyleMap["--bodyFont"],
        },
        resolution: window.devicePixelRatio * 4,
      })
      label.scale.set(1 / config.scale)
      let oldLabelOpacity = 0
      const tagNode = node.id.startsWith("tags/")
      const gfx = new Graphics({
        interactive: true,
        label: node.id,
        eventMode: "static",
        hitArea: new Circle(0, 0, nodeRadius(node)),
        cursor: "pointer",
      })
        .circle(0, 0, nodeRadius(node))
        .fill({ color: tagNode ? computedStyleMap["--light"] : color(node) })
        .stroke({ width: tagNode ? 2 : 0, color: color(node) })
        .on("pointerover", () => {
          updateHoverInfo(node.id)
          oldLabelOpacity = label.alpha
          if (!dragging) renderHover()
        })
        .on("pointerleave", () => {
          updateHoverInfo(null)
          label.alpha = oldLabelOpacity
          if (!dragging) renderHover()
        })

      nodesContainer.addChild(gfx)
      labelsContainer.addChild(label)
      nodeRenderData.push({
        simulationData: node,
        gfx,
        label,
        color: color(node),
        alpha: 1,
        active: false,
      })
    }

    for (const link of links) {
      const gfx = new Graphics({ interactive: false, eventMode: "none" })
      linkContainer.addChild(gfx)
      linkRenderData.push({
        simulationData: link,
        gfx,
        color: computedStyleMap["--lightgray"],
        alpha: 1,
        active: false,
      })
    }

    const canvasSelection = select<HTMLCanvasElement, NodeData | undefined>(app.canvas)
    if (config.drag) {
      canvasSelection.call(
        drag<HTMLCanvasElement, NodeData | undefined>()
          .container(() => app.canvas)
          .subject(() => nodes.find((node) => node.id === hoveredNodeId))
          .on("start", (event) => {
            if (!event.active) simulation.alphaTarget(1).restart()
            event.subject.fx = event.subject.x
            event.subject.fy = event.subject.y
            event.subject.__initialDragPos = { x: event.subject.x, y: event.subject.y }
            dragStartTime = Date.now()
            dragging = true
          })
          .on("drag", (event) => {
            const initial = event.subject.__initialDragPos
            event.subject.fx = initial.x + (event.x - initial.x) / currentTransform.k
            event.subject.fy = initial.y + (event.y - initial.y) / currentTransform.k
          })
          .on("end", (event) => {
            if (!event.active) simulation.alphaTarget(0)
            event.subject.fx = null
            event.subject.fy = null
            dragging = false
            if (Date.now() - dragStartTime < 500) {
              const target = resolveRelative(fullSlug, event.subject.id)
              window.spaNavigate(new URL(target, window.location.toString()))
            }
          }),
      )
    } else {
      for (const node of nodeRenderData) {
        node.gfx.on("click", () => {
          const target = resolveRelative(fullSlug, node.simulationData.id)
          window.spaNavigate(new URL(target, window.location.toString()))
        })
      }
    }

    if (config.zoom) {
      select<HTMLCanvasElement, NodeData>(app.canvas).call(
        zoom<HTMLCanvasElement, NodeData>()
          .extent([
            [0, 0],
            [width, height],
          ])
          .scaleExtent([0.25, 4])
          .on("zoom", ({ transform }) => {
            currentTransform = transform
            stage.scale.set(transform.k, transform.k)
            stage.position.set(transform.x, transform.y)
            const labelOpacity = Math.max((transform.k * config.opacityScale - 1) / 3.75, 0)
            for (const node of nodeRenderData) {
              if (!node.active) node.label.alpha = labelOpacity
            }
          }),
      )
    }

    let disposed = false
    let animationFrame: number | undefined
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      const canvas = app.canvas
      let cleanupError: unknown
      const attempt = (cleanup: () => void): void => {
        try {
          cleanup()
        } catch (error) {
          cleanupError ??= error
        }
      }
      attempt(() => simulation.stop())
      attempt(() => tweens.forEach((tween) => tween.stop()))
      tweens.clear()
      const frame = animationFrame
      if (frame !== undefined) attempt(() => cancelAnimationFrame(frame))
      attempt(() => select(canvas).on(".drag", null).on(".zoom", null))
      attempt(() => app.destroy(true, { children: true, context: true }))
      canvas.remove()
      delete graph.dataset.graphNodes
      if (cleanupError !== undefined) reportGraphFailure(graph, cleanupError)
    }
    activeRenderers.set(containerId, { dispose })
    pendingApplication = undefined
    pendingSimulation = undefined

    const animate = (time: number): void => {
      if (disposed) return
      for (const node of nodeRenderData) {
        const { x, y } = node.simulationData
        if (x === undefined || y === undefined) continue
        node.gfx.position.set(x + width / 2, y + height / 2)
        node.label.position.set(x + width / 2, y + height / 2)
      }
      for (const link of linkRenderData) {
        const { source, target } = link.simulationData
        link.gfx.clear()
        link.gfx.moveTo((source.x ?? 0) + width / 2, (source.y ?? 0) + height / 2)
        link.gfx
          .lineTo((target.x ?? 0) + width / 2, (target.y ?? 0) + height / 2)
          .stroke({ alpha: link.alpha, width: 1, color: link.color })
      }
      tweens.forEach((tween) => tween.update(time))
      app.renderer.render(stage)
      animationFrame = requestAnimationFrame(animate)
    }
    animationFrame = requestAnimationFrame(animate)
  } catch (error) {
    pendingSimulation?.stop()
    try {
      pendingApplication?.destroy(true, { children: true, context: true })
    } catch {
      // Preserve the semantic fallback if a partially initialized renderer cannot be destroyed.
    }
    if (renderGenerations.get(containerId) === generation) {
      invalidateRenderer(containerId)
      delete graph.dataset.graphNodes
      reportGraphFailure(graph, error)
    }
  }
}

const handleThemeChange = (): void => {
  const slug = getFullSlug(window)
  void Promise.all([
    renderGraph("graph-container", slug),
    renderGraph("published-graph-container", slug),
  ])
  if (document.getElementById("global-graph-outer")?.classList.contains("active")) {
    void renderGraph("global-graph-container", slug)
  }
}
document.addEventListener("themechange", handleThemeChange)

document.addEventListener("nav", async (event: CustomEventMap["nav"]) => {
  const currentNavigation = ++navigationGeneration
  const slug = event.detail.url
  addToVisited(simplifySlug(slug))
  disposeAllRenderers()

  const renderPageGraphs = async (): Promise<void> => {
    await Promise.all([
      renderGraph("graph-container", slug),
      renderGraph("published-graph-container", slug),
    ])
  }
  await renderPageGraphs()
  if (currentNavigation !== navigationGeneration) return

  const globalContainer = document.getElementById("global-graph-outer")
  const sidebar = globalContainer?.closest(".sidebar") as HTMLElement | null
  const globalIcon = document.getElementById("global-graph-icon")

  const hideGlobalGraph = (): void => {
    globalContainer?.classList.remove("active")
    if (sidebar) sidebar.style.zIndex = "unset"
    invalidateRenderer("global-graph-container")
  }
  const showGlobalGraph = (): void => {
    if (!globalContainer) return
    globalContainer.classList.add("active")
    if (sidebar) sidebar.style.zIndex = "1"
    void renderGraph("global-graph-container", getFullSlug(window))
  }
  const handleGlobalClick = (clickEvent: MouseEvent): void => {
    if (clickEvent.target === globalContainer) hideGlobalGraph()
  }
  const handleKeydown = (keyboardEvent: KeyboardEvent): void => {
    if (keyboardEvent.key.startsWith("Esc") && globalContainer?.classList.contains("active")) {
      keyboardEvent.preventDefault()
      hideGlobalGraph()
      return
    }
    if (
      keyboardEvent.key === "g" &&
      (keyboardEvent.ctrlKey || keyboardEvent.metaKey) &&
      !keyboardEvent.shiftKey
    ) {
      keyboardEvent.preventDefault()
      globalContainer?.classList.contains("active") ? hideGlobalGraph() : showGlobalGraph()
    }
  }
  globalIcon?.addEventListener("click", showGlobalGraph)
  globalContainer?.addEventListener("click", handleGlobalClick)
  document.addEventListener("keydown", handleKeydown)

  window.addCleanup(() => {
    globalIcon?.removeEventListener("click", showGlobalGraph)
    globalContainer?.removeEventListener("click", handleGlobalClick)
    document.removeEventListener("keydown", handleKeydown)
    disposeAllRenderers()
  })
})
