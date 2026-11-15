import { copyFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const DOCUMENTS = [
    { label: 'cv', destination: 'public/cv.pdf' },
    { label: 'resume', destination: 'public/resume.pdf' },
];

const fail = (detail) => {
    throw new Error(
        `Publishing the CV/resume failed: ${detail} `
        + 'No files were changed. Pass two PDF paths and retry: '
        + '`pnpm run documents:publish -- <cv.pdf> <resume.pdf>`',
    );
};

const sources = process.argv.slice(2);
if (sources[0] === '--') {
    sources.shift();
}
if (sources.length !== DOCUMENTS.length) {
    fail(`expected ${DOCUMENTS.length} source paths, received ${sources.length}.`);
}

const validated = [];
for (const [index, document] of DOCUMENTS.entries()) {
    const source = resolve(sources[index]);
    const bytes = await readFile(source).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        fail(`could not read ${JSON.stringify(source)}: ${reason}`);
    });

    if (bytes.length === 0) {
        fail(`${JSON.stringify(source)} is empty, so the published ${document.label} would be unusable.`);
    }
    if (bytes.length > MAX_PDF_BYTES) {
        fail(`${JSON.stringify(source)} is ${bytes.length} bytes, above the ${MAX_PDF_BYTES}-byte limit.`);
    }
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
        fail(`${JSON.stringify(source)} does not start with the PDF signature, so it is not a PDF.`);
    }

    validated.push({ ...document, source, destination: resolve(document.destination) });
}

for (const document of validated) {
    await copyFile(document.source, document.destination);
    console.log(`Published ${document.label}: ${document.source} -> ${document.destination}`);
}

console.log('Review the changed PDFs, commit them, and push; Vercel redeploys automatically.');
