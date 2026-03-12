/**
 * Gerber Tool – Stencil Aperture Area Calculator
 * Main application module using uhtml (zero-build, CDN-imported).
 *
 * uhtml docs: https://github.com/WebReflection/uhtml
 */

import { html, render } from './vendor/uhtml.js';
import { parseGerber } from './gerber-parser.js';
import {
  parseOdb,
  vfsFromDirHandle,
  vfsFromFileMap,
  buildPathMapFromFileList,
  traverseDirEntry,
} from './odb-parser.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Conversion factor: 1 inch² = 25.4² mm² */
const IN2_TO_MM2 = 25.4 * 25.4;

// ─── Application state ───────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, type: 'gerber'|'odb', status: 'pending'|'processing'|'done'|'error', result: object|null, error: string|null }} FileEntry
 */

/** @type {{ isDragging: boolean, files: FileEntry[] }} */
let state = {
  isDragging: false,
  files: [],
};

function setState(patch) {
  state = { ...state, ...patch };
  update();
}

function updateFile(index, patch) {
  const files = state.files.map((f, i) => (i === index ? { ...f, ...patch } : f));
  setState({ files });
}

// ─── File handling ────────────────────────────────────────────────────────────

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(/** @type {string} */ (e.target.result));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

async function processFile(file, index) {
  updateFile(index, { status: 'processing' });
  try {
    const text = await readFileAsText(file);
    const result = parseGerber(text);
    updateFile(index, { status: 'done', result });
  } catch (err) {
    updateFile(index, { status: 'error', error: err.message });
  }
}

function addFiles(fileList) {
  const incoming = Array.from(fileList);
  const startIndex = state.files.length;
  const newEntries = incoming.map((f) => ({
    name: f.name,
    type: 'gerber',
    status: /** @type {'pending'} */ ('pending'),
    result: null,
    error: null,
  }));
  setState({ files: [...state.files, ...newEntries] });
  incoming.forEach((file, i) => processFile(file, startIndex + i));
}

// ─── ODB++ directory handling ─────────────────────────────────────────────────

function addOdbEntry(jobName) {
  const index = state.files.length;
  setState({
    files: [
      ...state.files,
      { name: jobName, type: 'odb', status: 'pending', result: null, error: null },
    ],
  });
  return index;
}

async function processOdbDirHandle(dirHandle) {
  const index = addOdbEntry(dirHandle.name);
  updateFile(index, { status: 'processing' });
  try {
    const vfs = vfsFromDirHandle(dirHandle);
    const result = await parseOdb(vfs, dirHandle.name);
    updateFile(index, { status: 'done', result });
  } catch (err) {
    updateFile(index, { status: 'error', error: err.message });
  }
}

async function processOdbDirEntry(dirEntry) {
  const index = addOdbEntry(dirEntry.name);
  updateFile(index, { status: 'processing' });
  try {
    const { pathMap, rootName } = await traverseDirEntry(dirEntry);
    const vfs = vfsFromFileMap(pathMap);
    const result = await parseOdb(vfs, rootName);
    updateFile(index, { status: 'done', result });
  } catch (err) {
    updateFile(index, { status: 'error', error: err.message });
  }
}

async function processOdbFileList(files) {
  const { pathMap, rootName } = buildPathMapFromFileList(files);
  const index = addOdbEntry(rootName || 'ODB++ folder');
  updateFile(index, { status: 'processing' });
  try {
    const vfs = vfsFromFileMap(pathMap);
    const result = await parseOdb(vfs, rootName || 'ODB++ folder');
    updateFile(index, { status: 'done', result });
  } catch (err) {
    updateFile(index, { status: 'error', error: err.message });
  }
}

// ─── Drop handler ─────────────────────────────────────────────────────────────

async function handleDrop(e) {
  e.preventDefault();
  setState({ isDragging: false });

  const items = Array.from(e.dataTransfer.items ?? []);
  if (items.length === 0) return;

  for (const item of items) {
    if (item.kind !== 'file') continue;

    // Prefer File System Access API (Chrome / Edge) – gives a DirectoryHandle
    if (typeof item.getAsFileSystemHandle === 'function') {
      try {
        const handle = await item.getAsFileSystemHandle();
        if (handle.kind === 'directory') {
          processOdbDirHandle(handle);
          return;
        }
      } catch { /* not a directory or FSAPI unavailable – fall through */ }
    }

    // Fallback: webkitGetAsEntry (Firefox, legacy Chrome)
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      processOdbDirEntry(entry);
      return;
    }
  }

  // All items are plain files → treat as Gerber
  if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
}

function handleFileInput(e) {
  if (e.target.files.length > 0) addFiles(e.target.files);
  e.target.value = '';
}

function handleOdbDirInput(e) {
  if (e.target.files.length > 0) processOdbFileList(Array.from(e.target.files));
  e.target.value = '';
}

async function openOdbFolderPicker() {
  if (typeof showDirectoryPicker === 'function') {
    try {
      const dirHandle = await showDirectoryPicker();
      processOdbDirHandle(dirHandle);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User cancelled
      // Other error: fall through to webkitdirectory fallback
    }
  }
  // Fallback for Firefox (and any browser without showDirectoryPicker)
  document.getElementById('odb-dir-input').click();
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtArea(area, units, extraDecimals = 0) {
  if (units === 'mm') {
    return `${area.toFixed(4 + extraDecimals)} mm²`;
  }
  // inches → also show mm² conversion
  const mm2 = area * IN2_TO_MM2;
  return `${area.toFixed(6)} in² (≈ ${mm2.toFixed(4)} mm²)`;
}

function toMm2(area, units) {
  return units === 'mm' ? area : area * IN2_TO_MM2;
}

// ─── Components ──────────────────────────────────────────────────────────────

function DropZone() {
  const cls = state.isDragging ? 'drop-zone drop-zone--active' : 'drop-zone';
  return html`
    <div
      class="${cls}"
      ondragover="${(e) => { e.preventDefault(); setState({ isDragging: true }); }}"
      ondragleave="${() => setState({ isDragging: false })}"
      ondrop="${handleDrop}"
      role="region"
      aria-label="File upload area"
    >
      <svg class="drop-zone__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5
                 m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
      <p class="drop-zone__label">Drop Gerber files or an ODB++ folder here</p>
      <div class="drop-zone__actions">
        <button
          class="drop-zone__btn"
          onclick="${(e) => { e.stopPropagation(); document.getElementById('file-input').click(); }}"
          type="button"
        >Browse Gerber files&hellip;</button>
        <span class="drop-zone__sep" aria-hidden="true">or</span>
        <button
          class="drop-zone__btn drop-zone__btn--odb"
          onclick="${(e) => { e.stopPropagation(); openOdbFolderPicker(); }}"
          type="button"
        >Select ODB++ folder&hellip;</button>
      </div>
      <input
        type="file"
        id="file-input"
        multiple
        accept=".gbr,.ger,.gtl,.gbl,.gtp,.gbp,.gts,.gbs,.gko,.drl,.exc,.xln"
        style="display:none"
        onchange="${handleFileInput}"
      />
      <input
        type="file"
        id="odb-dir-input"
        webkitdirectory
        multiple
        style="display:none"
        onchange="${handleOdbDirInput}"
      />
    </div>
  `;
}

function StatusBadge(status) {
  const map = {
    pending:    ['badge badge--pending',    'Pending'],
    processing: ['badge badge--processing', 'Processing\u2026'],
    done:       ['badge badge--done',       'Done'],
    error:      ['badge badge--error',      'Error'],
  };
  const [cls, label] = map[status] ?? ['badge', status];
  return html`<span class="${cls}">${label}</span>`;
}

function ApertureTableRow(ap, units, codePrefix = 'D') {
  return html`
    <tr>
      <td>${codePrefix}${ap.dCode}</td>
      <td>${ap.shapeName}</td>
      <td>${ap.dimensions}</td>
      <td class="num">${fmtArea(ap.areaPerFlash, units)}</td>
      <td class="num">${ap.flashes.toLocaleString()}</td>
      <td class="num">${fmtArea(ap.totalArea, units)}</td>
    </tr>
  `;
}

function ApertureTable(apertures, units, codeLabel = 'D Code', codePrefix = 'D') {
  return html`
    <div class="table-wrapper">
      <table class="aperture-table">
        <thead>
          <tr>
            <th>${codeLabel}</th>
            <th>Shape</th>
            <th>Dimensions</th>
            <th>Area / Flash</th>
            <th>Flashes</th>
            <th>Total Area</th>
          </tr>
        </thead>
        <tbody>
          ${apertures.map((ap) => ApertureTableRow(ap, units, codePrefix))}
        </tbody>
      </table>
    </div>
  `;
}

function OdbPasteLayer(layer) {
  const hasFlashes = layer.apertures?.length > 0;
  return html`
    <details class="paste-layer">
      <summary class="paste-layer__summary">
        <span class="paste-layer__name">${layer.name}</span>
        <span class="paste-layer__area">${layer.error ? 'Error' : fmtArea(layer.totalArea, 'mm')}</span>
      </summary>
      ${layer.error
        ? html`<p class="result-card__error">${layer.error}</p>`
        : hasFlashes
          ? html`
            <div class="paste-layer__body">
              <dl class="stat-grid stat-grid--compact">
                <div class="stat">
                  <dt>Layer Area</dt>
                  <dd class="stat__value--primary">${fmtArea(layer.totalArea, 'mm')}</dd>
                </div>
                <div class="stat">
                  <dt>Flashes</dt>
                  <dd>${layer.totalFlashes.toLocaleString()}</dd>
                </div>
                <div class="stat">
                  <dt>Sym Types Used</dt>
                  <dd>${layer.usedApertureCount} / ${layer.apertureCount}</dd>
                </div>
              </dl>
              <details class="aperture-details">
                <summary>Symbol breakdown</summary>
                ${ApertureTable(layer.apertures, 'mm', 'Sym #', '')}
              </details>
            </div>
          `
          : html`<p class="result-card__no-data">No pad flashes in this layer.</p>`}
    </details>
  `;
}

function OdbResultCard(file) {
  if (file.status === 'pending' || file.status === 'processing') {
    return html`
      <article class="result-card result-card--loading">
        <div class="result-card__header">
          <span class="result-card__name">${file.name}</span>
          <span class="badge badge--odb">ODB++</span>
          ${StatusBadge(file.status)}
        </div>
      </article>
    `;
  }

  if (file.status === 'error') {
    return html`
      <article class="result-card result-card--error">
        <div class="result-card__header">
          <span class="result-card__name">${file.name}</span>
          <span class="badge badge--odb">ODB++</span>
          ${StatusBadge('error')}
        </div>
        <p class="result-card__error">${file.error}</p>
      </article>
    `;
  }

  const r = file.result;
  return html`
    <article class="result-card">
      <div class="result-card__header">
        <span class="result-card__name">${file.name}</span>
        <span class="badge badge--odb">ODB++</span>
        ${StatusBadge('done')}
      </div>
      <div class="result-card__body">
        <dl class="stat-grid">
          <div class="stat">
            <dt>Total Stencil Area</dt>
            <dd class="stat__value--primary">${fmtArea(r.totalArea, 'mm')}</dd>
          </div>
          <div class="stat">
            <dt>Total Flashes</dt>
            <dd>${r.totalFlashes.toLocaleString()}</dd>
          </div>
          <div class="stat">
            <dt>Paste Layers</dt>
            <dd>${r.pasteLayers.length}</dd>
          </div>
        </dl>
        <div class="paste-layers">
          ${r.pasteLayers.map(OdbPasteLayer)}
        </div>
      </div>
    </article>
  `;
}

function ResultCard(file) {
  if (file.type === 'odb') return OdbResultCard(file);

  if (file.status === 'pending' || file.status === 'processing') {
    return html`
      <article class="result-card result-card--loading">
        <div class="result-card__header">
          <span class="result-card__name">${file.name}</span>
          ${StatusBadge(file.status)}
        </div>
      </article>
    `;
  }

  if (file.status === 'error') {
    return html`
      <article class="result-card result-card--error">
        <div class="result-card__header">
          <span class="result-card__name">${file.name}</span>
          ${StatusBadge('error')}
        </div>
        <p class="result-card__error">${file.error}</p>
      </article>
    `;
  }

  // status === 'done'
  const r = file.result;
  const hasFlashes = r.apertures.length > 0;

  return html`
    <article class="result-card">
      <div class="result-card__header">
        <span class="result-card__name">${file.name}</span>
        ${StatusBadge('done')}
      </div>

      ${hasFlashes
        ? html`
          <div class="result-card__body">
            <dl class="stat-grid">
              <div class="stat">
                <dt>Total Stencil Area</dt>
                <dd class="stat__value--primary">${fmtArea(r.totalArea, r.units)}</dd>
              </div>
              <div class="stat">
                <dt>Total Flashes</dt>
                <dd>${r.totalFlashes.toLocaleString()}</dd>
              </div>
              <div class="stat">
                <dt>Aperture Types Used</dt>
                <dd>${r.usedApertureCount} / ${r.apertureCount}</dd>
              </div>
              <div class="stat">
                <dt>Units</dt>
                <dd>${r.units === 'mm' ? 'Millimeters' : 'Inches'}</dd>
              </div>
            </dl>

            <details class="aperture-details">
              <summary>Aperture breakdown</summary>
              ${ApertureTable(r.apertures, r.units)}
            </details>
          </div>
        `
        : html`
          <p class="result-card__no-data">
            No aperture flashes found &mdash; this may not be a stencil/paste layer.
          </p>
        `}
    </article>
  `;
}

function SummaryCard() {
  const done = state.files.filter((f) => f.status === 'done' && f.result);
  if (done.length < 2) return html``;

  const totalMm2 = done.reduce((sum, f) => sum + toMm2(f.result.totalArea, f.result.units), 0);
  const totalFlashes = done.reduce((sum, f) => sum + f.result.totalFlashes, 0);

  return html`
    <article class="summary-card">
      <h2 class="summary-card__title">Grand Total (all files)</h2>
      <dl class="stat-grid">
        <div class="stat">
          <dt>Combined Stencil Area</dt>
          <dd class="stat__value--primary">${totalMm2.toFixed(4)} mm²</dd>
        </div>
        <div class="stat">
          <dt>Total Flashes</dt>
          <dd>${totalFlashes.toLocaleString()}</dd>
        </div>
        <div class="stat">
          <dt>Files</dt>
          <dd>${done.length}</dd>
        </div>
      </dl>
    </article>
  `;
}

function App() {
  return html`
    <div class="app">
      <header class="app-header">
        <h1 class="app-header__title">Gerber & ODB++ Stencil Area Calculator</h1>
        <p class="app-header__desc">
          Upload Gerber paste/stencil files or an ODB++ folder to calculate the total aperture opening area.
        </p>
      </header>

      <main class="app-main">
        ${DropZone()}

        ${state.files.length > 0
          ? html`
            <section class="results" aria-label="Results">
              <div class="results__toolbar">
                <h2 class="results__heading">Results</h2>
                <button class="btn-clear" onclick="${() => setState({ files: [] })}">
                  Clear all
                </button>
              </div>
              ${state.files.map((f) => ResultCard(f))}
              ${SummaryCard()}
            </section>
          `
          : html``}
      </main>

      <footer class="app-footer">
        <p>Gerber: aperture types C (Circle), R (Rectangle), O (Oval), P (Polygon).</p>
        <p>ODB++: symbol shapes r (Circle), s (Square), rect, oval, di (Donut), hex_l/hex_s (Hexagon).</p>
        <p>Uses <a href="https://github.com/WebReflection/uhtml" target="_blank" rel="noopener">uhtml</a> &mdash; zero build step required.</p>
      </footer>
    </div>
  `;
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function update() {
  render(document.getElementById('app'), App());
}

update();
