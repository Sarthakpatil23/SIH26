// Image Preprocessing Pipeline for ONNX Vision Models
// Performs letterbox resize, RGB normalization [0, 1], and NCHW tensor conversion.

import type { PreprocessedImage } from './types.js';

export interface PreprocessOptions {
  targetWidth?: number;
  targetHeight?: number;
}

/** Preprocess an image buffer into a normalized NCHW Float32Array tensor. */
export async function preprocessImageForONNX(
  imageInput: Buffer | string,
  options: PreprocessOptions = {}
): Promise<PreprocessedImage> {
  const targetW = options.targetWidth || 640;
  const targetH = options.targetHeight || 640;

  const inputBuffer = Buffer.isBuffer(imageInput)
    ? imageInput
    : Buffer.from(imageInput, 'base64');

  const sharpModule = await import('sharp');
  const sharp = (sharpModule.default || sharpModule) as typeof import('sharp');

  const image = sharp(inputBuffer);
  const meta = await image.metadata();
  const origW = meta.width || targetW;
  const origH = meta.height || targetH;

  // Letterbox scaling: preserve aspect ratio
  const scale = Math.min(targetW / origW, targetH / origH);
  const scaledW = Math.round(origW * scale);
  const scaledH = Math.round(origH * scale);
  const padX = Math.floor((targetW - scaledW) / 2);
  const padY = Math.floor((targetH - scaledH) / 2);

  // Resize and composite onto letterbox canvas (standard 114 gray background for YOLO/SSD)
  const resizedBuffer = await sharp(inputBuffer)
    .resize(scaledW, scaledH, { fit: 'inside' })
    .extend({
      top: padY,
      bottom: targetH - scaledH - padY,
      left: padX,
      right: targetW - scaledW - padX,
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  // Convert HWC uint8 RGB to NCHW Float32Array
  const totalPixels = targetW * targetH;
  const tensorData = new Float32Array(3 * totalPixels);

  const rOffset = 0;
  const gOffset = totalPixels;
  const bOffset = 2 * totalPixels;

  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 3;
    tensorData[rOffset + i] = resizedBuffer[srcIdx] / 255.0;
    tensorData[gOffset + i] = resizedBuffer[srcIdx + 1] / 255.0;
    tensorData[bOffset + i] = resizedBuffer[srcIdx + 2] / 255.0;
  }

  return {
    tensorData,
    dims: [1, 3, targetH, targetW],
    scale,
    padX,
    padY,
    originalWidth: origW,
    originalHeight: origH,
  };
}
