/**
 * envValidation.js — Issue #250
 *
 * Validates required public environment variables at startup.
 * Reports every missing or incorrectly formatted variable in a single error
 * so developers fix all problems at once rather than one at a time.
 *
 * Validation performed:
 *   - Presence: required variables must be non-empty.
 *   - URL format: NEXT_PUBLIC_API_URL must be a valid absolute URL or a
 *                 root-relative path beginning with "/" (for same-origin proxy setups).
 *   - Network name: NEXT_PUBLIC_STELLAR_NETWORK must be "testnet" or "mainnet".
 *   - Timeout: NEXT_PUBLIC_REQUEST_TIMEOUT_MS must be a positive integer when set.
 *
 * Behaviour by environment:
 *   - Production  (NODE_ENV === 'production'): throws an Error on any violation.
 *   - Development (any other NODE_ENV):        logs a warning and continues.
 *
 * Usage:
 *   import { validateEnv } from '../config/envValidation';
 *   validateEnv();  // Call before React tree renders (see _app.jsx).
 *
 * Uses CommonJS exports so it can also be require()-d from next.config.js.
 * Never logs variable *values* — only names appear in error/warning messages.
 */

/** Variables that must be non-empty for the app to function */
const REQUIRED_PUBLIC_VARS = ['NEXT_PUBLIC_API_URL'];

/** Variables with safe defaults */
const OPTIONAL_PUBLIC_VARS = {
  NEXT_PUBLIC_REQUEST_TIMEOUT_MS: '15000',
  NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
};

/** Valid values for NEXT_PUBLIC_STELLAR_NETWORK */
const VALID_STELLAR_NETWORKS = ['testnet', 'mainnet'];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the value of a public env var, or the provided fallback.
 * Never logs the value — only the key name in error messages.
 *
 * @param {string} name
 * @param {string} [fallback='']
 * @returns {string}
 */
function getEnvVar(name, fallback = '') {
  const val = typeof process !== 'undefined' ? process.env[name] : undefined;
  return (val !== undefined && val !== '') ? val : fallback;
}

/**
 * Returns true if the string is a valid absolute URL (http/https) or a
 * root-relative path starting with "/".  Accepts:
 *   - "https://api.example.com/api"
 *   - "http://localhost:5000/api"
 *   - "/api"   ← same-origin proxy (recommended for Codespaces / Docker)
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidApiUrl(value) {
  if (!value || typeof value !== 'string') return false;
  // Accept root-relative paths (used with Next.js rewrites proxy)
  if (value.startsWith('/')) return true;
  // Accept absolute http / https URLs
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Returns true if the value is a valid positive integer string (> 0).
 *
 * @param {string} value
 * @returns {boolean}
 */
function isPositiveIntegerString(value) {
  if (!value || typeof value !== 'string') return false;
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

/**
 * Schema entries describe each known env var.
 * Each entry may carry an optional `validate` function returning a string
 * error message (or null when valid).
 *
 * @type {Array<{
 *   name: string,
 *   required: boolean,
 *   default?: string,
 *   validate?: (value: string) => string|null,
 * }>}
 */
const ENV_SCHEMA = [
  {
    name: 'NEXT_PUBLIC_API_URL',
    required: true,
    validate: (value) => {
      if (!isValidApiUrl(value)) {
        return (
          `NEXT_PUBLIC_API_URL must be a valid absolute URL (http/https) or a ` +
          `root-relative path starting with "/". ` +
          `Example: "https://api.example.com/api" or "/api".`
        );
      }
      return null;
    },
  },
  {
    name: 'NEXT_PUBLIC_STELLAR_NETWORK',
    required: false,
    default: 'testnet',
    validate: (value) => {
      if (!VALID_STELLAR_NETWORKS.includes(value)) {
        return (
          `NEXT_PUBLIC_STELLAR_NETWORK must be one of: ${VALID_STELLAR_NETWORKS.join(', ')}. ` +
          `Received an unrecognised network name.`
        );
      }
      return null;
    },
  },
  {
    name: 'NEXT_PUBLIC_REQUEST_TIMEOUT_MS',
    required: false,
    default: '15000',
    validate: (value) => {
      if (!isPositiveIntegerString(value)) {
        return (
          `NEXT_PUBLIC_REQUEST_TIMEOUT_MS must be a positive integer (milliseconds). ` +
          `Example: "15000".`
        );
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates all environment variables defined in ENV_SCHEMA.
 *
 * Checks:
 *   1. Required variables are present and non-empty.
 *   2. Each present variable passes its schema validator (if any).
 *
 * In production: throws an Error listing every violation.
 * In development: logs a warning for each violation and continues.
 *
 * @returns {{ [key: string]: string }} Snapshot of validated env var values.
 * @throws {Error} In production when one or more required vars are missing or invalid.
 */
function validateEnv() {
  const violations = [];

  for (const entry of ENV_SCHEMA) {
    const defaultValue = entry.default ?? (OPTIONAL_PUBLIC_VARS[entry.name] || '');
    const rawValue = getEnvVar(entry.name, '');

    // 1. Presence check for required variables
    if (entry.required && !rawValue) {
      violations.push(
        `${entry.name} is required but not set. Check your .env.local file.`
      );
      // Skip format validation when the value is missing
      continue;
    }

    // 2. Format/value validation (only when a value is present)
    const valueToValidate = rawValue || defaultValue;
    if (entry.validate && valueToValidate) {
      const formatError = entry.validate(valueToValidate);
      if (formatError) {
        violations.push(`${entry.name}: ${formatError}`);
      }
    }
  }

  if (violations.length > 0) {
    const header = `Environment configuration error(s) detected:\n`;
    const list = violations.map((v, i) => `  ${i + 1}. ${v}`).join('\n');
    const footer = `\nFix these issues in your .env.local file before starting the application.`;
    const msg = `${header}${list}${footer}`;

    const isProd =
      typeof process !== 'undefined' && process.env.NODE_ENV === 'production';

    if (isProd) {
      throw new Error(msg);
    } else {
      if (typeof console !== 'undefined') {
        console.warn('[envValidation]', msg);
      }
    }
  }

  // Return a snapshot of all validated values (required + optional with defaults)
  const snapshot = {};
  for (const entry of ENV_SCHEMA) {
    const defaultValue = entry.default ?? (OPTIONAL_PUBLIC_VARS[entry.name] || '');
    snapshot[entry.name] = getEnvVar(entry.name, defaultValue);
  }
  return snapshot;
}

/** True when running in a browser context */
const isBrowser = typeof window !== 'undefined';

module.exports = {
  REQUIRED_PUBLIC_VARS,
  OPTIONAL_PUBLIC_VARS,
  VALID_STELLAR_NETWORKS,
  ENV_SCHEMA,
  getEnvVar,
  isValidApiUrl,
  isPositiveIntegerString,
  validateEnv,
  isBrowser,
};
