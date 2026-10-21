# Data Classification Policy

**Version:** 1.0
**Effective Date:** 2026-10-21
**Closes:** [#322](https://github.com/onlyonee1/PaymentFlow/issues/322)

---

## Overview

StellarEduPay stores sensitive data about students, their parents, schools, and payment transactions. This document defines the data classification scheme, maps every significant database field to its classification, and specifies redaction rules for logs, error messages, and API responses.

**All engineers, on-call responders, and contributors who work with production data must read and follow this policy.**

---

## Classification Levels

| Level | Label | Description | Examples |
|-------|-------|-------------|---------|
| **L1** | Public | Intentionally public; no harm if disclosed | API version, supported assets, network name |
| **L2** | Internal | Non-sensitive operational data; access limited to authenticated users | Payment amounts, fee structures, payment status |
| **L3** | Confidential | Sensitive business or operational data; disclosure could embarrass or harm the school | Admin email, school name, webhook URL, audit log entries |
| **L4** | Restricted | Personal data (PII), financial identifiers, or cryptographic secrets; subject to data protection law (GDPR, NDPA equivalents) and maximum access control | Student name, parent email/phone, txHash, private keys, MFA secrets |

Restricted (L4) data must:
- Never appear in log files
- Never appear in API error response bodies
- Never appear in webhook payloads unless the school has explicitly opted in
- Be encrypted at rest wherever technically feasible

---

## Field Classification: Student Collection

| Field | Classification | Notes |
|-------|---------------|-------|
| `_id` | L2 Internal | MongoDB ObjectId; no PII |
| `schoolId` | L2 Internal | Tenant identifier |
| `studentId` | L3 Confidential | Used as Stellar memo; treat as identifier |
| `name` | **L4 Restricted** | Student full name — PII |
| `class` | L2 Internal | |
| `academicYear` | L2 Internal | |
| `feeAmount` | L2 Internal | |
| `fees` (array) | L2 Internal | Fee categories and amounts |
| `feePaid` | L2 Internal | |
| `totalPaid` | L2 Internal | |
| `remainingBalance` | L2 Internal | |
| `creditAdjustments` | L3 Confidential | Financial adjustment ledger |
| `parentEmail` | **L4 Restricted** | PII — encrypted at rest (migration 029) |
| `parentEmailHash` | L3 Confidential | Blind index of parentEmail; not reversible but correlatable |
| `parentPhone` | **L4 Restricted** | PII — encrypted at rest (migration 029) |
| `parentName` | **L4 Restricted** | PII |
| `dateOfBirth` | **L4 Restricted** | PII — sensitive demographic data |
| `gender` | **L4 Restricted** | PII — sensitive demographic data |
| `contactNumber` | **L4 Restricted** | PII |
| `lastReminderSentAt` | L2 Internal | |
| `reminderCount` | L2 Internal | |
| `reminderOptOut` | L2 Internal | |
| `parentEmailSuppressed` | L2 Internal | |
| `parentEmailSuppressionReason` | L2 Internal | |
| `disputeHold` | L2 Internal | |
| `deletedAt` | L2 Internal | Soft-delete timestamp |
| `lastPaymentHash` | L3 Confidential | Links to a specific payment; see Payment.txHash |

**Encryption status:** `parentEmail` and `parentPhone` are AES-256-GCM encrypted at rest via `studentPiiEncryption.js` (migration 029). `parentEmailHash` is a deterministic HMAC-SHA256 blind index used for exact-match lookups (e.g. email suppression) without decrypting.

---

## Field Classification: Payment Collection

| Field | Classification | Notes |
|-------|---------------|-------|
| `_id` | L2 Internal | |
| `schoolId` | L2 Internal | |
| `studentId` | L3 Confidential | |
| `txHash` | **L4 Restricted** | Blockchain transaction hash — financial identifier; redacted in request logs |
| `amount` | L2 Internal | |
| `correlationId` | L2 Internal | Derived from txHash; safe for logs |
| `feeAmount` | L2 Internal | |
| `feeCategory` | L2 Internal | |
| `feeValidationStatus` | L2 Internal | |
| `excessAmount` | L2 Internal | |
| `assetCode` | L2 Internal | 'XLM' or 'USDC' |
| `status` | L2 Internal | |
| `memo` | **L4 Restricted** | Contains studentId embedded by the parent; redacted in logs |
| `senderAddress` | **L4 Restricted** | Parent's Stellar wallet address — financial/blockchain PII; redacted in logs |
| `isSuspicious` | L2 Internal | |
| `suspicionReason` | L3 Confidential | Internal fraud detection detail |
| `suspicionReviewStatus` | L3 Confidential | |
| `suspicionReviewedBy` | L3 Confidential | Admin email |
| `suspicionReviewNote` | L3 Confidential | |
| `confirmationState` | L2 Internal | |
| `confirmedAt` | L2 Internal | |
| `fiatSnapshot` | L2 Internal | Fiat conversion snapshot; no PII |
| `underpaidReconciliation` | L3 Confidential | Reconciliation status; financial detail |
| `deletedAt` | L2 Internal | |

---

## Field Classification: School Collection

| Field | Classification | Notes |
|-------|---------------|-------|
| `_id` | L2 Internal | |
| `schoolId` | L2 Internal | |
| `name` | L2 Internal | School name is not PII |
| `slug` | L1 Public | Used in API headers |
| `stellarAddress` | L3 Confidential | School's receiving wallet; public on-chain but operationally sensitive |
| `previousStellarAddress` | L3 Confidential | Pre-rotation address; see wallet-rotation runbook |
| `network` | L1 Public | 'testnet' or 'mainnet' |
| `syncCursor` | L2 Internal | |
| `adminEmail` | **L4 Restricted** | Admin's personal email address — PII |
| `contactEmail` | L3 Confidential | School contact email; school-level, not personal |
| `webhookUrl` | L3 Confidential | Internal integration endpoint |
| `webhookSecret` | **L4 Restricted** | HMAC signing key — encrypted at rest (migration 017); never logged |
| `webhookPayloadConfig` | L2 Internal | |
| `mfaEnabled` | L2 Internal | |
| `mfaSecret` | **L4 Restricted** | TOTP secret — AES-256-GCM encrypted; never logged |
| `mfaBackupCodes` | **L4 Restricted** | Hashed backup codes; never logged |
| `localCurrency` | L2 Internal | |
| `timezone` | L2 Internal | |
| `suspiciousPaymentMultiplier` | L2 Internal | |
| `maxStudents` | L2 Internal | |
| `isActive` | L2 Internal | |
| `settings` | L2 Internal | Per-school config overrides |
| `classOptions` | L2 Internal | |

---

## Field Classification: AuditLog Collection

| Field | Classification | Notes |
|-------|---------------|-------|
| `schoolId` | L2 Internal | |
| `action` | L2 Internal | Audit action code |
| `performedBy` | L3 Confidential | Admin user identifier (email or userId) |
| `details` | L3 Confidential | May contain operational data; must not contain L4 fields in plaintext |
| `createdAt` | L2 Internal | |

> Audit log entries must not embed raw PII. Reference fields by their opaque ID (`studentId`, `txHash`) rather than plaintext names or emails. If a `details` field needs to reference a student, use the studentId, not the student's name.

---

## Redaction Rules

### Log Redaction

The following fields are **automatically redacted** in HTTP request logs by `backend/src/middleware/requestLogger.js` using the `REQUEST_LOG_REDACT_FIELDS` list in `backend/src/utils/redactConfig.js`:

```javascript
// backend/src/utils/redactConfig.js — See ADR-002 for idempotency context
const REQUEST_LOG_REDACT_FIELDS = [
  'txHash',       // L4 — blockchain financial identifier
  'studentId',    // L3 — student identifier
  'memo',         // L4 — contains studentId embedded in tx
  'senderAddress',// L4 — parent's wallet address
  'password',     // L4 — credentials
  'secret',       // L4 — generic secrets
  'token',        // L4 — auth tokens
  'mfaCode',      // L4 — TOTP code
  'backupCode',   // L4 — MFA backup code
  'currentPassword', // L4 — credentials
];
```

**Adding new Restricted fields:** When adding a new L4 field to any model, add its key to `REQUEST_LOG_REDACT_FIELDS` in `redactConfig.js`. Open a PR that includes both the model change and the redaction config update.

### Environment Variable Redaction

The `SENSITIVE_KEYS` set in `redactConfig.js` ensures that sensitive environment variable values are never logged at startup:

```javascript
const SENSITIVE_KEYS = new Set([
  'JWT_SECRET', 'WEBHOOK_SECRET', 'MONGO_URI', 'MONGODB_URI',
  'SMTP_PASS', 'REDIS_PASSWORD'
]);
```

Startup config logging uses `redactConfig(cfg)` to replace these values with `'[REDACTED]'`.

### API Error Response Redaction

API error responses must never include L4 field values. Acceptable in an error:
```json
{ "error": "Student not found", "code": "NOT_FOUND" }
```

Not acceptable:
```json
{ "error": "parentEmail abc@example.com is already registered" }
```

Error messages should reference fields by name, not by value. Enforce this in controller code — never interpolate L4 field values into error message strings.

### Webhook Payload Redaction

By default, `buildWebhookPayload.js` limits the fields sent in webhook payloads to a safe allow-list (`webhookPayloadConfig.allowedFields`). L4 fields (`txHash`, `senderAddress`, `studentId`, `memo`) are **excluded by default**. Schools can opt in by explicitly adding these fields to their `webhookPayloadConfig.allowedFields` setting — this opt-in is logged in the audit trail.

---

## Encryption at Rest

| Data | Mechanism | Key Source | Migration |
|------|-----------|------------|-----------|
| `Student.parentEmail` | AES-256-GCM | `STUDENT_PII_ENCRYPTION_KEY` | 029 |
| `Student.parentPhone` | AES-256-GCM | `STUDENT_PII_ENCRYPTION_KEY` | 029 |
| `Payment.memo` | AES-256-GCM | `PAYMENT_MEMO_ENCRYPTION_KEY` | 011 |
| `School.webhookSecret` | AES-256-GCM | `WEBHOOK_SECRET_ENCRYPTION_KEY` | 017, 021 |
| `School.mfaSecret` | AES-256-GCM | Derived from `JWT_SECRET` | — |

Fields marked **not yet encrypted** but classified L4 are tracked in the encryption migration backlog:

| Field | Priority | Tracking |
|-------|----------|---------|
| `Student.name` | Medium | Follow-up migration needed |
| `Student.parentName` | Medium | Follow-up migration needed |
| `Student.dateOfBirth` | High | Sensitive demographic data |
| `Student.gender` | High | Sensitive demographic data |
| `Student.contactNumber` | Medium | Follow-up migration needed |
| `School.adminEmail` | Medium | Follow-up migration needed |

---

## Redact Utility (`redactPii`)

The `backend/src/utils/redactConfig.js` module exports `redactConfig` for environment variables. For structured data objects (log payloads, error details, API responses), use the `redactPii` utility:

```javascript
// backend/src/utils/redactConfig.js
const { redactPii } = require('../utils/redactConfig');

// Redacts all L4 fields from a data object before logging
const safePayload = redactPii(paymentRecord);
logger.info('Payment processed', safePayload);
```

The `redactPii(data)` function accepts an object or array of objects and returns a deep copy with all L4 field values replaced by `'[REDACTED]'`. It uses the `PII_FIELDS` export from `redactConfig.js`.

```javascript
// Fields redacted by redactPii()
const PII_FIELDS = new Set([
  // Student PII
  'parentEmail', 'parentPhone', 'parentName', 'dateOfBirth', 'gender',
  'contactNumber', 'name', 'parentEmailHash',
  // Payment financial identifiers
  'txHash', 'memo', 'senderAddress',
  // School secrets
  'webhookSecret', 'mfaSecret', 'mfaBackupCodes',
  // Auth fields
  'password', 'secret', 'token', 'mfaCode', 'backupCode',
  'currentPassword', 'confirmPassword',
  // School contact
  'adminEmail',
]);
```

---

## Compliance Notes

- **GDPR / NDPA (Nigeria Data Protection Act):** `parentEmail`, `parentPhone`, `parentName`, `dateOfBirth`, `gender` are personal data. Access must be limited to the school to which the student belongs. Requests for data deletion must trigger the student soft-delete flow (which does not hard-delete, but marks the record for PII anonymization via `piiAnonymizationScheduler.js`).
- **Data retention:** Student PII is retained for the duration of the school's subscription plus any legally mandated period. The `piiAnonymizationScheduler.js` service handles scheduled anonymization of deleted student PII.
- **Cross-border data transfer:** StellarEduPay does not transfer student PII to third parties (Stellar only receives `studentId` as a memo field, which is a pseudonymous identifier, not the student's name).

---

## Related Documents and Code References

- Request logger redaction: [`backend/src/middleware/requestLogger.js`](../backend/src/middleware/requestLogger.js)
- Redact config: [`backend/src/utils/redactConfig.js`](../backend/src/utils/redactConfig.js)
- Student PII encryption: [`backend/src/services/studentPiiEncryption.js`](../backend/src/services/studentPiiEncryption.js)
- Student PII encryption migration: [`backend/migrations/029_encrypt_student_pii.js`](../backend/migrations/029_encrypt_student_pii.js)
- Payment memo encryption migration: [`backend/migrations/011_encrypt_payment_memos.js`](../backend/migrations/011_encrypt_payment_memos.js)
- Webhook secret encryption migration: [`backend/migrations/021_encrypt_webhook_secrets.js`](../backend/migrations/021_encrypt_webhook_secrets.js)
- PII anonymization scheduler: [`backend/src/services/piiAnonymizationScheduler.js`](../backend/src/services/piiAnonymizationScheduler.js)
- Student PII protection tests: [`tests/studentPiiProtection.test.js`](../tests/studentPiiProtection.test.js)
- Security threat model: [`docs/security.md`](security.md)
