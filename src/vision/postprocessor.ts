// Postprocessing Pipeline for ONNX Vision Models
// Performs Non-Maximum Suppression (NMS), coordinate de-letterboxing, and UI/PII classification.

import type {
  RawDetection,
  DetectedElement,
  PreprocessedImage,
} from './types.js';
import type { SensitiveBoundingBox } from '../privacy/types.js';

export interface PostprocessOptions {
  confidenceThreshold?: number;
  iouThreshold?: number;
}

/** Calculate Intersection-over-Union (IoU) between two bounding boxes. */
export function calculateIoU(
  boxA: { x: number; y: number; w: number; h: number },
  boxB: { x: number; y: number; w: number; h: number }
): number {
  const x1 = Math.max(boxA.x, boxB.x);
  const y1 = Math.max(boxA.y, boxB.y);
  const x2 = Math.min(boxA.x + boxA.w, boxB.x + boxB.w);
  const y2 = Math.min(boxA.y + boxA.h, boxB.y + boxB.h);

  const intersectionW = Math.max(0, x2 - x1);
  const intersectionH = Math.max(0, y2 - y1);
  const intersectionArea = intersectionW * intersectionH;

  const areaA = boxA.w * boxA.h;
  const areaB = boxB.w * boxB.h;
  const unionArea = areaA + areaB - intersectionArea;

  if (unionArea <= 0) return 0;
  return intersectionArea / unionArea;
}

/** Non-Maximum Suppression (NMS) to eliminate duplicate overlapping bounding boxes. */
export function applyNMS(
  detections: RawDetection[],
  iouThreshold = 0.45
): RawDetection[] {
  // Sort by confidence descending
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const selected: RawDetection[] = [];

  for (const candidate of sorted) {
    let keep = true;
    for (const prev of selected) {
      if (candidate.classType === prev.classType || isBothSensitive(candidate.classType, prev.classType)) {
        if (calculateIoU(candidate.box, prev.box) > iouThreshold) {
          keep = false;
          break;
        }
      }
    }
    if (keep) {
      selected.push(candidate);
    }
  }

  return selected;
}

function isBothSensitive(a: string, b: string): boolean {
  const sensitiveSet = new Set(['face', 'id_card', 'credit_card']);
  return sensitiveSet.has(a) && sensitiveSet.has(b);
}

/** Postprocess raw tensor detections into mapped UI elements and sensitive redaction boxes. */
export function postprocessDetections(
  rawDetections: RawDetection[],
  prep: PreprocessedImage,
  options: PostprocessOptions = {}
): {
  detectedElements: DetectedElement[];
  sensitiveBoxes: SensitiveBoundingBox[];
} {
  const confThreshold = options.confidenceThreshold ?? 0.35;
  const iouThreshold = options.iouThreshold ?? 0.45;

  // 1. Filter by minimum confidence
  const confident = rawDetections.filter((d) => d.confidence >= confThreshold);

  // 2. Apply NMS
  const nmsFiltered = applyNMS(confident, iouThreshold);

  const detectedElements: DetectedElement[] = [];
  const sensitiveBoxes: SensitiveBoundingBox[] = [];

  let elementCounter = 1;

  for (const det of nmsFiltered) {
    // Reverse letterbox coordinate transformation
    const xInOrig = (det.box.x - prep.padX) / prep.scale;
    const yInOrig = (det.box.y - prep.padY) / prep.scale;
    const wInOrig = det.box.w / prep.scale;
    const hInOrig = det.box.h / prep.scale;

    // Clamp to original viewport boundaries
    const clampedX = Math.max(0, Math.min(prep.originalWidth, Math.round(xInOrig)));
    const clampedY = Math.max(0, Math.min(prep.originalHeight, Math.round(yInOrig)));
    const clampedW = Math.max(1, Math.min(prep.originalWidth - clampedX, Math.round(wInOrig)));
    const clampedH = Math.max(1, Math.min(prep.originalHeight - clampedY, Math.round(hInOrig)));

    const cx = Math.round(clampedX + clampedW / 2);
    const cy = Math.round(clampedY + clampedH / 2);

    const isSensitive = det.classType === 'face' || det.classType === 'id_card' || det.classType === 'credit_card';

    // Build action hint based on class type
    let actionHint = '';
    if (det.classType === 'button' || det.classType === 'checkbox') {
      actionHint = `click_coordinate(${cx}, ${cy})`;
    } else if (det.classType === 'input_field') {
      actionHint = `type_coordinate(${cx}, ${cy}, text)`;
    } else if (det.classType === 'form' || det.classType === 'container') {
      actionHint = `container_region`;
    }

    const detectedItem: DetectedElement = {
      id: `UI_${elementCounter++}`,
      classType: det.classType,
      confidence: Math.round(det.confidence * 100) / 100,
      box: {
        x: clampedX,
        y: clampedY,
        w: clampedW,
        h: clampedH,
        cx,
        cy,
        normalized: {
          x: Math.round((clampedX / prep.originalWidth) * 1000) / 1000,
          y: Math.round((clampedY / prep.originalHeight) * 1000) / 1000,
          w: Math.round((clampedW / prep.originalWidth) * 1000) / 1000,
          h: Math.round((clampedH / prep.originalHeight) * 1000) / 1000,
        },
      },
      actionHint,
      isSensitive,
    };

    detectedElements.push(detectedItem);

    // If sensitive, emit sensitive bounding box for immediate visual redaction
    if (isSensitive) {
      sensitiveBoxes.push({
        x: clampedX,
        y: clampedY,
        w: clampedW,
        h: clampedH,
        type: det.classType === 'face' ? 'person_name' : (det.classType === 'credit_card' ? 'credit_card' : 'ssn'),
        label: det.classType.toUpperCase(),
        coordType: 'image',
      });
    }
  }

  return { detectedElements, sensitiveBoxes };
}
