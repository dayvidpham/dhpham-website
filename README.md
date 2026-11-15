# dhpham-website
My personal portfolio website at https://dhpham.com

## CV and resume

The CV and resume are served at `/cv` and `/resume`. Vercel rewrites those
extensionless URLs to `public/cv.pdf` and `public/resume.pdf` and returns the PDF
content type. Replace both files with:

```sh
pnpm run documents:publish -- ~/Downloads/new-cv.pdf ~/Downloads/new-resume.pdf
```

Then commit and push `public/cv.pdf` and `public/resume.pdf`; Vercel redeploys the
site automatically. The PDFs live in this deployment, so updating them always
requires a new deploy. To avoid redeploys, host the PDFs elsewhere and change the
`/cv` and `/resume` links in `index.html` to those URLs instead.

TODO:
  - revert debouncing of resize event
  - don't need to statically allocate this.xs, this.ys

