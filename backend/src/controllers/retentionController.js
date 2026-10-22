'use strict';

const { runRetention, ALL_SCOPES } = require('../services/retentionService');
const logger = require('../utils/logger').child('RetentionController');

/**
 * POST /api/admin/retention/run
 *
 * Body (all optional):
 *   { dryRun: boolean, scopes: string[] }
 *
 * dryRun defaults to true for safety — callers must explicitly pass
 * dryRun=false to perform live deletions.
 */
async function runRetentionHandler(req, res) {
  const { dryRun = true, scopes } = req.body || {};

  // Validate scopes if provided
  if (scopes !== undefined) {
    if (!Array.isArray(scopes) || scopes.some((s) => !ALL_SCOPES.includes(s))) {
      return res.status(400).json({
        error: `Invalid scopes. Allowed values: ${ALL_SCOPES.join(', ')}`,
        code:  'VALIDATION_ERROR',
      });
    }
    if (scopes.length === 0) {
      return res.status(400).json({
        error: 'scopes must be a non-empty array or omitted to run all scopes.',
        code:  'VALIDATION_ERROR',
      });
    }
  }

  const performedBy = req.user?.id || req.user?.email || 'admin';

  try {
    const report = await runRetention({ dryRun: Boolean(dryRun), scopes, performedBy });
    return res.status(200).json(report);
  } catch (err) {
    logger.error('Retention run failed', { error: err.message, dryRun, scopes });
    return res.status(500).json({
      error: 'Retention run failed.',
      code:  'INTERNAL_ERROR',
    });
  }
}

/**
 * GET /api/admin/retention/preview
 *
 * Convenience alias for a full dry-run across all scopes.
 * No body required.
 */
async function previewRetentionHandler(req, res) {
  try {
    const report = await runRetention({ dryRun: true });
    return res.status(200).json(report);
  } catch (err) {
    logger.error('Retention preview failed', { error: err.message });
    return res.status(500).json({
      error: 'Retention preview failed.',
      code:  'INTERNAL_ERROR',
    });
  }
}

module.exports = { runRetentionHandler, previewRetentionHandler };
