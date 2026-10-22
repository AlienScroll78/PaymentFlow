/**
 * paymentApiClient.js
 *
 * Typed payment API client — a focused facade over the shared axios instance
 * in `./api`.  Every function here maps one-to-one to a payment-related
 * backend route and normalises errors into a stable frontend shape so callers
 * never have to inspect raw Axios errors.
 *
 * All functions:
 *  - Reuse the shared `api` instance (no duplicate axios configuration).
 *  - Have JSDoc-documented params and return shapes.
 *  - Catch errors and re-throw them as a normalised `ApiError` object.
 *
 * Error shape: `{ message: string, code: string, status: number|null, retryable: boolean }`
 */

import api from "./api";
import { isRetryable, getErrorCode } from "../utils/retryClassification";

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ApiError
 * @property {string}       message   - Human-readable error description.
 * @property {string}       code      - Backend error code (e.g. "DUPLICATE_TX")
 *                                      or empty string if none was provided.
 * @property {number|null}  status    - HTTP status code, or null for network /
 *                                      timeout errors where no response arrived.
 * @property {boolean}      retryable - Whether retrying the request might succeed.
 */

/**
 * Transforms an Axios error (or any error) into the stable `ApiError` shape
 * used throughout the frontend.
 *
 * Decision rules (delegated to retryClassification):
 *  - No response (network error, timeout, abort) → retryable=true, status=null
 *  - HTTP 5xx or 429 → retryable=true
 *  - HTTP 4xx (other than 429) → retryable=false
 *
 * @param {unknown} err - The raw error thrown by an Axios call.
 * @returns {ApiError}
 */
export function normalizeApiError(err) {
  const status = err?.response?.status ?? null;
  const code   = getErrorCode(err);
  const message =
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    "An unexpected error occurred.";
  const retryable = isRetryable(err);

  return { message, code, status, retryable };
}

// ---------------------------------------------------------------------------
// Internal helper: execute a call and normalise any thrown error.
// ---------------------------------------------------------------------------

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    throw normalizeApiError(err);
  }
}

// ---------------------------------------------------------------------------
// Payment API functions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PaymentInstructions
 * @property {string} walletAddress     - School Stellar wallet public key.
 * @property {string} memo              - Memo text to embed in the transaction.
 * @property {Array<{code: string, issuer?: string}>} acceptedAssets
 */

/**
 * Retrieve payment instructions (wallet address, memo, accepted assets) for a
 * student.  Consumers should embed the memo in the Stellar transaction.
 *
 * @param {string}        studentId        - The student's ID.
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<import('axios').AxiosResponse<PaymentInstructions>>}
 */
export function fetchPaymentInstructions(studentId, { signal } = {}) {
  return call(() => api.get(`/payments/instructions/${studentId}`, { signal }));
}

/**
 * @typedef {Object} Payment
 * @property {string}  txHash    - Stellar transaction hash.
 * @property {string}  status    - One of the PAYMENT_STATUS values.
 * @property {number}  amount    - Payment amount.
 * @property {string}  asset     - Asset code (e.g. "XLM").
 * @property {string}  createdAt - ISO 8601 timestamp.
 */

/**
 * Retrieve the payment history for a student.
 *
 * @param {string}        studentId
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<import('axios').AxiosResponse<Payment[]>>}
 */
export function fetchStudentPayments(studentId, { signal } = {}) {
  return call(() => api.get(`/payments/${studentId}`, { signal }));
}

/**
 * @typedef {Object} StudentBalance
 * @property {number} totalPaid      - Sum of successful payments.
 * @property {number} totalDue       - Fee amount owed.
 * @property {number} balance        - Remaining balance (totalDue - totalPaid).
 * @property {string} feeStatus      - "paid" | "partial" | "unpaid"
 */

/**
 * Retrieve the current balance summary for a student.
 *
 * @param {string}        studentId
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<import('axios').AxiosResponse<StudentBalance>>}
 */
export function fetchStudentBalance(studentId, { signal } = {}) {
  return call(() => api.get(`/payments/balance/${studentId}`, { signal }));
}

/**
 * @typedef {Object} PaymentSummary
 * @property {number} totalCollected  - Total amount collected across all students.
 * @property {number} pendingCount    - Number of pending payments.
 * @property {number} successCount    - Number of successful payments.
 */

/**
 * Retrieve the school-wide payment summary (dashboard overview).
 *
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<import('axios').AxiosResponse<PaymentSummary>>}
 */
export function fetchPaymentSummary({ signal } = {}) {
  return call(() => api.get("/payments/summary", { signal }));
}

/**
 * @typedef {Object} VerifyPaymentResult
 * @property {string}  txHash  - The verified transaction hash.
 * @property {string}  status  - Resulting payment status.
 * @property {string}  memo    - Memo from the transaction.
 */

/**
 * Submit a Stellar transaction hash for on-chain verification.
 *
 * @param {string} txHash - The Stellar transaction hash to verify.
 * @returns {Promise<import('axios').AxiosResponse<VerifyPaymentResult>>}
 */
export function verifyPayment(txHash) {
  return call(() => api.post("/payments/verify", { txHash }));
}

/**
 * @typedef {Object} SyncResult
 * @property {number} processed - Number of transactions processed.
 * @property {number} new       - Number of new payments recorded.
 */

/**
 * Trigger a manual sync of the latest transactions from the Stellar blockchain.
 *
 * @returns {Promise<import('axios').AxiosResponse<SyncResult>>}
 */
export function syncPayments() {
  return call(() => api.post("/payments/sync"));
}

/**
 * @typedef {Object} SyncStatus
 * @property {boolean} running    - Whether a sync is currently in progress.
 * @property {string}  lastSyncAt - ISO 8601 timestamp of the last completed sync.
 */

/**
 * Retrieve the current sync status.
 *
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<import('axios').AxiosResponse<SyncStatus>>}
 */
export function fetchSyncStatus({ signal } = {}) {
  return call(() => api.get("/payments/sync/status", { signal }));
}

/**
 * @typedef {Object} ConversionRates
 * @property {{ [assetCode: string]: number }} rates - Conversion rates to USD.
 */

/**
 * Retrieve current XLM/USDC conversion rates.
 *
 * @returns {Promise<import('axios').AxiosResponse<ConversionRates>>}
 */
export function fetchConversionRates() {
  return call(() => api.get("/payments/rates"));
}

/**
 * @typedef {Object} RefundRequest
 * @property {string} reason - Reason for the refund.
 * @property {number} [amount] - Partial refund amount; omit for full refund.
 */

/**
 * @typedef {Object} RefundResult
 * @property {string} refundId - The created refund request ID.
 * @property {string} status   - Initial status of the refund.
 */

/**
 * Initiate a refund for a completed payment.
 *
 * @param {string}        txHash - The transaction hash of the payment to refund.
 * @param {RefundRequest} data   - Refund details.
 * @returns {Promise<import('axios').AxiosResponse<RefundResult>>}
 */
export function initiateRefund(txHash, data) {
  return call(() => api.post(`/payments/${txHash}/refund`, data));
}

/**
 * @typedef {Object} RefundApprovalData
 * @property {string} [notes] - Optional admin notes for the approval.
 */

/**
 * Approve a pending refund request.
 *
 * @param {string}            refundId - The refund request ID.
 * @param {RefundApprovalData} data    - Approval details.
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export function approveRefund(refundId, data) {
  return call(() => api.post(`/payments/refunds/${refundId}/approve`, data));
}

/**
 * @typedef {Object} Refund
 * @property {string} refundId  - Unique refund ID.
 * @property {string} status    - Refund status.
 * @property {number} amount    - Refund amount.
 * @property {string} createdAt - ISO 8601 timestamp.
 */

/**
 * Retrieve all refund records for a specific payment.
 *
 * @param {string} txHash - The transaction hash of the original payment.
 * @returns {Promise<import('axios').AxiosResponse<Refund[]>>}
 */
export function fetchPaymentRefunds(txHash) {
  return call(() => api.get(`/payments/${txHash}/refunds`));
}

/**
 * @typedef {Object} RefundListParams
 * @property {number} [page]   - Page number (1-indexed).
 * @property {number} [limit]  - Results per page.
 * @property {string} [status] - Filter by refund status.
 */

/**
 * Retrieve the paginated list of all refunds for the current school.
 *
 * @param {RefundListParams} [params]
 * @returns {Promise<import('axios').AxiosResponse<{ refunds: Refund[], total: number }>>}
 */
export function fetchSchoolRefunds(params = {}) {
  return call(() => api.get("/payments/refunds/school/list", { params }));
}
