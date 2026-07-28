import readingTime from "reading-time"
import { GlobalConfiguration } from "../../cfg"
import { QuartzPluginData } from "../../plugins/vfile"
import { simplifySlug } from "../../util/path"
import { DerivedPageMetadata } from "./types"
import { validateCanonicalUrl } from "./validate"

function reject(data: QuartzPluginData, field: string, problem: string, fix: string): never {
  const sourcePath = data.relativePath ?? data.filePath ?? data.slug ?? "unknown source"
  throw new Error(
    `Editorial metadata derivation failed. Operation: derive page metadata. File: ${JSON.stringify(sourcePath)}. ` +
      `Field: ${JSON.stringify(field)}. Problem: ${problem}. ` +
      "Impact: Quartz cannot emit one trustworthy canonical and editorial record for this page. " +
      `Fix: ${fix}.`,
  )
}

function configuredBaseUrl(cfg: GlobalConfiguration, data: QuartzPluginData): URL {
  if (cfg.baseUrl === undefined || cfg.baseUrl.trim() === "") {
    reject(
      data,
      "baseUrl",
      "the Quartz base URL is absent",
      "configure the deployed HTTPS host and path in quartz.config.ts",
    )
  }

  const value = cfg.baseUrl.trim()
  let base: URL
  try {
    base = new URL(value.includes("://") ? value : `https://${value}`)
  } catch {
    reject(
      data,
      "baseUrl",
      "the configured base URL cannot be parsed",
      "use a host/path such as dhpham.com/blog",
    )
  }
  if (base.protocol !== "https:") {
    reject(data, "baseUrl", "the configured base URL is not HTTPS", "configure an HTTPS base URL")
  }
  if (base.username !== "" || base.password !== "" || base.search !== "" || base.hash !== "") {
    reject(
      data,
      "baseUrl",
      "the configured base URL contains credentials, a query, or a fragment",
      "remove credentials, ?query, and #fragment components",
    )
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/`
  return base
}

export function derivePageMetadata(
  cfg: GlobalConfiguration,
  data: QuartzPluginData,
): DerivedPageMetadata {
  const editorial = data.editorial
  if (editorial === undefined) {
    reject(
      data,
      "editorial",
      "validated frontmatter is absent",
      "run the registered FrontMatter transformer before derivation",
    )
  }
  if (data.slug === undefined) {
    reject(
      data,
      "slug",
      "the normalized Quartz slug is absent",
      "derive metadata only after Quartz assigns the source slug",
    )
  }
  if (data.text === undefined) {
    reject(
      data,
      "text",
      "processed post text is absent",
      "derive metadata from the processed Markdown HAST",
    )
  }

  const base = configuredBaseUrl(cfg, data)
  const simplifiedSlug = simplifySlug(data.slug)
  const route = simplifiedSlug === "/" ? "" : encodeURI(simplifiedSlug)
  const sourcePath = data.relativePath ?? data.filePath ?? data.slug
  const canonical = validateCanonicalUrl(
    sourcePath,
    editorial.canonical ?? new URL(route, base).href,
    "derive page metadata",
    "Quartz cannot emit a bounded canonical into Head, ContentMeta, sitemap, feed, or structured data",
  )
  const reading = readingTime(data.text)

  return {
    canonical,
    words: reading.words,
    readingMinutes: Math.ceil(reading.minutes),
    editorial,
  }
}
