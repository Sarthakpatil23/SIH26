// Type definitions for Local Vision Engine (ONNX Runtime Web)

import type { SensitiveBoundingBox } from '../privacy/types.js';

export type DetectedUIClass =
  | 'button'
  | 'input_field'
  | 'checkbox'
  | 'form'
  | 'container'
  | 'face'
  | 'id_card'
  | 'credit_card'
  | 'text_block';

export interface VisionBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  normalized?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface DetectedElement {
  id: string;
  classType: DetectedUIClass;
  confidence: number;
  box: VisionBoundingBox;
  label?: string;
  actionHint: string;
  isSensitive: boolean;
}

export interface PreprocessedImage {
  tensorData: Float32Array;
  dims: [number, number, number, number]; // [1, 3, targetH, targetW]
  scale: number;
  padX: number;
  padY: number;
  originalWidth: number;
  originalHeight: number;
}

export interface VisionInferenceResult {
  provider: 'webgpu' | 'wasm' | 'cpu';
  durationMs: number;
  detectedElements: DetectedElement[];
  sensitiveBoxes: SensitiveBoundingBox[];
  rawDetectionsCount: number;
}

export interface RawDetection {
  classType: DetectedUIClass;
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
}
