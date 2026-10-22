'use strict';

const Joi = require('joi');

const {
  createPaymentIntentSchema,
  submitTransactionSchema,
  verifyPaymentSchema,
} = require('./schemas/paymentSchemas');

const {
  getPaymentInstructionsQuerySchema,
} = require('./schemas/paymentQuerySchemas');

const {
  paginationSchema,
  exportPaginationSchema,
  auditQuerySchema,
  updateStudentSchema,
  createDisputeSchema,
  createFeeAdjustmentSchema,
  createWebhookEndpointSchema,
  createSchoolSchema,
  updateSchoolSchema,
} = require('./schemas/requestLimitSchemas');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      convert:    true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field:   detail.context?.key || detail.path.join('.') || 'unknown',
        message: detail.message,
      }));
      return res.status(400).json({ errors });
    }

    req[source] = value;
    return next();
  };
}

const validateCreatePaymentIntent = validate(createPaymentIntentSchema, 'body');
const validateSubmitTransaction = validate(submitTransactionSchema, 'body');
const validateVerifyPayment = validate(verifyPaymentSchema, 'body');

const STUDENT_ID_RE = /^[\w-]{1,28}$/;

function validStudentId(id) {
  return typeof id === 'string' && STUDENT_ID_RE.test(id);
}

function validPositiveNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0;
}

function validTxHash(hash) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
}

/** Middleware: validate :studentId URL param */
function validateStudentIdParam(req, res, next) {
  const { studentId } = req.params;
  if (typeof studentId !== 'string' || !STUDENT_ID_RE.test(studentId)) {
    return res.status(400).json({ error: 'Invalid studentId format', code: 'VALIDATION_ERROR' });
  }
  return next();
}

/** Middleware: validate the query string of GET /payments/instructions/:studentId */
function validatePaymentInstructionsQuery(req, res, next) {
  const { error, value } = getPaymentInstructionsQuerySchema.validate(req.query, {
    abortEarly: false,
    convert:    true,
  });

  if (error) {
    return res.status(400).json({
      error: error.details[0].message,
      code:  'VALIDATION_ERROR',
      errors: error.details.map(detail => ({
        field:   detail.context?.key || detail.path.join('.') || 'unknown',
        message: detail.message,
      })),
    });
  }

  req.query = value;
  return next();
}

/** Middleware: validate :txHash URL param */
function validateTxHashParam(req, res, next) {
  if (!validTxHash(req.params.txHash)) {
    return res.status(400).json({ errors: [{ field: 'txHash', message: 'Invalid txHash format' }] });
  }
  return next();
}

/** Middleware: validate POST /api/students body */
function validateRegisterStudent(req, res, next) {
  const errors = [];
  const body = req.body || {};

  // studentId — optional (auto-generated if absent), but must be valid if provided
  let studentId = body.studentId != null ? String(body.studentId).trim() : undefined;
  if (studentId !== undefined && !validStudentId(studentId)) {
    errors.push({ field: 'studentId', message: 'studentId must be 3–20 alphanumeric/dash/underscore characters' });
  }

  // name — required, sanitize
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    errors.push({ field: 'name', message: 'name is required' });
  }

  // class — required, sanitize
  const className = typeof body.class === 'string' ? body.class.trim() : '';
  if (!className) {
    errors.push({ field: 'class', message: 'class is required' });
  }

  // feeAmount — optional, but must be positive number if provided
  let feeAmount = body.feeAmount;
  if (feeAmount != null) {
    feeAmount = Number(feeAmount);
    if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
      errors.push({ field: 'feeAmount', message: 'feeAmount must be a positive number' });
    }
  }

  if (errors.length) return res.status(400).json({ errors });

  // Write sanitized values back so the controller uses clean data
  req.body = { ...body, name, class: className };
  if (studentId !== undefined) req.body.studentId = studentId;
  if (feeAmount != null) req.body.feeAmount = feeAmount;

  return next();
}

function validateFeeStructure(req, res, next) {
  const { className, feeAmount } = req.body;
  const errors = [];

  if (!className || typeof className !== 'string' || !className.trim()) errors.push('className is required');
  if (!validPositiveNumber(feeAmount)) errors.push('feeAmount must be a positive number');

  if (errors.length) return res.status(400).json({ errors });
  return next();
}

// ── Request-limit middleware (Issue #41) ──────────────────────────────────────

/**
 * Validate pagination query params (page, limit) before any DB query.
 * Applies to all list endpoints. Allows unknown params through.
 */
function validatePagination(req, res, next) {
  const { error, value } = paginationSchema.validate(req.query, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.query = { ...req.query, ...value };
  return next();
}

/**
 * Validate export pagination — allows up to 10 000 rows.
 */
function validateExportPagination(req, res, next) {
  const { error, value } = exportPaginationSchema.validate(req.query, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.query = { ...req.query, ...value };
  return next();
}

/**
 * Validate audit log query parameters — enforces max lengths on all filter
 * strings before they reach the DB layer.
 */
function validateAuditQuery(req, res, next) {
  const { error, value } = auditQuerySchema.validate(req.query, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.query = value;
  return next();
}

/**
 * Validate PUT /api/students/:studentId body.
 */
function validateUpdateStudent(req, res, next) {
  const { error, value } = updateStudentSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate POST /api/disputes body.
 */
function validateCreateDispute(req, res, next) {
  const { error, value } = createDisputeSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate POST /api/fee-adjustments body.
 */
function validateCreateFeeAdjustment(req, res, next) {
  const { error, value } = createFeeAdjustmentSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate POST /api/webhooks/endpoints body.
 */
function validateCreateWebhookEndpoint(req, res, next) {
  const { error, value } = createWebhookEndpointSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate POST /api/schools body.
 */
function validateCreateSchool(req, res, next) {
  const { error, value } = createSchoolSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

/**
 * Validate PUT /api/schools/:id body.
 */
function validateUpdateSchool(req, res, next) {
  const { error, value } = updateSchoolSchema.validate(req.body || {}, {
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const errors = error.details.map((d) => ({
      field:   d.context?.key || d.path.join('.') || 'unknown',
      message: d.message,
    }));
    return res.status(400).json({ errors, code: 'VALIDATION_ERROR' });
  }
  req.body = value;
  return next();
}

module.exports = {
  validate,
  validateCreatePaymentIntent,
  validateSubmitTransaction,
  validateVerifyPayment,
  validateStudentIdParam,
  validatePaymentInstructionsQuery,
  validateTxHashParam,
  validateRegisterStudent,
  validateFeeStructure,
  // Issue #41 — request body and parameter limits
  validatePagination,
  validateExportPagination,
  validateAuditQuery,
  validateUpdateStudent,
  validateCreateDispute,
  validateCreateFeeAdjustment,
  validateCreateWebhookEndpoint,
  validateCreateSchool,
  validateUpdateSchool,
};
