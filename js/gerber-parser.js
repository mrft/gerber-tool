/**
 * Gerber RS-274X parser – stencil aperture area calculator.
 *
 * Supported aperture shapes:
 *   C  – Circle       %ADD10C,diameter*%
 *   R  – Rectangle    %ADD11R,widthXheight*%
 *   O  – Oval/Oblong  %ADD12O,widthXheight*%
 *   P  – Polygon      %ADD13P,outerDiaXsides[Xrotation]*%
 *
 * The parser counts D03 (flash) operations per aperture and multiplies
 * by the aperture area to get the total stencil opening area.
 */

const PI = Math.PI;

/** Human-readable names for the four standard aperture shapes. */
const SHAPE_NAMES = {
  C: 'Circle',
  R: 'Rectangle',
  O: 'Oval',
  P: 'Polygon',
};

/**
 * Calculate the area of a standard aperture shape.
 * @param {string} shape - 'C', 'R', 'O', or 'P'
 * @param {number[]} params - Numeric parameters from the ADD command
 * @returns {number} Area in the file's coordinate units²
 */
function calcApertureArea(shape, params) {
  switch (shape) {
    case 'C': {
      // Circle: diameter [X hole_diameter]
      const d = params[0] || 0;
      return PI * (d / 2) ** 2;
    }
    case 'R': {
      // Rectangle: width X height [X hole_diameter]
      const w = params[0] || 0;
      const h = params[1] !== undefined ? params[1] : w;
      return w * h;
    }
    case 'O': {
      // Oval (oblong): width X height [X hole_diameter]
      // Treated as a rectangle with semicircular caps on the shorter sides
      const w = params[0] || 0;
      const h = params[1] !== undefined ? params[1] : w;
      const minor = Math.min(w, h);
      const major = Math.max(w, h);
      return PI * (minor / 2) ** 2 + (major - minor) * minor;
    }
    case 'P': {
      // Regular polygon: outer_diameter X vertices [X rotation [X hole_diameter]]
      const d = params[0] || 0;
      const n = params[1] || 3;
      const r = d / 2;
      return (n * r * r * Math.sin((2 * PI) / n)) / 2;
    }
    default:
      return 0;
  }
}

/**
 * Build a human-readable dimension string for an aperture.
 * @param {string} shape
 * @param {number[]} params
 * @param {string} units - 'mm' or 'in'
 * @returns {string}
 */
function formatDimensions(shape, params, units) {
  const u = units === 'mm' ? 'mm' : 'in';
  const fmt = (n) => (typeof n === 'number' ? n.toFixed(4) : '?');
  switch (shape) {
    case 'C':
      return `\u2300${fmt(params[0])} ${u}`;
    case 'R':
    case 'O':
      return `${fmt(params[0])} \u00D7 ${fmt(params[1])} ${u}`;
    case 'P':
      return `\u2300${fmt(params[0])} ${u}, ${params[1]} sides`;
    default:
      return params.join(' \u00D7 ');
  }
}

/**
 * Parse a Gerber RS-274X file and return stencil aperture area information.
 *
 * @param {string} content - Raw text content of the Gerber file
 * @returns {{
 *   units: 'mm'|'in',
 *   apertures: ApertureResult[],
 *   totalArea: number,
 *   totalFlashes: number,
 *   apertureCount: number,
 *   usedApertureCount: number
 * }}
 *
 * @typedef {{
 *   dCode: number,
 *   shape: string,
 *   shapeName: string,
 *   params: number[],
 *   dimensions: string,
 *   areaPerFlash: number,
 *   flashes: number,
 *   totalArea: number
 * }} ApertureResult
 */
export function parseGerber(content) {
  // Normalize line endings
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  /** @type {Map<number, {dCode:number, shape:string, params:number[], area:number}>} */
  const apertures = new Map();
  /** @type {Map<number, number>} */
  const flashCounts = new Map();

  let currentAperture = null;
  let units = 'mm'; // Default to mm (most common); overridden by MO command
  let inRegion = false;

  let i = 0;
  while (i < text.length) {
    // Skip whitespace between tokens
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }

    if (text[i] === '%') {
      // ── Extended parameter block: %...% ─────────────────────────────────
      const blockStart = i + 1;
      i++;
      while (i < text.length && text[i] !== '%') i++;
      const block = text.slice(blockStart, i);
      i++; // skip closing %

      // A block may contain several statements separated by '*'
      for (const cmd of block.split('*').map((c) => c.replace(/\s/g, '')).filter(Boolean)) {
        // Units
        if (cmd === 'MOMM' || cmd === 'MO,MM') { units = 'mm'; continue; }
        if (cmd === 'MOIN' || cmd === 'MO,IN') { units = 'in'; continue; }

        // Aperture definition: ADD<d><shape>[,<params>]
        const addMatch = cmd.match(/^ADD(\d+)([CROP]),?(.*)$/);
        if (addMatch) {
          const dCode = parseInt(addMatch[1], 10);
          const shape = addMatch[2];
          const paramStr = addMatch[3];
          const params = paramStr
            ? paramStr.split('X').map(Number).filter((n) => !isNaN(n))
            : [];
          const area = calcApertureArea(shape, params);
          apertures.set(dCode, { dCode, shape, params, area });
          if (!flashCounts.has(dCode)) flashCounts.set(dCode, 0);
        }
        // Aperture macros (AM) and other extended params are skipped intentionally
      }
      continue;
    }

    // ── Regular command: terminated by '*' ──────────────────────────────────
    const cmdStart = i;
    while (i < text.length && text[i] !== '*') i++;
    const cmd = text.slice(cmdStart, i).replace(/\s/g, '');
    i++; // skip '*'

    if (!cmd) continue;

    // Skip G04 comments
    if (cmd.startsWith('G04')) continue;

    // Region commands (G36 / G37) – region outlines are not individual flashes
    if (cmd === 'G36') { inRegion = true; continue; }
    if (cmd === 'G37') { inRegion = false; continue; }

    // End-of-file marker
    if (cmd === 'M02' || cmd === 'M00' || cmd === 'M01') break;

    // Locate the trailing D-code (handles both standalone and coordinate-prefixed forms)
    // Examples: "D10", "G54D10", "X123Y456D03", "X123Y456I0J0D01"
    const dMatch = cmd.match(/D(\d+)$/);
    if (dMatch) {
      const dCode = parseInt(dMatch[1], 10);
      if (dCode >= 10) {
        // Aperture select
        currentAperture = dCode;
      } else if (dCode === 3 && !inRegion && currentAperture !== null) {
        // Flash operation
        flashCounts.set(currentAperture, (flashCounts.get(currentAperture) ?? 0) + 1);
      }
      // D01 (draw) and D02 (move) are deliberately ignored
    }
  }

  // ── Build result ──────────────────────────────────────────────────────────
  const apertureResults = [];
  let totalArea = 0;
  let totalFlashes = 0;

  for (const [dCode, ap] of apertures) {
    const flashes = flashCounts.get(dCode) ?? 0;
    totalFlashes += flashes;
    if (flashes > 0) {
      const apertureTotal = ap.area * flashes;
      totalArea += apertureTotal;
      apertureResults.push({
        dCode,
        shape: ap.shape,
        shapeName: SHAPE_NAMES[ap.shape] ?? ap.shape,
        params: ap.params,
        dimensions: formatDimensions(ap.shape, ap.params, units),
        areaPerFlash: ap.area,
        flashes,
        totalArea: apertureTotal,
      });
    }
  }

  apertureResults.sort((a, b) => a.dCode - b.dCode);

  return {
    units,
    apertures: apertureResults,
    totalArea,
    totalFlashes,
    apertureCount: apertures.size,
    usedApertureCount: apertureResults.length,
  };
}
