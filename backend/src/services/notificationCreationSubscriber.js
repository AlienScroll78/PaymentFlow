'use strict';

/**
 * notificationCreationSubscriber.js
 *
 * Subscribes to the paymentEvents EventEmitter and creates in-app notifications
 * for significant payment and dispute lifecycle events.
 *
 * Security:
 *   - Notification metadata must NOT contain txHash, wallet addresses, or raw PII
 *     beyond studentId. Titles and messages use only safe display values.
 *   - schoolId scoping is enforced by inAppNotificationService.createNotification.
 *   - Errors are caught and logged — a notification write failure must not
 *     interrupt the main payment / dispute processing path.
 *
 * Registered once at app startup via registerNotificationSubscribers().
 */

const paymentEvents = require('../events/paymentEvents');
const { createNotification } = require('./inAppNotificationService');
const logger = require('../utils/logger').child('NotificationSubscriber');

/**
 * Handle a 'payment.saved' event.
 *
 * payment.saved fires when a payment is persisted to MongoDB after on-chain
 * confirmation. The payment document contains status, schoolId, studentId,
 * amount, and assetCode.
 *
 * @param {object} payment - The saved Payment document
 */
async function onPaymentSaved(payment) {
  const { schoolId, studentId, amount, assetCode, status } = payment || {};

  if (!schoolId) {
    logger.warn('payment.saved event missing schoolId — notification skipped');
    return;
  }

  // Only create notifications for confirmed and failed states
  const isFailed = status === 'FAILED' || status === 'VERIFICATION_FAILED';
  const isConfirmed = status === 'CONFIRMED' || status === 'PAID';

  if (!isConfirmed && !isFailed) {
    return;
  }

  const notifData = isConfirmed
    ? {
        type: 'payment.confirmed',
        severity: 'info',
        title: 'Payment Confirmed',
        message: amount && assetCode
          ? `Payment of ${amount} ${assetCode} confirmed for student ${studentId}.`
          : `Payment confirmed for student ${studentId}.`,
        deepLink: studentId ? `/dashboard?student=${encodeURIComponent(studentId)}` : null,
        metadata: { studentId, amount, assetCode },
      }
    : {
        type: 'payment.failed',
        severity: 'warning',
        title: 'Payment Verification Failed',
        message: `Payment verification failed for student ${studentId}. Please check the transaction.`,
        deepLink: studentId ? `/dashboard?student=${encodeURIComponent(studentId)}` : null,
        metadata: { studentId },
      };

  try {
    await createNotification({ schoolId, ...notifData });
  } catch (err) {
    logger.error('Failed to create payment notification', {
      schoolId,
      studentId,
      err: err.message,
    });
  }
}

/**
 * Handle a 'dispute.created' event.
 *
 * @param {object} payload - { schoolId, studentId, disputeId }
 */
async function onDisputeCreated(payload) {
  const { schoolId, studentId } = payload || {};

  if (!schoolId) {
    logger.warn('dispute.created event missing schoolId — notification skipped');
    return;
  }

  try {
    await createNotification({
      schoolId,
      type: 'dispute.created',
      severity: 'warning',
      title: 'New Dispute Opened',
      message: `A dispute has been opened for student ${studentId}.`,
      deepLink: '/disputes',
      metadata: { studentId },
    });
  } catch (err) {
    logger.error('Failed to create dispute.created notification', {
      schoolId,
      studentId,
      err: err.message,
    });
  }
}

/**
 * Handle a 'dispute.updated' event.
 *
 * @param {object} payload - { schoolId, studentId, status }
 */
async function onDisputeUpdated(payload) {
  const { schoolId, studentId, status } = payload || {};

  if (!schoolId) {
    logger.warn('dispute.updated event missing schoolId — notification skipped');
    return;
  }

  try {
    await createNotification({
      schoolId,
      type: 'dispute.updated',
      severity: 'info',
      title: 'Dispute Updated',
      message: status
        ? `Dispute for student ${studentId} is now ${status}.`
        : `Dispute status updated for student ${studentId}.`,
      deepLink: '/disputes',
      metadata: { studentId, status },
    });
  } catch (err) {
    logger.error('Failed to create dispute.updated notification', {
      schoolId,
      studentId,
      err: err.message,
    });
  }
}

/**
 * Register all notification event subscribers on the paymentEvents bus.
 *
 * Called once from app.js after all services are initialised.
 */
function registerNotificationSubscribers() {
  paymentEvents.on('payment.saved', onPaymentSaved);
  paymentEvents.on('dispute.created', onDisputeCreated);
  paymentEvents.on('dispute.updated', onDisputeUpdated);

  logger.info('Notification subscribers registered', {
    events: ['payment.saved', 'dispute.created', 'dispute.updated'],
  });
}

module.exports = { registerNotificationSubscribers };
