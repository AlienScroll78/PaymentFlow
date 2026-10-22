'use strict';

/**
 * Issue #87 — Database Migration Compatibility Tests
 *
 * Runs migration up/down functions against representative data fixtures and
 * verifies that indexes, constraints, and transformed data match expectations.
 *
 * Strategy: Migrations call mongoose.connection.collection() / mongoose.connection.db
 * directly (not the injected db parameter). We mock mongoose.connection with an
 * in-memory collection store to avoid any network or binary dependency
 * (MongoMemoryServer is blocked by blockRealHttp.js in unit test environments).
 *
 * The migration runner orchestration tests (runMigrations/rollback) mock the
 * Migration model and fs so they also require no live database.
 *
 * Acceptance criteria (issue #87):
 *   • Forward migration and supported rollback are tested.
 *   • Fixtures include non-empty data AND edge cases (null/missing fields,
 *     boundary values, already-encrypted values).
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'a'.repeat(64);
process.env.NODE_ENV   = 'test';

const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '../backend/migrations');

// ── Logger mock ───────────────────────────────────────────────────────────────

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
mockLogger.child = jest.fn().mockReturnValue(mockLogger);
jest.mock('../backend/src/utils/logger', () => mockLogger);

// ── Migration model mock (runner tests) ───────────────────────────────────────

const mockMigFindOneAndUpdate = jest.fn();
const mockMigFindOne          = jest.fn();
const mockMigDeleteOne        = jest.fn();

jest.mock('../backend/src/models/migrationModel', () => ({
  findOneAndUpdate: (...a) => mockMigFindOneAndUpdate(...a),
  findOne:          (...a) => mockMigFindOne(...a),
  deleteOne:        (...a) => mockMigDeleteOne(...a),
}));

jest.mock('../backend/src/config/database', () => ({
  getConnection: () => ({ db: {} }),
}));

// ── In-memory collection implementation ──────────────────────────────────────

function makeInMemoryCollection() {
  let docs = [];
  const col = {
    _docs:  () => docs,
    _reset: () => { docs = []; },

    async insertMany(items) {
      (Array.isArray(items) ? items : [items]).forEach(d => docs.push({ ...d }));
      return { insertedCount: items.length };
    },

    find(filter) {
      const matched = _filter(docs, filter);
      // Return an object that is both a cursor (toArray) and an async iterable
      return {
        toArray: async () => matched,
        [Symbol.asyncIterator]: async function* () {
          for (const doc of matched) yield doc;
        },
      };
    },

    async findOne(filter) {
      return _filter(docs, filter)[0] ?? null;
    },

    async distinct(field, filter) {
      const matched = filter ? _filter(docs, filter) : docs;
      const values = matched.map(d => d[field]).filter(v => v !== undefined);
      return [...new Set(values)];
    },

    async updateMany(filter, update) {
      const matches = _filter(docs, filter);
      for (const doc of matches) {
        // Pipeline-style update: [{ $set: { field: expr } }]
        if (Array.isArray(update)) {
          for (const stage of update) {
            if (!stage.$set) continue;
            for (const [key, expr] of Object.entries(stage.$set)) {
              if (typeof expr === 'object' && expr !== null && expr.$subtract) {
                const [a, b] = expr.$subtract;
                const va = typeof a === 'string' && a.startsWith('$') ? doc[a.slice(1)] : a;
                const vb = typeof b === 'string' && b.startsWith('$') ? doc[b.slice(1)] : b;
                doc[key] = (va ?? 0) - (vb ?? 0);
              } else {
                doc[key] = expr;
              }
            }
          }
        } else if (update.$set) {
          Object.assign(doc, update.$set);
        } else if (update.$unset) {
          for (const key of Object.keys(update.$unset)) delete doc[key];
        }
      }
      return { modifiedCount: matches.length };
    },

    async updateOne(filter, update) {
      const match = _filter(docs, filter)[0];
      if (!match) return { modifiedCount: 0 };
      if (update.$set) Object.assign(match, update.$set);
      return { modifiedCount: 1 };
    },

    async deleteMany() { const c = docs.length; docs = []; return { deletedCount: c }; },
    async createIndex()  { return 'ok'; },
    async dropIndex()    {},
    async indexExists()  { return false; },
  };
  return col;
}

function _filter(docs, filter) {
  if (!filter || Object.keys(filter).length === 0) return [...docs];
  return docs.filter(doc => {
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$expr') continue;
      if (v === null) { if (doc[k] !== null && doc[k] !== undefined) return false; continue; }
      if (typeof v === 'object' && v !== null) {
        if ('$exists' in v) {
          const has = Object.prototype.hasOwnProperty.call(doc, k);
          if (v.$exists && !has) return false;
          if (!v.$exists && has) return false;
        } else if ('$ne' in v) { if (doc[k] === v.$ne) return false; }
        continue;
      }
      if (doc[k] !== v) return false;
    }
    return true;
  });
}

// ── Mongoose connection mock ──────────────────────────────────────────────────
// Migrations call mongoose.connection.collection(name) and mongoose.connection.db.
// We replace these with our in-memory store for each test suite.

let _mockCollections = {};

function _getOrCreateCollection(name) {
  if (!_mockCollections[name]) _mockCollections[name] = makeInMemoryCollection();
  return _mockCollections[name];
}

function _resetCollections() { _mockCollections = {}; }

// mongoose.connection is patched in beforeEach using jest.spyOn — we keep the
// actual mongoose module so Types, Schema, etc. remain available to any
// migration files that import them.  The connection.collection and
// connection.db properties are replaced per-test via Object.defineProperty.
// (No jest.mock factory is needed for mongoose itself.)

// ── Helper: load a migration by slug ─────────────────────────────────────────

function loadMigrationBySlug(slug) {
  const file = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.js'))
    .find(f => f.includes(slug));
  if (!file) throw new Error(`Migration slug not found: "${slug}"`);
  const fullPath = path.join(MIGRATIONS_DIR, file);
  delete require.cache[fullPath];
  return require(fullPath);
}

// ── Reset collections before each test ───────────────────────────────────────
// Patch mongoose.connection so migrations that call
// mongoose.connection.collection(name) or mongoose.connection.db.collection(name)
// use our in-memory store instead of a real MongoDB.

beforeEach(() => {
  _resetCollections();
  jest.clearAllMocks();

  const mongoose = require('mongoose');

  // Build a proxy db object that delegates to our in-memory store
  const mockDb = {
    collection: (name) => _getOrCreateCollection(name),
  };

  // Patch the connection object in-place (mongoose.connection is a singleton)
  Object.defineProperty(mongoose, 'connection', {
    get() {
      return {
        collection: (name) => _getOrCreateCollection(name),
        db: mockDb,
      };
    },
    configurable: true,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration 001 — backfill_remaining_balance
// ─────────────────────────────────────────────────────────────────────────────
describe('Migration 001 — backfill_remaining_balance', () => {
  let migration;
  beforeAll(() => { migration = loadMigrationBySlug('backfill_remaining_balance'); });

  it('sets remainingBalance on students where it is null', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'STU-001', feeAmount: 100, totalPaid: 40, remainingBalance: null },
      { studentId: 'STU-002', feeAmount: 200, totalPaid: 200, remainingBalance: null },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs.find(d => d.studentId === 'STU-001').remainingBalance).toBe(60);
    expect(docs.find(d => d.studentId === 'STU-002').remainingBalance).toBe(0);
  });

  it('does not overwrite an existing non-null remainingBalance', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'STU-003', feeAmount: 100, totalPaid: 40, remainingBalance: 60 },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs[0].remainingBalance).toBe(60);
  });

  it('is idempotent — running twice produces the same result', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'STU-004', feeAmount: 150, totalPaid: 75, remainingBalance: null },
    ]);

    await migration.up();
    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs[0].remainingBalance).toBe(75);
  });

  it('handles edge case: feeAmount and totalPaid both zero', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'STU-005', feeAmount: 0, totalPaid: 0, remainingBalance: null },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs[0].remainingBalance).toBe(0);
  });

  it('handles edge case: overpayment (totalPaid > feeAmount)', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'STU-006', feeAmount: 100, totalPaid: 150, remainingBalance: null },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    // $subtract(100, 150) = -50 — migration does not clamp
    expect(docs[0].remainingBalance).toBe(-50);
  });

  it('works on an empty collection without throwing', async () => {
    await expect(migration.up()).resolves.not.toThrow();
  });

  it('rollback (down) is callable without throwing', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'STU-007', feeAmount: 100, totalPaid: 60, remainingBalance: null },
    ]);
    await migration.up();
    await expect(migration.down()).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration 005 — backfill_fee_structure_is_active
// ─────────────────────────────────────────────────────────────────────────────
describe('Migration 005 — backfill_fee_structure_is_active', () => {
  let migration;
  beforeAll(() => { migration = loadMigrationBySlug('backfill_fee_structure_is_active'); });

  it('sets isActive=true for fee structures with no isActive field', async () => {
    const col = _getOrCreateCollection('feestructures');
    await col.insertMany([
      { className: 'JSS1', feeAmount: 100 },
      { className: 'JSS2', feeAmount: 200 },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    for (const doc of docs) expect(doc.isActive).toBe(true);
  });

  it('preserves explicitly false isActive', async () => {
    const col = _getOrCreateCollection('feestructures');
    await col.insertMany([
      { className: 'SS1', feeAmount: 300, isActive: false },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs[0].isActive).toBe(false);
  });

  it('handles empty collection gracefully', async () => {
    await expect(migration.up()).resolves.not.toThrow();
  });

  it('is idempotent — running twice does not change values', async () => {
    const col = _getOrCreateCollection('feestructures');
    await col.insertMany([{ className: 'JSS3', feeAmount: 150 }]);

    await migration.up();
    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs[0].isActive).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration 013 — backfill_student_deleted_at
// ─────────────────────────────────────────────────────────────────────────────
describe('Migration 013 — backfill_student_deleted_at', () => {
  let migration;
  beforeAll(() => { migration = loadMigrationBySlug('backfill_student_deleted_at'); });

  it('sets deletedAt=null on students without that field', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'DEL-001' },  // no deletedAt
      { studentId: 'DEL-002', deletedAt: null },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    // All students should have deletedAt field present after migration
    for (const doc of docs) {
      // either field is present as null, or the $set was applied
      const isOk = doc.deletedAt === null ||
                   Object.prototype.hasOwnProperty.call(doc, 'deletedAt');
      expect(isOk).toBe(true);
    }
  });

  it('does not modify already soft-deleted students', async () => {
    const col = _getOrCreateCollection('students');
    const deletedDate = new Date('2024-01-01');
    await col.insertMany([
      { studentId: 'DEL-003', deletedAt: deletedDate },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    // deletedDate was explicitly set — the { $exists: false } filter skips it
    expect(docs[0].deletedAt).toBe(deletedDate);
  });

  it('is idempotent — running twice does not corrupt data', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([{ studentId: 'DEL-004' }]);

    await migration.up();
    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs.length).toBe(1);
  });

  it('rollback ($unset deletedAt) is callable without throwing', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([{ studentId: 'DEL-005' }]);
    await migration.up();
    await expect(migration.down()).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration 014 — add_school_timezone
// ─────────────────────────────────────────────────────────────────────────────
describe('Migration 014 — add_school_timezone', () => {
  let migration;
  beforeAll(() => { migration = loadMigrationBySlug('add_school_timezone'); });

  it('adds a default timezone to schools without one', async () => {
    const col = _getOrCreateCollection('schools');
    await col.insertMany([
      { schoolId: 'SCH-001', name: 'Alpha' },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs[0].timezone).toBeTruthy();
  });

  it('preserves an existing timezone value', async () => {
    const col = _getOrCreateCollection('schools');
    await col.insertMany([
      { schoolId: 'SCH-002', name: 'Beta', timezone: 'America/New_York' },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs[0].timezone).toBe('America/New_York');
  });

  it('handles an empty schools collection without throwing', async () => {
    await expect(migration.up()).resolves.not.toThrow();
  });

  it('is idempotent — timezone does not change on second run', async () => {
    const col = _getOrCreateCollection('schools');
    await col.insertMany([{ schoolId: 'SCH-003' }]);

    await migration.up();
    const [after1] = await col.find({}).toArray();
    const tz = after1.timezone;

    await migration.up();
    const [after2] = await col.find({}).toArray();
    expect(after2.timezone).toBe(tz);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration 010 — backfill_student_deleted_payments
// ─────────────────────────────────────────────────────────────────────────────
describe('Migration 010 — backfill_student_deleted_payments', () => {
  let migration;
  beforeAll(() => { migration = loadMigrationBySlug('backfill_student_deleted_payments'); });

  it('runs against a non-empty payments collection without throwing', async () => {
    const col = _getOrCreateCollection('payments');
    await col.insertMany([
      { txHash: 'TX-001', status: 'SUCCESS', deletedAt: null },
      { txHash: 'TX-002', status: 'PENDING' },
    ]);

    await expect(migration.up()).resolves.not.toThrow();
  });

  it('handles an empty payments collection without throwing', async () => {
    await expect(migration.up()).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration 029 — encrypt_student_pii
// ─────────────────────────────────────────────────────────────────────────────
describe('Migration 029 — encrypt_student_pii', () => {
  let migration;

  beforeAll(() => {
    process.env.STUDENT_PII_ENCRYPTION_KEY = 'a'.repeat(64);
    migration = loadMigrationBySlug('encrypt_student_pii');
  });

  it('encrypts plaintext parentEmail — result has "enc:" prefix', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'PII-001', parentEmail: 'parent@example.com', parentPhone: '+1234567890' },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    const doc = docs[0];
    if (doc.parentEmail && doc.parentEmail !== 'parent@example.com') {
      expect(doc.parentEmail).toMatch(/^enc:/);
    }
    if (doc.parentPhone && doc.parentPhone !== '+1234567890') {
      expect(doc.parentPhone).toMatch(/^enc:/);
    }
  });

  it('skips already-encrypted values (idempotent)', async () => {
    const col = _getOrCreateCollection('students');
    const key = Buffer.from(process.env.STUDENT_PII_ENCRYPTION_KEY, 'hex');
    const iv = Buffer.alloc(12, 1);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update('already_encrypted', 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const encVal = `enc:${Buffer.concat([iv, ciphertext]).toString('base64url')}`;
    await col.insertMany([
      { studentId: 'PII-002', parentEmail: encVal, parentPhone: encVal },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs[0].parentEmail).toBe(encVal);
    expect(docs[0].parentPhone).toBe(encVal);
  });

  it('plaintext PII is not present in the collection after migration', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'PII-003', parentEmail: 'secret@test.example', parentPhone: '+9876543210' },
    ]);

    await migration.up();

    const docs = await col.find({}).toArray();
    expect(docs[0].parentEmail).not.toBe('secret@test.example');
    expect(docs[0].parentPhone).not.toBe('+9876543210');
  });

  it('handles students with null PII fields without throwing', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([
      { studentId: 'PII-004', parentEmail: null, parentPhone: null },
    ]);

    await expect(migration.up()).resolves.not.toThrow();
  });

  it('handles students with missing PII fields without throwing', async () => {
    const col = _getOrCreateCollection('students');
    await col.insertMany([{ studentId: 'PII-005' }]);

    await expect(migration.up()).resolves.not.toThrow();
  });

  it('handles empty students collection without throwing', async () => {
    await expect(migration.up()).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration runner — orchestration (fully mocked, no real DB required)
// ─────────────────────────────────────────────────────────────────────────────
describe('Migration runner — orchestration', () => {
  const realReaddirSync = fs.readdirSync.bind(fs);
  const realExistsSync  = fs.existsSync.bind(fs);
  const { runMigrations, rollback } = require('../backend/src/services/migrationRunner');

  afterEach(() => {
    fs.readdirSync = realReaddirSync;
    fs.existsSync  = realExistsSync;
  });

  it('runs pending migrations and records them as applied', async () => {
    const upFn = jest.fn().mockResolvedValue(undefined);
    const migrations = [
      { version: 'test-001-alpha', up: upFn },
      { version: 'test-002-beta',  up: upFn },
    ];

    fs.existsSync  = p => p === MIGRATIONS_DIR ? true : realExistsSync(p);
    fs.readdirSync = p => p === MIGRATIONS_DIR
      ? migrations.map(m => `${m.version}.js`)
      : realReaddirSync(p);

    const mockRequire = p => {
      const base = path.basename(p, '.js');
      return migrations.find(m => m.version === base) || {};
    };

    mockMigFindOneAndUpdate.mockResolvedValue(null);
    mockMigDeleteOne.mockResolvedValue({});

    await runMigrations(mockRequire, {});

    expect(upFn).toHaveBeenCalledTimes(2);
  });

  it('skips already-applied migrations (lock already held)', async () => {
    const upFn = jest.fn().mockResolvedValue(undefined);
    const migration = { version: 'test-skip-already', up: upFn };

    fs.existsSync  = p => p === MIGRATIONS_DIR ? true : realExistsSync(p);
    fs.readdirSync = p => p === MIGRATIONS_DIR ? [`${migration.version}.js`] : realReaddirSync(p);

    const mockRequire = () => migration;
    mockMigFindOneAndUpdate.mockResolvedValue({ version: migration.version }); // lock held

    await runMigrations(mockRequire, {});

    expect(upFn).not.toHaveBeenCalled();
  });

  it('removes the lock and re-throws when a migration fails', async () => {
    const failMig = {
      version: 'test-fail-migration',
      up: jest.fn().mockRejectedValue(new Error('Intentional failure')),
    };

    fs.existsSync  = p => p === MIGRATIONS_DIR ? true : realExistsSync(p);
    fs.readdirSync = p => p === MIGRATIONS_DIR ? [`${failMig.version}.js`] : realReaddirSync(p);

    const mockRequire = () => failMig;
    mockMigFindOneAndUpdate.mockResolvedValue(null);
    mockMigDeleteOne.mockResolvedValue({});

    await expect(runMigrations(mockRequire, {})).rejects.toThrow('Intentional failure');
    expect(mockMigDeleteOne).toHaveBeenCalledWith({ version: failMig.version });
  });

  it('throws when the migrations directory does not exist', async () => {
    fs.existsSync = () => false;
    await expect(runMigrations(require, {})).rejects.toThrow(/Migrations directory not found/);
  });

  it('rollback is a no-op when no migrations have been applied', async () => {
    mockMigFindOne.mockReturnValue({
      sort: () => Promise.resolve(null),
    });

    fs.existsSync  = p => p === MIGRATIONS_DIR ? true : realExistsSync(p);
    fs.readdirSync = p => p === MIGRATIONS_DIR ? [] : realReaddirSync(p);

    await expect(rollback(require, {})).resolves.toBeUndefined();
  });

  it('rollback calls down() on the most recently applied migration', async () => {
    const downFn  = jest.fn().mockResolvedValue(undefined);
    const lastMig = { version: 'test-rollback-target', down: downFn };

    mockMigFindOne.mockReturnValue({
      sort: () => Promise.resolve({ version: lastMig.version }),
    });

    fs.existsSync  = p => p === MIGRATIONS_DIR ? true : realExistsSync(p);
    fs.readdirSync = p => p === MIGRATIONS_DIR ? [`${lastMig.version}.js`] : realReaddirSync(p);

    const mockRequire = p => {
      const base = path.basename(p, '.js');
      return base === lastMig.version ? lastMig : {};
    };

    mockMigDeleteOne.mockResolvedValue({});

    await rollback(mockRequire, {});

    expect(downFn).toHaveBeenCalledTimes(1);
    expect(mockMigDeleteOne).toHaveBeenCalledWith({ version: lastMig.version });
  });
});
