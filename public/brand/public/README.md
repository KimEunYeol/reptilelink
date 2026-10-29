# Public source asset

`animal-placeholder.png` extracts only the central silhouette from `design/링크페이지-m.png`; its crop/source/output hashes and deterministic alpha rule are in source.json. Export background dithering within8 RGB levels of the row's left background sample is made transparent. Retained foreground colors are unchanged. No source example labels/counts/sex controls or full-screen UI are included, and the original97 PNGs are preserved.

The application renders actual text/counts/controls in HTML, preserves actual uploaded media, and applies the source's green plane/bottom shade behind the original silhouette. No new animal drawing or logo was created. The shared small SVGs in src/lib/publicIcons.ts are static markup from the already-installed lucide-react1.62.0 (ISC), matching the React icons without adding a server React renderer.

These are supplied-source resources for the private/local project. Distribution rights and exact original fonts remain unconfirmed user inputs before external publication.
