// Unit tests for DOM-First, Vision-Fallback Architecture
// Run: node tests/vision-fallback.mjs

import { evaluateDomSufficiency, formatVisionContextBlock } from '../src/agent/vision-fallback.ts';

const failures = [];
function check(name, cond) {
  if (!cond) {
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  } else {
    console.log(`  OK:   ${name}`);
  }
}

console.log('Testing DOM-First, Vision-Fallback Architecture...');

// 1. Standard DOM page (e.g. Wikipedia, GitHub, HackerNews)
{
  const snap = {
    capturedAt: Date.now(),
    info: { url: 'https://news.ycombinator.com', title: 'Hacker News', vw: 1280, vh: 800, isEmpty: false, isPlaceholder: false },
    stats: { interactive: 45, links: 30, inputs: 1, buttons: 2, iframes: 0, total: 350, textChars: 8000, canvasCount: 0, canvasCoverageRatio: 0 },
    sufficiency: {
      isSufficient: true,
      score: 1.0,
      hasDominantCanvas: false,
      canvasCoverageRatio: 0,
      canvasCount: 0,
      interactiveDensity: 45,
      reasons: [],
    },
    elements: [],
    announcements: [],
  };

  const decision = evaluateDomSufficiency(snap, 'summarize the top 3 stories');
  check('Standard HTML page uses DOM-only path', decision.useVision === false);
  check('Standard HTML page mode is dom-only', decision.mode === 'dom-only');
}

// 2. Dominant Canvas page (e.g. Google Sheets, Figma artboard, Canva)
{
  const snap = {
    capturedAt: Date.now(),
    info: { url: 'https://docs.google.com/spreadsheets/d/123/edit', title: 'Untitled spreadsheet', vw: 1280, vh: 800, isEmpty: false, isPlaceholder: false },
    stats: { interactive: 12, links: 0, inputs: 1, buttons: 8, iframes: 0, total: 120, textChars: 600, canvasCount: 2, canvasCoverageRatio: 0.82 },
    sufficiency: {
      isSufficient: false,
      score: 0.45,
      hasDominantCanvas: true,
      canvasCoverageRatio: 0.82,
      canvasCount: 2,
      interactiveDensity: 12,
      reasons: ['Dominant canvas covers 82% of viewport'],
    },
    elements: [],
    announcements: [],
  };

  const decision = evaluateDomSufficiency(snap, 'click on the menu');
  check('Dominant canvas page automatically triggers vision fallback', decision.useVision === true);
  check('Dominant canvas page mode is vision-augmented', decision.mode === 'vision-augmented');
  check('Reason notes canvas dominance', decision.reason.includes('<canvas>'));
}

// 3. Visual intent in user prompt ("type hi in cell A1")
{
  const snap = {
    capturedAt: Date.now(),
    info: { url: 'https://docs.google.com/spreadsheets', title: 'Spreadsheet', vw: 1280, vh: 800, isEmpty: false, isPlaceholder: false },
    stats: { interactive: 30, links: 0, inputs: 1, buttons: 20, iframes: 0, total: 200, textChars: 1200, canvasCount: 1, canvasCoverageRatio: 0.20 },
    sufficiency: {
      isSufficient: true,
      score: 0.7,
      hasDominantCanvas: false,
      canvasCoverageRatio: 0.20,
      canvasCount: 1,
      interactiveDensity: 30,
      reasons: [],
    },
    elements: [],
    announcements: [],
  };

  const decision = evaluateDomSufficiency(snap, 'create new spreadsheet and type hi in cell A1');
  check('User query referencing "cell A1" triggers vision fallback', decision.useVision === true);
  check('Reason identifies visual intent pattern', decision.reason.includes('visual analysis'));
}

// 4. Failed DOM action on a canvas-present page
{
  const snap = {
    capturedAt: Date.now(),
    info: { url: 'https://app.example.com', title: 'Canvas App', vw: 1280, vh: 800, isEmpty: false, isPlaceholder: false },
    stats: { interactive: 25, links: 0, inputs: 0, buttons: 5, iframes: 0, total: 100, textChars: 500, canvasCount: 1, canvasCoverageRatio: 0.15 },
    sufficiency: {
      isSufficient: true,
      score: 0.8,
      hasDominantCanvas: false,
      canvasCoverageRatio: 0.15,
      canvasCount: 1,
      interactiveDensity: 25,
      reasons: [],
    },
    elements: [],
    announcements: [],
  };

  const lastActions = [
    { name: 'click_index', result: '{"success":false,"error":"index 5 not found"}', ok: false },
  ];

  const decision = evaluateDomSufficiency(snap, 'click the item', lastActions);
  check('Failed DOM action on canvas-containing page triggers vision fallback', decision.useVision === true);
}

// 5. Vision Context block formatting
{
  const frame = {
    base64: 'fakebase64data',
    mimeType: 'image/jpeg',
    width: 1920,
    height: 1080,
    dpr: 1.5,
    capturedAt: Date.now(),
  };
  const decision = {
    useVision: true,
    reason: 'Page dominated by canvas',
    mode: 'vision-augmented',
  };

  const block = formatVisionContextBlock(frame, decision);
  check('Vision context block contains resolution', block.includes('1920x1080 px'));
  check('Vision context block mentions click_coordinate', block.includes('click_coordinate(x, y)'));
  check('Vision context block mentions type_coordinate', block.includes('type_coordinate(x, y, text)'));
  check('Vision context block advises using DOM for menus and coordinates for canvas', block.includes('<page_snapshot>'));
}

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length} failures):\n  ` + failures.join('\n  '));
  process.exit(1);
} else {
  console.log('\nPASS — all DOM-first, vision-fallback tests passed!\n');
}
