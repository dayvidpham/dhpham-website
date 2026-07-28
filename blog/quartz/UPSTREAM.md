# Quartz upstream provenance

This directory vendors the complete tracked source tree from
[jackyzha0/quartz](https://github.com/jackyzha0/quartz), release tag `v4.4.0`
at commit `7d7e3349763b0c1ade94b8a6d13986e171861bc1`.

Quartz is distributed under the MIT License. Its original license is retained
verbatim in [LICENSE.txt](LICENSE.txt).

Local staged-foundation changes are deliberately limited to:

- `quartz.config.ts`: site title and `baseUrl: "dhpham.com/blog"`.
- `quartz.layout.ts`: stock Graph component configuration with local depth `2`
  and global-overlay depth `-1`.
- `content/index.md`: the only public, coming-soon note.
- `package.json`: exact compatibility pins for Quartz's supported TypeScript
  toolchain and direct type imports under the root pnpm workspace.
- `UPSTREAM.md`: this provenance record.

Private topology fixtures live outside this directory at
`tests/fixtures/quartz-content` and are never part of production content.
