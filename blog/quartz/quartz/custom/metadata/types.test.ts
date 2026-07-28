import assert from "node:assert/strict"
import test from "node:test"
import { GlobalConfiguration } from "../../cfg"
import { isFilePath, isFullSlug } from "../../util/path"
import { derivePageMetadata } from "./derive"
import { EditorialContentKind, EditorialMetadataLimit } from "./types"
import { validateEditorialFrontmatter } from "./validate"

const revision = "baddd2a9d51c2b6a8bc65a67feddcfbbc48d9180"

const colorScheme = {
  light: "#fff",
  lightgray: "#eee",
  gray: "#888",
  darkgray: "#444",
  dark: "#111",
  secondary: "#246",
  tertiary: "#468",
  highlight: "#def",
  textHighlight: "#ffd",
}

const configuration = {
  pageTitle: "Metadata test",
  enableSPA: true,
  enablePopovers: true,
  analytics: null,
  locale: "en-US",
  baseUrl: "dhpham.com/blog",
  ignorePatterns: [],
  defaultDateType: "created",
  theme: {
    fontOrigin: "local",
    cdnCaching: false,
    typography: { header: "sans", body: "sans", code: "mono" },
    colors: { lightMode: colorScheme, darkMode: colorScheme },
  },
} satisfies GlobalConfiguration

const completePost = {
  kind: "post",
  title: "A validated post",
  summary: "One authoritative editorial summary.",
  created: "2026-07-01T08:00:00Z",
  published: "2026-07-02T09:30:00Z",
  modified: "2026-07-03T10:45:00Z",
  tags: ["Quartz Metadata", "testing"],
  canonical: "https://dhpham.com/blog/canonical-post",
  source: {
    repository: "https://github.com/dayvidpham/dhpham-website",
    revision,
    path: "blog/quartz/content/post.md",
  },
  crossposts: [
    {
      title: "Canonical mirror",
      url: "https://notes.example.com/canonical-post",
    },
  ],
}

function assertRejected(field: string, input: unknown): void {
  assert.throws(
    () => validateEditorialFrontmatter("fixtures/rejected.md", input),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.match(error.message, /Operation: validate frontmatter/)
      assert.match(error.message, /File: "fixtures\/rejected\.md"/)
      assert.match(
        error.message,
        new RegExp(`Field: "${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      )
      assert.match(error.message, /Impact:/)
      assert.match(error.message, /Fix:/)
      return true
    },
  )
}

test("validates a bounded post and normalizes its shared metadata", () => {
  const editorial = validateEditorialFrontmatter("fixtures/post.md", completePost)

  assert.deepEqual(editorial, {
    kind: EditorialContentKind.Post,
    title: "A validated post",
    description: "One authoritative editorial summary.",
    created: "2026-07-01T08:00:00Z",
    published: "2026-07-02T09:30:00Z",
    modified: "2026-07-03T10:45:00Z",
    tags: ["Quartz-Metadata", "testing"],
    canonical: "https://dhpham.com/blog/canonical-post",
    source: {
      repository: "https://github.com/dayvidpham/dhpham-website",
      revision,
      path: "blog/quartz/content/post.md",
    },
    crossposts: [
      {
        title: "Canonical mirror",
        url: "https://notes.example.com/canonical-post",
      },
    ],
  })
})

test("defaults an otherwise minimal page without inventing optional metadata", () => {
  assert.deepEqual(validateEditorialFrontmatter("index.md", { title: "Blog" }), {
    kind: EditorialContentKind.Page,
    title: "Blog",
    tags: [],
    crossposts: [],
  })
})

test("derives a stable default canonical and reading metrics from processed text", () => {
  const slug = "notes/post"
  const relativePath = "notes/post.md"
  assert(isFullSlug(slug))
  assert(isFilePath(relativePath))
  const editorial = validateEditorialFrontmatter(relativePath, completePost)
  const withoutOverride = { ...editorial, canonical: undefined }
  const derived = derivePageMetadata(configuration, {
    slug,
    relativePath,
    editorial: withoutOverride,
    text: "one two three four five",
  })

  assert.equal(derived.canonical, "https://dhpham.com/blog/notes/post")
  assert.equal(derived.words, 5)
  assert.equal(derived.readingMinutes, 1)
  assert.equal(derived.editorial, withoutOverride)
})

test("applies the same canonical bound to overrides and derived defaults", () => {
  const urlPrefix = "https://example.com/"
  const exactOverride = `${urlPrefix}${"a".repeat(
    EditorialMetadataLimit.UrlCharacters - urlPrefix.length,
  )}`
  const override = validateEditorialFrontmatter("bounded-override.md", {
    ...completePost,
    canonical: exactOverride,
  })
  assert.equal(override.canonical, exactOverride)
  assert.equal(override.canonical.length, EditorialMetadataLimit.UrlCharacters)

  const relativePath = "bounded-default.md"
  assert(isFilePath(relativePath))
  const editorial = validateEditorialFrontmatter(relativePath, {
    ...completePost,
    canonical: undefined,
  })
  const baseUrl = "example.com"
  const canonicalPrefixLength = `https://${baseUrl}/`.length
  const exactSlug = "a".repeat(EditorialMetadataLimit.UrlCharacters - canonicalPrefixLength)
  assert(isFullSlug(exactSlug))
  const exactDefault = derivePageMetadata(
    { ...configuration, baseUrl },
    { slug: exactSlug, relativePath, editorial, text: "bounded canonical" },
  )
  assert.equal(exactDefault.canonical.length, EditorialMetadataLimit.UrlCharacters)

  const overLimitSlug = `${exactSlug}a`
  assert(isFullSlug(overLimitSlug))
  assert.throws(
    () =>
      derivePageMetadata(
        { ...configuration, baseUrl },
        { slug: overLimitSlug, relativePath, editorial, text: "over limit canonical" },
      ),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.match(error.message, /Operation: derive page metadata/)
      assert.match(error.message, /File: "bounded-default\.md"/)
      assert.match(error.message, /Field: "canonical"/)
      assert.match(error.message, /2,048-character bound/)
      assert.match(error.message, /Impact:/)
      assert.match(error.message, /Fix:/)
      return true
    },
  )
})

test("rejects malformed, ambiguous, unsafe, and over-limit metadata", () => {
  assertRejected("frontmatter", null)
  assertRejected("title", { kind: "page" })
  assertRejected("title", { kind: "page", title: "x".repeat(201) })
  assertRejected("description/summary", {
    ...completePost,
    description: "Description",
    summary: "Summary",
  })
  assertRejected("published", { ...completePost, published: "2026-02-30T09:30:00Z" })
  assertRejected("created/published/modified", {
    ...completePost,
    created: "2026-07-04T08:00:00Z",
  })
  assertRejected("canonical", { ...completePost, canonical: "http://dhpham.com/blog/post" })
  assertRejected("canonical", {
    ...completePost,
    canonical: "https://author:secret@dhpham.com/blog/post",
  })
  assertRejected("canonical", {
    ...completePost,
    canonical: "https://dhpham.com/blog/post#duplicate",
  })
  assertRejected("source.revision", {
    ...completePost,
    source: { ...completePost.source, revision: "baddd2a" },
  })
  assertRejected("source.path", {
    ...completePost,
    source: { ...completePost.source, path: "/etc/passwd" },
  })
  assertRejected("source.path", {
    ...completePost,
    source: { ...completePost.source, path: "blog/../private.md" },
  })
  assertRejected("source.path", {
    ...completePost,
    source: { ...completePost.source, path: "blog/%2e%2e/private.md" },
  })
  assertRejected("published", { ...completePost, published: undefined })
  assertRejected("description", { ...completePost, summary: undefined })
  assertRejected("crossposts[1].url", {
    ...completePost,
    crossposts: [completePost.crossposts[0], { ...completePost.crossposts[0] }],
  })
  assertRejected("crossposts", {
    ...completePost,
    crossposts: Array.from({ length: 17 }, (_, index) => ({
      title: `Mirror ${index}`,
      url: `https://notes.example.com/${index}`,
    })),
  })
  assertRejected("tags", {
    ...completePost,
    tags: Array.from({ length: 33 }, (_, index) => `tag-${index}`),
  })
  assertRejected("tags[0]", { ...completePost, tags: [".."] })
})
