'use strict';

const express = require('express');
const router = express.Router();
const {
  registerStudent,
  getAllStudents,
  getStudent,
  getPublicStudentInfo,
  updateStudent,
  deleteStudent,
  restoreStudent,
  getDeletedStudentPayments,
  getPaymentSummary,
  bulkImportStudents,
  getOverdueStudents,
  resetPayment,
  reconcileStudent,
  getFeeHistory,
  exportStudents,
  adjustStudentCredit,
} = require('../controllers/studentController');
const { resubscribeReminders } = require('../controllers/reminderController');
const { getImportJobStatus } = require('../controllers/importJobController');
const { validateRegisterStudent, validateStudentIdParam, validatePagination, validateUpdateStudent } = require('../middleware/validate');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireAdminAuth, requireSchoolAuth } = require('../middleware/auth');
const { auditContext } = require('../middleware/auditContext');
const { bulkImportLimiter } = require('../middleware/rateLimiter');
const streamingCsvUpload = require('../middleware/streamingCsvUpload');

router.use(resolveSchool);

// Admin-only routes
router.post('/', requireAdminAuth, validateRegisterStudent, registerStudent);
router.post('/bulk', requireAdminAuth, bulkImportLimiter, express.json({ limit: '1mb' }), streamingCsvUpload({ requiredHeaders: ['studentId', 'name', 'class'] }), bulkImportStudents);
router.get('/', requireAdminAuth, validatePagination, getAllStudents);
router.get('/export', requireAdminAuth, exportStudents);

// Import job status — registered BEFORE /:studentId so Express does not
// capture the literal segment 'import' as a studentId parameter.
router.get('/import/:jobId', requireAdminAuth, getImportJobStatus);

// Authentication-required routes (Issue #1040: all student financial data requires auth)
router.get('/summary', requireSchoolAuth(), getPaymentSummary);
router.get('/overdue', requireSchoolAuth(), getOverdueStudents);

// Public routes
router.get('/public/:studentId', validateStudentIdParam, getPublicStudentInfo);
router.get('/:studentId', requireAdminAuth, validateStudentIdParam, getStudent);
router.put('/:studentId', requireAdminAuth, validateStudentIdParam, validateUpdateStudent, auditContext, updateStudent);
router.delete('/:studentId', requireAdminAuth, validateStudentIdParam, auditContext, deleteStudent);
router.post('/:studentId/restore', requireAdminAuth, validateStudentIdParam, auditContext, restoreStudent);
router.get('/:studentId/payments/audit', requireAdminAuth, validateStudentIdParam, getDeletedStudentPayments);
router.post('/:studentId/reset-payment', requireAdminAuth, validateStudentIdParam, resetPayment);
router.post('/:studentId/reconcile', requireAdminAuth, validateStudentIdParam, reconcileStudent);
router.post('/:studentId/reminders/resubscribe', requireAdminAuth, validateStudentIdParam, resubscribeReminders);
router.get('/:studentId/fee-history', requireAdminAuth, validateStudentIdParam, getFeeHistory);
router.post('/:studentId/credit-adjustments', requireAdminAuth, validateStudentIdParam, auditContext, adjustStudentCredit);

module.exports = router;
