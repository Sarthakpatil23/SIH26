// Multi-method Client-Side PII and Sensitive Data Detector
// Inspects DOM attributes, applies regex/heuristic rules, and validates algorithms (e.g. Luhn for credit cards).

import type { PiiType, PiiMatch, ElementPrivacyInspection } from './types.js';

// ── Luhn Algorithm for Credit Card Validation ─────────────────────────────
export function isValidLuhn(digitsOnly: string): boolean {
  if (!digitsOnly || digitsOnly.length < 13 || digitsOnly.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let digit = parseInt(digitsOnly.charAt(i), 10);
    if (isNaN(digit)) return false;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// ── Pattern Detectors ──────────────────────────────────────────────────────
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Credit card formats: 13-19 digits with optional spaces or dashes
const CREDIT_CARD_CANDIDATE_REGEX = /\b(?:\d[ -]?){13,19}\b/g;

// Indian Aadhaar: 12 digits, starts with 2-9, typically 4-4-4
const AADHAAR_REGEX = /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g;

// Indian PAN: 5 uppercase letters, 4 digits, 1 uppercase letter
const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g;

// US SSN: 3-2-4 digits with dashes or spaces
const SSN_REGEX = /\b(?!000|666|9\d{2})\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g;

// Phone numbers: international + national formats
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b|(?:\+?91[-.\s]?)?[6-9]\d{9}\b/g;

// Auth Tokens, JWTs, API Keys, Private Keys
const JWT_REGEX = /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]*\b/g;
const OPENAI_KEY_REGEX = /\bsk-[A-Za-z0-9]{20,}\b/g;
const GITHUB_KEY_REGEX = /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g;
const AWS_KEY_REGEX = /\bAKIA[0-9A-Z]{16}\b/g;
const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9\-_.~+/]+=*\b/gi;
const PRIVATE_KEY_REGEX = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

// ── Attribute-based DOM heuristics ────────────────────────────────────────
const PASSWORD_ATTR_KEYWORDS = /password|passwd|pwd|passcode|secret|api[-_]?key|auth[-_]?token/i;
const CARD_ATTR_KEYWORDS = /cc[-_]?number|card[-_]?num|credit[-_]?card|cvv|cvc|card[-_]?code/i;
const EMAIL_ATTR_KEYWORDS = /email|e[-_]?mail/i;
const PHONE_ATTR_KEYWORDS = /phone|mobile|telephone|cellphone/i;
const GOV_ID_ATTR_KEYWORDS = /ssn|social[-_]?security|aadhaar|pan[-_]?card/i;
const NAME_ATTR_KEYWORDS = /(?:^|[-_])(first[-_]?name|last[-_]?name|full[-_]?name|fname|lname|user[-_]?name|display[-_]?name|customer[-_]?name|author[-_]?name|contact[-_]?name|cardholder[-_]?name|profile[-_]?name|owner[-_]?name)(?:$|[-_])/i;
const STRICT_NAME_KEYWORD = /^(name|fullname|firstname|lastname|username)$/i;
const NAME_PLACEHOLDER_REGEX = /\b(?:enter\s+)?(?:your\s+)?(?:first\s+name|last\s+name|full\s+name|username|display\s+name|name)\b/i;

/** Inspect an individual DOM element's attributes to see if it is privacy-sensitive. */
export function inspectElementPrivacy(attrs: {
  tag?: string;
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  placeholder?: string;
  ariaLabel?: string;
  value?: string;
  text?: string;
}): ElementPrivacyInspection {
  const tag = (attrs.tag || '').toLowerCase();
  const type = (attrs.type || '').toLowerCase();
  const name = (attrs.name || '').toLowerCase();
  const id = (attrs.id || '').toLowerCase();
  const ac = (attrs.autocomplete || '').toLowerCase();
  const placeholder = attrs.placeholder || '';
  const ariaLabel = attrs.ariaLabel || '';
  const text = attrs.text || '';
  const value = attrs.value || '';

  // 1. Password input
  if (type === 'password' || ac.includes('password') || PASSWORD_ATTR_KEYWORDS.test(name) || PASSWORD_ATTR_KEYWORDS.test(id)) {
    return {
      isSensitive: true,
      type: 'password',
      placeholder: '[PASSWORD]',
      sanitizedValue: value ? '[PASSWORD]' : undefined,
      sanitizedPlaceholder: placeholder ? '[PASSWORD]' : undefined,
      sanitizedAriaLabel: ariaLabel ? redactText(ariaLabel).sanitized : undefined,
      sanitizedText: text ? '[PASSWORD]' : undefined,
    };
  }

  // 2. Credit card input
  if (ac.includes('cc-') || CARD_ATTR_KEYWORDS.test(name) || CARD_ATTR_KEYWORDS.test(id) || CARD_ATTR_KEYWORDS.test(placeholder)) {
    return {
      isSensitive: true,
      type: 'credit_card',
      placeholder: '[CARD_NUMBER]',
      sanitizedValue: value ? '[CARD_NUMBER]' : undefined,
      sanitizedPlaceholder: placeholder ? '[CARD_NUMBER]' : undefined,
      sanitizedAriaLabel: ariaLabel ? redactText(ariaLabel).sanitized : undefined,
      sanitizedText: text ? '[CARD_NUMBER]' : undefined,
    };
  }

  // 3. Email input
  if (type === 'email' || ac.includes('email') || EMAIL_ATTR_KEYWORDS.test(name) || EMAIL_ATTR_KEYWORDS.test(id)) {
    return {
      isSensitive: true,
      type: 'email',
      placeholder: '[EMAIL]',
      sanitizedValue: value ? '[EMAIL]' : undefined,
      sanitizedPlaceholder: placeholder ? '[EMAIL]' : undefined,
      sanitizedAriaLabel: ariaLabel ? redactText(ariaLabel).sanitized : undefined,
      sanitizedText: text ? redactText(text).sanitized : undefined,
    };
  }

  // 4. Phone input
  if (type === 'tel' || ac.includes('tel') || PHONE_ATTR_KEYWORDS.test(name) || PHONE_ATTR_KEYWORDS.test(id)) {
    return {
      isSensitive: true,
      type: 'phone',
      placeholder: '[PHONE]',
      sanitizedValue: value ? '[PHONE]' : undefined,
      sanitizedPlaceholder: placeholder ? '[PHONE]' : undefined,
      sanitizedAriaLabel: ariaLabel ? redactText(ariaLabel).sanitized : undefined,
      sanitizedText: text ? redactText(text).sanitized : undefined,
    };
  }

  // 5. Government ID input
  if (GOV_ID_ATTR_KEYWORDS.test(name) || GOV_ID_ATTR_KEYWORDS.test(id) || GOV_ID_ATTR_KEYWORDS.test(placeholder)) {
    return {
      isSensitive: true,
      type: 'ssn',
      placeholder: '[GOV_ID]',
      sanitizedValue: value ? '[GOV_ID]' : undefined,
      sanitizedPlaceholder: placeholder ? '[GOV_ID]' : undefined,
      sanitizedAriaLabel: ariaLabel ? redactText(ariaLabel).sanitized : undefined,
      sanitizedText: text ? redactText(text).sanitized : undefined,
    };
  }

  // 6. Personal Name input (First name, Last name, Full name, Username, Cardholder name)
  const isNameAc = ac === 'name' || ac.includes('given-name') || ac.includes('family-name') || ac.includes('additional-name') || ac.includes('nickname') || ac.includes('username');
  const isNameAttr = NAME_ATTR_KEYWORDS.test(name) || NAME_ATTR_KEYWORDS.test(id) || STRICT_NAME_KEYWORD.test(name) || STRICT_NAME_KEYWORD.test(id);
  const isNamePlaceholder = NAME_PLACEHOLDER_REGEX.test(placeholder) || NAME_PLACEHOLDER_REGEX.test(ariaLabel);
  const isNameField = (tag === 'input' || tag === 'textarea' || tag === 'select') && (isNameAc || isNameAttr || isNamePlaceholder);

  if (isNameField) {
    return {
      isSensitive: true,
      type: 'person_name',
      placeholder: '[NAME]',
      sanitizedValue: value ? '[NAME]' : undefined,
      sanitizedPlaceholder: placeholder ? '[NAME]' : undefined,
      sanitizedAriaLabel: ariaLabel ? redactText(ariaLabel).sanitized : undefined,
      sanitizedText: text ? '[NAME]' : undefined,
    };
  }

  // 7. User Profile Avatar / Picture (LinkedIn, GitHub, Google, social networks)
  const isImg = tag === 'img' || tag === 'svg' || (attrs as any).role === 'img';
  const AVATAR_HINTS = /avatar|profile[-_]?photo|profile[-_]?picture|profile[-_]?img|user[-_]?avatar|user[-_]?photo|author[-_]?img|account[-_]?circle|profile[-_]?badge/i;
  const isAvatar = isImg && (
    AVATAR_HINTS.test(name) ||
    AVATAR_HINTS.test(id) ||
    AVATAR_HINTS.test(placeholder) ||
    AVATAR_HINTS.test(ariaLabel) ||
    AVATAR_HINTS.test((attrs as any).alt || '') ||
    AVATAR_HINTS.test((attrs as any).className || '') ||
    AVATAR_HINTS.test((attrs as any).src || '')
  );

  if (isAvatar) {
    return {
      isSensitive: true,
      type: 'person_name',
      placeholder: '[AVATAR]',
      sanitizedAriaLabel: '[AVATAR]',
      sanitizedText: '[AVATAR]',
    };
  }

  // 7. Generic inspection of value / text content
  const valueRedaction = value ? redactText(value) : null;
  const textRedaction = text ? redactText(text) : null;
  const isContentSensitive = (valueRedaction && valueRedaction.matches.length > 0) || (textRedaction && textRedaction.matches.length > 0);

  if (isContentSensitive) {
    const firstType = valueRedaction?.matches[0]?.type || textRedaction?.matches[0]?.type || 'financial';
    return {
      isSensitive: true,
      type: firstType,
      sanitizedValue: valueRedaction?.sanitized,
      sanitizedText: textRedaction?.sanitized,
      sanitizedPlaceholder: placeholder ? redactText(placeholder).sanitized : undefined,
      sanitizedAriaLabel: ariaLabel ? redactText(ariaLabel).sanitized : undefined,
    };
  }

  return {
    isSensitive: false,
    sanitizedValue: value,
    sanitizedText: text,
    sanitizedPlaceholder: placeholder,
    sanitizedAriaLabel: ariaLabel,
  };
}

/** Redact all sensitive PII patterns from free-form text into semantic placeholders. */
export function redactText(text: string): { sanitized: string; matches: PiiMatch[] } {
  if (!text || typeof text !== 'string') {
    return { sanitized: text || '', matches: [] };
  }

  const matches: PiiMatch[] = [];

  // 1. Private keys (full block)
  let working = text.replace(PRIVATE_KEY_REGEX, (raw, offset) => {
    matches.push({ type: 'auth_token', raw, placeholder: '[PRIVATE_KEY]', start: offset, end: offset + raw.length, confidence: 1.0 });
    return '[PRIVATE_KEY]';
  });

  // 2. JWT tokens
  working = working.replace(JWT_REGEX, (raw, offset) => {
    matches.push({ type: 'auth_token', raw, placeholder: '[JWT_TOKEN]', start: offset, end: offset + raw.length, confidence: 0.95 });
    return '[JWT_TOKEN]';
  });

  // 3. API Keys (OpenAI, GitHub, AWS, Bearer)
  working = working.replace(OPENAI_KEY_REGEX, (raw, offset) => {
    matches.push({ type: 'auth_token', raw, placeholder: '[API_KEY]', start: offset, end: offset + raw.length, confidence: 1.0 });
    return '[API_KEY]';
  });
  working = working.replace(GITHUB_KEY_REGEX, (raw, offset) => {
    matches.push({ type: 'auth_token', raw, placeholder: '[API_KEY]', start: offset, end: offset + raw.length, confidence: 1.0 });
    return '[API_KEY]';
  });
  working = working.replace(AWS_KEY_REGEX, (raw, offset) => {
    matches.push({ type: 'auth_token', raw, placeholder: '[AWS_KEY]', start: offset, end: offset + raw.length, confidence: 1.0 });
    return '[AWS_KEY]';
  });
  working = working.replace(BEARER_REGEX, (raw, offset) => {
    matches.push({ type: 'auth_token', raw, placeholder: 'Bearer [AUTH_TOKEN]', start: offset, end: offset + raw.length, confidence: 0.9 });
    return 'Bearer [AUTH_TOKEN]';
  });

  // 4. Credit card numbers (verified with Luhn algorithm)
  working = working.replace(CREDIT_CARD_CANDIDATE_REGEX, (raw, offset) => {
    const digitsOnly = raw.replace(/\D/g, '');
    if (isValidLuhn(digitsOnly)) {
      matches.push({ type: 'credit_card', raw, placeholder: '[CARD_NUMBER]', start: offset, end: offset + raw.length, confidence: 0.95 });
      return '[CARD_NUMBER]';
    }
    return raw;
  });

  // 5. Emails
  working = working.replace(EMAIL_REGEX, (raw, offset) => {
    matches.push({ type: 'email', raw, placeholder: '[EMAIL]', start: offset, end: offset + raw.length, confidence: 0.98 });
    return '[EMAIL]';
  });

  // 6. Government IDs: Aadhaar, PAN, SSN
  working = working.replace(AADHAAR_REGEX, (raw, offset) => {
    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly.length === 12) {
      matches.push({ type: 'aadhaar', raw, placeholder: '[AADHAAR]', start: offset, end: offset + raw.length, confidence: 0.85 });
      return '[AADHAAR]';
    }
    return raw;
  });

  working = working.replace(PAN_REGEX, (raw, offset) => {
    matches.push({ type: 'pan', raw, placeholder: '[PAN]', start: offset, end: offset + raw.length, confidence: 0.9 });
    return '[PAN]';
  });

  working = working.replace(SSN_REGEX, (raw, offset) => {
    matches.push({ type: 'ssn', raw, placeholder: '[SSN]', start: offset, end: offset + raw.length, confidence: 0.9 });
    return '[SSN]';
  });

  // 7. Passwords and credentials
  // A. HTML/DOM input tags with password value attributes (e.g. <input type=password value="xyz" />)
  working = working.replace(/(<input\b[^>]*\btype=["']?password["']?[^>]*\bvalue=["'])([^"'>]+)(["'])/gi, (full, p1, rawVal, p2, offset) => {
    matches.push({ type: 'password', raw: rawVal, placeholder: '[PASSWORD]', start: offset + p1.length, end: offset + p1.length + rawVal.length, confidence: 0.99 });
    return `${p1}[PASSWORD]${p2}`;
  });
  working = working.replace(/(<input\b[^>]*\bvalue=["'])([^"'>]+)(["'][^>]*\btype=["']?password["']?)/gi, (full, p1, rawVal, p2, offset) => {
    matches.push({ type: 'password', raw: rawVal, placeholder: '[PASSWORD]', start: offset + p1.length, end: offset + p1.length + rawVal.length, confidence: 0.99 });
    return `${p1}[PASSWORD]${p2}`;
  });

  // B. Free-text passwords: "password: xyz", "password = xyz", or "password xyz" (not matching HTML attributes)
  const PASSWORD_TEXT_REGEX = /\b(?<!type=["']?)(?:password|passwd|pwd|passcode|secret)\s*(?:[:=]|is|\s)\s*(?!value|type|name|id|class|input)(["']?[^\s,;."'<>]{4,}["']?)/gi;
  working = working.replace(PASSWORD_TEXT_REGEX, (full, secretVal, offset) => {
    const prefix = full.slice(0, full.length - secretVal.length);
    matches.push({ type: 'password', raw: secretVal, placeholder: '[PASSWORD]', start: offset + prefix.length, end: offset + full.length, confidence: 0.9 });
    return `${prefix}[PASSWORD]`;
  });

  // 8. Phone numbers
  working = working.replace(PHONE_REGEX, (raw, offset) => {
    const digits = raw.replace(/\D/g, '');
    // Avoid redacting short strings like dates "2026-09-17" or zip codes
    if (digits.length >= 10 && digits.length <= 15) {
      matches.push({ type: 'phone', raw, placeholder: '[PHONE]', start: offset, end: offset + raw.length, confidence: 0.85 });
      return '[PHONE]';
    }
    return raw;
  });

  // 9. Personal Names in contextual text patterns
  // A. Honorifics / Salutations: "Dr. Jane Foster", "Mr. John Smith", "Ms. Sarah Connor", "Prof. Charles Xavier"
  const SALUTATION_NAME_REGEX = /\b(?:Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Prof\.|Sir|Madam)\s+([A-Z][a-z]+(?:['’][a-zA-Z]+)?(?:\s+[A-Z][a-z]+(?:['’][a-zA-Z]+)?){1,3})\b/g;
  working = working.replace(SALUTATION_NAME_REGEX, (full, namePart, offset) => {
    matches.push({
      type: 'person_name',
      raw: full,
      placeholder: '[NAME]',
      start: offset,
      end: offset + full.length,
      confidence: 0.95,
    });
    return '[NAME]';
  });

  // B. Labeled names: "Name: Sarthak Patil", "Full Name: Jane Doe", "Customer: Alice Smith", "User: Bob Jones"
  const LABELED_NAME_REGEX = /\b(name|full\s*name|first\s*name|last\s*name|user(?:name)?|author|customer|cardholder|candidate|patient|profile|contact|account)\s*[:=–-]\s*([A-Z][a-z]+(?:['’][a-zA-Z]+)?(?:\s+[A-Z][a-z]+(?:['’][a-zA-Z]+)?){0,3})\b/gi;
  working = working.replace(LABELED_NAME_REGEX, (full, labelPart, namePart, offset) => {
    const trimmedName = namePart.trim();
    if (!trimmedName || /^(is|of|for|the|and|or|in|at|by|with|to|not|null|undefined|true|false|none|n\/a)$/i.test(trimmedName)) {
      return full;
    }
    const prefix = full.slice(0, full.length - namePart.length);
    matches.push({
      type: 'person_name',
      raw: namePart,
      placeholder: '[NAME]',
      start: offset + prefix.length,
      end: offset + full.length,
      confidence: 0.9,
    });
    return `${prefix}[NAME]`;
  });

  // C. Greeting & Session / Login Banners: "Welcome, Sarah Connor", "Welcome back, Alex Smith", "Signed in as: Alex Smith", "Logged in as: John Doe"
  const GREETING_NAME_REGEX = /\b(welcome(?:\s+back)?,?|signed\s+in\s+as:?|logged\s+in\s+as:?|hello,?|hi,?|hey,?)\s+([A-Z][a-z]+(?:['’][a-zA-Z]+)?(?:\s+[A-Z][a-z]+(?:['’][a-zA-Z]+)?){0,3})\b/gi;
  working = working.replace(GREETING_NAME_REGEX, (full, greetingPart, namePart, offset) => {
    const trimmedName = namePart.trim();
    if (!trimmedName || /^(to|there|everyone|user|guest|back|again|all|browy|google|github|linkedin)$/i.test(trimmedName)) {
      return full;
    }
    const prefix = full.slice(0, full.length - namePart.length);
    matches.push({
      type: 'person_name',
      raw: namePart,
      placeholder: '[NAME]',
      start: offset + prefix.length,
      end: offset + full.length,
      confidence: 0.9,
    });
    return `${prefix}[NAME]`;
  });

  return { sanitized: working, matches };
}

/** Sanitize URLs by stripping sensitive query parameters (tokens, keys, emails, passwords). */
export function sanitizeUrl(urlStr: string): string {
  if (!urlStr || typeof urlStr !== 'string') return urlStr || '';
  try {
    const parsed = new URL(urlStr);
    const SENSITIVE_PARAM_NAMES = [
      'token', 'access_token', 'auth', 'key', 'apikey', 'api_key', 'secret',
      'password', 'pwd', 'email', 'session', 'session_id', 'code', 'reset_code',
      'jwt', 'bearer', 'signature', 'sig',
    ];

    for (const [key, val] of parsed.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (SENSITIVE_PARAM_NAMES.some((s) => lower === s || lower.includes(s))) {
        parsed.searchParams.set(key, '[REDACTED]');
      } else {
        // Also check if parameter value matches email or token pattern
        const redacted = redactText(val);
        if (redacted.matches.length > 0) {
          parsed.searchParams.set(key, redacted.sanitized);
        }
      }
    }
    return parsed.toString();
  } catch {
    // If not a standard URL, run standard text redaction
    return redactText(urlStr).sanitized;
  }
}
