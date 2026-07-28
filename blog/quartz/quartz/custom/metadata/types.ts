export enum EditorialContentKind {
  Page = "page",
  Post = "post",
}

export enum EditorialMetadataLimit {
  TitleCharacters = 200,
  DescriptionCharacters = 1000,
  TagCharacters = 80,
  Tags = 32,
  CrossPostTitleCharacters = 200,
  CrossPosts = 16,
  UrlCharacters = 2048,
  SourcePathCharacters = 1024,
}

export type HttpsUrl = string & { readonly __brand: "HttpsUrl" }
export type IsoTimestamp = string & { readonly __brand: "IsoTimestamp" }
export type GitRevision = string & { readonly __brand: "GitRevision" }

export interface SourceProvenance {
  readonly repository: HttpsUrl
  readonly revision: GitRevision
  readonly path?: string
}

export interface CrossPost {
  readonly title: string
  readonly url: HttpsUrl
}

export interface ValidatedEditorialFrontmatter {
  readonly kind: EditorialContentKind
  readonly title: string
  readonly description?: string
  readonly created?: IsoTimestamp
  readonly published?: IsoTimestamp
  readonly modified?: IsoTimestamp
  readonly tags: readonly string[]
  readonly canonical?: HttpsUrl
  readonly source?: SourceProvenance
  readonly crossposts: readonly CrossPost[]
}

export interface DerivedPageMetadata {
  readonly canonical: HttpsUrl
  readonly words: number
  readonly readingMinutes: number
  readonly editorial: ValidatedEditorialFrontmatter
}

export interface QuartzFrontmatter {
  [key: string]: unknown
  title: string
  tags?: string[]
  aliases?: string[]
  description?: string
  publish?: boolean
  draft?: boolean
  lang?: string
  enableToc?: string
  cssclasses?: string[]
}

export interface ExplicitEditorialDates {
  readonly created?: Date
  readonly published?: Date
  readonly modified?: Date
}

declare module "vfile" {
  interface DataMap {
    frontmatter: QuartzFrontmatter
    editorial: ValidatedEditorialFrontmatter
    derivedPageMetadata: DerivedPageMetadata
    dates: ExplicitEditorialDates
  }
}
