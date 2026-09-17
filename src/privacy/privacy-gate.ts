// Pre-Flight Privacy Firewall Gatekeeper
// Certifies that outbound payloads to remote LLMs/VLMs contain zero unredacted PII.
// Appends structural <redaction_manifest> metadata for the remote reasoning engine.

import type { SensitiveBoundingBox, RedactionManifest } from './types.js';
import { redactText } from './pii-detector.js';

export interface GateCertificationResult {
  certifiedPrompt: string;
  manifest: RedactionManifest;
  interceptedCount: number;
  isClean: boolean;
}

export class PrivacyGate {
  /**
   * Certify an outgoing text prompt before transmission.
   * Scans for any raw PII leakage, redacts residual secrets, and injects the redaction manifest.
   */
  static certifyPayload(
    prompt: string,
    boxes: SensitiveBoundingBox[] = []
  ): GateCertificationResult {
    const { sanitized, matches } = redactText(prompt);

    // Compile breakdown of redacted types
    const typesCount: Record<string, number> = {};
    for (const m of matches) {
      typesCount[m.type] = (typesCount[m.type] || 0) + 1;
    }
    for (const b of boxes) {
      typesCount[b.type] = (typesCount[b.type] || 0) + 1;
    }

    const totalRedacted = matches.length + boxes.length;

    const manifest: RedactionManifest = {
      totalRedacted,
      types: typesCount,
      boxes,
      timestamp: Date.now(),
    };

    let certifiedPrompt = sanitized;

    // If sensitive data was redacted, append the explicit redaction manifest so the server AI is aware
    if (totalRedacted > 0) {
      const manifestBlock = PrivacyGate.formatManifestBlock(manifest);
      certifiedPrompt = `${certifiedPrompt}\n\n${manifestBlock}`;
    }

    return {
      certifiedPrompt,
      manifest,
      interceptedCount: matches.length,
      isClean: matches.length === 0,
    };
  }

  /**
   * Format the <redaction_manifest> block to instruct the server-side AI model
   * on how to reason about sanitized placeholders.
   */
  static formatManifestBlock(manifest: RedactionManifest): string {
    const lines: string[] = [
      '<redaction_manifest status="active" redacted_items="' + manifest.totalRedacted + '">',
      '## PRIVACY-PRESERVING FILTER NOTICE:',
      '1. Sensitive personal data (PII) on this screen has been REDACTED LOCALLY before transmission.',
      '2. Semantic placeholders like [EMAIL], [PASSWORD], [CARD_NUMBER], [PHONE], [GOV_ID], [NAME] mark sensitive fields.',
      '3. In visual screenshots, sensitive regions are masked with [REDACTED: TYPE] overlays.',
      '4. INSTRUCTIONS FOR REASONING:',
      '   - Treat placeholders as valid inputs/values for reasoning.',
      '   - To interact with a redacted element, target its indexed identifier (e.g. click_index, type_index) or coordinates.',
      '   - You DO NOT need real credentials to plan actions (e.g. focus and click submit on [PASSWORD_FIELD]).',
      '</redaction_manifest>',
    ];
    return lines.join('\n');
  }
}
