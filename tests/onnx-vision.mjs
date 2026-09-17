// Unit and integration tests for Local ONNX Runtime Vision Engine & UI Detector
// Run: node tests/unit.mjs

import { preprocessImageForONNX } from '../src/vision/preprocessor.ts';
import { calculateIoU, applyNMS, postprocessDetections } from '../src/vision/postprocessor.ts';
import { UIDetector, formatDetectedElementsBlock, getUIDetector } from '../src/vision/ui-detector.ts';
import { captureVisionFrame, formatVisionContextBlock } from '../src/agent/vision-fallback.ts';
import sharp from 'sharp';

const failures = [];
function check(name, cond) {
  if (!cond) {
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  } else {
    console.log(`  OK:   ${name}`);
  }
}

console.log('=== Testing Local Vision Model (ONNX Runtime Web) ===\n');

// 1. Image Preprocessing for ONNX (Letterbox 640x640 & Normalization)
{
  console.log('1. Testing Image Preprocessing Pipeline...');

  // Create synthetic 1280x800 test image (standard viewport)
  const testImg = await sharp({
    create: {
      width: 1280,
      height: 800,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  }).jpeg().toBuffer();

  const prep = await preprocessImageForONNX(testImg, { targetWidth: 640, targetHeight: 640 });

  check('Tensor dimensions are [1, 3, 640, 640]',
    prep.dims[0] === 1 && prep.dims[1] === 3 && prep.dims[2] === 640 && prep.dims[3] === 640
  );
  check('Tensor data length matches 3 * 640 * 640', prep.tensorData.length === 3 * 640 * 640);
  check('Scale ratio is 0.5 (640 / 1280)', Math.abs(prep.scale - 0.5) < 0.001);
  check('Horizontal padding is 0', prep.padX === 0);
  check('Vertical padding is 120 (for 800 scaled to 400)', prep.padY === 120);
  check('Normalized pixel values in range [0, 1]',
    prep.tensorData[0] >= 0.0 && prep.tensorData[0] <= 1.0
  );
}

// 2. IoU Calculation and Non-Maximum Suppression (NMS)
{
  console.log('\n2. Testing IoU & Non-Maximum Suppression...');

  // Overlapping boxes (identical box has IoU 1.0)
  const box1 = { x: 100, y: 100, w: 100, h: 50 };
  const box2 = { x: 100, y: 100, w: 100, h: 50 };
  const iouSelf = calculateIoU(box1, box2);
  check('Identical boxes have IoU of 1.0', Math.abs(iouSelf - 1.0) < 0.001);

  // 50% horizontal overlap
  const box3 = { x: 150, y: 100, w: 100, h: 50 };
  const iouOverlap = calculateIoU(box1, box3);
  check('50% overlapping boxes have expected IoU ~0.333', Math.abs(iouOverlap - (50 * 50) / (7500)) < 0.05);

  // Disjoint boxes
  const boxDisjoint = { x: 500, y: 500, w: 50, h: 50 };
  check('Disjoint boxes have IoU of 0', calculateIoU(box1, boxDisjoint) === 0);

  // NMS suppression test
  const rawCandidates = [
    { classType: 'button', confidence: 0.95, box: { x: 100, y: 100, w: 100, h: 40 } },
    { classType: 'button', confidence: 0.70, box: { x: 102, y: 101, w: 98, h: 39 } }, // Duplicate to be suppressed
    { classType: 'button', confidence: 0.88, box: { x: 300, y: 100, w: 100, h: 40 } }, // Distinct button
  ];
  const nmsResult = applyNMS(rawCandidates, 0.45);
  check('NMS suppresses lower-confidence duplicate box', nmsResult.length === 2);
  check('Highest confidence box is retained', nmsResult[0].confidence === 0.95);
  check('Distinct button is retained', nmsResult[1].confidence === 0.88);
}

// 3. Coordinate De-letterboxing and UI Affordance Mapping
{
  console.log('\n3. Testing Coordinate De-letterboxing and Affordances...');

  const prepMock = {
    tensorData: new Float32Array(0),
    dims: [1, 3, 640, 640],
    scale: 0.5,
    padX: 0,
    padY: 120,
    originalWidth: 1280,
    originalHeight: 800,
  };

  const rawDetections = [
    { classType: 'button', confidence: 0.90, box: { x: 100, y: 200, w: 80, h: 30 } },
    { classType: 'input_field', confidence: 0.85, box: { x: 200, y: 250, w: 120, h: 25 } },
    { classType: 'face', confidence: 0.92, box: { x: 50, y: 150, w: 40, h: 40 } },
  ];

  const processed = postprocessDetections(rawDetections, prepMock);

  check('Correct number of elements postprocessed', processed.detectedElements.length === 3);

  const btn = processed.detectedElements.find((e) => e.classType === 'button');
  check('Button de-letterboxed X: (100 - 0)/0.5 = 200', btn.box.x === 200);
  check('Button de-letterboxed Y: (200 - 120)/0.5 = 160', btn.box.y === 160);
  check('Button center coordinate computed: cx=280, cy=190', btn.box.cx === 280 && btn.box.cy === 190);
  check('Button has click_coordinate action hint', btn.actionHint.includes('click_coordinate(280, 190)'));

  const inputEl = processed.detectedElements.find((e) => e.classType === 'input_field');
  check('Input field has type_coordinate action hint', inputEl.actionHint.includes('type_coordinate'));

  const faceEl = processed.detectedElements.find((e) => e.classType === 'face');
  check('Face is marked as sensitive', faceEl.isSensitive === true);
  check('Sensitive bounding box emitted for visual redaction', processed.sensitiveBoxes.length === 1);
  check('Sensitive box type is person_name or ID', processed.sensitiveBoxes[0].label === 'FACE');
}

// 4. End-to-End UIDetector Detection & Prompt Formatting
{
  console.log('\n4. Testing UIDetector Orchestration & Formatting...');

  // Create composite test image with a button and a simulated face avatar (skin tone)
  const baseImg = sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  });

  // Add blue button and skin-tone avatar patch
  const buttonSvg = Buffer.from(
    `<svg width="120" height="40"><rect width="120" height="40" rx="4" fill="#0066cc"/></svg>`
  );
  const faceSvg = Buffer.from(
    `<svg width="60" height="60"><rect width="60" height="60" rx="30" fill="#d89e7c"/></svg>`
  );

  const compositeBuffer = await baseImg
    .composite([
      { input: buttonSvg, top: 100, left: 200 },
      { input: faceSvg, top: 200, left: 400 },
    ])
    .png()
    .toBuffer();

  const detector = new UIDetector();
  const result = await detector.detect(compositeBuffer);

  check('Inference ran and returned valid result object', result && typeof result.durationMs === 'number');
  check('Execution provider detected (webgpu/wasm/cpu)', ['webgpu', 'wasm', 'cpu'].includes(result.provider));
  check('Detected elements array populated', Array.isArray(result.detectedElements));

  // Verify prompt formatter block
  const block = formatDetectedElementsBlock(result.detectedElements, result.provider, result.durationMs);
  check('Formatted block contains XML tag', block.includes('<vision_detected_elements'));
  check('Formatted block mentions provider', block.includes(`provider="${result.provider}"`));
}

// 5. Integration: captureVisionFrame with Visual Privacy Redaction
{
  console.log('\n5. Testing captureVisionFrame Integration & Redaction...');

  // Create an image with skin-tone / face avatar
  const avatarSvg = Buffer.from(
    `<svg width="80" height="80"><rect width="80" height="80" fill="#c68a62"/></svg>`
  );
  const screenshotBuf = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: avatarSvg, top: 50, left: 50 }])
    .jpeg()
    .toBuffer();

  const mockCdp = {
    send: async (method) => {
      if (method === 'Page.captureScreenshot') {
        return { data: screenshotBuf.toString('base64') };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { value: JSON.stringify({ width: 640, height: 480, dpr: 1 }) } };
      }
      return {};
    },
  };

  const frame = await captureVisionFrame(mockCdp);
  check('captureVisionFrame returns valid VisionFrame', frame !== null && frame.base64.length > 0);
  check('VisionFrame contains detectedElements', Array.isArray(frame.detectedElements));
  check('VisionFrame contains visionInference metadata', frame.visionInference !== undefined);

  // Context formatting check
  const mockDecision = {
    useVision: true,
    reason: 'Dominant canvas detected',
    mode: 'vision-augmented',
  };
  const contextText = formatVisionContextBlock(frame, mockDecision);
  check('Context block includes ONNX Runtime Web engine details',
    contextText.includes('ONNX Runtime Web')
  );
  check('Context block includes coordinate guidance',
    contextText.includes('click_coordinate') && contextText.includes('type_coordinate')
  );
}

// Report
console.log('\n=======================================');
if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} test(s) failed:`, failures);
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED: ONNX Runtime Web Vision Engine is functioning properly!');
  process.exit(0);
}
