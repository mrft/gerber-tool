/**
 * ODB++ directory parser – stencil paste-layer area calculator.
 *
 * Supports two modes of directory access:
 *   1. File System Access API  (FileSystemDirectoryHandle) – Chrome / Edge
 *   2. Flat FileList from webkitdirectory input or FileSystemEntry drag – Firefox + all
 *
 * Expected ODB++ structure (checked at one and two levels deep):
 *   <root>/
 *     steps/
 *       <step>/        (first step found, usually 'pcb')
 *         layers/
 *           <paste_layer>/  (detected via matrix TYPE PASTE_MASK or name heuristic)
 *             features       (contains symbol defs and pad records)
 *         matrix             (optional – used to identify paste layers by type)
 *
 * Supported ODB++ symbol shapes: r (circle), s (square), rect, oval, di (donut), hex_l/hex_s
 */

const PI = Math.PI;

/** Unit name → mm multiplier */
const UNIT_TO_MM = {
  MM: 1,
  INCH: 25.4,
  MIL: 0.0254,
  MICRON: 0.001,
};

/** Layer name patterns that indicate a solder-paste layer */
const PASTE_NAME_RE = /paste|spt|spb|sp[_-][tb]|sol[_-]past/i;

// ─── Symbol area calculation ─────────────────────────────────────────────────

/**
 * Parse an ODB++ symbol name and return shape metadata.
 * Sizes in the symbol name are in file units; `unitMult` converts them to mm.
 * @param {string} name
 * @param {number} unitMult
 * @returns {{ shapeName: string, dimensions: string, areaInMm2: number }}
 */
function parseSymbolInfo(name, unitMult) {
  const fmm = (n) => (n * unitMult).toFixed(4);
  let m;

  // r<d> – round (circle), diameter d
  if ((m = name.match(/^r([\d.]+)$/i))) {
    const d = parseFloat(m[1]);
    const dMm = d * unitMult;
    return { shapeName: 'Circle', dimensions: `\u2300${fmm(d)} mm`, areaInMm2: PI * (dMm / 2) ** 2 };
  }

  // s<d> – square, side d
  if ((m = name.match(/^s([\d.]+)$/i))) {
    const d = parseFloat(m[1]);
    const dMm = d * unitMult;
    return { shapeName: 'Square', dimensions: `${fmm(d)} \u00D7 ${fmm(d)} mm`, areaInMm2: dMm * dMm };
  }

  // rect<w>x<h> – rectangle
  if ((m = name.match(/^rect([\d.]+)x([\d.]+)$/i))) {
    const w = parseFloat(m[1]) * unitMult;
    const h = parseFloat(m[2]) * unitMult;
    return { shapeName: 'Rectangle', dimensions: `${w.toFixed(4)} \u00D7 ${h.toFixed(4)} mm`, areaInMm2: w * h };
  }

  // oval<w>x<h> – oval / oblong (stadium shape)
  if ((m = name.match(/^oval([\d.]+)x([\d.]+)$/i))) {
    const w = parseFloat(m[1]) * unitMult;
    const h = parseFloat(m[2]) * unitMult;
    const minor = Math.min(w, h);
    const major = Math.max(w, h);
    const areaInMm2 = PI * (minor / 2) ** 2 + (major - minor) * minor;
    return { shapeName: 'Oval', dimensions: `${w.toFixed(4)} \u00D7 ${h.toFixed(4)} mm`, areaInMm2 };
  }

  // di<outer>x<inner> – donut (ring)
  if ((m = name.match(/^di([\d.]+)x([\d.]+)$/i))) {
    const dOuter = parseFloat(m[1]) * unitMult;
    const dInner = parseFloat(m[2]) * unitMult;
    const areaInMm2 = Math.max(0, PI * ((dOuter / 2) ** 2 - (dInner / 2) ** 2));
    return {
      shapeName: 'Donut',
      dimensions: `\u2300${dOuter.toFixed(4)} / \u2300${dInner.toFixed(4)} mm`,
      areaInMm2,
    };
  }

  // hex_l<d> / hex_s<d> – regular hexagon inscribed in circle of diameter d
  if ((m = name.match(/^hex_[ls]([\d.]+)$/i))) {
    const d = parseFloat(m[1]) * unitMult;
    const r = d / 2;
    const areaInMm2 = (6 * r * r * Math.sin((2 * PI) / 6)) / 2;
    return { shapeName: 'Hexagon', dimensions: `\u2300${d.toFixed(4)} mm`, areaInMm2 };
  }

  // Unknown symbol – area is unknown / zero
  return { shapeName: name, dimensions: name, areaInMm2: 0 };
}

// ─── Features file parser ────────────────────────────────────────────────────

/**
 * Parse the text content of an ODB++ features file.
 *
 * @param {string} content
 * @returns {{
 *   units: 'mm',
 *   apertures: object[],
 *   totalArea: number,
 *   totalFlashes: number,
 *   apertureCount: number,
 *   usedApertureCount: number
 * }}
 */
export function parseFeaturesContent(content) {
  const lines = content.split(/\r?\n/);

  // First pass: find UNITS line (typically near the top)
  let unitMult = 1; // default: mm
  for (const line of lines) {
    const m = line.trim().match(/^UNITS\s*=\s*(\w+)/i);
    if (m) {
      unitMult = UNIT_TO_MM[m[1].toUpperCase()] ?? 1;
      break;
    }
  }

  /** @type {Map<number, {symName:string,shapeName:string,dimensions:string,areaInMm2:number}>} */
  const symbols = new Map();
  /** @type {Map<number, number>} */
  const flashCounts = new Map();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Symbol definition: $<num> <symname> [attrs...]
    const symM = line.match(/^\$(\d+)\s+(\S+)/);
    if (symM) {
      const idx = parseInt(symM[1], 10);
      const symName = symM[2];
      symbols.set(idx, { symName, ...parseSymbolInfo(symName, unitMult) });
      if (!flashCounts.has(idx)) flashCounts.set(idx, 0);
      continue;
    }

    // Pad feature: P <x> <y> <sym_num> <polarity> [...]
    if (line.startsWith('P ')) {
      const parts = line.split(/\s+/);
      // P x y sym_num polarity ...
      if (parts.length >= 4) {
        const symIdx = parseInt(parts[3], 10);
        if (!isNaN(symIdx) && symbols.has(symIdx)) {
          flashCounts.set(symIdx, (flashCounts.get(symIdx) ?? 0) + 1);
        }
      }
    }
    // Line (L), arc (A), and surface (S…SE) features are not flashes – ignored.
  }

  // Build result
  const apertures = [];
  let totalArea = 0;
  let totalFlashes = 0;

  for (const [idx, sym] of symbols) {
    const flashes = flashCounts.get(idx) ?? 0;
    if (!flashes) continue;
    totalFlashes += flashes;
    const layerTotalArea = sym.areaInMm2 * flashes;
    totalArea += layerTotalArea;
    apertures.push({
      dCode: idx,
      shape: sym.symName,
      shapeName: sym.shapeName,
      params: [],
      dimensions: sym.dimensions,
      areaPerFlash: sym.areaInMm2,
      flashes,
      totalArea: layerTotalArea,
    });
  }

  apertures.sort((a, b) => a.dCode - b.dCode);

  return {
    units: 'mm',
    apertures,
    totalArea,
    totalFlashes,
    apertureCount: symbols.size,
    usedApertureCount: apertures.length,
  };
}

// ─── Matrix / layer detection ────────────────────────────────────────────────

/**
 * Parse the ODB++ matrix file to find layer names of type PASTE_MASK.
 * @param {string} matrixContent
 * @param {string[]} availableNames
 * @returns {string[]}
 */
function extractPasteLayersFromMatrix(matrixContent, availableNames) {
  const found = [];
  // Match LAYER { ... } blocks (multiline)
  const blockRe = /LAYER\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(matrixContent)) !== null) {
    const block = m[1];
    const nameM = block.match(/^\s*NAME\s+(\S+)/m);
    const typeM = block.match(/^\s*TYPE\s+(\S+)/m);
    if (nameM && typeM && /paste/i.test(typeM[1]) && availableNames.includes(nameM[1])) {
      found.push(nameM[1]);
    }
  }
  return found;
}

// ─── VFS abstractions ─────────────────────────────────────────────────────────

/**
 * Build a VFS from a FileSystemDirectoryHandle (File System Access API).
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {VFS}
 */
export function vfsFromDirHandle(rootHandle) {
  return {
    async readFile(path) {
      const parts = path.split('/').filter(Boolean);
      let dir = rootHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
      const file = await fileHandle.getFile();
      return file.text();
    },

    async listDir(path) {
      try {
        const parts = path.split('/').filter(Boolean);
        let dir = rootHandle;
        for (const part of parts) {
          dir = await dir.getDirectoryHandle(part);
        }
        const names = [];
        for await (const [name] of dir.entries()) {
          names.push(name);
        }
        return names;
      } catch {
        return [];
      }
    },
  };
}

/**
 * Build a VFS from a path→File map (built from webkitdirectory input or FileSystemEntry traversal).
 * Paths must be relative to the ODB++ root (no leading /).
 * @param {Map<string, File>} pathToFile
 * @returns {VFS}
 */
export function vfsFromFileMap(pathToFile) {
  return {
    async readFile(path) {
      const normalized = path.replace(/^\/+/, '');
      const file = pathToFile.get(normalized);
      if (!file) throw new Error(`File not found in ODB++ folder: ${normalized}`);
      return file.text();
    },

    async listDir(path) {
      const dir = path.replace(/^\/+|\/+$/g, '');
      const prefix = dir ? dir + '/' : '';
      const children = new Set();
      for (const p of pathToFile.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const seg = rest.split('/')[0];
        if (seg) children.add(seg);
      }
      return [...children];
    },
  };
}

/**
 * Build a path→File map from the FileList returned by a <input webkitdirectory> element.
 * The root directory name is stripped from all paths.
 * @param {File[]|FileList} files
 * @returns {{ pathMap: Map<string, File>, rootName: string }}
 */
export function buildPathMapFromFileList(files) {
  const arr = Array.from(files);
  if (arr.length === 0) return { pathMap: new Map(), rootName: '' };

  const firstPath = arr[0].webkitRelativePath ?? '';
  const rootName = firstPath.split('/')[0] ?? '';

  const pathMap = new Map();
  for (const file of arr) {
    const rel = file.webkitRelativePath ?? file.name;
    const path = rootName && rel.startsWith(rootName + '/')
      ? rel.slice(rootName.length + 1)
      : rel;
    if (path) pathMap.set(path, file);
  }

  return { pathMap, rootName };
}

// ─── FileSystemDirectoryEntry traversal (Firefox drag-and-drop) ──────────────

/**
 * Read all entries from a FileSystemDirectoryReader (handles the 100-entry batch limit).
 * @param {FileSystemDirectoryReader} reader
 * @returns {Promise<FileSystemEntry[]>}
 */
async function readAllEntries(reader) {
  const all = [];
  let batch;
  do {
    batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

/**
 * Recursively traverse a FileSystemDirectoryEntry and build a path→File map.
 * Paths are relative to the root directory (its name is stripped).
 * @param {FileSystemDirectoryEntry} rootEntry
 * @returns {Promise<{ pathMap: Map<string, File>, rootName: string }>}
 */
export async function traverseDirEntry(rootEntry) {
  const pathMap = new Map();

  async function visit(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      pathMap.set(prefix + entry.name, file);
    } else if (entry.isDirectory) {
      const entries = await readAllEntries(entry.createReader());
      const newPrefix = prefix + entry.name + '/';
      for (const child of entries) {
        await visit(child, newPrefix);
      }
    }
  }

  // Traverse children of root so paths are relative to the job root
  const rootChildren = await readAllEntries(rootEntry.createReader());
  for (const child of rootChildren) {
    await visit(child, '');
  }

  return { pathMap, rootName: rootEntry.name };
}

// ─── Main parseOdb entry point ────────────────────────────────────────────────

/**
 * @typedef {{
 *   readFile: (path: string) => Promise<string>,
 *   listDir:  (path: string) => Promise<string[]>
 * }} VFS
 */

/**
 * Parse an ODB++ job directory and return stencil paste-layer area data.
 *
 * @param {VFS} vfs
 * @param {string} jobName - Human-readable job name (usually the directory name)
 * @returns {Promise<{
 *   format: 'odb',
 *   jobName: string,
 *   units: 'mm',
 *   pasteLayers: object[],
 *   totalArea: number,
 *   totalFlashes: number
 * }>}
 */
export async function parseOdb(vfs, jobName) {
  // Locate the ODB++ root: check one and two levels deep for a `steps/` directory
  const topItems = await vfs.listDir('');
  let stepsPath = '';

  if (topItems.map((s) => s.toLowerCase()).includes('steps')) {
    stepsPath = 'steps';
  } else {
    // One level down (common when a job folder is itself inside the selected root)
    for (const item of topItems) {
      const sub = await vfs.listDir(item);
      if (sub.map((s) => s.toLowerCase()).includes('steps')) {
        stepsPath = `${item}/steps`;
        break;
      }
    }
  }

  if (!stepsPath) {
    throw new Error(
      'Not a valid ODB++ folder: no "steps" directory found.\n' +
      'Expected structure: <root>/steps/<step>/layers/<paste-layer>/features',
    );
  }

  // Pick the first step (usually 'pcb')
  const steps = await vfs.listDir(stepsPath);
  if (steps.length === 0) {
    throw new Error(`No step sub-directories found inside "${stepsPath}"`);
  }
  const stepName = steps.find((s) => !s.startsWith('.')) ?? steps[0];

  // Some exports put layers directly in <step>/, others in <step>/layers/
  const layersPath = `${stepsPath}/${stepName}/layers`;
  let layerNames = await vfs.listDir(layersPath);

  // Fallback: layers directly in step (no 'layers' sub-folder)
  let layersActualPath = layersPath;
  if (layerNames.length === 0) {
    layerNames = await vfs.listDir(`${stepsPath}/${stepName}`);
    layersActualPath = `${stepsPath}/${stepName}`;
  }

  if (layerNames.length === 0) {
    throw new Error(`No layers found in step "${stepName}"`);
  }

  // Identify paste layers – try matrix file first, then name heuristic
  let pasteLayerNames = [];
  try {
    const matrixContent = await vfs.readFile(`${stepsPath}/${stepName}/matrix`);
    pasteLayerNames = extractPasteLayersFromMatrix(matrixContent, layerNames);
  } catch { /* matrix not available */ }

  if (pasteLayerNames.length === 0) {
    pasteLayerNames = layerNames.filter((n) => PASTE_NAME_RE.test(n));
  }

  if (pasteLayerNames.length === 0) {
    throw new Error(
      `No paste layers found in step "${stepName}".\n` +
      `Available layers: ${layerNames.join(', ')}\n` +
      'Paste layers are identified by TYPE PASTE_MASK in the matrix file, ' +
      'or by having "paste", "spt", "spb", etc. in their name.',
    );
  }

  // Parse each paste layer's features file
  const pasteLayers = [];
  let totalArea = 0;
  let totalFlashes = 0;

  for (const layerName of pasteLayerNames) {
    const featuresPath = `${layersActualPath}/${layerName}/features`;
    try {
      const content = await vfs.readFile(featuresPath);
      const layerResult = parseFeaturesContent(content);
      pasteLayers.push({ name: layerName, ...layerResult });
      totalArea += layerResult.totalArea;
      totalFlashes += layerResult.totalFlashes;
    } catch (err) {
      // Skip layers whose features file is missing or unreadable
      pasteLayers.push({
        name: layerName,
        units: 'mm',
        apertures: [],
        totalArea: 0,
        totalFlashes: 0,
        apertureCount: 0,
        usedApertureCount: 0,
        error: err.message,
      });
    }
  }

  return {
    format: 'odb',
    jobName,
    units: 'mm',
    pasteLayers,
    totalArea,
    totalFlashes,
  };
}
