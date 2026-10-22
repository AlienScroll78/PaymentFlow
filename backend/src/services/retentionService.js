'use strict';

/**
 * Retention Service
 *
 * Provides configurable, auditable retention for all ephemeral operational
 * data. Each scope can be:
 *   - previewed (dryRun=true)  → returns candidate counts, touches nothing
 *   - executed  (dryRun=false) → deletes eligible records and writes an audit
 *
 * Financial records (Payment, Receipt, PaymentPlan) are never eligible for
 * deletion — this is enforced unconditionally by this service regardless of
 * the requested scopes.
 *
 * Supported scopes:
 *   webhookDeliveries  – delivered / failed webhook delivery log entries
 *   webhookRetries     – completed/failed webhook retry queue entries
 *   emailDeliveries    – completed email delivery records
 *   reportJobs         – completed/failed report export jobs
 *   expiredSessions    – expired PaymentIntent records (status=expired)
 *   auditLogs          – archive-only; never hard-deleted
 *
 * Environment variables (all optional, with defaults):
 *   WEBHOOK_DELIVERY_RETENTION_DAYS  (default 90)
 *   WEBHOOK_RETRY_RETENTION_DAYS     (default 30)
 *   EMAIL_DELIVERY_RETENTION_DAYS    (default 90)
 *   REPORT_JOB_RETENTION_DAYS        (default 7)
 *   SESSION_RETENTION_DAYS           (default 1)
 *   AUDIT_LOG_RETENTION_DAYS         (default 730)
 */

const logger = require('../utils/logger').child('RetentionService');
const { logAudit } = require('./auditService');
const { archiveAuditLogs } = require('./auditService');

// ── Retention policy defaults ─────────────────────────────────────────────────
const DEFAULTS = {
  webhookDeliveries: 90,
  webhookRetries:    30,
  emailDeliveries:   90,
  reportJobs:        7,
  expiredSessions:   1,
  auditLogs:         730,
};

function retentionDays(scope) {
  const ENV = {
    webhookDeliveries: 'WEBHOOK_DELIVERY_RETENTION_DAYS',
    webhookRetries:    'WEBHOOK_RETRY_RETENTION_DAYS',
    emailDeliveries:   'EMAIL_DELIVERY_RETENTION_DAYS',
    reportJobs:        'REPORT_JOB_RETENTION_DAYS',
    expiredSessions:   'SESSION_RETENTION_DAYS',
    auditLogs:         'AUDIT_LOG_RETENTION_DAYS',
  };
  const raw = parseInt(process.env[ENV[scope]], 10);
  return (Number.isFinite(raw) && raw > 0) ? raw : DEFAULTS[scope];
}

function cutoffDate(scope) {
  return new Date(Date.now() - retentionDays(scope) * 24 * 60 * 60 * 1000);
}

/** All supported scopes, in a stable execution order. */
const ALL_SCOPES = [
  'webhookDeliveries',
  'webhookRetries',
  'emailDeliveries',
  'reportJobs',
  'expiredSessions',
  'auditLogs',
];

// ── Financial-record guard ────────────────────────────────────────────────────
// These collections must never be touched by retention. Hardcoded as a
// defence-in-depth measure — no caller can override this list.
const FINANCIAL_MODELS = ['Payment', 'Receipt', 'PaymentPlan'];

/**
 * Run retention across the requested scopes.
 *
 * @param {object}   opts
 * @param {boolean}  opts.dryRun   – true = count only, false = delete + audit
 * @param {string[]} [opts.scopes] – subset of ALL_SCOPES; defaults to all
 * @param {string}   [opts.performedBy] – identity of the triggering admin
 *
 * @returns {Promise<object>} Report object:
 *   {
 *     dryRun: boolean,
 *     executedAt: ISO string,
 *     scopes: {
 *       [scopeName]: { retentionDays, cutoff, candidates, deleted }
 *     },
 *     totals: { candidates, deleted },
 *     protected: string[]   — always lists the financial models
 *   }
 */
async function runRetention({ dryRun = true, scopes, performedBy = 'system' } = {}) {
  const requestedScopes = Array.isArray(scopes)
    ? scopes.filter((s) => ALL_SCOPES.includes(s))
    : ALL_SCOPES;

  const executedAt = new Date().toISOString();
  const report = {
    dryRun,
    executedAt,
    scopes: {},
    totals: { candidates: 0, deleted: 0 },
    protected: FINANCIAL_MODELS,
  };

  for (const scope of requestedScopes) {
    try {
      const result = await _runScope(scope, dryRun);
      report.scopes[scope] = result;
      report.totals.candidates += result.candidates;
      report.totals.deleted += result.deleted;
    } catch (err) {
      logger.error(`Retention scope failed: ${scope}`, { error: err.message, dryRun });
      report.scopes[scope] = { error: err.message, candidates: 0, deleted: 0 };
    }
  }

  if (!dryRun) {
    // Write a single system-level audit entry covering the full run
    await logAudit({
      schoolId: 'system',
      action:   'RETENTION_RUN',
      performedBy,
      targetId: 'system',
      targetType: 'school',
      details: {
        scopes:    requestedScopes,
        totals:    report.totals,
        perScope:  Object.fromEntries(
          Object.entries(report.scopes).map(([k, v]) => [k, {
            retentionDays: v.retentionDays,
            cutoff:        v.cutoff,
            deleted:       v.deleted ?? 0,
          }])
        ),
        protected: FINANCIAL_MODELS,
      },
      result: 'success',
    }).catch((err) => {
      logger.error('Retention audit write failed', { error: err.message });
    });
  }

  logger.info('Retention run complete', {
    dryRun,
    totals:        report.totals,
    scopeCount:    requestedScopes.length,
  });

  return report;
}

// ── Per-scope handlers ────────────────────────────────────────────────────────

async function _runScope(scope, dryRun) {
  switch (scope) {
    case 'webhookDeliveries': return _retainWebhookDeliveries(dryRun);
    case 'webhookRetries':    return _retainWebhookRetries(dryRun);
    case 'emailDeliveries':   return _retainEmailDeliveries(dryRun);
    case 'reportJobs':        return _retainReportJobs(dryRun);
    case 'expiredSessions':   return _retainExpiredSessions(dryRun);
    case 'auditLogs':         return _retainAuditLogs(dryRun);
    default:
      throw new Error(`Unknown retention scope: ${scope}`);
  }
}

async function _retainWebhookDeliveries(dryRun) {
  const WebhookDelivery = require('../models/webhookDeliveryModel');
  const days   = retentionDays('webhookDeliveries');
  const cutoff = cutoffDate('webhookDeliveries');
  // Only delete records that are past the retention window. MongoDB's TTL
  // index handles automated expiry, but this lets us report counts + give
  // admins an on-demand purge path with an audit trail.
  const query = { createdAt: { $lt: cutoff } };
  const candidates = await WebhookDelivery.countDocuments(query);
  let deleted = 0;
  if (!dryRun && candidates > 0) {
    const result = await WebhookDelivery.deleteMany(query);
    deleted = result.deletedCount;
  }
  return { retentionDays: days, cutoff: cutoff.toISOString(), candidates, deleted };
}

async function _retainWebhookRetries(dryRun) {
  const WebhookRetry = require('../models/webhookRetryModel');
  const days   = retentionDays('webhookRetries');
  const cutoff = cutoffDate('webhookRetries');
  // Only terminal states — never touch 'pending' or 'processing' records
  const query = {
    status:    { $in: ['succeeded', 'failed'] },
    createdAt: { $lt: cutoff },
  };
  const candidates = await WebhookRetry.countDocuments(query);
  let deleted = 0;
  if (!dryRun && candidates > 0) {
    const result = await WebhookRetry.deleteMany(query);
    deleted = result.deletedCount;
  }
  return { retentionDays: days, cutoff: cutoff.toISOString(), candidates, deleted };
}

async function _retainEmailDeliveries(dryRun) {
  const EmailDelivery = require('../models/emailDeliveryModel');
  const days   = retentionDays('emailDeliveries');
  const cutoff = cutoffDate('emailDeliveries');
  // Only terminal states — never touch 'queued' or 'sent' (still in-flight)
  const query = {
    status:    { $in: ['delivered', 'failed', 'bounced', 'complaint', 'skipped'] },
    createdAt: { $lt: cutoff },
  };
  const candidates = await EmailDelivery.countDocuments(query);
  let deleted = 0;
  if (!dryRun && candidates > 0) {
    const result = await EmailDelivery.deleteMany(query);
    deleted = result.deletedCount;
  }
  return { retentionDays: days, cutoff: cutoff.toISOString(), candidates, deleted };
}

async function _retainReportJobs(dryRun) {
  const { ReportJob } = require('../models/reportJobModel');
  const days   = retentionDays('reportJobs');
  const cutoff = cutoffDate('reportJobs');
  // Only completed/failed jobs — never delete pending/processing exports
  const query = {
    status:    { $in: ['completed', 'failed'] },
    createdAt: { $lt: cutoff },
  };
  const candidates = await ReportJob.countDocuments(query);
  let deleted = 0;
  if (!dryRun && candidates > 0) {
    const result = await ReportJob.deleteMany(query);
    deleted = result.deletedCount;
  }
  return { retentionDays: days, cutoff: cutoff.toISOString(), candidates, deleted };
}

async function _retainExpiredSessions(dryRun) {
  const PaymentIntent = require('../models/paymentIntentModel');
  const days   = retentionDays('expiredSessions');
  const cutoff = cutoffDate('expiredSessions');
  // Only already-expired intents (the session cleanup scheduler marks them
  // expired; MongoDB's TTL removes them after PAYMENT_INTENT_TTL_SECONDS).
  // This scope gives an on-demand count and explicit deletion with audit.
  const query = {
    status:    'expired',
    expiresAt: { $lt: cutoff },
  };
  const candidates = await PaymentIntent.countDocuments(query);
  let deleted = 0;
  if (!dryRun && candidates > 0) {
    const result = await PaymentIntent.deleteMany(query);
    deleted = result.deletedCount;
  }
  return { retentionDays: days, cutoff: cutoff.toISOString(), candidates, deleted };
}

async function _retainAuditLogs(dryRun) {
  // Audit logs are NEVER hard-deleted — compliance requirement.
  // This scope archives (marks archived=true) old entries so they can be
  // offloaded to cold storage. Returns the archive count as 'candidates'.
  const days = retentionDays('auditLogs');
  let archived = 0;
  if (!dryRun) {
    archived = await archiveAuditLogs(days);
  } else {
    // Dry-run: count how many would be archived
    const AuditLog = require('../models/auditLogModel');
    const cutoff = cutoffDate('auditLogs');
    archived = await AuditLog.countDocuments({ createdAt: { $lt: cutoff }, archived: false });
  }
  const cutoff = cutoffDate('auditLogs');
  return {
    retentionDays: days,
    cutoff:        cutoff.toISOString(),
    candidates:    archived,
    deleted:       0,        // never deleted
    archived:      dryRun ? 0 : archived,
    note:          'Audit logs are archived, never deleted.',
  };
}

module.exports = {
  runRetention,
  ALL_SCOPES,
  DEFAULTS,
  retentionDays,
  cutoffDate,
  FINANCIAL_MODELS,
};
