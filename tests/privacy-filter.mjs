// Unit and integration tests for Client-Side Privacy Engine & Redaction Filter
// Run: node tests/privacy-filter.mjs

import { isValidLuhn, inspectElementPrivacy, redactText, sanitizeUrl } from '../src/privacy/pii-detector.ts';
import { redactVisualFrame } from '../src/privacy/visual-redactor.ts';
import { PrivacyGate } from '../src/privacy/privacy-gate.ts';
import sharp from 'sharp';

const failures = [];
function check(name, cond) {
  if (!cond) {
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  } else {
    console.log(`  OK:   ${name}`);
  }
}

console.log('=== Testing Client-Side Privacy Engine & Redaction Filter ===\n');

// 1. Credit Card & Luhn Algorithm Validation
{
  console.log('1. Testing Credit Card Detection & Luhn Algorithm...');
  check('Valid Visa passes Luhn', isValidLuhn('4532015012345671') === true);
  check('Invalid card fails Luhn', isValidLuhn('4532015012345679') === false);

  const cardText = 'My payment card is 4532-0150-1234-5671, please charge it.';
  const redacted = redactText(cardText);
  check('Valid card number in text is redacted', redacted.sanitized.includes('[CARD_NUMBER]'));
  check('Raw card number is not present in output', !redacted.sanitized.includes('4532-0150-1234-5671'));

  const nonCardDigits = 'Order confirmation # 1234-5678-9012-3456';
  // If digits don't pass Luhn, they should not be falsely classified as credit card
  if (!isValidLuhn('1234567890123456')) {
    const falseCardCheck = redactText(nonCardDigits);
    check('Non-card digits avoid false positive card redaction', !falseCardCheck.sanitized.includes('[CARD_NUMBER]'));
  }
}

// 2. Email Address Redaction
{
  console.log('\n2. Testing Email Address Redaction...');
  const text = 'Contact support at support@company.co.uk or sarthak.patil@sub.domain.org for help.';
  const r = redactText(text);
  check('All emails redacted to [EMAIL]', !r.sanitized.includes('support@company.co.uk') && !r.sanitized.includes('sarthak.patil@sub.domain.org'));
  check('Contains [EMAIL] placeholders', (r.sanitized.match(/\[EMAIL\]/g) || []).length === 2);
}

// 3. Phone Numbers
{
  console.log('\n3. Testing Phone Number Redaction...');
  const text = 'Call me at +1 (555) 867-5309 or Indian line +91 9876543210.';
  const r = redactText(text);
  check('Phone numbers redacted to [PHONE]', r.sanitized.includes('[PHONE]'));
  check('Raw numbers not in output', !r.sanitized.includes('867-5309') && !r.sanitized.includes('9876543210'));
}

// 4. Government IDs (Aadhaar, PAN, SSN)
{
  console.log('\n4. Testing Government IDs...');
  const text = 'Aadhaar: 2345 6789 0123, PAN: ABCDE1234F, SSN: 123-45-6789';
  const r = redactText(text);
  check('Aadhaar redacted', r.sanitized.includes('[AADHAAR]') && !r.sanitized.includes('2345 6789 0123'));
  check('PAN redacted', r.sanitized.includes('[PAN]') && !r.sanitized.includes('ABCDE1234F'));
  check('SSN redacted', r.sanitized.includes('[SSN]') && !r.sanitized.includes('123-45-6789'));
}

// 5. Authentication & API Tokens
{
  console.log('\n5. Testing API Keys & Tokens...');
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature1234567890';
  const openai = 'sk-proj1234567890abcdef1234567890';
  const bearer = 'Authorization: Bearer mySecretAccessToken123';
  const text = `JWT: ${jwt} and Key: ${openai} and Header: ${bearer}`;
  const r = redactText(text);
  check('JWT redacted', r.sanitized.includes('[JWT_TOKEN]') && !r.sanitized.includes('doNotLeakThisSignature1234567890'));
  check('API Key redacted', r.sanitized.includes('[API_KEY]') && !r.sanitized.includes('sk-proj1234567890'));
  check('Bearer token redacted', r.sanitized.includes('Bearer [AUTH_TOKEN]') && !r.sanitized.includes('mySecretAccessToken123'));
}

// 6. Personal Name Redaction in Free-form Text
{
  console.log('\n6. Testing Personal Name Redaction in Free-form Text...');
  const text1 = 'Patient Name: Sarthak Patil, Full Name: Jane Foster, Customer: Alice Smith.';
  const r1 = redactText(text1);
  check('Labeled personal names are redacted', r1.sanitized.includes('Name: [NAME]') && r1.sanitized.includes('Full Name: [NAME]'));
  check('Raw names not leaked in text', !r1.sanitized.includes('Sarthak Patil') && !r1.sanitized.includes('Jane Foster'));

  const text2 = 'Welcome back, Alex Smith! Signed in as: Robert Downey.';
  const r2 = redactText(text2);
  check('Welcome and Signed-in names are redacted', r2.sanitized.includes('Welcome back, [NAME]!') && r2.sanitized.includes('Signed in as: [NAME]'));
  check('Raw names not in greeting output', !r2.sanitized.includes('Alex Smith') && !r2.sanitized.includes('Robert Downey'));

  const text3 = 'Consultation scheduled with Dr. Jane Foster and Mr. John Smith.';
  const r3 = redactText(text3);
  check('Honorific / Salutation names are redacted to [NAME]', (r3.sanitized.match(/\[NAME\]/g) || []).length === 2);
  check('Doctor and Mr names are removed', !r3.sanitized.includes('Jane Foster') && !r3.sanitized.includes('John Smith'));
}

// 7. DOM Element Privacy Inspection
{
  console.log('\n7. Testing DOM Element Privacy Inspection...');

  // Name input field
  const nameEl = inspectElementPrivacy({
    tag: 'input',
    type: 'text',
    name: 'user_full_name',
    autocomplete: 'name',
    placeholder: 'Enter your full name',
    value: 'Sarthak Patil',
  });
  check('Name field is marked sensitive', nameEl.isSensitive === true);
  check('Name field type is person_name', nameEl.type === 'person_name');
  check('Name field value is redacted to [NAME]', nameEl.sanitizedValue === '[NAME]');

  // First name field
  const fNameEl = inspectElementPrivacy({
    tag: 'input',
    type: 'text',
    name: 'first_name',
    value: 'John',
  });
  check('First name field is marked sensitive', fNameEl.isSensitive === true);
  check('First name value is redacted to [NAME]', fNameEl.sanitizedValue === '[NAME]');

  // Avatar / Profile picture
  const avatarEl = inspectElementPrivacy({
    tag: 'img',
    className: 'profile-photo avatar-large',
    alt: 'Profile photo of Sarthak Patil',
  });
  check('Avatar is marked sensitive', avatarEl.isSensitive === true);
  check('Avatar placeholder is [AVATAR]', avatarEl.placeholder === '[AVATAR]');

  // Password field
  const passEl = inspectElementPrivacy({
    tag: 'input',
    type: 'password',
    name: 'user_password',
    value: 'secret123456',
  });
  check('Password field is marked sensitive', passEl.isSensitive === true);
  check('Password field value is redacted to [PASSWORD]', passEl.sanitizedValue === '[PASSWORD]');

  // Credit card field
  const cardEl = inspectElementPrivacy({
    tag: 'input',
    type: 'text',
    autocomplete: 'cc-number',
    placeholder: 'Enter 16-digit card',
    value: '4532 0150 1234 5678',
  });
  check('Card field is marked sensitive', cardEl.isSensitive === true);
  check('Card field value is redacted to [CARD_NUMBER]', cardEl.sanitizedValue === '[CARD_NUMBER]');

  // Email field
  const emailEl = inspectElementPrivacy({
    tag: 'input',
    type: 'email',
    name: 'email_address',
    value: 'sarthak@example.com',
  });
  check('Email field is marked sensitive', emailEl.isSensitive === true);
  check('Email value is redacted to [EMAIL]', emailEl.sanitizedValue === '[EMAIL]');

  // Non-sensitive button
  const btnEl = inspectElementPrivacy({
    tag: 'button',
    text: 'Submit Order',
  });
  check('Safe button is not sensitive', btnEl.isSensitive === false);
  check('Button text is preserved', btnEl.sanitizedText === 'Submit Order');
}

// 7. URL Sanitization
{
  console.log('\n7. Testing URL Sanitization...');
  const url = 'https://app.example.com/checkout?token=eyJhbG123&session_id=sess_4981&email=user@test.com&item=laptop';
  const cleanUrl = sanitizeUrl(url);
  check('Token parameter redacted', cleanUrl.includes('token=%5BREDACTED%5D') || cleanUrl.includes('token=[REDACTED]'));
  check('Session ID parameter redacted', cleanUrl.includes('session_id=%5BREDACTED%5D') || cleanUrl.includes('session_id=[REDACTED]'));
  check('Email parameter redacted', cleanUrl.includes('email=%5BREDACTED%5D') || cleanUrl.includes('email=[REDACTED]') || cleanUrl.includes('email=%5BEMAIL%5D'));
  check('Safe item parameter preserved', cleanUrl.includes('item=laptop'));
}

// 8. Pre-Flight Privacy Firewall Gate
{
  console.log('\n8. Testing Pre-Flight Privacy Firewall Gate...');
  const rawPrompt = `User said: "Here is my account info: sarthak@test.com with password MySecretPass123.
<browser_context>
URL: https://bank.com/account?token=secret123
Active tab: "Dashboard for sarthak@test.com"
<page_snapshot>
[1]<input type=password value="MySecretPass123" />
[2]<input type=text value="4532 0150 1234 5671" />
</page_snapshot>
</browser_context>`;

  const boxes = [
    { x: 100, y: 200, w: 300, h: 40, type: 'password', label: 'PASSWORD' },
    { x: 100, y: 260, w: 300, h: 40, type: 'credit_card', label: 'CARD' },
  ];

  const certified = PrivacyGate.certifyPayload(rawPrompt, boxes);
  check('Privacy Gate certifies prompt', certified.certifiedPrompt.length > 0);
  check('Zero raw emails remain in certified payload', !certified.certifiedPrompt.includes('sarthak@test.com'));
  check('Zero raw passwords remain in certified payload', !certified.certifiedPrompt.includes('MySecretPass123'));
  check('Zero raw cards remain in certified payload', !certified.certifiedPrompt.includes('4532 0150 1234 5671'));
  check('Redaction manifest appended', certified.certifiedPrompt.includes('<redaction_manifest'));
  check('Manifest contains total redacted count', certified.manifest.totalRedacted >= 4);
}

// 9. Visual Redaction with sharp
{
  console.log('\n9. Testing Dynamic Visual Redaction Engine...');
  // Create an initial white test image (600x400)
  const baseImg = await sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).jpeg().toBuffer();

  const boxes = [
    { x: 50, y: 50, w: 200, h: 40, type: 'password', label: 'PASSWORD' },
    { x: 50, y: 120, w: 250, h: 40, type: 'credit_card', label: 'CARD_NUMBER' },
    { x: 50, y: 180, w: 220, h: 36, type: 'person_name', label: 'NAME' },
  ];

  const result = await redactVisualFrame({
    base64: baseImg.toString('base64'),
    mimeType: 'image/jpeg',
    viewportWidth: 600,
    viewportHeight: 400,
    dpr: 1,
    boxes,
  });

  check('Visual redaction returns valid base64 output', !!result.base64 && result.base64.length > 0);
  check('Redacted boxes count is 3 (including personal name)', result.redactedBoxesCount === 3);
  check('Redaction latency is fast (<300ms)', result.durationMs < 300);

  // Inspect pixels inside the redacted box (x=60, y=60) vs unredacted (x=500, y=350)
  const outputBuffer = Buffer.from(result.base64, 'base64');
  const { data, info } = await sharp(outputBuffer).raw().toBuffer({ resolveWithObject: true });

  // Redacted region (50, 50) is filled with dark mask (#0f172a -> r:15, g:23, b:42)
  const idxRedacted = (60 * info.width + 60) * info.channels;
  const rVal = data[idxRedacted];
  const gVal = data[idxRedacted + 1];
  const bVal = data[idxRedacted + 2];

  check('Redacted coordinate has dark mask pixels', rVal < 50 && gVal < 50 && bVal < 70);

  // Unredacted region (500, 350) is still bright white
  const idxUnredacted = (350 * info.width + 500) * info.channels;
  const rUn = data[idxUnredacted];
  const gUn = data[idxUnredacted + 1];
  const bUn = data[idxUnredacted + 2];
  check('Unredacted coordinate maintains original pixels', rUn > 240 && gUn > 240 && bUn > 240);
}

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length} failures):\n  ` + failures.join('\n  '));
  process.exit(1);
} else {
  console.log('\n✅ ALL PRIVACY TESTS PASSED! Zero raw PII leakage verified.\n');
}
