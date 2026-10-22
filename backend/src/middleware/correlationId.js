'use strict';

/**
 * Correlation ID middleware.
 *
 * Accepts or generates a correlation ID for every incoming request and attaches
 * it to `req.correlationId` and the `X-Correlation-ID` response header so that
 * a single trace identifier flows across HTTP, queues, provider calls, and logs.
 *
 * Incoming ID handling:
 *   - If the `X-Correlation-ID` request header is present it is sanitized
 *     (stripped to a safe charset, max 128 chars) and used as-is so callers
 *     (frontend, external services, integration tests) can maintain their own
 *     trace chain.
 *   - If the header is absent, empty, or becomes empty after sanitization a
 *     fresh ID is generated via `generateCorrelationId()`.
 *
 * Security:
 *   - Only alphanumerics plus `_`, `:`, `.`, and `-` are allowed. Everything
 *     else is stripped before the value is stored or reflected. This prevents
 *     log-injection and header-injection attacks.
 *   - IDs are capped at MAX_LENGTH characters before reflection so a caller
 *     cannot flood logs with arbitrarily long strings.
 */

const { generateCorrelationId } = require('../utils/correlationId');

/**
 * Characters outside this set are stripped from incoming IDs.
 * Allows: a-z A-Z 0-9 _ : . -
 */
const UNSAFE_CHARS = /[^a-zA-Z0-9_:.-]/g;
const MAX_LENGTH = 128;

/**
 * Sanitize a raw correlation ID supplied by the caller.
 *
 * @param {*} raw  Raw header value (may be undefined, null, or any type).
 * @returns {string|null}  Cleaned ID, or null when nothing usable remains.
 */
function sanitizeCorrelationId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(UNSAFE_CHARS, '').slice(0, MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Express middleware.  Must be mounted BEFORE `requestLogger` so the logger
 * can use the already-resolved ID rather than generating a second one.
 */
function correlationIdMiddleware(req, res, next) {
  const incoming = req.headers['x-correlation-id'];
  const sanitized = sanitizeCorrelationId(incoming);
  const correlationId = sanitized || generateCorrelationId();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  next();
}

module.exports = { correlationIdMiddleware, sanitizeCorrelationId };
