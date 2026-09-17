// UI and Visual Privacy Detector Orchestrator
// Coordinates preprocessing, ONNX Runtime Web model execution, NMS, and detection formatting.

import { preprocessImageForONNX } from './preprocessor.js';
import { postprocessDetections } from './postprocessor.js';
import { ONNXRuntimeVisionEngine, type ONNXEngineConfig } from './onnx-engine.js';
import type { VisionInferenceResult, DetectedElement } from './types.js';

export interface DetectionOptions {
  confidenceThreshold?: number;
  iouThreshold?: number;
}

export class UIDetector {
  private engine: ONNXRuntimeVisionEngine;

  constructor(config?: ONNXEngineConfig) {
    this.engine = new ONNXRuntimeVisionEngine(config);
  }

  /** Run visual detection on an image buffer or base64 string. */
  async detect(
    imageInput: Buffer | string,
    options: DetectionOptions = {}
  ): Promise<VisionInferenceResult> {
    const t0 = Date.now();

    // 1. Preprocess into normalized NCHW tensor
    const prep = await preprocessImageForONNX(imageInput);

    // 2. Run ONNX Runtime Web session (WebGPU / WASM SIMD / edge feature extractor)
    const { rawDetections, durationMs: inferDurationMs } = await this.engine.runInference(prep);

    // 3. Postprocess: IoU + NMS + viewport coordinate de-letterboxing
    const { detectedElements, sensitiveBoxes } = postprocessDetections(rawDetections, prep, options);

    const totalDurationMs = Date.now() - t0;

    return {
      provider: this.engine.getProvider(),
      durationMs: totalDurationMs,
      detectedElements,
      sensitiveBoxes,
      rawDetectionsCount: rawDetections.length,
    };
  }

  getProvider(): 'webgpu' | 'wasm' | 'cpu' {
    return this.engine.getProvider();
  }
}

// Global detector singleton
let globalDetector: UIDetector | null = null;

export function getUIDetector(config?: ONNXEngineConfig): UIDetector {
  if (!globalDetector) {
    globalDetector = new UIDetector(config);
  }
  return globalDetector;
}

/** Format detected elements for injection into the agent's LLM prompt. */
export function formatDetectedElementsBlock(
  elements: DetectedElement[],
  provider: string,
  durationMs: number
): string {
  if (!elements || elements.length === 0) {
    return `<vision_detected_elements provider="${provider}" count="0" inference_ms="${durationMs}" />`;
  }

  const lines: string[] = [
    `<vision_detected_elements provider="${provider}" count="${elements.length}" inference_ms="${durationMs}">`,
    '  <!-- Visually detected interactive UI controls on canvas/viewport (exact pixel coordinates) -->',
  ];

  for (const el of elements) {
    const { id, classType, confidence, box, actionHint, isSensitive } = el;
    const sensitiveFlag = isSensitive ? ' [PROTECTED_PII]' : '';
    lines.push(
      `  - [${id}] ${classType} (conf: ${confidence})${sensitiveFlag} at [x:${box.x}, y:${box.y}, w:${box.w}, h:${box.h}] center:(${box.cx}, ${box.cy}) -> Action: ${actionHint}`
    );
  }

  lines.push('</vision_detected_elements>');
  return lines.join('\n');
}
