'use strict';

/**
 * paymentTransitionService — domain service for explicit payment status transitions.
 *
 * This is the single authoritative path for all payment status changes. It:
 *   1. Validates the transition is legal using the canonical transition tables
 *      in constants/paymentStatus.js (Issue #72 / #32).
 *   2. Applies the change via Mongoose .save() so every pre-save hook fires.
 *   3. Writes a structured audit entry (actor, from, to, reason, result).
 *   4. Returns a stable { ok, payment, previousStatus } / { ok: false, error, code }
 *      envelope so callers never have to inspect thrown exceptions for transition
 *      rejections.
 *
 * Illegal transitions return { ok: false } — they are NOT thrown exceptions.
 * Infrastructure failures (DB errors etc.) are still thrown so callers can
 * surface them as 500s through the normal error handler.
 *
 * Usage:
 *   const { transition } = require('./paymentTransitionService');
 *
 *   const result = await transition(payment, 'REFUNDED', {
 *     adminOverride: true,
 *     reason:        'Manual correction after reconciliation',
 *     performedBy:   req.auditContext?.performedBy,
 *     schoolId:      req.schoolId,
 *     ipAddress:     req.auditContext?.ipAddress,
 *     userAgent:     req.auditContext?.userAgent,
 *   });
 *
 *   if (!result.ok) {
 *     return res.status(400).json({ error: result.error, code: result.code });
 *   }
 */

const {
  PAYMENT_STATUS,
  PAYMENT_STATUS_TRANSITIONS,
  ADMIN_PAYMENT_STATUS_TRANSITIONS,
  isTransitionAllowed,
} = require('../constants/paymentStatus');
const { logAudit } = require('./auditService');
const logger = require('../utils/logger');

/**
 * Attempt a payment status transition and persist the result.
 *
 * @param {object} payment        - Mongoose Payment document (not a lean object)
 * @param {string} toStatus       - Target PAYMENT_STATUS value
 * @param {object} opts
 * @param {boolean} [opts.adminOverride=false] - Allow admin-only transitions
 * @param {string}  [opts.reason]       - Human-readable reason (required for audit)
 * @param {string}  [opts.performedBy]  - Actor identifier (email or userId)
 * @param {string}  [opts.schoolId]     - School scoping for audit entry
 * @param {string}  [opts.ipAddress]    - Request IP for audit entry
 * @param {string}  [opts.userAgent]    - User-Agent header for audit entry
 *
 * @returns {Promise<{ok: true, payment: object, previousStatus: string}
 *                 | {ok: false, error: string, code: string}>}
 */
async function transition(payment, toStatus, opts = {}) {
  const {
    adminOverride = false,
    reason        = null,
    performedBy   = 'unknown',
    schoolId      = payment.schoolId,
    ipAddress     = null,
    userAgent     = null,
  } = opts;

  const fromStatus = payment.status;
  const txHash = payment.txHash;

  // ── 1. Validate ────────────────────────────────────────────────────────────
  if (!toStatus || !Object.values(PAYMENT_STATUS).includes(toStatus)) {
    return { ok: false, error: `Unknown status: ${toStatus}`, code: 'INVALID_STATUS' };
  }

  // Reject any attempt to transition to PENDING — it is only ever the initial
  // state assigned at creation time.
  if (toStatus === PAYMENT_STATUS.PENDING) {
    const err = 'Cannot transition to PENDING';
    await _auditFailure(schoolId, txHash, fromStatus, toStatus, reason, performedBy, err, ipAddress, userAgent);
    return { ok: false, error: err, code: 'INVALID_TRANSITION' };
  }

  if (!isTransitionAllowed(fromStatus, toStatus, adminOverride)) {
    const table = adminOverride ? ADMIN_PAYMENT_STATUS_TRANSITIONS : PAYMENT_STATUS_TRANSITIONS;
    const allowed = table[fromStatus] || [];
    const err = `Cannot transition from ${fromStatus} to ${toStatus}. Allowed: [${allowed.join(', ')}]`;
    await _auditFailure(schoolId, txHash, fromStatus, toStatus, reason, performedBy, err, ipAddress, userAgent);
    return { ok: false, error: err, code: 'INVALID_TRANSITION' };
  }

  // ── 2. Apply ───────────────────────────────────────────────────────────────
  // Set $locals.adminOverride so the model's pre-save hook uses the wider
  // ADMIN_PAYMENT_STATUS_TRANSITIONS table when validating. $locals is
  // Mongoose's per-document transient store — never persisted.
  if (adminOverride) {
    payment.$locals = payment.$locals || {};
    payment.$locals.adminOverride = true;
  }
  payment.status = toStatus;

  const updated = await payment.save();

  // ── 3. Audit ───────────────────────────────────────────────────────────────
  await logAudit({
    schoolId,
    action:      'payment_status_transition',
    performedBy,
    targetId:    txHash || String(payment._id),
    targetType:  'payment',
    details: {
      from:          fromStatus,
      to:            toStatus,
      reason:        reason || null,
      adminOverride: !!adminOverride,
      transitionedAt: new Date().toISOString(),
    },
    result:      'success',
    ipAddress,
    userAgent,
  });

  logger.info('[PaymentTransitionService] Status transition recorded', {
    schoolId,
    txHash,
    from: fromStatus,
    to: toStatus,
    performedBy,
    adminOverride: !!adminOverride,
  });

  return { ok: true, payment: updated, previousStatus: fromStatus };
}

/**
 * Write a failure audit entry for a rejected transition (no secret values).
 * Internal helper — never throws.
 * @private
 */
async function _auditFailure(schoolId, txHash, from, to, reason, performedBy, errorMessage, ipAddress, userAgent) {
  try {
    await logAudit({
      schoolId,
      action:      'payment_status_transition',
      performedBy: performedBy || 'unknown',
      targetId:    txHash || 'unknown',
      targetType:  'payment',
      details: {
        from,
        to,
        reason: reason || null,
        rejected: true,
      },
      result:       'failure',
      errorMessage,
      ipAddress,
      userAgent,
    });
  } catch (auditErr) {
    logger.error('[PaymentTransitionService] Failed to write rejection audit entry', {
      error: auditErr.message,
    });
  }
}

/**
 * Convenience wrapper for a pre-fetched txHash.
 * Looks up the payment by txHash + schoolId, runs the transition, and returns
 * the envelope. Callers that already hold the Mongoose document should use
 * `transition()` directly.
 *
 * @param {object} Payment - Mongoose model (injected to avoid circular deps)
 * @param {string} txHash
 * @param {string} toStatus
 * @param {object} opts - same as transition()
 * @returns {Promise<{ok: true, payment, previousStatus}|{ok: false, error, code}>}
 */
async function transitionByHash(Payment, txHash, toStatus, opts = {}) {
  const { schoolId } = opts;
  const payment = await Payment.findOne({ schoolId, txHash });
  if (!payment) {
    return { ok: false, error: 'Payment not found', code: 'NOT_FOUND' };
  }
  return transition(payment, toStatus, opts);
}

module.exports = { transition, transitionByHash };
