export enum StaticRouteOutcome {
    File = 'file',
    CleanHtml = 'clean-html',
    DirectoryIndex = 'directory-index',
    NotFound = 'not-found',
    BadRequest = 'bad-request',
    Forbidden = 'forbidden',
    MethodNotAllowed = 'method-not-allowed',
}

export enum StaticMimeType {
    Binary = 'application/octet-stream',
    Css = 'text/css; charset=utf-8',
    Gif = 'image/gif',
    Html = 'text/html; charset=utf-8',
    Icon = 'image/x-icon',
    JavaScript = 'text/javascript; charset=utf-8',
    Jpeg = 'image/jpeg',
    Json = 'application/json; charset=utf-8',
    Map = 'application/json; charset=utf-8',
    Png = 'image/png',
    Svg = 'image/svg+xml; charset=utf-8',
    Text = 'text/plain; charset=utf-8',
    WebManifest = 'application/manifest+json; charset=utf-8',
    Webp = 'image/webp',
    Woff = 'font/woff',
    Woff2 = 'font/woff2',
    Xml = 'application/xml; charset=utf-8',
}

export enum StaticFileExtension {
    Css = '.css',
    Gif = '.gif',
    Html = '.html',
    Htm = '.htm',
    Ico = '.ico',
    JavaScript = '.js',
    Jpeg = '.jpeg',
    Jpg = '.jpg',
    Json = '.json',
    Map = '.map',
    Mjs = '.mjs',
    Png = '.png',
    Svg = '.svg',
    Text = '.txt',
    WebManifest = '.webmanifest',
    Webp = '.webp',
    Woff = '.woff',
    Woff2 = '.woff2',
    Xml = '.xml',
}

export const STATIC_MIME_BY_EXTENSION: Readonly<Record<StaticFileExtension, StaticMimeType>> = {
    [StaticFileExtension.Css]: StaticMimeType.Css,
    [StaticFileExtension.Gif]: StaticMimeType.Gif,
    [StaticFileExtension.Html]: StaticMimeType.Html,
    [StaticFileExtension.Htm]: StaticMimeType.Html,
    [StaticFileExtension.Ico]: StaticMimeType.Icon,
    [StaticFileExtension.JavaScript]: StaticMimeType.JavaScript,
    [StaticFileExtension.Jpeg]: StaticMimeType.Jpeg,
    [StaticFileExtension.Jpg]: StaticMimeType.Jpeg,
    [StaticFileExtension.Json]: StaticMimeType.Json,
    [StaticFileExtension.Map]: StaticMimeType.Map,
    [StaticFileExtension.Mjs]: StaticMimeType.JavaScript,
    [StaticFileExtension.Png]: StaticMimeType.Png,
    [StaticFileExtension.Svg]: StaticMimeType.Svg,
    [StaticFileExtension.Text]: StaticMimeType.Text,
    [StaticFileExtension.WebManifest]: StaticMimeType.WebManifest,
    [StaticFileExtension.Webp]: StaticMimeType.Webp,
    [StaticFileExtension.Woff]: StaticMimeType.Woff,
    [StaticFileExtension.Woff2]: StaticMimeType.Woff2,
    [StaticFileExtension.Xml]: StaticMimeType.Xml,
}

export interface StaticServerOptions {
    readonly rootDirectory: string
    readonly mountPath: string
    readonly host?: '127.0.0.1' | '::1'
    readonly port?: number
    readonly maxRequestUrlBytes?: number
    readonly maxFileBytes?: number
}

export interface ResolvedStaticRoute {
    readonly outcome: StaticRouteOutcome
    readonly statusCode: number
    readonly filePath?: string
    readonly mimeType?: StaticMimeType
    readonly contentLength?: number
    readonly detail: string
}
