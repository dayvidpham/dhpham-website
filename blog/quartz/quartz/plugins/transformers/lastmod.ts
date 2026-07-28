import { QuartzTransformerPlugin } from "../types"

export interface Options {
  priority: ("frontmatter" | "git" | "filesystem")[]
}

export const CreatedModifiedDate: QuartzTransformerPlugin<Partial<Options>> = (_userOpts) => {
  // Keep the upstream constructor contract while deliberately ignoring non-editorial fallbacks.
  return {
    name: "CreatedModifiedDate",
    markdownPlugins({ cfg }) {
      return [
        () => {
          return (_tree, file) => {
            const editorial = file.data.editorial
            if (editorial === undefined) {
              const sourcePath = file.data.relativePath ?? file.path
              throw new Error(
                `Editorial date mapping failed. Operation: map explicit editorial dates. File: ${JSON.stringify(sourcePath)}. ` +
                  'Field: "editorial". Problem: validated frontmatter is absent. ' +
                  "Impact: Quartz cannot expose truthful dates to registered consumers. " +
                  "Fix: register FrontMatter before CreatedModifiedDate.",
              )
            }

            const dates = {
              ...(editorial.created === undefined ? {} : { created: new Date(editorial.created) }),
              ...(editorial.published === undefined
                ? {}
                : { published: new Date(editorial.published) }),
              ...(editorial.modified === undefined
                ? {}
                : { modified: new Date(editorial.modified) }),
            }
            // Quartz list components treat any dates object as proof that the configured key exists.
            if (dates[cfg.configuration.defaultDateType] === undefined) {
              delete file.data.dates
            } else {
              file.data.dates = dates
            }
          }
        },
      ]
    },
  }
}
