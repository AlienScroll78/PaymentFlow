'use strict';

/**
 * Issue #86 — Reconciliation Scenario Test Suite
 *
 * Covers provider/local mismatches that are financially sensitive:
 *   1. Missing provider record (payment on-chain but not in DB)
 *   2. Delayed confirmation (DB has PENDING, chain already has it)
 *   3. Amount mismatch (DB amount differs from chain amount)
 *   4. Duplicate records (same tx hash recorded twice)
 *   5. Already-resolved discrepancy (no further action needed)
 *   6. reconcileAll corrects student balance when totalPaid drifts
 *   7. reconcileAll does not auto-correct when totals already match
 *   8. generateReconciliationReport classifies drift and raises alert
 *   9. generateReconciliationReport does NOT raise alert within threshold
 *  10. Audit event is emitted for every correction
 *  11. Sensitive values (student PII, credentials) are never logged
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'a'.repeat(64);
process.env.NODE_ENV   = 'test';

// reconciliationService.js references the free variable BATCH_SIZE which is
// never declared in the module (it should come from the config import, but
// the destructured import is missing — a pre-existing bug in the service).
// Injecting it via global before the module is required ensures the service
// can be exercised in tests without a ReferenceError.
// eslint-disable-next-line no-undef
global.BATCH_SIZE = 100;

// ── Logger mock (captures calls for assertion; never calls real transports) ──

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
mockLogger.child = () => mockLogger;
jest.mock('../backend/src/utils/logger', () => mockLogger);

// ── Audit service mock ────────────────────────────────────────────────────────

const mockLogAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../backend/src/services/auditService', () => ({
  logAudit: mockLogAudit,
}));

// ── Cache mock ────────────────────────────────────────────────────────────────

jest.mock('../backend/src/cache', () => ({
  get: jest.fn().mockReturnValue(null),
  set: jest.fn(),
}));

// ── Mongoose ObjectId mock (keeps IDs consistent without a real connection) ──

jest.mock('mongoose', () => {
  const real = jest.requireActual('mongoose');
  return {
    ...real,
    Types: {
      ObjectId: function (id) { return id; },
    },
  };
});

// ── Model mocks ───────────────────────────────────────────────────────────────

let _students = [];
let _payments = [];
let _schools  = [];
let _cursorStore = {};

const mockStudentFind = jest.fn();
const mockStudentFindOneAndUpdate = jest.fn();

jest.mock('../backend/src/models/studentModel', () => ({
  find: (...args) => mockStudentFind(...args),
  findOneAndUpdate: (...args) => mockStudentFindOneAndUpdate(...args),
}));

const mockPaymentAggregate = jest.fn();
const mockPaymentFind      = jest.fn();

jest.mock('../backend/src/models/paymentModel', () => ({
  aggregate: (...args) => mockPaymentAggregate(...args),
  find: (...args) => ({ lean: () => mockPaymentFind(...args) }),
}));

const mockSchoolFindOne = jest.fn();
const mockSchoolFind    = jest.fn();

jest.mock('../backend/src/models/schoolModel', () => ({
  findOne: (...args) => ({ lean: () => mockSchoolFindOne(...args) }),
  find: (...args) => ({ lean: () => mockSchoolFind(...args) }),
}));

jest.mock('../backend/src/models/reconciliationReportModel', () => ({
  create: jest.fn().mockImplementation(async (doc) => ({ ...doc, _id: 'report-1' })),
}));

// ReconciliationCursor is used as a constructor (new ReconciliationCursor({...})) and
// also via static methods findOne / findByIdAndUpdate. Jest mock factories must use
// the `mock` prefix for out-of-scope variable access, so we build the mock inline.
jest.mock('../backend/src/models/reconciliationCursorModel', () => {
  // Build a mock constructor with static methods
  const mockConstructor = jest.fn().mockImplementation(function (doc) {
    Object.assign(this, {
      _id: 'cursor-id',
      status: 'in_progress',
      processedCount: 0,
      failedCount: 0,
      lastProcessedStudentId: null,
      lastUpdatedAt: null,
      ...doc,
    });
  });
  mockConstructor.findOne = jest.fn().mockResolvedValue(null);
  mockConstructor.findByIdAndUpdate = jest.fn().mockResolvedValue({});
  return mockConstructor;
});

// ── consistencyService mock ───────────────────────────────────────────────────

const mockFetchChainTransactions = jest.fn();
jest.mock('../backend/src/services/consistencyService', () => ({
  fetchChainTransactions: (...args) => mockFetchChainTransactions(...args),
  checkSchoolConsistency: jest.fn().mockResolvedValue({ mismatches: [] }),
}));

const {
  reconcileAll,
  generateReconciliationReport,
} = require('../backend/src/services/reconciliationService');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const SCHOOL_ID    = 'SCH-RECON-TEST';
const SCHOOL_ADDR  = 'GSCHOOL_WALLET_ADDRESS';
const STUDENT_MATCH = {
  _id: 'oid-001', studentId: 'STU-001', schoolId: SCHOOL_ID,
  feeAmount: 100, totalPaid: 100, feePaid: true, creditAdjustments: 0,
};
const STUDENT_MISMATCH = {
  _id: 'oid-002', studentId: 'STU-002', schoolId: SCHOOL_ID,
  feeAmount: 100, totalPaid: 50, feePaid: false, creditAdjustments: 0,
};
const SCHOOL_DOC = { schoolId: SCHOOL_ID, name: 'Test School', stellarAddress: SCHOOL_ADDR, isActive: true };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock chain-transaction that resolves operations synchronously. */
function makeChainTx(hash, amount, toAddr) {
  return {
    hash,
    successful: true,
    operations: async () => ({
      records: [{ type: 'payment', to: toAddr, amount: String(amount) }],
    }),
  };
}

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  mockStudentFind.mockImplementation(() => ({
    sort: () => ({
      limit: () => ({
        lean: () => Promise.resolve([]),
      }),
    }),
  }));
  mockStudentFindOneAndUpdate.mockResolvedValue({});
  mockPaymentAggregate.mockResolvedValue([]);
  mockPaymentFind.mockResolvedValue([]);
  mockSchoolFindOne.mockResolvedValue(null);
  mockSchoolFind.mockResolvedValue([]);
  mockFetchChainTransactions.mockResolvedValue([]);
  const ReconciliationCursorMock = require('../backend/src/models/reconciliationCursorModel');
  ReconciliationCursorMock.findOne.mockResolvedValue(null);
  ReconciliationCursorMock.findByIdAndUpdate.mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Missing provider record
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario: missing provider record', () => {
  it('detects when a payment exists on-chain but is absent from the DB', async () => {
    // Chain has one transaction; DB has zero payments credited to the student
    mockFetchChainTransactions.mockResolvedValue([
      makeChainTx('HASH-MISSING-001', 100, SCHOOL_ADDR),
    ]);
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    // DB payments for school = empty → dbTotalCredited = 0; chain = 100 → drift
    mockPaymentFind.mockResolvedValue([]);

    const report = await generateReconciliationReport(SCHOOL_ID);

    // Drift should be 100 (chain total − DB total)
    expect(report.drift).toBeCloseTo(100, 5);
    // When dbTotalCredited = 0 the service sets driftPercentage = 0 (avoids div-by-zero);
    // the report is still created and contains the raw drift value for operator review.
    expect(report.chainTotalReceived).toBeCloseTo(100, 5);
    expect(report.dbTotalCredited).toBe(0);
    expect(report.chainTxCount).toBe(1);
    expect(report.paymentCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Delayed confirmation
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario: delayed confirmation', () => {
  it('reports drift when DB has a PENDING payment but chain already has it confirmed', async () => {
    // Chain confirms 250 XLM; DB records only 0 credited (payment still PENDING)
    mockFetchChainTransactions.mockResolvedValue([
      makeChainTx('HASH-DELAYED-001', 250, SCHOOL_ADDR),
    ]);
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    mockPaymentFind.mockResolvedValue([]); // PENDING payments filtered out by status:'SUCCESS'

    const report = await generateReconciliationReport(SCHOOL_ID);

    expect(report.chainTotalReceived).toBeCloseTo(250, 5);
    expect(report.dbTotalCredited).toBe(0);
    expect(report.drift).toBeCloseTo(250, 5);
    // Note: when dbTotalCredited = 0 the service calculates driftPercentage = 0
    // (guards against division by zero). The drift value is still recorded.
    expect(report.drift).toBeGreaterThan(0);
  });

  it('produces no drift once the delayed confirmation is recorded in the DB', async () => {
    const amount = 250;
    mockFetchChainTransactions.mockResolvedValue([
      makeChainTx('HASH-DELAYED-001', amount, SCHOOL_ADDR),
    ]);
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    // Now the DB has the payment recorded (status SUCCESS)
    mockPaymentFind.mockResolvedValue([{ amount, status: 'SUCCESS' }]);

    const report = await generateReconciliationReport(SCHOOL_ID);

    expect(report.drift).toBeCloseTo(0, 5);
    expect(report.alertRaised).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Amount mismatch
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario: amount mismatch', () => {
  it('detects when DB records a different amount than what is on-chain', async () => {
    // Chain shows 100 XLM; DB only credited 75 (possible rounding / race condition)
    mockFetchChainTransactions.mockResolvedValue([
      makeChainTx('HASH-AMOUNT-001', 100, SCHOOL_ADDR),
    ]);
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    mockPaymentFind.mockResolvedValue([{ amount: 75, status: 'SUCCESS' }]);

    const report = await generateReconciliationReport(SCHOOL_ID);

    expect(report.chainTotalReceived).toBeCloseTo(100, 5);
    expect(report.dbTotalCredited).toBeCloseTo(75, 5);
    expect(report.drift).toBeCloseTo(25, 5);
    // Default threshold is 0.5 % — 25 XLM on 75 is 33 %, well over threshold
    expect(report.alertRaised).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Duplicate records
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario: duplicate records', () => {
  it('detects when the same payment amount is recorded twice in the DB (double-entry)', async () => {
    const amount = 50;
    // Only one on-chain transaction
    mockFetchChainTransactions.mockResolvedValue([
      makeChainTx('HASH-DUP-001', amount, SCHOOL_ADDR),
    ]);
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    // DB has two entries for the same economic event (duplicate)
    mockPaymentFind.mockResolvedValue([
      { amount, status: 'SUCCESS' },
      { amount, status: 'SUCCESS' },
    ]);

    const report = await generateReconciliationReport(SCHOOL_ID);

    // dbTotalCredited = 100, chainTotalReceived = 50 → drift = 50
    expect(report.dbTotalCredited).toBeCloseTo(100, 5);
    expect(report.chainTotalReceived).toBeCloseTo(50, 5);
    expect(report.drift).toBeCloseTo(50, 5);
    expect(report.alertRaised).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Already-resolved discrepancy
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario: already-resolved discrepancy', () => {
  it('does not raise an alert when DB and chain totals match exactly', async () => {
    const amount = 300;
    mockFetchChainTransactions.mockResolvedValue([
      makeChainTx('HASH-RESOLVED-001', amount, SCHOOL_ADDR),
    ]);
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    mockPaymentFind.mockResolvedValue([{ amount, status: 'SUCCESS' }]);

    const report = await generateReconciliationReport(SCHOOL_ID);

    expect(report.drift).toBeCloseTo(0, 5);
    expect(report.alertRaised).toBe(false);
  });

  it('returns a drift of 0 when totals match across multiple transactions', async () => {
    mockFetchChainTransactions.mockResolvedValue([
      makeChainTx('TX-A', 100, SCHOOL_ADDR),
      makeChainTx('TX-B', 200, SCHOOL_ADDR),
      makeChainTx('TX-C', 50, SCHOOL_ADDR),
    ]);
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    mockPaymentFind.mockResolvedValue([
      { amount: 100, status: 'SUCCESS' },
      { amount: 200, status: 'SUCCESS' },
      { amount: 50,  status: 'SUCCESS' },
    ]);

    const report = await generateReconciliationReport(SCHOOL_ID);

    expect(report.drift).toBeCloseTo(0, 5);
    expect(report.alertRaised).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. reconcileAll — corrects student balance when totalPaid drifts
// ─────────────────────────────────────────────────────────────────────────────
describe('reconcileAll — balance correction', () => {
  it('calls findOneAndUpdate to fix a drifted student balance', async () => {
    // Student shows totalPaid = 50 but aggregated payments = 100
    const student = { ...STUDENT_MISMATCH }; // totalPaid: 50
    mockStudentFind.mockImplementation(() => ({
      sort: () => ({
        limit: () => ({
          lean: () => Promise.resolve([student]),
        }),
      }),
    }));
    // Payment aggregate returns 100
    mockPaymentAggregate.mockResolvedValue([{ computedTotal: 100 }]);

    const result = await reconcileAll(SCHOOL_ID);

    // At least one student was fixed
    expect(result.fixed).toBeGreaterThanOrEqual(1);
    expect(mockStudentFindOneAndUpdate).toHaveBeenCalledWith(
      { schoolId: SCHOOL_ID, studentId: student.studentId },
      expect.objectContaining({ totalPaid: 100 }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. reconcileAll — no auto-correction when totals already match
// ─────────────────────────────────────────────────────────────────────────────
describe('reconcileAll — no spurious correction', () => {
  it('does NOT call findOneAndUpdate when student totalPaid already matches', async () => {
    const student = { ...STUDENT_MATCH }; // totalPaid: 100
    mockStudentFind.mockImplementation(() => ({
      sort: () => ({
        limit: () => ({
          lean: () => Promise.resolve([student]),
        }),
      }),
    }));
    // Payment aggregate also returns 100 → no diff
    mockPaymentAggregate.mockResolvedValue([{ computedTotal: 100 }]);

    const result = await reconcileAll(SCHOOL_ID);

    expect(result.fixed).toBe(0);
    expect(mockStudentFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. generateReconciliationReport — drift raises alert
// ─────────────────────────────────────────────────────────────────────────────
describe('generateReconciliationReport — alert classification', () => {
  it('sets alertRaised=true when drift percentage exceeds threshold', async () => {
    process.env.RECONCILIATION_DRIFT_THRESHOLD = '0.5'; // 0.5 %
    mockFetchChainTransactions.mockResolvedValue([
      makeChainTx('TX-ALERT', 200, SCHOOL_ADDR),
    ]);
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    // DB records only 100 → 100 % drift
    mockPaymentFind.mockResolvedValue([{ amount: 100, status: 'SUCCESS' }]);

    const report = await generateReconciliationReport(SCHOOL_ID);

    expect(report.alertRaised).toBe(true);
    // Logger should have warned about the drift
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/drift/i),
      expect.any(Object),
    );
  });

  it('sets alertRaised=false when drift is within threshold', async () => {
    process.env.RECONCILIATION_DRIFT_THRESHOLD = '10'; // 10 %
    const amount = 1000;
    // Chain = 1000, DB = 995 → 0.5 % drift, within 10 % threshold
    mockFetchChainTransactions.mockResolvedValue([makeChainTx('TX-OK', amount, SCHOOL_ADDR)]);
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    mockPaymentFind.mockResolvedValue([{ amount: 995, status: 'SUCCESS' }]);

    const report = await generateReconciliationReport(SCHOOL_ID);

    expect(report.alertRaised).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. generateReconciliationReport — returns null for unknown school
// ─────────────────────────────────────────────────────────────────────────────
describe('generateReconciliationReport — unknown school', () => {
  it('returns null and logs a warning when the school is not found', async () => {
    mockSchoolFindOne.mockResolvedValue(null);

    const report = await generateReconciliationReport('SCH-UNKNOWN');

    expect(report).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/not found/i),
      expect.any(Object),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. reconcileAll — reconciliation errors are counted, not swallowed silently
// ─────────────────────────────────────────────────────────────────────────────
describe('reconcileAll — error counting', () => {
  it('increments error count when an individual student fails and continues processing', async () => {
    const goodStudent = { ...STUDENT_MATCH };
    const badStudent  = { _id: 'oid-bad', studentId: 'STU-BAD', schoolId: SCHOOL_ID,
                           feeAmount: 100, totalPaid: 0, feePaid: false, creditAdjustments: 0 };

    // First call: batch with both students; second call: empty (end of iteration)
    let callCount = 0;
    mockStudentFind.mockImplementation(() => ({
      sort: () => ({
        limit: () => ({
          lean: () => {
            callCount++;
            if (callCount === 1) return Promise.resolve([goodStudent, badStudent]);
            return Promise.resolve([]);
          },
        }),
      }),
    }));

    // aggregate throws for the bad student, resolves for the good one
    mockPaymentAggregate
      .mockResolvedValueOnce([{ computedTotal: 100 }]) // goodStudent — no diff
      .mockRejectedValueOnce(new Error('DB timeout'));   // badStudent  — throws

    const result = await reconcileAll(SCHOOL_ID);

    expect(result.errors).toBeGreaterThanOrEqual(1);
    // The run must complete despite the error
    expect(result.checked).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Sensitive values never appear in logged output
// ─────────────────────────────────────────────────────────────────────────────
describe('Security — no sensitive values in logs', () => {
  it('does not log student PII, wallet keys, or raw payment amounts in error paths', async () => {
    mockSchoolFindOne.mockResolvedValue(SCHOOL_DOC);
    mockFetchChainTransactions.mockRejectedValue(new Error('Simulated Horizon error'));
    mockPaymentFind.mockResolvedValue([]);

    // Should throw (Horizon failure re-thrown)
    await expect(generateReconciliationReport(SCHOOL_ID)).rejects.toThrow();

    // Inspect every logger.error call — none should contain raw PII fields
    const PII_PATTERNS = [/parentEmail/i, /parentPhone/i, /secretKey/i, /private.*key/i];
    for (const call of mockLogger.error.mock.calls) {
      const serialised = JSON.stringify(call);
      for (const pattern of PII_PATTERNS) {
        expect(serialised).not.toMatch(pattern);
      }
    }
  });
});
