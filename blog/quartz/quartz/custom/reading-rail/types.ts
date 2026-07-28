export enum ReadingRailEntryKind {
  AuthorAside = "author-aside",
  FootnoteMirror = "footnote-mirror",
  Metadata = "metadata",
}

export interface ReadingRailEntry {
  readonly kind: ReadingRailEntryKind
  readonly id: string
  readonly referenceId?: string
}

export interface ReadingRailModel {
  readonly entries: readonly ReadingRailEntry[]
  readonly footnoteSectionId?: string
}

export interface ReadingRailLimits {
  readonly authorAsides: number
  readonly footnoteDefinitions: number
  readonly footnoteReferences: number
  readonly footnoteBackrefs: number
  readonly entries: number
  readonly sourceIdLength: number
  readonly generatedIdLength: number
  readonly mirrorNumberLength: number
  readonly mirrorTextLength: number
}

export const READING_RAIL_LIMITS = Object.freeze({
  authorAsides: 16,
  footnoteDefinitions: 32,
  footnoteReferences: 47,
  footnoteBackrefs: 47,
  entries: 64,
  sourceIdLength: 96,
  generatedIdLength: 128,
  mirrorNumberLength: 16,
  mirrorTextLength: 1024,
}) satisfies ReadingRailLimits

export const READING_RAIL_METADATA_ID = "reading-rail-metadata" as const
export const READING_RAIL_FOOTNOTE_SECTION_ID = "reading-rail-footnotes" as const
