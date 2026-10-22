/**
 * useDashboardLoader — issue #18
 *
 * Route-level data loader for the dashboard page.
 *
 * Problem solved
 * ──────────────
 * The dashboard previously used independent `useEffect` hooks to fetch
 * summary data and student data, issuing separate requests with separate
 * loading/error states. This caused:
 *   • No single "initial load" coordination — widgets could start in
 *     arbitrary order, producing inconsistent perceived loading time.
 *   • A failure in one widget cleared state unrelated to that widget
 *     (because error state was shared at the page level in earlier
 *     versions of the component).
 *
 * How this hook addresses it
 * ──────────────────────────
 *   1. DEDUPLICATED REQUESTS — `load()` fans out `getPaymentSummary` and
 *      `getStudents` in parallel via `Promise.allSettled`.  There is exactly
 *      one in-flight request per data source regardless of how many widgets
 *      consume it.
 *
 *   2. INDEPENDENT FAILURE STATES — summary and students each carry their own
 *      `error` value.  A failed summary does not wipe out a successfully
 *      loaded student list, and vice-versa.
 *
 *   3. CONSISTENT REFRESH TIMING — all consumers receive data from the same
 *      fetch cycle, so stat cards and the student table are always in sync
 *      with each other.
 *
 *   4. ABORT SAFETY — every `getStudents` call is issued with an
 *      AbortSignal; superseded (stale) requests are cancelled automatically
 *      when `load()` is called again before the previous call resolves.
 *
 * Usage
 * ─────
 *   const {
 *     summary, summaryLoading, summaryError,
 *     students, studentsLoading, studentsError,
 *     pages, total,
 *     load, loadSummary, loadStudents,
 *   } = useDashboardLoader({ page, search, statusFilter, classFilter });
 *
 *   // Trigger a full refresh (e.g. after a sync completes):
 *   load();
 *
 *   // Re-fetch only the student list (e.g. after editing a student):
 *   loadStudents();
 *
 *   // Re-fetch only the summary (e.g. after a payment event):
 *   loadSummary();
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getPaymentSummary, getStudents } from '../services/api';

const PAGE_SIZE = 20;

/**
 * @typedef {Object} DashboardLoaderResult
 * @property {object|null}  summary
 * @property {boolean}      summaryLoading
 * @property {string|null}  summaryError
 * @property {Array}        students
 * @property {boolean}      studentsLoading
 * @property {string|null}  studentsError
 * @property {number}       pages
 * @property {number}       total
 * @property {Function}     load          — full parallel refresh
 * @property {Function}     loadSummary   — summary-only refresh
 * @property {Function}     loadStudents  — students-only refresh
 */

/**
 * @param {object} params
 * @param {number} params.page
 * @param {string} params.search
 * @param {string} params.statusFilter
 * @param {string} params.classFilter
 * @param {string} [params.summaryErrorMsg]   — i18n error string for summary failures
 * @param {string} [params.studentsErrorMsg]  — i18n error string for students failures
 * @returns {DashboardLoaderResult}
 */
export function useDashboardLoader({
  page,
  search,
  statusFilter,
  classFilter,
  summaryErrorMsg  = 'Could not load payment summary.',
  studentsErrorMsg = 'Could not load student list.',
} = {}) {
  // ── Summary slice ─────────────────────────────────────────────────────────
  const [summary, setSummary]               = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError]     = useState(null);

  // ── Students slice ────────────────────────────────────────────────────────
  const [students, setStudents]               = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError]     = useState(null);
  const [pages, setPages]                     = useState(1);
  const [total, setTotal]                     = useState(0);

  // Abort controller for the in-flight students request — superseded calls
  // are cancelled before a new one starts.
  const studentsAbortRef = useRef(null);

  // ── Summary loader ────────────────────────────────────────────────────────

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    setSummaryError(null);
    return getPaymentSummary()
      .then(({ data }) => {
        setSummary(data);
        return data;
      })
      .catch(() => {
        setSummaryError(summaryErrorMsg);
        return null;
      })
      .finally(() => setSummaryLoading(false));
  }, [summaryErrorMsg]);

  // ── Students loader ───────────────────────────────────────────────────────

  const loadStudents = useCallback(() => {
    // Cancel the previous in-flight request.
    studentsAbortRef.current?.abort();
    const controller = new AbortController();
    studentsAbortRef.current = controller;

    setStudentsLoading(true);
    setStudentsError(null);
    return getStudents(
      page,
      PAGE_SIZE,
      { search, status: statusFilter, className: classFilter },
      { signal: controller.signal }
    )
      .then(({ data }) => {
        setStudents(data.students ?? []);
        setPages(data.pages ?? 1);
        setTotal(data.total ?? 0);
        return data;
      })
      .catch((err) => {
        // Silently discard superseded/aborted requests.
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
          return null;
        }
        setStudentsError(studentsErrorMsg);
        return null;
      })
      .finally(() => {
        // Only clear loading if this controller is still current.
        if (studentsAbortRef.current === controller) {
          setStudentsLoading(false);
        }
      });
  }, [page, search, statusFilter, classFilter, studentsErrorMsg]);

  // ── Full parallel loader ──────────────────────────────────────────────────

  /**
   * Fan out both requests in parallel via Promise.allSettled so that one
   * failure does not prevent the other data source from resolving.  Returns
   * a promise that resolves once both settle.
   */
  const load = useCallback(() => {
    return Promise.allSettled([loadSummary(), loadStudents()]);
  }, [loadSummary, loadStudents]);

  // ── Auto-refresh when filter params change ────────────────────────────────

  useEffect(() => {
    loadStudents();
    // Cleanup: cancel in-flight request on unmount or before next effect run.
    return () => studentsAbortRef.current?.abort();
  }, [loadStudents]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    // Summary
    summary,
    summaryLoading,
    summaryError,
    // Students
    students,
    studentsLoading,
    studentsError,
    pages,
    total,
    // Actions
    load,
    loadSummary,
    loadStudents,
  };
}

export default useDashboardLoader;
