import matter from "gray-matter"
import { Root, RootContent } from "hast"
import remarkFrontmatter from "remark-frontmatter"
import { Processor } from "unified"
import { QuartzTransformerPlugin } from "../types"
import yaml from "js-yaml"
import toml from "toml"
import { derivePageMetadata } from "../../custom/metadata/derive"
import { QuartzFrontmatter } from "../../custom/metadata/types"
import { validateEditorialFrontmatter } from "../../custom/metadata/validate"

export interface Options {
  delimiters: string | [string, string]
  language: "yaml" | "toml"
}

const defaultOptions: Options = {
  delimiters: "---",
  language: "yaml",
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function requireParsedMapping(
  sourcePath: string,
  language: Options["language"],
  input: unknown,
): object {
  if (!isRecord(input)) {
    throw new Error(
      `Frontmatter parsing failed. Operation: parse ${language} frontmatter. File: ${JSON.stringify(sourcePath)}. ` +
        'Field: "frontmatter". Problem: the document root is not a mapping. ' +
        "Impact: Quartz cannot validate or publish editorial metadata for this file. " +
        `Fix: replace the ${language} root with key/value frontmatter fields.`,
    )
  }
  return input
}

function coalesceAliases(data: Record<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    if (data[alias] !== undefined && data[alias] !== null) return data[alias]
  }
}

function coerceToArray(input: unknown): string[] | undefined {
  if (input === undefined || input === null) return undefined

  // coerce to array
  const values = Array.isArray(input)
    ? input
    : input
        .toString()
        .split(",")
        .map((tag: string) => tag.trim())

  // remove all non-strings
  return values
    .filter((tag: unknown) => typeof tag === "string" || typeof tag === "number")
    .map((tag: string | number) => tag.toString())
}

function semanticText(node: Root | RootContent): string {
  if (node.type === "text") return node.value
  if (node.type !== "root" && node.type !== "element") return ""
  if (node.type === "element") {
    const ariaHidden = node.properties.ariaHidden ?? node.properties["aria-hidden"]
    if (ariaHidden === true || ariaHidden === "true") return ""
  }
  return node.children.map(semanticText).join("")
}

export const FrontMatter: QuartzTransformerPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }
  return {
    name: "FrontMatter",
    markdownPlugins() {
      return [
        [remarkFrontmatter, ["yaml", "toml"]],
        () => {
          return (_, file) => {
            const sourcePath = file.data.relativePath ?? file.path
            const { data } = matter(Buffer.from(file.value), {
              ...opts,
              engines: {
                yaml: (s) =>
                  requireParsedMapping(
                    sourcePath,
                    "yaml",
                    yaml.load(s, { schema: yaml.JSON_SCHEMA }),
                  ),
                toml: (s) => requireParsedMapping(sourcePath, "toml", toml.parse(s)),
              },
            })

            const parsedData: unknown = data
            const editorial = validateEditorialFrontmatter(sourcePath, parsedData)
            const rawFrontmatter = isRecord(parsedData) ? parsedData : {}
            const aliases = coerceToArray(coalesceAliases(rawFrontmatter, ["aliases", "alias"]))
            const cssclasses = coerceToArray(
              coalesceAliases(rawFrontmatter, ["cssclasses", "cssclass"]),
            )
            const normalized: QuartzFrontmatter = {
              ...rawFrontmatter,
              title: editorial.title,
              tags: [...editorial.tags],
              ...(editorial.description === undefined
                ? {}
                : { description: editorial.description }),
              ...(aliases === undefined ? {} : { aliases }),
              ...(cssclasses === undefined ? {} : { cssclasses }),
            }

            // fill in frontmatter
            file.data.frontmatter = normalized
            file.data.editorial = editorial
          }
        },
      ]
    },
    htmlPlugins({ cfg }) {
      return [
        function queueEditorialMetadataFinalizer(this: Processor) {
          // Appending during processor freeze runs after every statically registered HTML transform.
          this.use(() => (tree: Root, file) => {
            if (file.data.frontmatter === undefined || file.data.editorial === undefined) {
              const sourcePath = file.data.relativePath ?? file.path
              throw new Error(
                `Editorial metadata wiring failed. Operation: derive finalized semantic page metadata. File: ${JSON.stringify(sourcePath)}. ` +
                  'Field: "frontmatter/editorial". Problem: the validated Markdown-boundary record is absent. ' +
                  "Impact: Quartz cannot derive one authoritative record for registered consumers. " +
                  "Fix: keep the FrontMatter Markdown transformer before its queued semantic finalizer.",
              )
            }
            file.data.frontmatter.tags = [...file.data.editorial.tags]
            file.data.text = semanticText(tree)
            file.data.derivedPageMetadata = derivePageMetadata(cfg.configuration, file.data)
          })
        },
      ]
    },
  }
}
