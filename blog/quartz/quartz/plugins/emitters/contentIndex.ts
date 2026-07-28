import { Root } from "hast"
import { GlobalConfiguration } from "../../cfg"
import { escapeHTML } from "../../util/escape"
import { FilePath, FullSlug, SimpleSlug, joinSegments } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import { toHtml } from "hast-util-to-html"
import { write } from "./helpers"
import { i18n } from "../../i18n"
import DepGraph from "../../depgraph"
import { HttpsUrl } from "../../custom/metadata/types"

export type ContentIndex = Map<FullSlug, ContentDetails>
export type ContentDetails = {
  title: string
  links: SimpleSlug[]
  tags: string[]
  content: string
  richContent?: string
}

type EmitterContentDetails = ContentDetails & {
  canonical: HttpsUrl
  published?: Date
  modified?: Date
  description?: string
}
type EmitterContentIndex = Map<FullSlug, EmitterContentDetails>

interface Options {
  enableSiteMap: boolean
  enableRSS: boolean
  rssLimit?: number
  rssFullHtml: boolean
  includeEmptyFiles: boolean
}

const defaultOptions: Options = {
  enableSiteMap: true,
  enableRSS: true,
  rssLimit: 10,
  rssFullHtml: false,
  includeEmptyFiles: true,
}

function generateSiteMap(idx: EmitterContentIndex): string {
  const createURLEntry = (content: EmitterContentDetails): string => `<url>
    <loc>${escapeHTML(content.canonical)}</loc>
    ${content.modified ? `<lastmod>${content.modified.toISOString()}</lastmod>` : ""}
  </url>`
  const urls = Array.from(idx)
    .map(([, content]) => createURLEntry(content))
    .join("")
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`
}

function generateRSSFeed(
  cfg: GlobalConfiguration,
  idx: EmitterContentIndex,
  limit?: number,
): string {
  const base = cfg.baseUrl ?? ""

  const createURLEntry = (content: EmitterContentDetails): string => `<item>
    <title>${escapeHTML(content.title)}</title>
    <link>${escapeHTML(content.canonical)}</link>
    <guid>${escapeHTML(content.canonical)}</guid>
    <description>${content.richContent ?? escapeHTML(content.description ?? "")}</description>
    ${content.published ? `<pubDate>${content.published.toUTCString()}</pubDate>` : ""}
  </item>`

  const items = Array.from(idx)
    .sort(([_, f1], [__, f2]) => {
      if (f1.published && f2.published) {
        return f2.published.getTime() - f1.published.getTime()
      } else if (f1.published && !f2.published) {
        return -1
      } else if (!f1.published && f2.published) {
        return 1
      }

      return f1.title.localeCompare(f2.title)
    })
    .map(([, content]) => createURLEntry(content))
    .slice(0, limit ?? idx.size)
    .join("")

  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
    <channel>
      <title>${escapeHTML(cfg.pageTitle)}</title>
      <link>https://${base}</link>
      <description>${!!limit ? i18n(cfg.locale).pages.rss.lastFewNotes({ count: limit }) : i18n(cfg.locale).pages.rss.recentNotes} on ${escapeHTML(
        cfg.pageTitle,
      )}</description>
      <generator>Quartz -- quartz.jzhao.xyz</generator>
      ${items}
    </channel>
  </rss>`
}

export const ContentIndex: QuartzEmitterPlugin<Partial<Options>> = (opts) => {
  opts = { ...defaultOptions, ...opts }
  return {
    name: "ContentIndex",
    async getDependencyGraph(ctx, content, _resources) {
      const graph = new DepGraph<FilePath>()

      for (const [_tree, file] of content) {
        const sourcePath = file.data.filePath!

        graph.addEdge(
          sourcePath,
          joinSegments(ctx.argv.output, "static/contentIndex.json") as FilePath,
        )
        if (opts?.enableSiteMap) {
          graph.addEdge(sourcePath, joinSegments(ctx.argv.output, "sitemap.xml") as FilePath)
        }
        if (opts?.enableRSS) {
          graph.addEdge(sourcePath, joinSegments(ctx.argv.output, "index.xml") as FilePath)
        }
      }

      return graph
    },
    async emit(ctx, content, _resources) {
      const cfg = ctx.cfg.configuration
      const emitted: FilePath[] = []
      const linkIndex: EmitterContentIndex = new Map()
      for (const [tree, file] of content) {
        const slug = file.data.slug
        if (slug === undefined) {
          const sourcePath = file.data.relativePath ?? file.data.filePath ?? "unknown source"
          throw new Error(
            `Content index metadata failed. Operation: emit ContentIndex. File: ${JSON.stringify(sourcePath)}. ` +
              'Field: "slug". Problem: the normalized Quartz slug is absent. ' +
              "Impact: sitemap, feed, and browser index entries cannot identify this page. " +
              "Fix: emit ContentIndex only after Quartz assigns the source slug.",
          )
        }
        const metadata = file.data.derivedPageMetadata
        if (metadata === undefined) {
          const sourcePath = file.data.relativePath ?? file.data.filePath ?? slug
          throw new Error(
            `Content index metadata failed. Operation: emit ContentIndex. File: ${JSON.stringify(sourcePath)}. ` +
              'Field: "derivedPageMetadata". Problem: the authoritative metadata record is absent. ' +
              "Impact: sitemap and feed output cannot report truthful canonical URLs or dates. " +
              "Fix: run the registered FrontMatter metadata derivation before ContentIndex.",
          )
        }
        if (opts?.includeEmptyFiles || (file.data.text && file.data.text !== "")) {
          linkIndex.set(slug, {
            title: metadata.editorial.title,
            links: file.data.links ?? [],
            tags: [...metadata.editorial.tags],
            content: file.data.text ?? "",
            richContent: opts?.rssFullHtml
              ? escapeHTML(toHtml(tree as Root, { allowDangerousHtml: true }))
              : undefined,
            canonical: metadata.canonical,
            published:
              metadata.editorial.published === undefined
                ? undefined
                : new Date(metadata.editorial.published),
            modified:
              metadata.editorial.modified === undefined
                ? undefined
                : new Date(metadata.editorial.modified),
            description: metadata.editorial.description,
          })
        }
      }

      if (opts?.enableSiteMap) {
        emitted.push(
          await write({
            ctx,
            content: generateSiteMap(linkIndex),
            slug: "sitemap" as FullSlug,
            ext: ".xml",
          }),
        )
      }

      if (opts?.enableRSS) {
        emitted.push(
          await write({
            ctx,
            content: generateRSSFeed(cfg, linkIndex, opts.rssLimit),
            slug: "index" as FullSlug,
            ext: ".xml",
          }),
        )
      }

      const fp = joinSegments("static", "contentIndex") as FullSlug
      const simplifiedIndex = Object.fromEntries(
        Array.from(linkIndex).map(([slug, content]) => {
          const contentIndexEntry = {
            title: content.title,
            links: content.links,
            tags: content.tags,
            content: content.content,
            ...(content.richContent === undefined ? {} : { richContent: content.richContent }),
          } satisfies ContentDetails
          return [slug, contentIndexEntry]
        }),
      )

      emitted.push(
        await write({
          ctx,
          content: JSON.stringify(simplifiedIndex),
          slug: fp,
          ext: ".json",
        }),
      )

      return emitted
    },
    getQuartzComponents: () => [],
  }
}
