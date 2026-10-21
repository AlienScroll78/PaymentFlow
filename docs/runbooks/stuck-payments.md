# Runbook: Investigating and Resolving Stuck Payments

**Component:** `stuckPaymentReconciliation`, `transactionPollingService`, `transactionQueue`, `paymentConfirmationStateMachine`
**Severity:** high — a payment stuck in `SUBMITTED` or `PROCESSING` state means a parent has paid but their balance is not updated.
**Closes:** [#319](https://github.com/onlyonee1/PaymentFlow/issues/319)

---

## Overview

A payment is considered "stuck" when it stays in `SUBMITTED` or `PROCESSING` status for longer than 15 minutes (configurable via `STUCK_PAYMENT_THRESHOLD_MS`, default `900000`). StellarEduPay has a built-in reconciliation scheduler (`stuckPaymentReconciliation.js`) that automatically re-queues stuck payments every 10 minutes, but there are failure scenarios the scheduler cannot self-heal: network partitions, bad memo, duplicate transaction hash collision, or a payment whose blockchain transaction was never confirmed.

This runbook covers:
1. How to detect stuck payments
2. A decision tree for diagnosing the root cause
3. Safe intervention options with risk levels and reversal procedures
4. Escalation criteria

---

## Definitions

| Status | Meaning |
|--------|---------|
| `PENDING` | Payment record created; waiting for blockchain confirmation |
| `SUBMITTED` | Transaction seen on Horizon; confirmation in progress |
| `PROCESSING` | Transaction queued for internal verification |
| `SUCCESS` | Payment confirmed and student balance updated |
| `FAILED` | Payment could not be confirmed; permanent terminal state |

A payment is **stuck** when it has been in `SUBMITTED` or `PROCESSING` for longer than `STUCK_PAYMENT_THRESHOLD_MS` (default 15 min).

---

## Pre-Investigation Checklist

Before intervening, gather these data points:

- [ ] **Payment ID (`txHash`)** — from the parent's report, admin dashboard, or `GET /api/payments/:studentId`
- [ ] **School ID (`schoolId`)** — from the payment record
- [ ] **Student ID (`studentId`)** — from the payment record
- [ ] **Timestamp** — when did the payment enter its current status?
- [ ] **Current backend health** — `curl https://<api-host>/health`
- [ ] **Retry queue depth** — `GET /api/admin/retry-queue` (requires admin JWT)

---

## Decision Tree

```
Payment stuck in SUBMITTED or PROCESSING?
│
├── Is the backend healthy? (/health → 200 ok)
│   ├── NO  → See "Backend / Infrastructure Outage" section
│   └── YES → Continue
│
├── Is the txHash visible on Stellar Horizon?
│   ├── NO  → Transaction was never broadcast; go to "Ghost Transaction"
│   └── YES → Continue
│
├── Does Horizon show the transaction as successful?
│   ├── NO (failed/expired) → Go to "Blockchain Transaction Failed"
│   └── YES → Continue
│
├── Does the memo on the blockchain match the studentId?
│   ├── NO  → Go to "Memo Mismatch"
│   └── YES → Continue
│
├── Is the destination address the school's current stellarAddress?
│   ├── NO  → Go to "Wrong Destination"
│   └── YES → Continue
│
├── Is the retry queue depth growing? (/api/admin/retry-queue → waiting > 50)
│   ├── YES → Queue backpressure; go to "Queue / Worker Failure"
│   └── NO  → Go to "Manual Reconciliation Trigger"
```

---

## Step 1: Verify Backend and Queue Health

```bash
# Health check
curl -s https://<api-host>/health | jq .

# Retry queue depth (requires admin JWT)
curl -s https://<api-host>/api/admin/retry-queue \
  -H "Authorization: Bearer <admin-jwt>" | jq .

# Check recent error logs
docker compose logs --tail=200 backend 2>&1 | grep -i "error\|stuck\|reconcil"
```

**Expected output:** `{ "status": "ok" }` and queue depth under 50. If the backend returns `503` or the queue depth is over 200, this is an infrastructure incident — escalate immediately (see Escalation section).

---

## Step 2: Inspect the Payment Record

### MongoDB query

```javascript
// Connect to MongoDB
mongosh "$MONGO_URI"

// Find the stuck payment by txHash
db.payments.findOne({ txHash: "<TX_HASH>" }, {
  txHash: 1, status: 1, confirmationState: 1,
  studentId: 1, schoolId: 1, memo: 1, senderAddress: 1,
  submittedAt: 1, confirmedAt: 1, createdAt: 1
})

// Find all stuck payments older than 15 minutes
db.payments.find({
  status: { $in: ["SUBMITTED", "PROCESSING"] },
  submittedAt: { $lt: new Date(Date.now() - 900000) },
  deletedAt: null
}).sort({ submittedAt: 1 })
```

### Via admin API

```bash
# List pending verifications
curl -s "https://<api-host>/api/payments/pending?page=1&limit=20" \
  -H "Authorization: Bearer <admin-jwt>" | jq .
```

---

## Step 3: Check Stellar Horizon

```bash
# Check transaction by hash
curl -s "https://horizon.stellar.org/transactions/<TX_HASH>" | jq '{
  id, successful, created_at,
  memo, memo_type,
  source_account
}'

# Check the destination account operations
curl -s "https://horizon.stellar.org/transactions/<TX_HASH>/operations" | \
  jq '.records[] | { type, from, to, amount, asset_type }'
```

For **testnet** use `https://horizon-testnet.stellar.org`.

---

## Scenario Playbooks

### Scenario A: Auto-Reconciliation Has Not Run Yet

**Symptoms:** Payment is 15–30 min old, backend is healthy, Horizon shows success, queue is normal.

**Resolution:** The reconciliation scheduler runs every 10 minutes. Wait one full cycle. If it does not resolve within 20 minutes, manually trigger reconciliation (Scenario E).

**Risk:** None — read-only wait.

---

### Scenario B: Ghost Transaction (Not on Horizon)

**Symptoms:** txHash is not found on Horizon at all.

**Cause:** The parent's wallet submitted a transaction that was never broadcast, or the memo pointed to an incorrect address.

**Resolution (⚠️ REQUIRES DUAL APPROVAL):**

1. Confirm with the parent that they have a Stellar transaction confirmation in their wallet app.
2. If the parent has a valid transaction but the memo/destination was wrong, see Scenario D (Memo Mismatch).
3. If no valid Stellar transaction exists, **manually fail the payment:**

```javascript
// ⚠️ DUAL APPROVAL REQUIRED — log the approving admin names before running
// Risk: IRREVERSIBLE. The payment will be permanently marked FAILED.
// Reversal: Create a new payment record manually if the parent later provides a valid txHash.

db.payments.updateOne(
  { txHash: "<TX_HASH>", status: { $in: ["SUBMITTED", "PROCESSING"] } },
  {
    $set: {
      status: "FAILED",
      confirmationState: "failed",
      confirmationStatus: "failed",
      updatedAt: new Date()
    }
  }
)
```

4. Notify the parent that their payment was not found on the blockchain.
5. Write an audit log entry manually:

```javascript
db.auditlogs.insertOne({
  schoolId: "<SCHOOL_ID>",
  action: "payment_manually_failed",
  performedBy: "<your-admin-email>",
  details: {
    txHash: "<TX_HASH>",
    reason: "Transaction not found on Stellar Horizon after investigation",
    approvedBy: "<second-admin-email>",
    incidentRef: "<incident-ID>"
  },
  createdAt: new Date()
})
```

---

### Scenario C: Blockchain Transaction Failed

**Symptoms:** Horizon returns `"successful": false` for the transaction.

**Cause:** The transaction was rejected by Stellar (insufficient balance, bad auth, no trustline, etc.).

**Resolution:**

1. Determine the specific Horizon error code:

```bash
curl -s "https://horizon.stellar.org/transactions/<TX_HASH>" | \
  jq '.result_codes'
```

2. Trigger a manual verification which will detect the failure and mark the payment `FAILED`:

```bash
# Trigger re-verification
curl -X POST "https://<api-host>/api/payments/verify" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "txHash": "<TX_HASH>", "schoolId": "<SCHOOL_ID>" }'
```

3. If the API returns an error, manually set the payment to `FAILED` using the MongoDB command from Scenario B (dual approval required).

**Risk:** Low — triggering verification is idempotent. Manual status update is irreversible.

---

### Scenario D: Memo Mismatch

**Symptoms:** Transaction is successful on Horizon, but the memo does not match the `studentId` format or is blank.

**Cause:** Parent entered the wrong memo, or the memo was truncated.

**Resolution (⚠️ REQUIRES DUAL APPROVAL):**

1. Confirm the correct student by cross-referencing the payment amount and school wallet address.
2. If the student can be positively identified:

```bash
# Trigger sync — the service will try to match the payment
curl -X POST "https://<api-host>/api/payments/sync" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "schoolId": "<SCHOOL_ID>" }'
```

3. If auto-match fails (memo is genuinely wrong), **do not update the memo field**. Instead, create a corrected payment record as a new verified entry and mark the original as `FAILED` with reason `"memo_mismatch_manually_resolved"`.

**Risk:** Medium — dual approval required before any manual record manipulation.

---

### Scenario E: Manual Reconciliation Trigger

**Symptoms:** Backend is healthy, transaction is confirmed on Horizon, memo is correct, but the payment is still stuck after two reconciliation cycles.

**Resolution:**

```bash
# Trigger reconciliation via API
curl -X POST "https://<api-host>/api/payments/sync" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "schoolId": "<SCHOOL_ID>" }'
```

If the API sync does not resolve it, re-queue via the reconciliation endpoint:

```bash
# Re-verify specific transaction
curl -X POST "https://<api-host>/api/payments/verify" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "txHash": "<TX_HASH>", "schoolId": "<SCHOOL_ID>" }'
```

**Risk:** Low — idempotent operation. Can be safely retried.
**Reversal:** Not needed; no state changes unless the payment legitimately confirms.

---

### Scenario F: Queue / Worker Failure

**Symptoms:** Retry queue depth growing (`waiting > 200`), many payments stuck simultaneously, worker logs show errors.

**Resolution:**

1. Check worker health:

```bash
docker compose logs --tail=500 backend 2>&1 | grep -i "worker\|bull\|queue"
```

2. If BullMQ worker is down, restart the backend:

```bash
docker compose restart backend
```

3. If Redis is unreachable, the system should have fallen back to MongoDB retry backend automatically. Check:

```bash
docker compose logs backend 2>&1 | grep -i "redis\|fallback\|mongo.*retry"
```

4. After restart, monitor the queue depth decreasing:

```bash
# Poll every 30 seconds
watch -n 30 'curl -s https://<api-host>/api/admin/retry-queue \
  -H "Authorization: Bearer <admin-jwt>" | jq .waiting'
```

**Risk:** Medium — restarting the backend will drain in-flight requests gracefully (SIGTERM handling). Any payment currently being processed will be retried on restart.

---

### Scenario G: Backend / Infrastructure Outage

**Symptoms:** `/health` returns `503` or is unreachable.

**Resolution:**

1. This is a full incident — see `docs/operator-runbooks.md` (General Incident Steps).
2. **Do not** manually modify payment records while the backend is unhealthy — you may create inconsistencies the auto-reconciler would otherwise resolve.
3. Once the backend recovers, the stuck payment reconciliation scheduler will automatically re-queue payments that have been stuck longer than 15 minutes.

---

## Intervention Reference

| Intervention | Risk | Reversible | Dual Approval |
|---|---|---|---|
| Trigger `POST /api/payments/sync` | Low | Yes (idempotent) | No |
| Trigger `POST /api/payments/verify` | Low | Yes (idempotent) | No |
| Restart backend container | Medium | Yes | No |
| Manual `FAILED` status in MongoDB | **HIGH** | **NO** | **YES — required** |
| Manual `SUCCESS` status in MongoDB | **CRITICAL** | **NO** | **YES — required + incident log** |
| Delete payment record | **CRITICAL** | **NO** | **NEVER — use soft delete** |

> **⚠️ Setting `status: "SUCCESS"` manually bypasses all fee validation, idempotency checks, student balance update, and audit trail.** This must never be done without creating an explicit audit log entry and getting sign-off from a second admin. The strongly preferred path is to re-queue the payment and let the verification pipeline confirm it.

---

## Example Log Searches

```bash
# Find all log lines for a specific txHash
docker compose logs backend 2>&1 | grep "<TX_HASH>"

# Find stuck payment reconciliation runs
docker compose logs backend 2>&1 | grep -i "stuck\|reconcil"

# Find errors from the last hour
docker compose logs --since=1h backend 2>&1 | grep '"level":"error"'

# Find queue re-queuing events
docker compose logs backend 2>&1 | grep -i "re-queue\|requeue"
```

If using structured JSON logs (production), use `jq`:

```bash
docker compose logs backend 2>&1 | \
  grep '"txHash":"<TX_HASH>"' | \
  jq '{ts, level, msg, status, correlationId}'
```

---

## Prometheus / Grafana Checks

| Metric | Alert Threshold | What to Look For |
|--------|----------------|------------------|
| `payment_processing_duration_seconds` (p95) | > 10s | Elevated latency in verification |
| `bullmq_queue_waiting_total` | > 50 (warn), > 200 (crit) | Queue backpressure |
| `stuck_payments_requeued_total` | Sudden spike | Batch of payments were stuck |
| `payment_status_transitions_total{to="FAILED"}` | Spike | Payments failing in bulk |

---

## Escalation

Escalate to the **Stellar / provider integration team** when:

1. Multiple payments are stuck simultaneously across more than one school
2. Horizon API is returning errors or rate-limiting (`curl https://horizon.stellar.org` returns 5xx)
3. A payment has been stuck for more than 1 hour and all standard interventions have failed
4. Any scenario requiring manual `SUCCESS` status — this always requires a second approver

**Escalation contact:** File a P1 incident in your incident tracker, assign `team/stellar-integration`, and attach:
- The stuck payment's `txHash`
- The Horizon transaction URL: `https://stellar.expert/explorer/testnet/tx/<TX_HASH>`
- The backend log excerpt for the payment
- The retry queue depth at time of escalation

---

## Related Documents

- Stuck payment reconciliation service: [`backend/src/services/stuckPaymentReconciliation.js`](../../backend/src/services/stuckPaymentReconciliation.js)
- Transaction queue: [`backend/src/queue/transactionQueue.js`](../../backend/src/queue/transactionQueue.js)
- Payment state machine: [`backend/src/services/paymentConfirmationStateMachine.js`](../../backend/src/services/paymentConfirmationStateMachine.js)
- Payment status constants: [`backend/src/constants/paymentStatus.js`](../../backend/src/constants/paymentStatus.js)
- General operator runbooks: [`docs/operator-runbooks.md`](../operator-runbooks.md)
- Idempotency design: [`docs/idempotency-payment-verification.md`](../idempotency-payment-verification.md)
- Retry backends: [`docs/retry-backends.md`](../retry-backends.md)
