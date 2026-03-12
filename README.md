# gerber-tool

A browser-based tool to infer some data from uploaded Gerber files.

## Features

- **Upload** one or more Gerber RS-274X stencil/paste files (drag-and-drop or click to browse)
- **Calculate** the total stencil aperture opening area for each file
- **Supports** all four standard aperture shapes: Circle (C), Rectangle (R), Oval (O), Polygon (P)
- **Grand total** across multiple files (auto-converted to mm²)
- **Zero build step** — runs directly in the browser using native ES modules

## How to run

```bash
# Serve the project root over HTTP (any static file server works)
npm start          # starts python3 -m http.server 8080
# then open http://localhost:8080
```

No bundler or build tool required.

## Testing

```bash
npm test           # runs the gerber-parser unit tests with Node.js
```

## Architecture

| File | Purpose |
|------|---------|
| `index.html` | Single-page application entry point |
| `styles.css` | Responsive styles (light/dark mode via `prefers-color-scheme`) |
| `js/app.js` | UI components built with [uhtml](https://github.com/WebReflection/uhtml) |
| `js/gerber-parser.js` | Pure-JS RS-274X Gerber parser — aperture area calculation |
| `js/vendor/uhtml.js` | Vendored uhtml build (no CDN dependency at runtime) |
| `tests/gerber-parser.test.js` | Unit tests for the parser |

## Supported file extensions

`.gbr` `.ger` `.gtl` `.gbl` `.gtp` `.gbp` `.gts` `.gbs` `.gko` `.drl` `.exc` `.xln`
