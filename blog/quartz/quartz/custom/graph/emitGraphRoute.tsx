import { pageResources, renderPage } from "../../components/renderPage"
import type { QuartzComponentProps } from "../../components/types"
import type { FullPageLayout } from "../../cfg"
import { defaultContentPageLayout, sharedPageComponents } from "../../../quartz.layout"
import type { ProcessedContent } from "../../plugins/vfile"
import { defaultProcessedContent } from "../../plugins/vfile"
import type { BuildCtx } from "../../util/ctx"
import type { FilePath, FullSlug } from "../../util/path"
import { pathToRoot } from "../../util/path"
import type { StaticResources } from "../../util/resources"
import { write } from "../../plugins/emitters/helpers"
import GraphRoute from "./GraphRoute"
import { assertGraphRouteOwnership } from "./model"
import { GRAPH_ROUTE_SLUG } from "./types"

const graphRouteSlug = GRAPH_ROUTE_SLUG as FullSlug
const graphRouteBody = GraphRoute()
const graphRouteLayout: FullPageLayout = {
  ...sharedPageComponents,
  ...defaultContentPageLayout,
  pageBody: graphRouteBody,
}

export async function emitGraphRoute(
  ctx: BuildCtx,
  content: readonly ProcessedContent[],
  resources: StaticResources,
): Promise<FilePath> {
  const allFiles = content.map(([, file]) => file.data)
  assertGraphRouteOwnership(ctx, allFiles)
  const [tree, file] = defaultProcessedContent({
    slug: graphRouteSlug,
    filePath: "graph/index.md" as FilePath,
    relativePath: "graph/index.md" as FilePath,
    frontmatter: {
      title: "Graph",
      description: "Relationships between published pages",
      tags: [],
      kind: "page",
    },
    links: [],
    text: "",
    description: "Relationships between published pages",
  })
  const externalResources = pageResources(pathToRoot(graphRouteSlug), resources)
  const componentData: QuartzComponentProps = {
    ctx,
    fileData: file.data,
    externalResources,
    cfg: ctx.cfg.configuration,
    children: [],
    tree,
    allFiles,
  }
  const rendered = renderPage(
    ctx.cfg.configuration,
    graphRouteSlug,
    componentData,
    graphRouteLayout,
    externalResources,
  )

  return write({
    ctx,
    content: rendered,
    slug: graphRouteSlug,
    ext: ".html",
  })
}
