import ContentMeta from "../../components/ContentMeta"
import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "../../components/types"
import { classNames } from "../../util/lang"
import { ReadingRailEntryKind } from "./types"
import style from "./readingRail.scss"

export default (() => {
  const ContentMetadata = ContentMeta()

  const ReadingRail: QuartzComponent = (props: QuartzComponentProps) => {
    if (!props.fileData.text) return null

    return (
      <aside
        class={classNames(props.displayClass, "reading-rail-entry", "reading-rail-metadata")}
        data-reading-rail-entry={ReadingRailEntryKind.Metadata}
        aria-label="Article metadata"
      >
        <ContentMetadata {...props} />
      </aside>
    )
  }

  ReadingRail.css = [ContentMetadata.css, style].filter((css) => css !== undefined).join("\n")
  return ReadingRail
}) satisfies QuartzComponentConstructor
