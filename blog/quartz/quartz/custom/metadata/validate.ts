import { slugTag } from "../../util/path"
import {
  CrossPost,
  EditorialContentKind,
  EditorialMetadataLimit,
  GitRevision,
  HttpsUrl,
  IsoTimestamp,
  SourceProvenance,
  ValidatedEditorialFrontmatter,
} from "./types"

type UnknownRecord = Readonly<Record<string, unknown>>
type UrlValidationResult =
  | { readonly valid: true; readonly url: HttpsUrl }
  | { readonly valid: false; readonly problem: string; readonly fix: string }

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/
const GIT_REVISION = /^[0-9a-fA-F]{40}$/
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function reject(sourcePath: string, field: string, problem: string, fix: string): never {
  return rejectWithContext(
    sourcePath,
    field,
    problem,
    fix,
    "validate frontmatter",
    "Quartz cannot emit truthful canonical, editorial, or provenance metadata for this file",
  )
}

function rejectWithContext(
  sourcePath: string,
  field: string,
  problem: string,
  fix: string,
  operation: string,
  impact: string,
): never {
  throw new Error(
    `Editorial metadata validation failed. Operation: ${operation}. File: ${JSON.stringify(sourcePath)}. ` +
      `Field: ${JSON.stringify(field)}. Problem: ${problem}. ` +
      `Impact: ${impact}. ` +
      `Fix: ${fix}.`,
  )
}

function isRecord(input: unknown): input is UnknownRecord {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function requireRecord(sourcePath: string, field: string, input: unknown): UnknownRecord {
  if (!isRecord(input)) {
    reject(
      sourcePath,
      field,
      "expected a mapping but received another value category",
      "use a YAML mapping",
    )
  }
  return input
}

function rejectUnknownFields(
  sourcePath: string,
  field: string,
  input: UnknownRecord,
  allowedFields: readonly string[],
): void {
  const allowed = new Set(allowedFields)
  const unknown = Object.keys(input).find((key) => !allowed.has(key))
  if (unknown !== undefined) {
    reject(
      sourcePath,
      `${field}.${unknown}`,
      "the nested metadata field is not part of the static contract",
      `remove it or use one of: ${allowedFields.join(", ")}`,
    )
  }
}

function readText(
  sourcePath: string,
  field: string,
  input: unknown,
  maximum: number,
  required: boolean,
): string | undefined {
  if (input === undefined) {
    if (required) {
      reject(
        sourcePath,
        field,
        "the required field is absent",
        `provide a non-empty string of at most ${maximum} characters`,
      )
    }
    return undefined
  }
  if (typeof input !== "string") {
    reject(
      sourcePath,
      field,
      "expected text but received another value category",
      `provide a string of at most ${maximum} characters`,
    )
  }

  const value = input.trim()
  if (value.length === 0) {
    reject(sourcePath, field, "the text is empty", "provide non-whitespace text")
  }
  if (value.length > maximum) {
    reject(
      sourcePath,
      field,
      `the text exceeds the ${maximum}-character bound`,
      `shorten it to at most ${maximum} characters`,
    )
  }
  if (UNSAFE_CONTROL_CHARACTER.test(value)) {
    reject(
      sourcePath,
      field,
      "the text contains an unsafe control character",
      "remove control characters from the value",
    )
  }
  return value
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function readTimestamp(
  sourcePath: string,
  field: string,
  input: unknown,
): IsoTimestamp | undefined {
  if (input === undefined) return undefined
  const value = readText(sourcePath, field, input, 35, true)!
  const match = ISO_TIMESTAMP.exec(value)
  if (!match) {
    reject(
      sourcePath,
      field,
      "the date is not a complete ISO 8601 timestamp with a timezone",
      "use a value such as 2026-07-02T09:30:00Z",
    )
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const daysPerMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const zoneHours = zone === "Z" ? 0 : Number(zone.slice(1, 3))
  const zoneMinutes = zone === "Z" ? 0 : Number(zone.slice(4, 6))
  const validCalendarValue =
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysPerMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    zoneHours <= 14 &&
    zoneMinutes <= 59 &&
    (zoneHours < 14 || zoneMinutes === 0)

  if (!validCalendarValue || !Number.isFinite(Date.parse(value))) {
    reject(
      sourcePath,
      field,
      "the timestamp contains an impossible calendar, clock, or timezone value",
      "provide a real ISO 8601 timestamp with an offset no greater than 14:00",
    )
  }
  return value as IsoTimestamp
}

function normalizeHttpsUrl(value: string, allowFragment: boolean): UrlValidationResult {
  const maximum = EditorialMetadataLimit.UrlCharacters.toLocaleString("en-US")
  if (value.length > EditorialMetadataLimit.UrlCharacters) {
    return {
      valid: false,
      problem: `the URL exceeds the ${maximum}-character bound`,
      fix: `shorten it to at most ${maximum} characters`,
    }
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return {
      valid: false,
      problem: "the URL is not absolute",
      fix: "provide a complete https:// URL",
    }
  }
  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      problem: "the URL does not use HTTPS",
      fix: "replace it with an absolute https:// URL",
    }
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return {
      valid: false,
      problem: "the URL contains credentials",
      fix: "remove the username and password",
    }
  }
  if (!allowFragment && parsed.hash !== "") {
    return {
      valid: false,
      problem: "a canonical URL cannot contain a fragment",
      fix: "remove the #fragment",
    }
  }
  if (parsed.href.length > EditorialMetadataLimit.UrlCharacters) {
    return {
      valid: false,
      problem: `the normalized URL exceeds the ${maximum}-character bound`,
      fix: `shorten it to at most ${maximum} characters after URL normalization`,
    }
  }
  return { valid: true, url: parsed.href as HttpsUrl }
}

export function validateCanonicalUrl(
  sourcePath: string,
  input: unknown,
  operation = "validate frontmatter",
  impact = "Quartz cannot emit truthful canonical metadata for this file",
): HttpsUrl {
  if (typeof input !== "string") {
    rejectWithContext(
      sourcePath,
      "canonical",
      "expected text but received another value category",
      "provide a complete HTTPS canonical URL",
      operation,
      impact,
    )
  }
  const value = input.trim()
  if (value.length === 0 || UNSAFE_CONTROL_CHARACTER.test(value)) {
    rejectWithContext(
      sourcePath,
      "canonical",
      "the URL is empty or contains an unsafe control character",
      "provide a non-empty HTTPS canonical URL without control characters",
      operation,
      impact,
    )
  }
  const result = normalizeHttpsUrl(value, false)
  if (!result.valid) {
    rejectWithContext(sourcePath, "canonical", result.problem, result.fix, operation, impact)
  }
  return result.url
}

function readHttpsUrl(
  sourcePath: string,
  field: string,
  input: unknown,
  allowFragment: boolean,
): HttpsUrl | undefined {
  if (input === undefined) return undefined
  const value = readText(sourcePath, field, input, EditorialMetadataLimit.UrlCharacters, true)!
  const result = normalizeHttpsUrl(value, allowFragment)
  if (!result.valid) reject(sourcePath, field, result.problem, result.fix)
  return result.url
}

function readTags(sourcePath: string, input: unknown): readonly string[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    reject(
      sourcePath,
      "tags",
      "expected a list of strings",
      "use a YAML list with at most 32 entries",
    )
  }
  if (input.length > EditorialMetadataLimit.Tags) {
    reject(
      sourcePath,
      "tags",
      `the collection exceeds the ${EditorialMetadataLimit.Tags}-tag bound`,
      `remove tags until at most ${EditorialMetadataLimit.Tags} remain`,
    )
  }

  const tags: string[] = []
  const seen = new Set<string>()
  for (const [index, rawTag] of input.entries()) {
    const field = `tags[${index}]`
    const raw = readText(sourcePath, field, rawTag, EditorialMetadataLimit.TagCharacters, true)!
    const tag = slugTag(raw)
    const segments = tag.split("/")
    if (
      tag.length === 0 ||
      tag.length > EditorialMetadataLimit.TagCharacters ||
      tag.includes("\\") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      reject(
        sourcePath,
        field,
        "the normalized tag is empty, unsafe as a route, or over the declared bound",
        "use non-dot POSIX tag segments of at most 80 normalized characters",
      )
    }
    if (seen.has(tag)) {
      reject(
        sourcePath,
        field,
        "the normalized tag duplicates an earlier tag",
        "remove the duplicate tag",
      )
    }
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

function readSource(sourcePath: string, input: unknown): SourceProvenance | undefined {
  if (input === undefined) return undefined
  const source = requireRecord(sourcePath, "source", input)
  rejectUnknownFields(sourcePath, "source", source, ["repository", "revision", "path"])
  const repository = readHttpsUrl(sourcePath, "source.repository", source.repository, true)
  if (repository === undefined) {
    reject(
      sourcePath,
      "source.repository",
      "the required field is absent",
      "provide the HTTPS repository URL",
    )
  }
  const revisionText = readText(sourcePath, "source.revision", source.revision, 40, true)!
  if (!GIT_REVISION.test(revisionText)) {
    reject(
      sourcePath,
      "source.revision",
      "the revision is not a full 40-hex commit ID",
      "provide the complete immutable Git commit ID",
    )
  }

  const sourceFilePath = readText(
    sourcePath,
    "source.path",
    source.path,
    EditorialMetadataLimit.SourcePathCharacters,
    false,
  )
  if (sourceFilePath !== undefined) {
    const segments = sourceFilePath.split("/")
    let decodedSegments: string[]
    try {
      decodedSegments = segments.map((segment) => decodeURIComponent(segment))
    } catch {
      reject(
        sourcePath,
        "source.path",
        "the path contains malformed percent encoding",
        "remove malformed percent escapes and use a literal relative POSIX path",
      )
    }
    const unsafe =
      sourceFilePath.startsWith("/") ||
      sourceFilePath.endsWith("/") ||
      sourceFilePath.includes("\\") ||
      decodedSegments.some(
        (segment) =>
          segment === "" ||
          segment === "." ||
          segment === ".." ||
          segment.includes("/") ||
          segment.includes("\\") ||
          segment.includes("\0"),
      )
    if (unsafe) {
      reject(
        sourcePath,
        "source.path",
        "the path is absolute, non-POSIX, or contains an empty/dot segment",
        "use a relative POSIX repository path without . or .. segments",
      )
    }
  }

  return {
    repository,
    revision: revisionText.toLowerCase() as GitRevision,
    ...(sourceFilePath === undefined ? {} : { path: sourceFilePath }),
  }
}

function readCrossPosts(sourcePath: string, input: unknown): readonly CrossPost[] {
  if (input === undefined) return []
  if (!Array.isArray(input)) {
    reject(
      sourcePath,
      "crossposts",
      "expected a list of cross-post mappings",
      "use a YAML list with title and url fields",
    )
  }
  if (input.length > EditorialMetadataLimit.CrossPosts) {
    reject(
      sourcePath,
      "crossposts",
      `the collection exceeds the ${EditorialMetadataLimit.CrossPosts}-link bound`,
      `remove links until at most ${EditorialMetadataLimit.CrossPosts} remain`,
    )
  }

  const crossposts: CrossPost[] = []
  const urls = new Set<HttpsUrl>()
  for (const [index, rawCrossPost] of input.entries()) {
    const field = `crossposts[${index}]`
    const crosspost = requireRecord(sourcePath, field, rawCrossPost)
    rejectUnknownFields(sourcePath, field, crosspost, ["title", "url"])
    const title = readText(
      sourcePath,
      `${field}.title`,
      crosspost.title,
      EditorialMetadataLimit.CrossPostTitleCharacters,
      true,
    )!
    const url = readHttpsUrl(sourcePath, `${field}.url`, crosspost.url, true)
    if (url === undefined) {
      reject(
        sourcePath,
        `${field}.url`,
        "the required field is absent",
        "provide the cross-post HTTPS URL",
      )
    }
    if (urls.has(url)) {
      reject(
        sourcePath,
        `${field}.url`,
        "the URL duplicates an earlier cross-post",
        "remove the duplicate URL",
      )
    }
    urls.add(url)
    crossposts.push({ title, url })
  }
  return crossposts
}

function assertDateOrder(
  sourcePath: string,
  created: IsoTimestamp | undefined,
  published: IsoTimestamp | undefined,
  modified: IsoTimestamp | undefined,
): void {
  const dates = [created, published, modified]
  for (let left = 0; left < dates.length; left++) {
    for (let right = left + 1; right < dates.length; right++) {
      const earlier = dates[left]
      const later = dates[right]
      if (earlier !== undefined && later !== undefined && Date.parse(earlier) > Date.parse(later)) {
        reject(
          sourcePath,
          "created/published/modified",
          "the explicit timestamps are not ordered created <= published <= modified",
          "correct the timestamps while retaining only dates known from editorial frontmatter",
        )
      }
    }
  }
}

export function validateEditorialFrontmatter(
  sourcePath: string,
  input: unknown,
): ValidatedEditorialFrontmatter {
  const frontmatter = requireRecord(sourcePath, "frontmatter", input)
  const title = readText(
    sourcePath,
    "title",
    frontmatter.title,
    EditorialMetadataLimit.TitleCharacters,
    true,
  )!

  if (frontmatter.description !== undefined && frontmatter.summary !== undefined) {
    reject(
      sourcePath,
      "description/summary",
      "both aliases are present and create two possible authoritative summaries",
      "keep exactly one of description or summary",
    )
  }
  const description = readText(
    sourcePath,
    frontmatter.description === undefined ? "summary" : "description",
    frontmatter.description ?? frontmatter.summary,
    EditorialMetadataLimit.DescriptionCharacters,
    false,
  )

  let kind = EditorialContentKind.Page
  if (frontmatter.kind !== undefined) {
    if (
      frontmatter.kind !== EditorialContentKind.Page &&
      frontmatter.kind !== EditorialContentKind.Post
    ) {
      reject(
        sourcePath,
        "kind",
        "the content kind is not page or post",
        'set kind to exactly "page" or "post"',
      )
    }
    kind = frontmatter.kind
  }

  const created = readTimestamp(sourcePath, "created", frontmatter.created)
  const published = readTimestamp(sourcePath, "published", frontmatter.published)
  const modified = readTimestamp(sourcePath, "modified", frontmatter.modified)
  assertDateOrder(sourcePath, created, published, modified)

  if (kind === EditorialContentKind.Post && description === undefined) {
    reject(
      sourcePath,
      "description",
      "a post has no explicit description or summary",
      "add a bounded description or summary",
    )
  }
  if (kind === EditorialContentKind.Post && published === undefined) {
    reject(
      sourcePath,
      "published",
      "a post has no explicit publication timestamp",
      "add a complete ISO 8601 published timestamp",
    )
  }

  const tags = readTags(sourcePath, frontmatter.tags)
  const canonical =
    frontmatter.canonical === undefined
      ? undefined
      : validateCanonicalUrl(sourcePath, frontmatter.canonical)
  const source = readSource(sourcePath, frontmatter.source)
  const crossposts = readCrossPosts(sourcePath, frontmatter.crossposts)

  return {
    kind,
    title,
    ...(description === undefined ? {} : { description }),
    ...(created === undefined ? {} : { created }),
    ...(published === undefined ? {} : { published }),
    ...(modified === undefined ? {} : { modified }),
    tags,
    ...(canonical === undefined ? {} : { canonical }),
    ...(source === undefined ? {} : { source }),
    crossposts,
  }
}
