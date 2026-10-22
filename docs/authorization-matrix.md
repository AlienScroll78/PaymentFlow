# Authorization Matrix

Single authoritative reference for authentication level, role requirements, and ownership constraints for every protected endpoint in PaymentFlow.

---

## Auth Levels

| Level | Middleware | Description |
|-------|-----------|-------------|
| `SUPER_ADMIN` | `requireAdminAuth` | Global administrator. Accepts tokens with `role:'admin'` or `roles:['super_admin']`. Not restricted to a single school. |
| `SCHOOL_ADMIN` | `requireSchoolAuth(roles)` | Tenant-scoped. Token `schoolId` must match `X-School-ID` request header. Optional per-group role restriction. |
| `PUBLIC` | none | No authentication required. |

**Super-admin bypass**: a valid `SUPER_ADMIN` token can reach any `SCHOOL_ADMIN` endpoint without a matching `X-School-ID`. This is the break-glass path for cross-school operations.

---

## Ownership Check Policy

When **Ownership Check = Yes**, the controller must verify that the target resource (student, payment, fee structure) belongs to `req.schoolId` **before** performing any mutation. The auth middleware enforces tenant isolation at the token level; controllers enforce resource-level ownership.

---

## Endpoint Matrix

### Super-Admin: Runtime Administration (`/api/admin/*`)

| Method | Endpoint | Auth Level | Roles | Cross-School | Ownership Check |
|--------|----------|-----------|-------|-------------|----------------|
| `POST` | `/api/admin/log-level` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/webhooks/dlq` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `POST` | `/api/admin/webhooks/dlq/:id/retry` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `POST` | `/api/admin/webhooks/:id/replay` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/pending-verifications/backlog` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/pending-verifications/dead-letter` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/pending-verifications/:id` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `POST` | `/api/admin/pending-verifications/:id/retry` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/payment-limits` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `PUT` | `/api/admin/payment-limits` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `DELETE` | `/api/admin/payment-limits/:schoolId` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/retry-queue/failed` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/retry-queue/failed/:jobId` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `POST` | `/api/admin/retry-queue/failed/:jobId/retry` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `DELETE` | `/api/admin/retry-queue/failed/:jobId` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/retry-queue/stats` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/outbox/dead-letter` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/outbox/dead-letter/:eventId` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `POST` | `/api/admin/outbox/dead-letter/:eventId/replay` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `DELETE` | `/api/admin/outbox/dead-letter/:eventId` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/admin/outbox/stats` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/consistency` | SUPER_ADMIN | admin, super_admin | Yes | No |

---

### Super-Admin: Audit Logs (`/api/audit/*`)

| Method | Endpoint | Auth Level | Roles | Cross-School | Ownership Check |
|--------|----------|-----------|-------|-------------|----------------|
| `GET` | `/api/audit` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/audit/recent` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/audit/export` | SUPER_ADMIN | admin, super_admin | Yes | No |
| `GET` | `/api/audit/verify-chain` | SUPER_ADMIN | admin, super_admin | Yes | No |

---

### Students (`/api/students/*`)

| Method | Endpoint | Auth Level | Roles | Cross-School | Ownership Check |
|--------|----------|-----------|-------|-------------|----------------|
| `POST` | `/api/students` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `POST` | `/api/students/bulk` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `GET` | `/api/students` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `GET` | `/api/students/export` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `GET` | `/api/students/:studentId` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `PUT` | `/api/students/:studentId` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `DELETE` | `/api/students/:studentId` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `POST` | `/api/students/:studentId/restore` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `GET` | `/api/students/:studentId/payments/audit` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `POST` | `/api/students/:studentId/reset-payment` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `POST` | `/api/students/:studentId/reconcile` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `POST` | `/api/students/:studentId/credit-adjustments` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `GET` | `/api/students/:studentId/fee-history` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `GET` | `/api/students/public/:studentId` | PUBLIC | — | Yes | No |

---

### Fee Structures (`/api/fees/*`)

| Method | Endpoint | Auth Level | Roles | Cross-School | Ownership Check |
|--------|----------|-----------|-------|-------------|----------------|
| `POST` | `/api/fees` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `GET` | `/api/fees` | SCHOOL_ADMIN | any | No | No |
| `GET` | `/api/fees/:className` | SCHOOL_ADMIN | any | No | No |
| `PUT` | `/api/fees/:className` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `DELETE` | `/api/fees/:className` | SUPER_ADMIN | admin, super_admin | No | Yes |

---

### Payments (`/api/payments/*`)

| Method | Endpoint | Auth Level | Roles | Cross-School | Ownership Check |
|--------|----------|-----------|-------|-------------|----------------|
| `GET` | `/api/payments/verify/:txHash` | PUBLIC | — | Yes | No |
| `POST` | `/api/payments/verify` | PUBLIC | — | Yes | No |
| `POST` | `/api/payments/intent` | PUBLIC | — | Yes | No |
| `POST` | `/api/payments/submit` | PUBLIC | — | Yes | No |
| `GET` | `/api/payments` | SCHOOL_ADMIN | any | No | Yes |
| `GET` | `/api/payments/:studentId` | SCHOOL_ADMIN | any | No | Yes |
| `GET` | `/api/payments/overpayments` | SCHOOL_ADMIN | any | No | Yes |
| `GET` | `/api/payments/pending` | SCHOOL_ADMIN | any | No | Yes |
| `GET` | `/api/payments/suspicious` | SCHOOL_ADMIN | any | No | Yes |
| `POST` | `/api/payments/sync` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `POST` | `/api/payments/finalize` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `PATCH` | `/api/payments/:txHash/status` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `PATCH` | `/api/payments/bulk/status` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `PATCH` | `/api/payments/:txHash/suspicion-review` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `POST` | `/api/payments/:txHash/refund` | SUPER_ADMIN | admin, super_admin | No | Yes |

---

### Disputes (`/api/disputes/*`)

| Method | Endpoint | Auth Level | Roles | Cross-School | Ownership Check |
|--------|----------|-----------|-------|-------------|----------------|
| `POST` | `/api/disputes` | PUBLIC (school context) | — | No | No |
| `GET` | `/api/disputes` | PUBLIC (school context) | — | No | No |
| `GET` | `/api/disputes/:id` | PUBLIC (school context) | — | No | No |
| `PATCH` | `/api/disputes/:id/resolve` | SUPER_ADMIN | admin, super_admin | No | Yes |
| `POST` | `/api/disputes/:id/evidence` | SUPER_ADMIN | admin, super_admin | No | Yes |

---

### Reports (`/api/reports/*`)

| Method | Endpoint | Auth Level | Roles | Cross-School | Ownership Check |
|--------|----------|-----------|-------|-------------|----------------|
| `GET` | `/api/reports` | SCHOOL_ADMIN | owner, finance | No | No |
| `GET` | `/api/reports/dashboard` | SCHOOL_ADMIN | owner, finance | No | No |
| `GET` | `/api/reports/jobs/:jobId` | SCHOOL_ADMIN | owner, finance | No | No |
| `GET` | `/api/reports/jobs/:jobId/download` | SCHOOL_ADMIN | owner, finance | No | No |

---

## Error Response Contract

All auth failures return a consistent `{ error: string, code: string }` JSON body:

| Scenario | HTTP Status | Code |
|----------|------------|------|
| No token provided | `401` | `MISSING_AUTH_TOKEN` |
| Token expired | `401` | `TOKEN_EXPIRED` |
| Invalid / malformed token | `401` | `INVALID_AUTH_TOKEN` |
| IP temporarily blocked | `429` | `IP_BLOCKED` |
| Insufficient role | `403` | `INSUFFICIENT_ROLE` |
| Token not scoped to a school | `403` | `MISSING_TENANT_CLAIM` |
| Token schoolId ≠ X-School-ID | `403` | `TENANT_MISMATCH` |
| MFA setup required | `403` | `MFA_SETUP_REQUIRED` |

---

## Cross-School Access Prevention

The `requireSchoolAuth` middleware enforces tenant isolation automatically:

1. The JWT `schoolId` claim is compared to the `X-School-ID` request header.
2. A mismatch returns `403 TENANT_MISMATCH` before the controller runs.
3. Controllers receive `req.schoolId` populated from the **token** (not the header) and must use it for all database queries to prevent data leakage.
4. Super-admin tokens (`role:'admin'` or `roles:['super_admin']`) bypass the schoolId check — this is the intentional break-glass path.

---

## Implementation References

| Component | File |
|-----------|------|
| Auth middleware | `backend/src/middleware/auth.js` |
| Authorization matrix module | `backend/src/middleware/authorizationMatrix.js` |
| Admin routes | `backend/src/routes/adminRoutes.js` |
| Student routes | `backend/src/routes/studentRoutes.js` |
| Payment routes | `backend/src/routes/paymentRoutes.js` |
| Fee routes | `backend/src/routes/feeRoutes.js` |
| Dispute routes | `backend/src/routes/disputeRoutes.js` |
| Audit routes | `backend/src/routes/auditRoutes.js` |
| Report routes | `backend/src/routes/reportRoutes.js` |
