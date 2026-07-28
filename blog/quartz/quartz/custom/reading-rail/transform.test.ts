import assert from "node:assert/strict"
import test from "node:test"
import type { Element, Root } from "hast"
import rehypeRaw from "rehype-raw"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { toString as hastToString } from "hast-util-to-string"
import { unified } from "unified"
import {
  READING_RAIL_FOOTNOTE_SECTION_ID,
  READING_RAIL_LIMITS,
  READING_RAIL_METADATA_ID,
  ReadingRailEntryKind,
} from "./types"
import { transformReadingRail } from "./transform"

async function parseHtml(source: string): Promise<Root> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
  const parsed = processor.parse(source)
  return processor.run(parsed)
}

function collectElements(root: Root | Element, predicate: (element: Element) => boolean) {
  const matches: Element[] = []

  function walk(element: Root | Element) {
    for (const child of element.children) {
      if (child.type !== "element") continue
      if (predicate(child)) matches.push(child)
      walk(child)
    }
  }

  walk(root)
  return matches
}

function hasProperty(element: Element, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(element.properties, property)
}

function getStringProperty(element: Element, property: string): string | undefined {
  const value = element.properties[property]
  return typeof value === "string" ? value : undefined
}

function findOne(root: Root | Element, predicate: (element: Element) => boolean): Element {
  const matches = collectElements(root, predicate)
  assert.equal(matches.length, 1)
  return matches[0]
}

function findElementParent(root: Root, target: Element): Element {
  let result: Element | undefined

  function walk(parent: Element): void {
    for (const child of parent.children) {
      if (child === target) {
        result = parent
        return
      }
      if (child.type === "element") walk(child)
      if (result !== undefined) return
    }
  }

  for (const child of root.children) {
    if (child.type === "element") walk(child)
    if (result !== undefined) break
  }
  assert.ok(result, "Expected the target element to have an element parent.")
  return result
}

function countOccurrences(value: string, expected: string): number {
  return value.split(expected).length - 1
}

function expectActionableTransformFailure(
  tree: Root,
  sourcePath: string,
  expectedField: RegExp,
): void {
  try {
    transformReadingRail(tree, sourcePath)
    assert.fail(`Expected reading-rail validation to reject ${sourcePath}.`)
  } catch (error) {
    assert.ok(error instanceof Error)
    assert.match(error.message, new RegExp(sourcePath.replaceAll(".", "\\.")))
    assert.match(error.message, expectedField)
    assert.match(error.message, /Quartz cannot emit this article/)
    assert.match(error.message, /Fix:/)
  }
}

const validSource = `
Claim one has a shared note.[^shared]

<aside data-reading-aside id="aside-context">Original context for the claim.</aside>

Claim two refers to the same note again.[^shared] It also has another note.[^detail]

[^shared]: Shared canonical note with [a source](https://example.com/source).
[^detail]: A second canonical note.
`.trim()

test("transforms marked asides and GFM footnotes without changing canonical semantics", async () => {
  const tree = await parseHtml(validSource)
  const canonicalSection = findOne(tree, (element) => hasProperty(element, "dataFootnotes"))
  const canonicalChildren = structuredClone(canonicalSection.children)
  const canonicalBackrefs = collectElements(canonicalSection, (element) =>
    hasProperty(element, "dataFootnoteBackref"),
  ).map((element) => getStringProperty(element, "href"))

  const model = transformReadingRail(tree, "fixtures/valid-article.md")

  assert.equal(model.footnoteSectionId, READING_RAIL_FOOTNOTE_SECTION_ID)
  assert.equal(getStringProperty(canonicalSection, "id"), READING_RAIL_FOOTNOTE_SECTION_ID)
  assert.deepEqual(canonicalSection.children, canonicalChildren)
  assert.deepEqual(
    collectElements(canonicalSection, (element) => hasProperty(element, "dataFootnoteBackref")).map(
      (element) => getStringProperty(element, "href"),
    ),
    canonicalBackrefs,
  )

  const mirrors = collectElements(
    tree,
    (element) =>
      getStringProperty(element, "dataReadingRailEntry") === ReadingRailEntryKind.FootnoteMirror,
  )
  assert.equal(mirrors.length, 3)
  for (const mirror of mirrors) {
    assert.equal(getStringProperty(mirror, "ariaHidden"), "true")
    assert.equal(collectElements(mirror, (element) => element.tagName === "a").length, 0)
    assert.equal(hastToString(mirror), "")
    const number = findOne(mirror, (element) => hasProperty(element, "dataReadingRailNumber"))
    const text = findOne(mirror, (element) => hasProperty(element, "dataReadingRailText"))
    assert.equal(number.children.length, 0)
    assert.equal(text.children.length, 0)
  }
  assert.equal(countOccurrences(hastToString(tree), "Shared canonical note"), 1)

  const authorAside = findOne(
    tree,
    (element) =>
      getStringProperty(element, "dataReadingRailEntry") === ReadingRailEntryKind.AuthorAside,
  )
  assert.equal(getStringProperty(authorAside, "id"), "aside-context")
  assert.ok(hasProperty(authorAside, "dataReadingAside"))

  assert.deepEqual(
    model.entries.map(({ kind }) => kind).sort(),
    [
      ReadingRailEntryKind.Metadata,
      ReadingRailEntryKind.AuthorAside,
      ReadingRailEntryKind.FootnoteMirror,
      ReadingRailEntryKind.FootnoteMirror,
      ReadingRailEntryKind.FootnoteMirror,
    ].sort(),
  )
  assert.equal(model.entries[0].id, READING_RAIL_METADATA_ID)
  assert.ok(Object.isFrozen(model))
  assert.ok(Object.isFrozen(model.entries))
})

test("accepts content with no authored rail entries", async () => {
  const tree = await parseHtml("A plain article without annotations.")
  const model = transformReadingRail(tree, "fixtures/plain.md")

  assert.deepEqual(model, {
    entries: [{ kind: ReadingRailEntryKind.Metadata, id: READING_RAIL_METADATA_ID }],
  })
})

test("accepts standard GFM percent-encoded Unicode footnote IDs", async () => {
  const tree = await parseHtml("Unicode note.[^café]\n\n[^café]: Encoded label content.")
  const model = transformReadingRail(tree, "fixtures/unicode-footnote.md")

  assert.equal(
    model.entries.filter(({ kind }) => kind === ReadingRailEntryKind.FootnoteMirror).length,
    1,
  )
  assert.ok(
    model.entries.some(({ id }) => id.includes("caf%C3%A9")),
    "The mirror ID must retain GFM's stable percent-encoded label.",
  )
})

test("accepts image-only GFM footnotes and mirrors their accessible alt text", async () => {
  const tree = await parseHtml(
    "Image note.[^image]\n\n[^image]: ![Diagram description](diagram.png)",
  )
  const canonicalSection = findOne(tree, (element) => hasProperty(element, "dataFootnotes"))
  const canonicalChildren = structuredClone(canonicalSection.children)

  transformReadingRail(tree, "fixtures/image-footnote.md")

  assert.deepEqual(canonicalSection.children, canonicalChildren)
  const canonicalImage = findOne(canonicalSection, (element) => element.tagName === "img")
  assert.equal(getStringProperty(canonicalImage, "alt"), "Diagram description")
  const mirrorText = findOne(tree, (element) => hasProperty(element, "dataReadingRailText"))
  assert.equal(getStringProperty(mirrorText, "dataReadingRailText"), "Diagram description")
  assert.equal(mirrorText.children.length, 0)
})

test("rejects duplicate and unsafe author aside IDs actionably", async () => {
  const duplicateTree = await parseHtml(`
<aside data-reading-aside id="aside-repeat">First.</aside>
<aside data-reading-aside id="aside-repeat">Second.</aside>
`)
  assert.throws(
    () => transformReadingRail(duplicateTree, "fixtures/duplicate.md"),
    /fixtures\/duplicate\.md[\s\S]*duplicate ID[\s\S]*Fix/,
  )

  const unsafeTree = await parseHtml(
    '<aside data-reading-aside id="not-an-aside">Unsafe marker ID.</aside>',
  )
  assert.throws(
    () => transformReadingRail(unsafeTree, "fixtures/unsafe.md"),
    /fixtures\/unsafe\.md[\s\S]*id[\s\S]*aside-/,
  )
})

test("rejects nested or malformed reading-aside markers", async () => {
  const nestedTree = await parseHtml(`
<aside data-reading-aside id="aside-outer">
  Outer.
  <aside data-reading-aside id="aside-inner">Inner.</aside>
</aside>
`)
  assert.throws(
    () => transformReadingRail(nestedTree, "fixtures/nested.md"),
    /fixtures\/nested\.md[\s\S]*nested[\s\S]*Fix/,
  )

  const wrongElementTree = await parseHtml(
    '<div data-reading-aside id="aside-wrong-element">Not semantic.</div>',
  )
  assert.throws(
    () => transformReadingRail(wrongElementTree, "fixtures/wrong-element.md"),
    /fixtures\/wrong-element\.md[\s\S]*aside element[\s\S]*Fix/,
  )
})

test("rejects dangling footnote references and malformed backrefs", async () => {
  const danglingTree = await parseHtml(validSource)
  danglingTree.children = danglingTree.children.filter(
    (child) => child.type !== "element" || !hasProperty(child, "dataFootnotes"),
  )
  assert.throws(
    () => transformReadingRail(danglingTree, "fixtures/dangling.md"),
    /fixtures\/dangling\.md[\s\S]*canonical footnote section[\s\S]*Fix/,
  )

  const malformedTree = await parseHtml(validSource)
  const backref = collectElements(malformedTree, (element) =>
    hasProperty(element, "dataFootnoteBackref"),
  )[0]
  backref.properties.href = "#missing-reference"
  assert.throws(
    () => transformReadingRail(malformedTree, "fixtures/malformed-backref.md"),
    /fixtures\/malformed-backref\.md[\s\S]*backref[\s\S]*Fix/,
  )
})

test("rejects invalid UTF-8 and decoded control characters in footnote IDs", async () => {
  for (const invalidId of [
    { encoded: "%FF", expected: /UTF-8/, source: "invalid-utf8" },
    { encoded: "%00", expected: /control character/, source: "decoded-control" },
  ]) {
    const tree = await parseHtml("Encoded note.[^encoded]\n\n[^encoded]: Canonical text.")
    const definition = findOne(
      tree,
      (element) => getStringProperty(element, "id") === "user-content-fn-encoded",
    )
    const noteref = findOne(tree, (element) => hasProperty(element, "dataFootnoteRef"))
    const backref = findOne(tree, (element) => hasProperty(element, "dataFootnoteBackref"))
    definition.properties.id = `user-content-fn-${invalidId.encoded}`
    noteref.properties.id = `user-content-fnref-${invalidId.encoded}`
    noteref.properties.href = `#user-content-fn-${invalidId.encoded}`
    backref.properties.href = `#user-content-fnref-${invalidId.encoded}`

    expectActionableTransformFailure(
      tree,
      `fixtures/${invalidId.source}.md`,
      new RegExp(`footnote definition id[\\s\\S]*${invalidId.expected.source}`),
    )
  }
})

test("rejects duplicate and over-limit backrefs", async () => {
  const duplicateTree = await parseHtml("Duplicate.[^note]\n\n[^note]: Canonical text.")
  const duplicateBackref = findOne(duplicateTree, (element) =>
    hasProperty(element, "dataFootnoteBackref"),
  )
  findElementParent(duplicateTree, duplicateBackref).children.push(
    structuredClone(duplicateBackref),
  )
  expectActionableTransformFailure(
    duplicateTree,
    "fixtures/duplicate-backref.md",
    /footnote backref[\s\S]*exactly one/,
  )

  const overLimitTree = await parseHtml("Over limit.[^note]\n\n[^note]: Canonical text.")
  const boundedBackref = findOne(overLimitTree, (element) =>
    hasProperty(element, "dataFootnoteBackref"),
  )
  const parent = findElementParent(overLimitTree, boundedBackref)
  for (let index = 0; index < READING_RAIL_LIMITS.footnoteBackrefs; index++) {
    parent.children.push(structuredClone(boundedBackref))
  }
  expectActionableTransformFailure(
    overLimitTree,
    "fixtures/too-many-backrefs.md",
    /footnote backref collection[\s\S]*limit of 47/,
  )
})

test("rejects missing canonical noteref and backref accessibility relationships", async () => {
  const missingDescriptionTree = await parseHtml(
    "Missing description.[^note]\n\n[^note]: Canonical text.",
  )
  const noteref = findOne(missingDescriptionTree, (element) =>
    hasProperty(element, "dataFootnoteRef"),
  )
  delete noteref.properties.ariaDescribedBy
  expectActionableTransformFailure(
    missingDescriptionTree,
    "fixtures/missing-noteref-description.md",
    /footnote noteref[\s\S]*aria-describedby/,
  )

  const missingLabelTree = await parseHtml("Missing label.[^note]\n\n[^note]: Canonical text.")
  const backref = findOne(missingLabelTree, (element) =>
    hasProperty(element, "dataFootnoteBackref"),
  )
  delete backref.properties.ariaLabel
  expectActionableTransformFailure(
    missingLabelTree,
    "fixtures/missing-backref-label.md",
    /footnote backref[\s\S]*aria-label/,
  )

  const missingSectionLabelTree = await parseHtml(
    "Missing section label.[^note]\n\n[^note]: Canonical text.",
  )
  const section = findOne(missingSectionLabelTree, (element) =>
    hasProperty(element, "dataFootnotes"),
  )
  section.children = section.children.filter(
    (child) => child.type !== "element" || child.tagName !== "h2",
  )
  expectActionableTransformFailure(
    missingSectionLabelTree,
    "fixtures/missing-section-label.md",
    /canonical footnote label/,
  )
})

test("rejects rail collections above their static limits", async () => {
  const source = Array.from(
    { length: READING_RAIL_LIMITS.authorAsides + 1 },
    (_, index) =>
      `<aside data-reading-aside id="aside-limit-${index}">Bounded aside ${index}.</aside>`,
  ).join("\n")
  const tree = await parseHtml(source)

  assert.throws(
    () => transformReadingRail(tree, "fixtures/too-many-asides.md"),
    /fixtures\/too-many-asides\.md[\s\S]*limit of 16[\s\S]*Fix/,
  )

  const overlongTextTree = await parseHtml(
    `Long note.[^long]\n\n[^long]: ${"x".repeat(READING_RAIL_LIMITS.mirrorTextLength + 1)}`,
  )
  expectActionableTransformFailure(
    overlongTextTree,
    "fixtures/overlong-mirror-text.md",
    /footnote definition[\s\S]*mirror text limit of 1024/,
  )
})
