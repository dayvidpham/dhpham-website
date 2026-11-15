import { defineConfig, type Plugin } from 'vite';

const EXTENSIONLESS_DOCUMENTS = new Map([
    ['/cv', '/cv.pdf'],
    ['/resume', '/resume.pdf'],
]);

/**
 * Vercel rewrites the extensionless document URLs to the PDFs. Vite preview
 * does not read vercel.json, so this middleware mirrors the same mapping for
 * the local production test path.
 */
const extensionlessDocuments = (): Plugin => ({
    name: 'extensionless-documents',
    configurePreviewServer(server) {
        server.middlewares.use((request, _response, next) => {
            const [pathname, query] = (request.url ?? '/').split('?');
            const document = EXTENSIONLESS_DOCUMENTS.get(pathname);
            if (document) {
                request.url = query ? `${document}?${query}` : document;
            }
            next();
        });
    },
});

export default defineConfig({
    plugins: [extensionlessDocuments()],
});
