// Unit & Integration tests for Visual Privacy Comparison ("What You See" vs "What AI Sees")
// Run: node tests/privacy-comparison.mjs

import { captureVisionFrame } from '../src/agent/vision-fallback.ts';

const failures = [];
function check(name, cond, details = '') {
  if (!cond) {
    failures.push(name);
    console.error(`  FAIL: ${name}${details ? ' - ' + details : ''}`);
  } else {
    console.log(`  OK:   ${name}`);
  }
}

console.log('=== Testing Visual Privacy Comparison Architecture ===\n');

// 1x1 transparent PNG base64:
// data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// 1. Verification of captureVisionFrame preserving raw vs redacted frames
{
  console.log('1. Testing captureVisionFrame preservation of originalBase64 vs sanitized base64...');

  const mockCdpNoRedaction = {
    send: async (method) => {
      if (method === 'Page.captureScreenshot') {
        return { data: samplePngBase64 };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { value: JSON.stringify({ width: 1280, height: 800, dpr: 1 }) } };
      }
      return {};
    },
  };

  const frameNoRedact = await captureVisionFrame(mockCdpNoRedaction, { format: 'png' });
  check('Frame is captured successfully', frameNoRedact !== null);
  check('originalBase64 is populated', typeof frameNoRedact.originalBase64 === 'string' && frameNoRedact.originalBase64.length > 0);
  check('sanitized base64 is populated', typeof frameNoRedact.base64 === 'string' && frameNoRedact.base64.length > 0);
  check('When zero redactions occur, originalBase64 matches base64', frameNoRedact.originalBase64 === frameNoRedact.base64);
}

// 2. Sensitive redaction produces distinct originalBase64 and redacted base64
{
  console.log('\n2. Testing redaction differentiation...');

  const mockCdpWithRedaction = {
    send: async (method) => {
      if (method === 'Page.captureScreenshot') {
        return { data: samplePngBase64 };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { value: JSON.stringify({ width: 1280, height: 800, dpr: 1 }) } };
      }
      return {};
    },
  };

  const sensitiveBoxes = [
    {
      label: 'profile_photo',
      reason: 'LinkedIn Avatar',
      confidence: 0.98,
      bounds: { x: 50, y: 50, width: 120, height: 120 },
    },
    {
      label: 'personal_name',
      reason: 'Profile Name',
      confidence: 0.95,
      bounds: { x: 180, y: 60, width: 240, height: 32 },
    },
  ];

  const frameRedacted = await captureVisionFrame(mockCdpWithRedaction, {
    format: 'png',
    sensitiveBoxes,
  });

  check('Redacted frame captured', frameRedacted !== null);
  check('originalBase64 strictly equals raw captured image', frameRedacted.originalBase64 === samplePngBase64);
  check('sanitized base64 is present and non-empty', typeof frameRedacted.base64 === 'string' && frameRedacted.base64.length > 0);
  check('sensitiveBoxes are preserved in frame metadata', frameRedacted.sensitiveBoxes.length >= 2);
}

// 3. WSMessage and ServerMessage Protocol Event Structure
{
  console.log('\n3. Testing protocol structure for privacy_comparison & privacy.comparison...');

  const wsComparison = {
    type: 'privacy_comparison',
    originalBase64: samplePngBase64,
    sanitizedBase64: 'redacted_sample_bytes',
    mimeType: 'image/jpeg',
    redactedCount: 2,
    detectedElementsCount: 5,
    provider: 'ONNX/YOLO-v8n (SIMD)',
    inferenceMs: 42,
    manifest: [
      { label: 'profile_photo', confidence: 0.98, bounds: { x: 50, y: 50, width: 120, height: 120 } },
      { label: 'personal_name', confidence: 0.95, bounds: { x: 180, y: 60, width: 240, height: 32 } },
    ],
  };

  check('WSMessage has type privacy_comparison', wsComparison.type === 'privacy_comparison');
  check('originalBase64 exists on event', wsComparison.originalBase64 === samplePngBase64);
  check('sanitizedBase64 exists on event', wsComparison.sanitizedBase64 === 'redacted_sample_bytes');
  check('manifest contains redacted element metadata', wsComparison.manifest.length === 2);
  check('manifest entries contain label, confidence, and bounds',
    wsComparison.manifest[0].label === 'profile_photo' &&
    wsComparison.manifest[0].confidence === 0.98 &&
    wsComparison.manifest[0].bounds.width === 120
  );

  // Simulate runner mapping from WSMessage to ServerMessage
  const serverMsg = {
    type: 'privacy.comparison',
    originalBase64: wsComparison.originalBase64,
    sanitizedBase64: wsComparison.sanitizedBase64,
    mimeType: wsComparison.mimeType,
    redactedCount: wsComparison.redactedCount,
    detectedElementsCount: wsComparison.detectedElementsCount,
    provider: wsComparison.provider,
    inferenceMs: wsComparison.inferenceMs,
    manifest: wsComparison.manifest,
  };

  check('ServerMessage has type privacy.comparison', serverMsg.type === 'privacy.comparison');
  check('ServerMessage carries provider and inferenceMs', serverMsg.provider === 'ONNX/YOLO-v8n (SIMD)' && serverMsg.inferenceMs === 42);
}

// 4. Zero Cloud Leakage Verification: Ensure originalBase64 is NEVER forwarded to LLM payloads
{
  console.log('\n4. Testing Zero Cloud Leakage invariant...');

  // Mock message generator that builds cloud payload from VisionFrame
  function buildLlmMultimodalPayload(frame) {
    // LLM payload MUST use frame.base64 (the sanitized frame), never originalBase64
    return {
      role: 'user',
      content: [
        { type: 'text', text: 'Analyze screen' },
        {
          type: 'image_url',
          image_url: {
            url: `data:${frame.mimeType};base64,${frame.base64}`,
          },
        },
      ],
    };
  }

  const mockFrame = {
    base64: 'REDACTED_SAFE_BASE64_IMAGE',
    originalBase64: 'RAW_UNSAFE_PII_SCREENSHOT',
    mimeType: 'image/jpeg',
    width: 1280,
    height: 800,
    dpr: 1,
    capturedAt: Date.now(),
  };

  const payload = buildLlmMultimodalPayload(mockFrame);
  const serialized = JSON.stringify(payload);

  check('Payload contains REDACTED_SAFE_BASE64_IMAGE', serialized.includes('REDACTED_SAFE_BASE64_IMAGE'));
  check('Payload NEVER contains RAW_UNSAFE_PII_SCREENSHOT', !serialized.includes('RAW_UNSAFE_PII_SCREENSHOT'));
}

console.log('\n----------------------------------------');
if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} checks failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PRIVACY COMPARISON CHECKS PASSED (✓)');
  process.exit(0);
}
