'use strict';

/**
 * auditService — append-only audit log with HMAC hash chain.
 *
 * ## Cursor-based pagination (Issue #40)
 *
 * `getAuditLogs` supports two pagination modes:
 *
 * ### Mode 1 — Cursor (recommended for long exports)
 *   Pass the `cursor` string returned in a prior response's `nextCursor`
 *   field. The cursor is an HMAC-SHA256-signed, base64url-encoded JSON token
 *   that encodes the last record's `(createdAt, _id)` position together with
 *   the active filter set and an expiry timestamp.
 *
 *   - **Stable**: uses keyset pagination (`$lt createdAt / _id`), so concurrent
 *     inserts cannot cause records to be skipped or duplicated.
 *   - **Tamper-proof**: any modification to the token causes signature
 *     verification to fail and the request is rejected with `INVALID_CURSOR`.
 *   - **Expiry**: cursors expire after 1 hour (configurable via
 *     `AUDIT_CURSOR_HMAC_KEY` env var). Expired cursors return `INVALID_CURSOR`.
 *   - **Filter-locked**: the cursor encodes the active filters; changing a
 *     filter param while using a cursor from a different filter set is rejected.
 *
 * ### Mode 2 — Offset (default, backwards-compatible)
 *   Pass `page` and `limit` as before. Offset pagination may skip or
 *   duplicate records under concurrent inserts, but is simpler for small
 *   result sets and backwards-compatible with existing clients.
 *
 * ### Response fields
 *   - `nextCursor` — opaque cursor string to pass for the next page, or
 *     `null` when there are no more records.
 *   - `cursorExpiry` — ISO 8601 expiry timestamp for `nextCursor`.
 */

const crypto = require('crypto');
const AuditLog = require('../models/auditLogModel');
const logger = require('../utils/logger');

// HMAC key for entry hashes. Falls back to JWT_SECRET so no new env var is
// required; operators can add AUDIT_HMAC_KEY to isolate the secret.
const HMAC_KEY = process.env.AUDIT_HMAC_KEY || process.env.JWT_SECRET || 'audit-integrity-key';

// Separate HMAC key for pagination cursors so rotating the cursor key does
// not invalidate stored entry hashes (or vice-versa).
const CURSOR_HMAC_KEY =
  process.env.AUDIT_CURSOR_HMAC_KEY ||
  process.env.AUDIT_HMAC_KEY ||
  process.env.JWT_SECRET ||
  'cursor-key';

/** Cursors expire after 1 hour by default. */
const CURSOR_TTL_MS = 60 * 60 * 1000;

// In-process failure counter — reset on restart
let _auditFailureCount = 0;

function getAuditHealth() {
  return {
    status: _auditFailureCount === 0 ? 'ok' : 'degraded',
    recentFailures: _auditFailureCount,
  };
}

function _resetAuditFailureCount() {
  _auditFailureCount = 0;
}

/**
 * Compute a deterministic HMAC-SHA256 over the canonical fields of an entry.
 * prevHash is included so any modification to the chain is detectable.
 */
function _computeEntryHash(fields) {
  const canonical = JSON.stringify({
    schoolId:     fields.schoolId,
    action:       fields.action,
    performedBy:  fields.performedBy,
    targetId:     fields.targetId,
    targetType:   fields.targetType,
    details:      fields.details,
    result:       fields.result,
    errorMessage: fields.errorMessage ?? null,
    ipAddress:    fields.ipAddress ?? null,
    prevHash:     fields.prevHash ?? null,
    createdAt:    fields.createdAt instanceof Date ? fields.createdAt.toISOString() : fields.createdAt,
  });
  return crypto.createHmac('sha256', HMAC_KEY).update(canonical).digest('hex');
}

/**
 * Fetch the most recent audit entry's entryHash for the given schoolId.
 * Used to link the new entry into the hash chain.
 */
async function _getPrevHash(schoolId) {
  const last = await AuditLog.findOne({ schoolId })
    .sort({ _id: -1 })
    .select('entryHash')
    .lean()
    .bypassTenantScope();
  return last ? (last.entryHash || null) : null;
}

/**
 * logAudit — append-only audit entry with hash chain.
 *
 * Never throws; audit failure must not break the primary operation.
 */
async function logAudit({
  schoolId,
  action,
  performedBy,
  targetId,
  targetType,
  details = {},
  result = 'success',
  errorMessage = null,
  ipAddress = null,
  userAgent = null,
  severity = null,
}) {
  try {
    const prevHash = await _getPrevHash(schoolId);
    const createdAt = new Date();

    const entryHash = _computeEntryHash({
      schoolId, action, performedBy, targetId, targetType,
      details, result, errorMessage, ipAddress, prevHash, createdAt,
    });

    await AuditLog.create({
      schoolId,
      action,
      performedBy,
      targetId,
      targetType,
      details,
      result,
      errorMessage,
      ipAddress,
      userAgent,
      ...(severity ? { severity } : {}),
      prevHash,
      entryHash,
      createdAt,
    });
  } catch (err) {
    _auditFailureCount += 1;
    logger.error('AUDIT_LOG_FAILURE', { err, schoolId, action });
  }
}

const MAX_PAGE_SIZE = 200;

// ── Cursor encode / decode ────────────────────────────────────────────────────

/**
 * Build a canonical filter fingerprint so cursors are tied to the active
 * filter set. Changing any filter param while using an old cursor is detected
 * and rejected.
 *
 * Only the fields that affect the query are included. Page/limit/cursor are
 * intentionally excluded.
 */
function _filterFingerprint({ schoolId, action, targetType, performedBy, result, search, startDate, endDate }) {
  return JSON.stringify({ schoolId, action, targetType, performedBy, result, search, startDate, endDate });
}

/**
 * Encode a signed, expiring pagination cursor.
 *
 * Payload: { createdAt (ISO), _id (hex string), filters (canonical), expiresAt (ms epoch) }
 * Envelope: base64url({ data: JSON.stringify(payload), sig: HMAC-SHA256(data) })
 */
function _signCursor(entry, filters) {
  const payload = {
    createdAt:  entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
    _id:        String(entry._id),
    filters:    _filterFingerprint(filters),
    expiresAt:  Date.now() + CURSOR_TTL_MS,
  };
  const data = JSON.stringify(payload);
  const sig  = crypto.createHmac('sha256', CURSOR_HMAC_KEY).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

/**
 * Decode and verify a pagination cursor.
 *
 * Returns the decoded payload, or throws an error with `code = 'INVALID_CURSOR'`
 * if the token is malformed, tampered, expired, or locked to a different filter set.
 */
function _verifyCursor(token, currentFilters) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
  } catch {
    const err = new Error('Cursor is malformed');
    err.code = 'INVALID_CURSOR';
    throw err;
  }

  const { data, sig } = envelope;
  if (typeof data !== 'string' || typeof sig !== 'string') {
    const err = new Error('Cursor is malformed');
    err.code = 'INVALID_CURSOR';
    throw err;
  }

  // Constant-time comparison to prevent timing attacks
  const expected = crypto.createHmac('sha256', CURSOR_HMAC_KEY).update(data).digest('hex');
  let sigMatch = false;
  try {
    sigMatch = crypto.timingSafeEqual(
      Buffer.from(sig.padEnd(64, '0'), 'hex'),
      Buffer.from(expected.padEnd(64, '0'), 'hex'),
    ) && sig.length === expected.length;
  } catch {
    sigMatch = false;
  }

  if (!sigMatch) {
    const err = new Error('Cursor signature is invalid');
    err.code = 'INVALID_CURSOR';
    throw err;
  }

  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    const err = new Error('Cursor payload is malformed');
    err.code = 'INVALID_CURSOR';
    throw err;
  }

  if (Date.now() > payload.expiresAt) {
    const err = new Error('Cursor has expired');
    err.code = 'INVALID_CURSOR';
    throw err;
  }

  const currentFingerprint = _filterFingerprint(currentFilters);
  if (payload.filters !== currentFingerprint) {
    const err = new Error('Cursor filters do not match current request');
    err.code = 'INVALID_CURSOR';
    throw err;
  }

  return payload;
}

// ── getAuditLogs ──────────────────────────────────────────────────────────────

/**
 * Retrieve paginated audit logs.
 *
 * Supports both cursor-based (stable, recommended) and offset (legacy) pagination.
 * See module-level JSDoc for full documentation.
 *
 * @param {object} filters
 * @returns {Promise<{logs, total, page, limit, pages, nextCursor, cursorExpiry}>}
 */
async function getAuditLogs(filters = {}) {
  const {
    schoolId, action, targetType, performedBy, result, search,
    startDate, endDate, cursor, page = 1, limit = 50,
  } = filters;

  const baseQuery = { schoolId };
  if (action)      baseQuery.action      = action;
  if (targetType)  baseQuery.targetType  = targetType;
  if (performedBy) baseQuery.performedBy = performedBy;
  if (result)      baseQuery.result      = result;
  if (search)      baseQuery.$text       = { $search: search };
  if (startDate || endDate) {
    baseQuery.createdAt = {};
    if (startDate) baseQuery.createdAt.$gte = new Date(startDate);
    if (endDate)   baseQuery.createdAt.$lte = new Date(endDate);
  }

  const actualLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), MAX_PAGE_SIZE);
  const actualPage  = Math.max(parseInt(page, 10) || 1, 1);

  const currentFilters = { schoolId, action, targetType, performedBy, result, search, startDate, endDate };

  // ── Index hint selection ────────────────────────────────────────────────────
  let indexHint;
  if (search)           indexHint = 'details_text';
  else if (action)      indexHint = { schoolId: 1, action: 1, createdAt: -1 };
  else if (performedBy) indexHint = { schoolId: 1, performedBy: 1, createdAt: -1 };
  else if (targetType)  indexHint = { schoolId: 1, targetType: 1, createdAt: -1 };
  else                  indexHint = { schoolId: 1, createdAt: -1 };

  const sortSpec = search ? { score: { $meta: 'textScore' } } : { createdAt: -1, _id: -1 };

  let logs;
  let total;
  let usedCursor = false;

  if (cursor) {
    // ── Cursor mode: keyset pagination (stable under inserts) ──────────────
    // _verifyCursor throws with code='INVALID_CURSOR' if the token is bad.
    const cursorPayload = _verifyCursor(cursor, currentFilters);
    usedCursor = true;

    const cursorDate = new Date(cursorPayload.createdAt);
    const cursorId   = cursorPayload._id;

    // Build a keyset condition that continues from where the last page ended.
    // We use ($lt createdAt) OR (== createdAt AND $lt _id) to handle ties.
    const keysetCondition = {
      $or: [
        { createdAt: { $lt: cursorDate } },
        { createdAt: cursorDate, _id: { $lt: cursorId } },
      ],
    };

    const pagedQuery = { ...baseQuery, ...keysetCondition };

    [logs, total] = await Promise.all([
      AuditLog.find(pagedQuery)
        .hint(indexHint)
        .sort(sortSpec)
        .limit(actualLimit)
        .lean(),
      AuditLog.countDocuments(baseQuery),
    ]);
  } else {
    // ── Offset mode: classic page/skip pagination ─────────────────────────
    const skip = (actualPage - 1) * actualLimit;

    [logs, total] = await Promise.all([
      AuditLog.find(baseQuery)
        .hint(indexHint)
        .sort(sortSpec)
        .skip(skip)
        .limit(actualLimit)
        .lean(),
      AuditLog.countDocuments(baseQuery),
    ]);
  }

  // Build the next cursor when there are more records after this page
  let nextCursor    = null;
  let cursorExpiry  = null;
  if (logs.length > 0) {
    const lastLog     = logs[logs.length - 1];
    const hasMore     = usedCursor
      ? logs.length === actualLimit   // cursor mode: fetch full page → likely more
      : (actualPage - 1) * actualLimit + logs.length < total;

    if (hasMore) {
      nextCursor   = _signCursor(lastLog, currentFilters);
      cursorExpiry = new Date(Date.now() + CURSOR_TTL_MS).toISOString();
    }
  }

  return {
    logs,
    total,
    page:        usedCursor ? null : actualPage,
    limit:       actualLimit,
    pages:       Math.ceil(total / actualLimit) || 1,
    nextCursor,
    cursorExpiry,
  };
}

async function getRecentAuditLogs(schoolId, limit = 10) {
  return AuditLog.find({ schoolId }).sort({ createdAt: -1 }).limit(limit).lean();
}

/**
 * verifyAuditChain — walks the chain for a school and reports broken links.
 *
 * Returns { ok: boolean, scanned: number, broken: Array<{ _id, reason }> }
 *
 * Broken entries are those where:
 *   (a) recomputed entryHash !== stored entryHash, or
 *   (b) stored prevHash !== entryHash of the prior record.
 */
async function verifyAuditChain(schoolId, { limit = 1000 } = {}) {
  const entries = await AuditLog.find({ schoolId })
    .sort({ _id: 1 })
    .limit(limit)
    .lean()
    .bypassTenantScope();

  const broken = [];
  let prevHash = null;

  for (const entry of entries) {
    // (a) Recompute hash to detect field-level tampering
    const recomputed = _computeEntryHash({
      schoolId:     entry.schoolId,
      action:       entry.action,
      performedBy:  entry.performedBy,
      targetId:     entry.targetId,
      targetType:   entry.targetType,
      details:      entry.details,
      result:       entry.result,
      errorMessage: entry.errorMessage,
      ipAddress:    entry.ipAddress,
      prevHash:     entry.prevHash,
      createdAt:    entry.createdAt,
    });

    if (recomputed !== entry.entryHash) {
      broken.push({ _id: entry._id, reason: 'entryHash_mismatch' });
    } else if (entry.prevHash !== prevHash) {
      // (b) Chain link broken: this entry doesn't point to the previous one
      broken.push({ _id: entry._id, reason: 'chain_link_broken' });
    }

    prevHash = entry.entryHash;
  }

  return { ok: broken.length === 0, scanned: entries.length, broken };
}

/** Maximum number of rows that may be exported in a single request. */
const MAX_EXPORT_ROWS = 10000;

/**
 * exportAuditLogs — fetch up to MAX_EXPORT_ROWS matching records and return
 * them as a flat array suitable for CSV or JSON serialisation.
 *
 * Accepts the same filter parameters as getAuditLogs (minus pagination).
 * Sorted oldest-first so the export is chronologically readable.
 *
 * @param {object} filters - { schoolId, action, targetType, performedBy,
 *                             result, startDate, endDate, limit? }
 * @returns {Promise<Array>}  array of plain audit log objects
 */
async function exportAuditLogs(filters = {}) {
  const {
    schoolId, action, targetType, performedBy, result,
    startDate, endDate,
    limit: requestedLimit,
  } = filters;

  const query = { schoolId };
  if (action)      query.action      = action;
  if (targetType)  query.targetType  = targetType;
  if (performedBy) query.performedBy = performedBy;
  if (result)      query.result      = result;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate)   query.createdAt.$lte = new Date(endDate);
  }

  const rowLimit = Math.min(
    Math.max(parseInt(requestedLimit, 10) || MAX_EXPORT_ROWS, 1),
    MAX_EXPORT_ROWS,
  );

  return AuditLog.find(query)
    .sort({ createdAt: 1 })
    .limit(rowLimit)
    .lean();
}

/**
 * archiveAuditLogs — marks records older than retentionDays as archived=true.
 * Records are never deleted; archiving signals they can be exported to cold storage.
 */
async function archiveAuditLogs(retentionDays = 730) {
  const expiry = new Date(Date.now() - retentionDays * 86400000);
  const result = await AuditLog.updateMany(
    { createdAt: { $lt: expiry }, archived: false },
    { $set: { archived: true } },
  ).bypassTenantScope();
  if (result.modifiedCount > 0) {
    logger.info('AUDIT_LOG_ARCHIVE', { archivedCount: result.modifiedCount });
  }
  return result.modifiedCount;
}

module.exports = {
  logAudit,
  getAuditLogs,
  getRecentAuditLogs,
  exportAuditLogs,
  getAuditHealth,
  verifyAuditChain,
  archiveAuditLogs,
  _resetAuditFailureCount,
  // Exported for testing
  _computeEntryHash,
  _signCursor,
  _verifyCursor,
  CURSOR_TTL_MS,
  MAX_EXPORT_ROWS,
};
