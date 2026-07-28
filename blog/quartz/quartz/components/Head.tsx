import { i18n } from "../i18n"
import { FullSlug, joinSegments, pathToRoot } from "../util/path"
import { JSResourceToScriptElement } from "../util/resources"
import { googleFontHref } from "../util/theme"
import { EditorialContentKind } from "../custom/metadata/types"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}

function postStructuredData(fileData: QuartzComponentProps["fileData"]): string | undefined {
  const metadata = fileData.derivedPageMetadata
  if (metadata?.editorial.kind !== EditorialContentKind.Post) return undefined

  const { editorial } = metadata
  if (editorial.description === undefined || editorial.published === undefined) {
    const sourcePath =
      fileData.relativePath ?? fileData.filePath ?? fileData.slug ?? "unknown source"
    throw new Error(
      `Structured metadata rendering failed. Operation: render BlogPosting JSON-LD. File: ${JSON.stringify(sourcePath)}. ` +
        'Field: "description/published". Problem: validated post requirements are absent. ' +
        "Impact: Quartz cannot make a truthful BlogPosting claim. " +
        "Fix: validate the post through the registered FrontMatter transformer before rendering.",
    )
  }

  return serializeStructuredData({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: editorial.title,
    description: editorial.description,
    url: metadata.canonical,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": metadata.canonical,
    },
    datePublished: editorial.published,
    ...(editorial.created === undefined ? {} : { dateCreated: editorial.created }),
    ...(editorial.modified === undefined ? {} : { dateModified: editorial.modified }),
    keywords: editorial.tags,
    wordCount: metadata.words,
    timeRequired: `PT${metadata.readingMinutes}M`,
    ...(editorial.source === undefined
      ? {}
      : {
          isBasedOn: {
            "@type": "SoftwareSourceCode",
            codeRepository: editorial.source.repository,
            version: editorial.source.revision,
            ...(editorial.source.path === undefined ? {} : { identifier: editorial.source.path }),
          },
        }),
    ...(editorial.crossposts.length === 0
      ? {}
      : { sameAs: editorial.crossposts.map(({ url }) => url) }),
  })
}

export default (() => {
  const Head: QuartzComponent = ({ cfg, fileData, externalResources }: QuartzComponentProps) => {
    const metadata = fileData.derivedPageMetadata
    const editorial = metadata?.editorial
    const isPost = editorial?.kind === EditorialContentKind.Post
    const title =
      editorial?.title ?? fileData.frontmatter?.title ?? i18n(cfg.locale).propertyDefaults.title
    const description =
      editorial?.description ??
      fileData.description?.trim() ??
      i18n(cfg.locale).propertyDefaults.description
    const { css, js } = externalResources
    const structuredData = postStructuredData(fileData)

    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)

    const iconPath = joinSegments(baseDir, "static/icon.png")
    const ogImagePath = cfg.baseUrl ? `https://${cfg.baseUrl}/static/og-image.png` : undefined

    return (
      <head>
        <title>{title}</title>
        <meta charSet="utf-8" />
        {cfg.theme.cdnCaching && cfg.theme.fontOrigin === "googleFonts" && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" />
            <link rel="stylesheet" href={googleFontHref(cfg.theme)} />
          </>
        )}
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content={isPost ? "article" : "website"} />
        {metadata && <meta property="og:url" content={metadata.canonical} />}
        {ogImagePath && <meta property="og:image" content={ogImagePath} />}
        <meta property="og:width" content="1200" />
        <meta property="og:height" content="675" />
        {isPost && editorial.published && (
          <meta property="article:published_time" content={editorial.published} />
        )}
        {isPost && editorial.modified && (
          <meta property="article:modified_time" content={editorial.modified} />
        )}
        {isPost && editorial.tags.map((tag) => <meta property="article:tag" content={tag} />)}
        {metadata && <link rel="canonical" href={metadata.canonical} />}
        <link rel="icon" href={iconPath} />
        <meta name="description" content={description} />
        <meta name="generator" content="Quartz" />
        {structuredData && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: structuredData }}
          ></script>
        )}
        {css.map((href) => (
          <link key={href} href={href} rel="stylesheet" type="text/css" spa-preserve />
        ))}
        {js
          .filter((resource) => resource.loadTime === "beforeDOMReady")
          .map((res) => JSResourceToScriptElement(res, true))}
      </head>
    )
  }

  return Head
}) satisfies QuartzComponentConstructor
