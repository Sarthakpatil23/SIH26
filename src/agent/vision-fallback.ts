// Generic DOM-First, Vision-Fallback Architecture
//
// Evaluates DOM sufficiency dynamically for every turn.
// If the DOM is sufficient (standard HTML pages), Browy remains 100% DOM-first (fast, low-token, indexed).
// If the DOM is insufficient (canvas-heavy like Google Sheets/Figma, inaccessible SVG, or failed DOM actions),
// this engine triggers vision fallback, captures a high-efficiency screenshot, and formats combined context.

import type { PageSnapshot, DomSufficiencyReport } from './page-snapshot.js';
import type { ToolCallRecord } from '../types.js';

export interface VisionDecision {
  useVision: boolean;
  reason: string;
  mode: 'dom-only' | 'vision-augmented' | 'vision-only';
  domSufficiency?: DomSufficiencyReport;
}

export interface VisionFrame {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  dpr: number;
  capturedAt: number;
}

interface CdpLike {
  send: (method: string, params?: unknown) => Promise<unknown>;
}

/** Regex patterns indicating user intent that typically relies on visual / spatial rendering. */
const VISUAL_INTENT_PATTERNS = [
  /\b(cell\s+[a-z]{1,3}\d{1,5})\b/i,          // e.g. "cell A1", "cell B5"
  /\b(spreadsheet|sheet\s+grid)\b/i,           // spreadsheets
  /\b(canvas|board|artboard|drawing)\b/i,      // canvas apps (Figma, Canva, Excalidraw)
  /\b(look\s+at\s+(the\s+)?(screen|page|image)|screenshot)\b/i,
  /\b(what\s+color|visual(ly)?|diagram|chart|graph)\b/i,
  /\b(click\s+(at|on)\s+coordinates?)\b/i,
];

export interface ActionRecordLike {
  name: string;
  result?: string;
  ok?: boolean;
}

/**
 * Universal evaluator: checks whether DOM context is sufficient or if vision fallback is needed.
 */
export function evaluateDomSufficiency(
  snapshot?: PageSnapshot | null,
  userPrompt?: string,
  lastActions?: ActionRecordLike[] | ToolCallRecord[],
): VisionDecision {
  if (!snapshot) {
    return {
      useVision: true,
      reason: 'No DOM snapshot available',
      mode: 'vision-augmented',
    };
  }

  const sufficiency = snapshot.sufficiency;
  const promptText = userPrompt || '';

  // 1. Structural DOM check: Dominant Canvas (Google Sheets, Figma, Canva, WebGL, Games)
  if (sufficiency?.hasDominantCanvas && (sufficiency.canvasCoverageRatio >= 0.25)) {
    // If the canvas covers significant screen area and interactive elements are mostly in toolbars
    const coveragePct = Math.round(sufficiency.canvasCoverageRatio * 100);
    return {
      useVision: true,
      reason: `Page is dominated by <canvas> (${coveragePct}% of viewport). Interactive content is rendered visually.`,
      mode: 'vision-augmented',
      domSufficiency: sufficiency,
    };
  }

  // 2. Action Failure / Stuck in DOM: Recent indexed action failed on DOM
  if (lastActions && lastActions.length > 0) {
    const recent = lastActions.slice(-2);
    const hasDomFailure = recent.some((a) => {
      const isErr = /error|not found|stale/i.test(a.result || '');
      const isDomTool = ['click_index', 'type_index', 'select_index', 'fill_form'].includes(a.name);
      return isDomTool && isErr;
    });

    if (hasDomFailure && (snapshot.stats.canvasCount || 0) > 0) {
      return {
        useVision: true,
        reason: 'Recent DOM action failed and canvas elements are present. Falling back to visual analysis.',
        mode: 'vision-augmented',
        domSufficiency: sufficiency,
      };
    }
  }

  // 3. Visual Intent check: User explicitly refers to visual-only targets (e.g. "cell A1" in Sheets)
  for (const pattern of VISUAL_INTENT_PATTERNS) {
    if (pattern.test(promptText)) {
      return {
        useVision: true,
        reason: `User intent requires visual analysis: matches "${promptText.slice(0, 50)}"`,
        mode: 'vision-augmented',
        domSufficiency: sufficiency,
      };
    }
  }

  // 4. Inaccessible or Empty DOM
  if (sufficiency && !sufficiency.isSufficient) {
    return {
      useVision: true,
      reason: sufficiency.reasons.join('; ') || 'DOM actionability score is low.',
      mode: 'vision-augmented',
      domSufficiency: sufficiency,
    };
  }

  // DOM is healthy, rich, and sufficient! Use fast, token-efficient DOM-only path.
  return {
    useVision: false,
    reason: 'DOM provides complete, structured interactive coverage.',
    mode: 'dom-only',
    domSufficiency: sufficiency,
  };
}

/**
 * Capture a visual screenshot frame via CDP and measure viewport metrics.
 * Uses JPEG quality 85 for high fidelity with compact byte size (~120KB vs 2MB PNG).
 */
export async function captureVisionFrame(
  cdp: CdpLike,
  opts?: { quality?: number; format?: 'jpeg' | 'png' },
): Promise<VisionFrame | null> {
  try {
    const format = opts?.format || 'jpeg';
    const quality = opts?.quality ?? 85;

    const [screenshotResult, metricsResult] = await Promise.all([
      cdp.send('Page.captureScreenshot', {
        format,
        quality: format === 'jpeg' ? quality : undefined,
      }) as Promise<{ data: string }>,
      cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          width: window.innerWidth || document.documentElement?.clientWidth || 1280,
          height: window.innerHeight || document.documentElement?.clientHeight || 800,
          dpr: window.devicePixelRatio || 1
        })`,
        returnByValue: true,
      }) as Promise<{ result?: { value?: string } }>,
    ]);

    const metrics = JSON.parse(String(metricsResult?.result?.value ?? '{"width":1280,"height":800,"dpr":1}'));

    return {
      base64: screenshotResult.data,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      width: Number(metrics.width) || 1280,
      height: Number(metrics.height) || 800,
      dpr: Number(metrics.dpr) || 1,
      capturedAt: Date.now(),
    };
  } catch (err) {
    return null;
  }
}

/**
 * Format the <vision_context> prompt block to inform the model about visual coordinates
 * and how to combine DOM reasoning with Vision reasoning.
 */
export function formatVisionContextBlock(frame: VisionFrame, decision: VisionDecision): string {
  const lines: string[] = [
    '<vision_context>',
    `Resolution: ${frame.width}x${frame.height} px (Device Pixel Ratio: ${frame.dpr})`,
    `Reason for vision fallback: ${decision.reason}`,
    '',
    '## COMBINED DOM + VISION INSTRUCTIONS:',
    '1. A visual screenshot of the current viewport is attached to this turn.',
    `2. Viewport coordinate system: (0, 0) is top-left, (${frame.width}, ${frame.height}) is bottom-right.`,
    '3. For standard HTML controls (e.g. top menu bars, formula input, tab bar), USE the indexed DOM tools (click_index, type_index) from <page_snapshot>.',
    '4. For canvas regions, spreadsheet cells (e.g. cell A1, B2), shapes, or visual graphics NOT indexed in the DOM, USE coordinate tools:',
    '   - click_coordinate(x, y): click or double-click exact pixel coordinates.',
    '   - type_coordinate(x, y, text): focus coordinate and type text (ideal for spreadsheet cells).',
    '   - drag_coordinate(fromX, fromY, toX, toY): drag across visual coordinates.',
    '</vision_context>',
  ];
  return lines.join('\n');
}
