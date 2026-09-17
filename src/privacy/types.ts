// Core types for client-side Privacy-Preserving Filter and Redaction Engine

export type PiiType =
  | 'email'
  | 'phone'
  | 'credit_card'
  | 'password'
  | 'ssn'
  | 'aadhaar'
  | 'pan'
  | 'auth_token'
  | 'person_name'
  | 'address'
  | 'financial';

export interface PiiMatch {
  type: PiiType;
  raw: string;
  placeholder: string;
  start: number;
  end: number;
  confidence: number;
}

export interface SensitiveBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  type: PiiType;
  label: string;
  elementIndex?: number;
  coordType?: 'css' | 'image';
}

export interface RedactionManifest {
  totalRedacted: number;
  types: Record<string, number>;
  boxes: SensitiveBoundingBox[];
  timestamp: number;
}

export interface SanitizedContext {
  sanitizedText: string;
  manifest: RedactionManifest;
  isClean: boolean;
}

export interface ElementPrivacyInspection {
  isSensitive: boolean;
  type?: PiiType;
  placeholder?: string;
  sanitizedValue?: string;
  sanitizedText?: string;
  sanitizedPlaceholder?: string;
  sanitizedAriaLabel?: string;
}
