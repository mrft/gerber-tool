# gerber-tool

A browser-based tool to infer some data from uploaded Gerber files.

## Features

- **Upload** Gerber RS-274X stencil/paste files (drag-and-drop or click to browse)
- **Upload** ODB++ job folders (drag-and-drop or folder picker; Firefox-compatible fallback)
- **Calculate** the total stencil aperture opening area per file / per paste layer
- **Gerber** aperture shapes: Circle (C), Rectangle (R), Oval (O), Polygon (P)
- **ODB++** symbol shapes: Circle (r), Square (s), Rectangle (rect), Oval (oval), Donut (di), Hexagon (hex_l/hex_s)
- **Grand total** across multiple files/folders (all normalised to mm²)
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
npm test           # runs the Gerber and ODB++ parser unit tests with Node.js
```

## Architecture

| File | Purpose |
|------|---------|
| `index.html` | Single-page application entry point |
| `styles.css` | Responsive styles (light/dark mode via `prefers-color-scheme`) |
| `js/app.js` | UI components built with [uhtml](https://github.com/WebReflection/uhtml) |
| `js/gerber-parser.js` | Pure-JS RS-274X Gerber parser — aperture area calculation |
| `js/odb-parser.js` | Pure-JS ODB++ parser — paste layer detection and symbol area calculation |
| `js/vendor/uhtml.js` | Vendored uhtml build (no CDN dependency at runtime) |
| `tests/gerber-parser.test.js` | Unit tests for the Gerber parser |
| `tests/odb-parser.test.js` | Unit tests for the ODB++ parser |

## Supported file extensions

`.gbr` `.ger` `.gtl` `.gbl` `.gtp` `.gbp` `.gts` `.gbs` `.gko` `.drl` `.exc` `.xln`
