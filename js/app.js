/**
 * Gerber Tool – Stencil Aperture Area Calculator
 * Main application module using uhtml (zero-build, CDN-imported).
 *
 * uhtml docs: https://github.com/WebReflection/uhtml
 */

import { html, render } from './vendor/uhtml.js';
import { parseGerber } from './gerber-parser.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Conversion factor: 1 inch² = 25.4² mm² */
const IN2_TO_MM2 = 25.4 * 25.4;

// ─── Application state ───────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, status: 'pending'|'processing'|'done'|'error', result: object|null, error: string|null }} FileEntry
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
    status: /** @type {'pending'} */ ('pending'),
    result: null,
    error: null,
  }));
  setState({ files: [...state.files, ...newEntries] });
  incoming.forEach((file, i) => processFile(file, startIndex + i));
}

function handleDrop(e) {
  e.preventDefault();
  setState({ isDragging: false });
  if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
}

function handleFileInput(e) {
  if (e.target.files.length > 0) addFiles(e.target.files);
  // Reset the input so the same file can be re-uploaded after clearing
  e.target.value = '';
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtArea(area, units, extraDecimals = 0) {
  if (units === 'mm') {
    return `${area.toFixed(4 + extraDecimals)} mm²`;
  }
  // inches → also show mm² conversion
  const mm2 = area * IN2_TO_MM2;
  return `${area.toFixed(6)} in² (≈ ${mm2.toFixed(4)} mm²`;
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
      onclick="${() => document.getElementById('file-input').click()}"
      role="button"
      tabindex="0"
      aria-label="Upload Gerber files"
      onkeydown="${(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('file-input').click(); }}"
    >
      <svg class="drop-zone__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5
                 m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
      <p class="drop-zone__label">Drop Gerber files here</p>
      <p class="drop-zone__hint">or click to browse &mdash; .gbr, .ger, .gtp, .gbp, .gtl, .gbl &hellip;</p>
      <input
        type="file"
        id="file-input"
        multiple
        accept=".gbr,.ger,.gtl,.gbl,.gtp,.gbp,.gts,.gbs,.gko,.drl,.exc,.xln"
        style="display:none"
        onchange="${handleFileInput}"
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

function ApertureTableRow(ap, units) {
  return html`
    <tr>
      <td>D${ap.dCode}</td>
      <td>${ap.shapeName}</td>
      <td>${ap.dimensions}</td>
      <td class="num">${fmtArea(ap.areaPerFlash, units)}</td>
      <td class="num">${ap.flashes.toLocaleString()}</td>
      <td class="num">${fmtArea(ap.totalArea, units)}</td>
    </tr>
  `;
}

function ApertureTable(apertures, units) {
  return html`
    <div class="table-wrapper">
      <table class="aperture-table">
        <thead>
          <tr>
            <th>D Code</th>
            <th>Shape</th>
            <th>Dimensions</th>
            <th>Area / Flash</th>
            <th>Flashes</th>
            <th>Total Area</th>
          </tr>
        </thead>
        <tbody>
          ${apertures.map((ap) => ApertureTableRow(ap, units))}
        </tbody>
      </table>
    </div>
  `;
}

function ResultCard(file) {
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
        <h1 class="app-header__title">Gerber Stencil Area Calculator</h1>
        <p class="app-header__desc">
          Upload one or more Gerber paste/stencil files to calculate the total aperture opening area.
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
        <p>Supports aperture types C (Circle), R (Rectangle), O (Oval), P (Polygon).</p>
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
