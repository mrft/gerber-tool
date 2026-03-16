/**
 * Basic tests for js/odb-parser.js
 * Run with: node tests/odb-parser.test.js   (or via npm test if combined)
 */

import {
  parseFeaturesContent,
  buildPathMapFromFileList,
  vfsFromFileMap,
  parseOdb,
} from '../js/odb-parser.js';

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

function approxEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

const PI = Math.PI;

// ─── Fixture ─────────────────────────────────────────────────────────────────

const SAMPLE_FEATURES_MM = `
# ODB++ features file - paste_top
#
UNITS=MM

$1 r0.500000
$2 s0.800000
$3 rect0.800000x0.600000
$4 oval1.000000x0.500000
$5 hex_l1.200000

# Pads
P 5.000 10.000 1 P 0
P 6.000 10.000 1 P 0
P 7.000 10.000 1 P 0
P 5.000 12.000 2 P 0
P 5.000 14.000 3 P 0
P 5.000 16.000 4 P 0
P 5.000 18.000 5 P 0
P 5.000 19.000 5 P 0
`;

// ─── 1. Circle area (r<d>) ────────────────────────────────────────────────────
console.log('\n1. Circle aperture (r0.5 → ⌀0.5mm)');
{
  const r = parseFeaturesContent(SAMPLE_FEATURES_MM);
  const ap = r.apertures.find((a) => a.dCode === 1);
  assert(ap !== undefined, 'symbol 1 found');
  assert(ap.shapeName === 'Circle', `shapeName = Circle (got ${ap.shapeName})`);
  assert(ap.flashes === 3, `flashes = 3 (got ${ap.flashes})`);
  const expected = PI * 0.0625;
  assert(approxEqual(ap.areaPerFlash, expected), `areaPerFlash ≈ ${expected.toFixed(6)} (got ${ap.areaPerFlash.toFixed(6)})`);
  assert(approxEqual(ap.totalArea, expected * 3), `totalArea = ${(expected * 3).toFixed(6)}`);
}

// ─── 2. Square area (s<d>) ────────────────────────────────────────────────────
console.log('\n2. Square aperture (s0.8)');
{
  const r = parseFeaturesContent(SAMPLE_FEATURES_MM);
  const ap = r.apertures.find((a) => a.dCode === 2);
  assert(ap !== undefined, 'symbol 2 found');
  assert(ap.shapeName === 'Square', `shapeName = Square (got ${ap.shapeName})`);
  assert(ap.flashes === 1, `flashes = 1 (got ${ap.flashes})`);
  assert(approxEqual(ap.areaPerFlash, 0.64), `areaPerFlash = 0.64 (got ${ap.areaPerFlash})`);
}

// ─── 3. Rectangle area (rect<w>x<h>) ─────────────────────────────────────────
console.log('\n3. Rectangle aperture (rect0.8x0.6)');
{
  const r = parseFeaturesContent(SAMPLE_FEATURES_MM);
  const ap = r.apertures.find((a) => a.dCode === 3);
  assert(ap !== undefined, 'symbol 3 found');
  assert(ap.shapeName === 'Rectangle', `shapeName = Rectangle (got ${ap.shapeName})`);
  assert(approxEqual(ap.areaPerFlash, 0.48), `areaPerFlash = 0.48 (got ${ap.areaPerFlash})`);
}

// ─── 4. Oval area (oval<w>x<h>) ──────────────────────────────────────────────
console.log('\n4. Oval aperture (oval1.0x0.5)');
{
  const r = parseFeaturesContent(SAMPLE_FEATURES_MM);
  const ap = r.apertures.find((a) => a.dCode === 4);
  assert(ap !== undefined, 'symbol 4 found');
  assert(ap.shapeName === 'Oval', `shapeName = Oval (got ${ap.shapeName})`);
  const expected = PI * 0.0625 + 0.25; // π*(0.25)² + 0.5*0.5
  assert(approxEqual(ap.areaPerFlash, expected), `areaPerFlash ≈ ${expected.toFixed(6)} (got ${ap.areaPerFlash.toFixed(6)})`);
}

// ─── 5. Hexagon area (hex_l<d>) ──────────────────────────────────────────────
console.log('\n5. Hexagon aperture (hex_l1.2)');
{
  const r = parseFeaturesContent(SAMPLE_FEATURES_MM);
  const ap = r.apertures.find((a) => a.dCode === 5);
  assert(ap !== undefined, 'symbol 5 found');
  assert(ap.shapeName === 'Hexagon', `shapeName = Hexagon (got ${ap.shapeName})`);
  assert(ap.flashes === 2, `flashes = 2 (got ${ap.flashes})`);
  const r2 = 0.6 * 0.6;
  const expected = (6 * r2 * Math.sin((2 * PI) / 6)) / 2;
  assert(approxEqual(ap.areaPerFlash, expected), `areaPerFlash ≈ ${expected.toFixed(6)} (got ${ap.areaPerFlash.toFixed(6)})`);
}

// ─── 6. Total area sum ────────────────────────────────────────────────────────
console.log('\n6. Total area (all symbols)');
{
  const r = parseFeaturesContent(SAMPLE_FEATURES_MM);
  const circle3 = PI * 0.0625 * 3;
  const sq1     = 0.64 * 1;
  const rect1   = 0.48 * 1;
  const oval1   = (PI * 0.0625 + 0.25) * 1;
  const hex2    = (6 * 0.36 * Math.sin((2 * PI) / 6)) / 2 * 2;
  const expected = circle3 + sq1 + rect1 + oval1 + hex2;
  assert(approxEqual(r.totalArea, expected), `totalArea ≈ ${expected.toFixed(6)} (got ${r.totalArea.toFixed(6)})`);
  assert(r.totalFlashes === 8, `totalFlashes = 8 (got ${r.totalFlashes})`);
}

// ─── 7. MIL units conversion ──────────────────────────────────────────────────
console.log('\n7. MIL units conversion');
{
  const milContent = `UNITS=MIL\n$1 r20\nP 0 0 1 P 0\n`;
  const r = parseFeaturesContent(milContent);
  const ap = r.apertures.find((a) => a.dCode === 1);
  // 20 mil = 0.508mm; area = π*(0.254)²
  const dMm = 20 * 0.0254;
  const expected = PI * (dMm / 2) ** 2;
  assert(approxEqual(ap.areaPerFlash, expected, 1e-12), `MIL→mm area ≈ ${expected.toFixed(8)} (got ${ap.areaPerFlash.toFixed(8)})`);
}

// ─── 8. Donut (di) ────────────────────────────────────────────────────────────
console.log('\n8. Donut aperture (di1.0x0.5)');
{
  const r = parseFeaturesContent(`UNITS=MM\n$1 di1.0x0.5\nP 0 0 1 P 0\n`);
  const ap = r.apertures.find((a) => a.dCode === 1);
  assert(ap?.shapeName === 'Donut', `shapeName = Donut (got ${ap?.shapeName})`);
  const expected = PI * (0.25 - 0.0625); // π*(0.5)² - π*(0.25)²
  assert(approxEqual(ap.areaPerFlash, expected), `areaPerFlash ≈ ${expected.toFixed(6)} (got ${ap.areaPerFlash.toFixed(6)})`);
}

// ─── 9. Lines and arcs ignored (not counted as flashes) ──────────────────────
console.log('\n9. Lines and arcs not counted');
{
  const r = parseFeaturesContent(`UNITS=MM\n$1 r0.5\nP 0 0 1 P 0\nL 0 0 1 1 1 P\nA 0 0 1 1 1 P 1\n`);
  assert(r.totalFlashes === 1, `only 1 flash (lines/arcs ignored) (got ${r.totalFlashes})`);
}

// ─── 10. vfsFromFileMap / parseOdb integration ───────────────────────────────
console.log('\n10. parseOdb with in-memory VFS');
{
  const featuresContent = `UNITS=MM\n$1 r0.500\n$2 s0.800\nP 0 0 1 P 0\nP 1 0 1 P 0\nP 0 1 2 P 0\n`;
  // Simulate a minimal ODB++ folder: steps/pcb/layers/paste_top/features
  const pathMap = new Map([
    ['steps/pcb/layers/paste_top/features', { text: () => Promise.resolve(featuresContent) }],
  ]);

  // minimal VFS for test (simpler than buildPathMapFromFileList)
  const vfs = {
    async readFile(path) {
      const f = pathMap.get(path.replace(/^\/+/, ''));
      if (!f) throw new Error(`not found: ${path}`);
      return f.text();
    },
    async listDir(path) {
      const p = path.replace(/^\/+|\/+$/g, '');
      const prefix = p ? p + '/' : '';
      const children = new Set();
      for (const k of pathMap.keys()) {
        if (!k.startsWith(prefix)) continue;
        const seg = k.slice(prefix.length).split('/')[0];
        if (seg) children.add(seg);
      }
      return [...children];
    },
  };

  const result = await parseOdb(vfs, 'test-job');
  assert(result.format === 'odb', `format = odb (got ${result.format})`);
  assert(result.pasteLayers.length === 1, `1 paste layer (got ${result.pasteLayers.length})`);
  assert(result.pasteLayers[0].name === 'paste_top', `layer name = paste_top`);
  assert(result.totalFlashes === 3, `totalFlashes = 3 (got ${result.totalFlashes})`);

  const expectedTotal = PI * 0.0625 * 2 + 0.64;
  assert(approxEqual(result.totalArea, expectedTotal), `totalArea ≈ ${expectedTotal.toFixed(6)} (got ${result.totalArea.toFixed(6)})`);
}

// ─── 11. No steps/ directory → error ─────────────────────────────────────────
console.log('\n11. Invalid ODB++ (no steps/)');
{
  const vfs = { readFile: async () => '', listDir: async () => ['something', 'else'] };
  try {
    await parseOdb(vfs, 'bad');
    assert(false, 'should have thrown');
  } catch (err) {
    assert(err.message.includes('steps'), `error mentions "steps": ${err.message.slice(0, 60)}`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
