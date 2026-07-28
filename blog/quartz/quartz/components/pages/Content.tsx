import { htmlToJsx } from "../../util/jsx"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
import ReadingRailConstructor from "../../custom/reading-rail/ReadingRail"

const ReadingRail = ReadingRailConstructor()

const Content: QuartzComponent = (props: QuartzComponentProps) => {
  const { fileData, tree } = props
  const content = htmlToJsx(fileData.filePath!, tree)
  const classes: string[] = fileData.frontmatter?.cssclasses ?? []
  const classString = ["popover-hint", ...classes].join(" ")
  return (
    <article class={classString} data-reading-rail-content>
      <ReadingRail {...props} />
      {content}
    </article>
  )
}

Content.css = ReadingRail.css

export default (() => Content) satisfies QuartzComponentConstructor
