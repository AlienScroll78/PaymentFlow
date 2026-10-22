'use strict';

const SENSITIVE_KEYS = new Set(['JWT_SECRET', 'WEBHOOK_SECRET', 'MONGO_URI', 'MONGODB_URI', 'SMTP_PASS', 'REDIS_PASSWORD']);

// Request body/query fields that must never be written to request logs.
const REQUEST_LOG_REDACT_FIELDS = [
  'txHash',
  'studentId',
  'memo',
  'senderAddress',
  'password',
  'secret',
  'token',
  'mfaCode',
  'backupCode',
  'currentPassword',
];

const SENSITIVE_LOG_KEY = /(password|secret|token|authorization|cookie|api.?key|private.?key|access.?key|refresh.?token|mfa|backup.?code|student.?id|tx.?hash|sender.?address|memo)/i;

function redactLogValue(value) {
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [
    key,
    SENSITIVE_LOG_KEY.test(key) ? '[REDACTED]' : redactLogValue(nestedValue),
  ]));
}

function redactConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  return Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, SENSITIVE_KEYS.has(k) && v !== undefined ? '[REDACTED]' : v]));
}

module.exports = { redactConfig, redactLogValue, SENSITIVE_KEYS, REQUEST_LOG_REDACT_FIELDS };
