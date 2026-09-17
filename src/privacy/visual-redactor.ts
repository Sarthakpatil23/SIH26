// Dynamic Local Visual Redaction Engine
// Physically obscures sensitive bounding boxes on screenshot frames before network dispatch.

import type { SensitiveBoundingBox } from './types.js';

export interface VisualRedactionOptions {
  base64: string;
  mimeType?: string;
  viewportWidth: number;
  viewportHeight: number;
  dpr?: number;
  boxes: SensitiveBoundingBox[];
}

export interface VisualRedactionResult {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  redactedBoxesCount: number;
  durationMs: number;
}

/** Redact sensitive bounding boxes from a screenshot buffer using local sharp rendering. */
export async function redactVisualFrame(options: VisualRedactionOptions): Promise<VisualRedactionResult> {
  const t0 = Date.now();
  const {
    base64,
    mimeType = 'image/jpeg',
    viewportWidth,
    viewportHeight,
    boxes,
  } = options;

  if (!boxes || boxes.length === 0) {
    return {
      base64,
      mimeType,
      width: viewportWidth,
      height: viewportHeight,
      redactedBoxesCount: 0,
      durationMs: Date.now() - t0,
    };
  }

  try {
    // Dynamic require for sharp to be safe in environments where sharp is optional
    const sharpModule = await import('sharp');
    const sharp = (sharpModule.default || sharpModule) as typeof import('sharp');

    const inputBuffer = Buffer.from(base64, 'base64');
    const image = sharp(inputBuffer);
    const meta = await image.metadata();

    const imgW = meta.width || viewportWidth;
    const imgH = meta.height || viewportHeight;

    // Calculate scale factor between viewport CSS coordinates and actual screenshot pixels
    const scaleX = imgW / Math.max(1, viewportWidth);
    const scaleY = imgH / Math.max(1, viewportHeight);

    // Build SVG overlay containing opaque redaction masks and labels
    const svgElements: string[] = [];

    for (const b of boxes) {
      // If box is already in physical image coordinates (from vision model), don't scale again
      const isImgCoords = (b as any).coordType === 'image' || (b.x > viewportWidth || b.w > viewportWidth);
      const sx = isImgCoords ? 1 : scaleX;
      const sy = isImgCoords ? 1 : scaleY;

      // Add a clean 4px padding so sensitive borders/glyphs are 100% enveloped
      const pad = 4;
      const rawX = b.x * sx;
      const rawY = b.y * sy;
      const rawW = b.w * sx;
      const rawH = b.h * sy;

      const x = Math.max(0, Math.round(rawX - pad));
      const y = Math.max(0, Math.round(rawY - pad));
      const w = Math.min(imgW - x, Math.round(rawW + pad * 2));
      const h = Math.min(imgH - y, Math.round(rawH + pad * 2));

      if (w <= 2 || h <= 2) continue;

      const resolvedLabel = (b.label || (b.type === 'person_name' ? 'NAME' : b.type) || 'PII').toUpperCase();
      const labelText = `[REDACTED: ${resolvedLabel}]`;
      const fontSize = Math.max(9, Math.min(13, Math.round(h * 0.55)));
      const textY = Math.round(y + (h / 2) + (fontSize * 0.35));
      const textX = Math.round(x + Math.max(6, w * 0.05));

      // Draw background opaque mask
      svgElements.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#0f172a" stroke="#ef4444" stroke-width="2" />`
      );

      // Draw semantic label if height allows
      if (h >= 14 && w >= 50) {
        svgElements.push(
          `<text x="${textX}" y="${textY}" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="600" letter-spacing="0.5">${escapeXml(labelText)}</text>`
        );
      }
    }

    if (svgElements.length === 0) {
      return {
        base64,
        mimeType,
        width: imgW,
        height: imgH,
        redactedBoxesCount: 0,
        durationMs: Date.now() - t0,
      };
    }

    const svgOverlay = `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">${svgElements.join('')}</svg>`;
    const isPng = (mimeType || '').includes('png') || meta.format === 'png';
    const pipeline = image.composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }]);
    const outputBuffer = isPng
      ? await pipeline.png({ compressionLevel: 6 }).toBuffer()
      : await pipeline.jpeg({ quality: 95 }).toBuffer();

    return {
      base64: outputBuffer.toString('base64'),
      mimeType: isPng ? 'image/png' : 'image/jpeg',
      width: imgW,
      height: imgH,
      redactedBoxesCount: Math.round(svgElements.length / 2),
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    // If sharp fails or is not available, fail-safe: return unredacted or minimal frame
    console.warn('[browy-privacy] visual redaction failed soft:', err);
    return {
      base64,
      mimeType,
      width: viewportWidth,
      height: viewportHeight,
      redactedBoxesCount: 0,
      durationMs: Date.now() - t0,
    };
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
