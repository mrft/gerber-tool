/**
 * Basic tests for js/gerber-parser.js
 * Run with: node --input-type=module < tests/gerber-parser.test.js
 * or:       npm test
 */

import { parseGerber } from '../js/gerber-parser.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function approxEqual(a, b, epsilon = 1e-9) {
  return Math.abs(a - b) < epsilon;
}

// ── Fixture ──────────────────────────────────────────────────────────────────

const SAMPLE_GBP = `G04 Test stencil - bottom paste*
%FSLAX46Y46*%
%MOMM*%
%ADD10C,0.500000*%
%ADD11R,0.800000X0.600000*%
%ADD12O,1.000000X0.500000*%
%ADD13P,1.200000X6*%
D10*
X2000000Y3000000D03*
X4000000Y3000000D03*
X6000000Y3000000D03*
D11*
X2000000Y6000000D03*
X4000000Y6000000D03*
D12*
X2000000Y9000000D03*
D13*
X4000000Y9000000D03*
X6000000Y9000000D03*
M02*`;

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\ngerber-parser.js tests\n');

// ── 1. Basic parse ────────────────────────────────────────────────────────────
console.log('1. Basic parse');
{
  const r = parseGerber(SAMPLE_GBP);
  assert(r.units === 'mm', 'units detected as mm');
  assert(r.apertureCount === 4, `aperture count = 4 (got ${r.apertureCount})`);
  assert(r.usedApertureCount === 4, `used aperture count = 4 (got ${r.usedApertureCount})`);
  assert(r.totalFlashes === 8, `total flashes = 8 (got ${r.totalFlashes})`);
}

// ── 2. Circle area ────────────────────────────────────────────────────────────
console.log('\n2. Circle aperture (D10, ⌀0.5 mm)');
{
  const r = parseGerber(SAMPLE_GBP);
  const ap = r.apertures.find((a) => a.dCode === 10);
  assert(ap !== undefined, 'D10 found');
  assert(ap.shape === 'C', 'shape = C');
  assert(ap.flashes === 3, `flashes = 3 (got ${ap.flashes})`);
  const expectedArea = Math.PI * 0.25 * 0.25;
  assert(approxEqual(ap.areaPerFlash, expectedArea), `areaPerFlash ≈ ${expectedArea.toFixed(6)} (got ${ap.areaPerFlash.toFixed(6)})`);
  assert(approxEqual(ap.totalArea, expectedArea * 3), `totalArea ≈ ${(expectedArea * 3).toFixed(6)}`);
}

// ── 3. Rectangle area ─────────────────────────────────────────────────────────
console.log('\n3. Rectangle aperture (D11, 0.8×0.6 mm)');
{
  const r = parseGerber(SAMPLE_GBP);
  const ap = r.apertures.find((a) => a.dCode === 11);
  assert(ap !== undefined, 'D11 found');
  assert(ap.shape === 'R', 'shape = R');
  assert(ap.flashes === 2, `flashes = 2 (got ${ap.flashes})`);
  assert(approxEqual(ap.areaPerFlash, 0.48), `areaPerFlash = 0.48 (got ${ap.areaPerFlash})`);
  assert(approxEqual(ap.totalArea, 0.96), `totalArea = 0.96 (got ${ap.totalArea})`);
}

// ── 4. Oval area ──────────────────────────────────────────────────────────────
console.log('\n4. Oval aperture (D12, 1.0×0.5 mm)');
{
  const r = parseGerber(SAMPLE_GBP);
  const ap = r.apertures.find((a) => a.dCode === 12);
  assert(ap !== undefined, 'D12 found');
  assert(ap.shape === 'O', 'shape = O');
  assert(ap.flashes === 1, `flashes = 1 (got ${ap.flashes})`);
  // Oval: π*(minor/2)² + (major-minor)*minor  = π*(0.25)² + 0.5*0.5
  const expectedArea = Math.PI * 0.0625 + 0.25;
  assert(approxEqual(ap.areaPerFlash, expectedArea), `areaPerFlash ≈ ${expectedArea.toFixed(6)} (got ${ap.areaPerFlash.toFixed(6)})`);
}

// ── 5. Polygon area ───────────────────────────────────────────────────────────
console.log('\n5. Polygon aperture (D13, ⌀1.2 mm, 6 sides)');
{
  const r = parseGerber(SAMPLE_GBP);
  const ap = r.apertures.find((a) => a.dCode === 13);
  assert(ap !== undefined, 'D13 found');
  assert(ap.shape === 'P', 'shape = P');
  assert(ap.flashes === 2, `flashes = 2 (got ${ap.flashes})`);
  // Regular hexagon inscribed in circle of radius 0.6: (6 * 0.36 * sin(60°)) / 2
  const expectedArea = (6 * 0.36 * Math.sin((2 * Math.PI) / 6)) / 2;
  assert(approxEqual(ap.areaPerFlash, expectedArea), `areaPerFlash ≈ ${expectedArea.toFixed(6)} (got ${ap.areaPerFlash.toFixed(6)})`);
}

// ── 6. Total area ─────────────────────────────────────────────────────────────
console.log('\n6. Total area');
{
  const r = parseGerber(SAMPLE_GBP);
  // Expected: circle*3 + rect*2 + oval*1 + polygon*2
  const circle = Math.PI * 0.0625 * 3;
  const rect   = 0.48 * 2;
  const oval   = (Math.PI * 0.0625 + 0.25) * 1;
  const poly   = (6 * 0.36 * Math.sin((2 * Math.PI) / 6)) / 2 * 2;
  const expected = circle + rect + oval + poly;
  assert(approxEqual(r.totalArea, expected), `totalArea ≈ ${expected.toFixed(6)} (got ${r.totalArea.toFixed(6)})`);
}

// ── 7. Inch units ─────────────────────────────────────────────────────────────
console.log('\n7. Inch units detection');
{
  const r = parseGerber(`%MOIN*%\n%ADD10C,0.020*%\nD10*\nX0Y0D03*\nM02*`);
  assert(r.units === 'in', `units = in (got ${r.units})`);
  assert(r.totalFlashes === 1, `totalFlashes = 1 (got ${r.totalFlashes})`);
}

// ── 8. Empty / no flashes ─────────────────────────────────────────────────────
console.log('\n8. File with no flashes');
{
  const r = parseGerber(`%MOMM*%\n%ADD10C,0.5*%\nD10*\nX0Y0D01*\nM02*`);
  assert(r.totalFlashes === 0, `no flashes (got ${r.totalFlashes})`);
  assert(r.totalArea === 0, `totalArea = 0 (got ${r.totalArea})`);
  assert(r.usedApertureCount === 0, `usedApertureCount = 0 (got ${r.usedApertureCount})`);
}

// ── 9. G54Dnn aperture select (legacy) ────────────────────────────────────────
console.log('\n9. Legacy G54Dnn aperture select');
{
  const r = parseGerber(`%MOMM*%\n%ADD10C,0.5*%\nG54D10*\nX0Y0D03*\nM02*`);
  assert(r.totalFlashes === 1, `flashes counted via G54D10 (got ${r.totalFlashes})`);
}

// ── 10. Region blocks (G36/G37) should not count as flashes ───────────────────
console.log('\n10. Region blocks (G36/G37) excluded from flash count');
{
  const r = parseGerber(`%MOMM*%\n%ADD10C,0.5*%\nD10*\nG36*\nX0Y0D03*\nG37*\nM02*`);
  assert(r.totalFlashes === 0, `region D03 not counted (got ${r.totalFlashes})`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
