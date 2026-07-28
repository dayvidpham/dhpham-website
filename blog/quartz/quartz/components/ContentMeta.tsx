import { QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"
import { JSX } from "preact"
import style from "./styles/contentMeta.scss"
import { pathToRoot, slugTag } from "../util/path"
import { IsoTimestamp } from "../custom/metadata/types"

function formatEditorialDate(timestamp: IsoTimestamp, locale: string): string {
  const [year, month, day] = timestamp.slice(0, 10).split("-").map(Number)
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

interface ContentMetaOptions {
  /**
   * Whether to display reading time
   */
  showReadingTime: boolean
  showComma: boolean
}

const defaultOptions: ContentMetaOptions = {
  showReadingTime: true,
  showComma: true,
}

export default ((opts?: Partial<ContentMetaOptions>) => {
  // Merge options with defaults
  const options: ContentMetaOptions = { ...defaultOptions, ...opts }

  function ContentMetadata({ cfg, fileData, displayClass }: QuartzComponentProps) {
    const metadata = fileData.derivedPageMetadata
    if (metadata === undefined) return null

    const { editorial } = metadata
    const segments: JSX.Element[] = []
    const addDate = (field: "created" | "published" | "modified", label: string) => {
      const value = editorial[field]
      if (value !== undefined) {
        segments.push(
          <span data-metadata-field={field}>
            {label} <time dateTime={value}>{formatEditorialDate(value, cfg.locale)}</time>
          </span>,
        )
      }
    }

    addDate("created", "Created")
    addDate("published", "Published")
    addDate("modified", "Modified")

    if (editorial.tags.length > 0) {
      if (fileData.slug === undefined) {
        const sourcePath = fileData.relativePath ?? fileData.filePath ?? "unknown source"
        throw new Error(
          `Visible metadata rendering failed. Operation: render ContentMeta tags. File: ${JSON.stringify(sourcePath)}. ` +
            'Field: "slug". Problem: the normalized Quartz slug is absent. ' +
            "Impact: tag links cannot target a truthful page route. " +
            "Fix: render ContentMeta only after Quartz assigns the source slug.",
        )
      }
      const baseDir = pathToRoot(fileData.slug)
      segments.push(
        <span data-metadata-field="tags">
          Tags:{" "}
          {editorial.tags.map((tag, index) => (
            <>
              {index > 0 && ", "}
              <a class="internal tag-link" href={`${baseDir}/tags/${slugTag(tag)}`}>
                {tag}
              </a>
            </>
          ))}
        </span>,
      )
    }

    segments.push(
      <span data-metadata-field="word-count">
        {metadata.words.toLocaleString(cfg.locale)} {metadata.words === 1 ? "word" : "words"}
      </span>,
    )
    if (options.showReadingTime) {
      segments.push(
        <span data-metadata-field="reading-time">
          {i18n(cfg.locale).components.contentMeta.readingTime({
            minutes: metadata.readingMinutes,
          })}
        </span>,
      )
    }

    if (editorial.source !== undefined) {
      segments.push(
        <span data-metadata-field="source">
          Source:{" "}
          <a href={editorial.source.repository} rel="external">
            repository
          </a>{" "}
          at{" "}
          <code data-source-revision={editorial.source.revision}>{editorial.source.revision}</code>
          {editorial.source.path === undefined ? null : (
            <>
              {" "}
              (<code>{editorial.source.path}</code>)
            </>
          )}
        </span>,
      )
    }

    if (editorial.crossposts.length > 0) {
      segments.push(
        <span data-metadata-field="crossposts">
          Cross-posts:{" "}
          {editorial.crossposts.map((crosspost, index) => (
            <>
              {index > 0 && ", "}
              <a href={crosspost.url} rel="external">
                {crosspost.title}
              </a>
            </>
          ))}
        </span>,
      )
    }

    return (
      <p show-comma={options.showComma} class={classNames(displayClass, "content-meta")}>
        {segments}
      </p>
    )
  }

  ContentMetadata.css = style

  return ContentMetadata
}) satisfies QuartzComponentConstructor
