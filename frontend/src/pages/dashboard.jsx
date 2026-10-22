import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import SyncButton from "../components/SyncButton";
import ErrorBoundary from "../components/ErrorBoundary";
import StudentForm from "../components/StudentForm";
import PageHero, { StatCard } from "../components/PageHero";
import SseDegradedBanner from "../components/SseDegradedBanner";
import RequireAdmin from "../components/RequireAdmin";
import EmptyState, { StandaloneEmptyState } from "../components/EmptyState";
import BlockchainStatusBadge from "../components/BlockchainStatusBadge";
import { TableDensityControl, useTableDensity } from "../components/TableDensityControl";
import { SkeletonStatCard, SkeletonTableRow } from "../components/Skeleton";
import FilterChips from "../components/FilterChips"; // Issue #107
import Pagination from "../components/Pagination";
import { usePaymentEvents } from "../hooks/usePaymentEvents";
import { useRouteChangeAbort } from "../hooks/useRouteChangeAbort";
import { getSyncStatus, getPaymentSummary, getStudents, getStudent, getSchool } from "../services/api";
import {
  IconUsers, IconCheck, IconAlertTriangle, IconDollarSign,
  IconSearch, IconChevronLeft, IconChevronRight,
} from "../components/Icons";
import { DEFAULT_CLASS_OPTIONS, loadSchoolClassOptions } from "../utils/classOptions";
import { formatRelative } from "../utils/dateTime";

const DEFAULT_PAGE_SIZE = 20;

function Dashboard() {
  const { t } = useTranslation();
  const timeAgo = (iso) => formatRelative(iso, t);

  const STATUS_BADGE = {
    paid:    { cls: "badge badge-success", label: t("status.student.paid") },
    partial: { cls: "badge badge-warning", label: t("status.student.partial") },
    unpaid:  { cls: "badge badge-danger",  label: t("status.student.unpaid") },
  };

  const [lastSyncAt, setLastSyncAt]           = useState(null);
  const [syncMsg, setSyncMsg]                 = useState(null);
  const [summary, setSummary]                 = useState(null);
  const [summaryLoading, setSummaryLoading]   = useState(true);
  const [summaryError, setSummaryError]       = useState(null);
  const [students, setStudents]               = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError]     = useState(null);
  const [page, setPage]                       = useState(1);
  const [pages, setPages]                     = useState(1);
  const [total, setTotal]                     = useState(0);
  const [pageSize, setPageSize]               = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch]                   = useState("");
  const [statusFilter, setStatusFilter]       = useState("all");
  const [classFilter, setClassFilter]         = useState("");
  const [classOptions, setClassOptions]       = useState(DEFAULT_CLASS_OPTIONS);
  const [error, setError]                     = useState(null);
  const [editingStudent, setEditingStudent]   = useState(null);
  const [editingStudentData, setEditingStudentData] = useState(null);

  // Table density (compact / default / comfortable) — Issue #113
  const { density, setDensity } = useTableDensity();
  // Set of student IDs whose detail row is currently expanded — Issue #113
  const [expandedRows, setExpandedRows] = useState(new Set());

  // Real-time SSE — surfaces degraded/reconnecting/failed state (Issues #1054, #1078).
  const { degraded, connectionStatus } = usePaymentEvents({
    onEvent: (type) => {
      // Refresh summary/students whenever a payment or dispute event arrives.
      if (type === 'payment' || type.startsWith('dispute')) {
        fetchSummary();
        fetchStudents(page, debouncedSearch, statusFilter, classFilter);
      }
    },
  });

  // Issue #6 — abort page-level requests when the user navigates away.
  // The returned signal is passed to fetchSummary / initial data loads below.
  const { signal: routeSignal } = useRouteChangeAbort();

  const searchDebounceRef = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Holds the AbortController for the most-recent fetchStudents call so
  // superseded (stale) requests can be cancelled before the next one starts.
  const studentsAbortRef = useRef(null);

  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchDebounceRef.current);
  }, [search]);

  const fetchSummary = useCallback(() => {
    setSummaryLoading(true);
    setSummaryError(null);
    // Pass the route-change signal so navigation cancels the in-flight request
    // without triggering an error toast (Issue #6).
    getPaymentSummary({ signal: routeSignal })
      .then(({ data }) => setSummary(data))
      .catch((err) => {
        // Silently ignore requests cancelled by route change or AbortController.
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setSummaryError(t("dashboard.failedToLoadSummary"));
      })
      .finally(() => setSummaryLoading(false));
  }, [t, routeSignal]);

  const fetchStudents = useCallback((p, srch, st, cls) => {
    // Cancel any in-flight student fetch before issuing a new one.
    studentsAbortRef.current?.abort();
    const controller = new AbortController();
    studentsAbortRef.current = controller;

    setStudentsLoading(true);
    setStudentsError(null);
    getStudents(p, pageSize, { search: srch, status: st, className: cls }, { signal: controller.signal })
      .then(({ data }) => {
        setStudents(data.students);
        setPages(data.pages || 1);
        setTotal(data.total || 0);
      })
      .catch((err) => {
        // Silently ignore aborted (superseded) requests.
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setStudentsError(t("dashboard.failedToLoadStudents"));
      })
      .finally(() => {
        // Only clear loading when this controller is still the current one.
        if (studentsAbortRef.current === controller) {
          setStudentsLoading(false);
        }
      });
  }, [t, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tracks whether the page effect is running for the very first time.
  // On mount the filter effect already calls fetchStudents(1, …), so the page
  // effect must skip that initial run to avoid a duplicate /students request
  // (#1214).  Subsequent page changes (user clicks Next/Prev) are not skipped.
  const isInitialPageRender = useRef(true);

  useEffect(() => {
    // Pass routeSignal so navigation cancels these page-level requests without
    // triggering error toasts (Issue #6).
    getSyncStatus({ signal: routeSignal })
      .then(({ data }) => setLastSyncAt(data.lastSyncAt))
      .catch((err) => {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setError(t("dashboard.failedToLoadSyncStatus"));
      });
    fetchSummary();
    loadSchoolClassOptions(getSchool, setClassOptions);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPage(1);
    fetchStudents(1, debouncedSearch, statusFilter, classFilter);
  }, [debouncedSearch, statusFilter, classFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // When page size changes, reset to page 1 and refetch.
  useEffect(() => {
    setPage(1);
    fetchStudents(1, debouncedSearch, statusFilter, classFilter);
  }, [pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Skip the initial render — the filter effect above already fetched page 1.
    if (isInitialPageRender.current) {
      isInitialPageRender.current = false;
      return;
    }
    fetchStudents(page, debouncedSearch, statusFilter, classFilter);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSyncComplete(data) {
    setLastSyncAt(new Date().toISOString());
    setSyncMsg(data?.message || t("dashboard.syncComplete"));
    setTimeout(() => setSyncMsg(null), 3500);
    fetchSummary();
    setPage(1);
    fetchStudents(1, debouncedSearch, statusFilter, classFilter);
  }

  async function handleEditStudent(student) {
    try {
      const { data } = await getStudent(student.studentId);
      setEditingStudentData(data);
      setEditingStudent(student.studentId);
    } catch {
      setError(t("dashboard.failedToLoadStudentDetails"));
    }
  }

  function handleCloseForm() {
    setEditingStudent(null);
    setEditingStudentData(null);
  }

  function handleSaveStudent() {
    handleCloseForm();
    fetchStudents(page, debouncedSearch, statusFilter, classFilter);
  }

  // Toggle expanded detail row for a student — Issue #113
  function handleRowClick(studentId) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }

  const stats = [
    {
      label: t("dashboard.statTotalStudents"),
      value: summary?.totalStudents ?? summary?.total ?? "—",
      Icon: IconUsers,
      color: "cyan",
    },
    {
      label: t("status.student.paid"),
      value: summary?.paidCount ?? summary?.counts?.paid ?? "—",
      Icon: IconCheck,
      color: "green",
    },
    {
      label: t("dashboard.statPending"),
      value: summary ? ((summary.unpaidCount || 0) + (summary.counts?.partial || 0)) || "—" : "—",
      Icon: IconAlertTriangle,
      color: "amber",
    },
    {
      label: t("dashboard.statXlmCollected"),
      value: summary
        ? (summary.totalXlmCollected || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
        : "—",
      sub: t("dashboard.statXlmTotalSub"),
      Icon: IconDollarSign,
      color: "violet",
    },
  ];

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd   = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <SseDegradedBanner degraded={degraded} connectionStatus={connectionStatus} />
      <style>{`        @keyframes dashFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dash-wrap { animation: dashFadeUp 0.35s ease both; }
        .dash-stat-row { --stat-accent: var(--c); }

        /* Inline toolbar override for search */
        .dash-search {
          position: relative;
        }
        .dash-search-icon {
          position: absolute;
          left: 0.65rem;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
          pointer-events: none;
          display: flex;
        }
        .dash-search input {
          padding-left: 2.125rem !important;
        }

        .student-row-name { font-weight: 500; color: var(--text); }
        .student-row-id { font-family: monospace; font-size: 0.78rem; color: var(--text-muted); }
        .student-row-class { font-size: 0.8125rem; color: var(--text-muted); }
        .student-row-fee { font-variant-numeric: tabular-nums; font-size: 0.875rem; }

        .stat-card-inner {
          display: flex;
          flex-direction: column;
        }
        .stat-card-icon-wrap {
          width: 36px; height: 36px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 0.875rem;
          flex-shrink: 0;
        }

        /* Skeleton pulse styles live in globals.css (issue #13). */

        /* ── Table density — Issue #113 ──────────────────── */
        .data-table[data-density='compact'] td,
        .data-table[data-density='compact'] th {
          padding: 0.3rem 0.75rem;
          font-size: 0.8rem;
        }
        .data-table[data-density='comfortable'] td,
        .data-table[data-density='comfortable'] th {
          padding: 1rem 1.25rem;
          font-size: 0.9375rem;
        }

        /* ── Responsive column hiding — Issue #113 ───────── */
        @media (max-width: 640px) {
          .col-hide-sm { display: none; }
        }
        @media (max-width: 480px) {
          .col-hide-xs { display: none; }
        }

        /* ── Expandable row detail — Issue #113 ──────────── */
        .row-clickable {
          cursor: pointer;
          user-select: none;
        }
        .row-clickable:hover td {
          background: var(--accent-subtle);
        }
        .row-clickable:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }
        .row-expanded td {
          background: var(--accent-subtle);
        }
        .row-detail td {
          padding: 0.75rem 1rem;
          background: var(--bg-subtle, var(--bg));
          border-top: 1px solid var(--border);
          border-bottom: 2px solid var(--accent-subtle);
        }
        .row-detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 0.75rem 1.5rem;
        }
        .row-detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .row-detail-label {
          font-size: 0.68rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--text-muted);
        }
        .row-detail-value {
          font-size: 0.875rem;
          color: var(--text);
        }
      `}</style>

      {/* Accessibility live regions */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {summaryLoading || studentsLoading ? t("dashboard.loadingAria") : t("dashboard.loadedAria")}
      </div>
      {(summaryError || studentsError) && (
        <div aria-live="assertive" aria-atomic="true" className="sr-only">
          {summaryError || studentsError}
        </div>
      )}

      <div className="page-wrap dash-wrap">

        {/* ── Centered Hero Header ──────────────────── */}
        <PageHero
          eyebrow={t("dashboard.eyebrow")}
          title={t("dashboard.title")}
          subtitle={t("dashboard.subtitle")}
        >
          <SyncButton onSyncComplete={handleSyncComplete} lastSyncTime={lastSyncAt} />
          <span style={{ alignSelf: "center", fontSize: "0.82rem", color: "rgba(255,255,255,0.85)" }}>
            {t("actions.lastSync")} <strong style={{ color: "#fff" }}>{timeAgo(lastSyncAt)}</strong>
          </span>
        </PageHero>

        {/* ── Alerts ────────────────────────────────── */}
        {syncMsg && (
          <div role="status" className="alert alert-success" style={{ marginBottom: "1.25rem" }}>
            <IconCheck size={16} />
            <span>{syncMsg}</span>
          </div>
        )}
        {error && (
          <div role="alert" className="alert alert-danger" style={{ marginBottom: "1.25rem" }}>
            <IconAlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Stat Cards ────────────────────────────── */}
        <ErrorBoundary>
          {summaryError ? (
            <div role="alert" className="alert alert-danger" style={{ marginBottom: "1.5rem" }}>
              <span style={{ flex: 1 }}>{summaryError}</span>
              <button onClick={fetchSummary} className="btn btn-sm btn-ghost" style={{ color: "inherit", borderColor: "currentColor", opacity: 0.8 }}>{t("actions.retry")}</button>
            </div>
          ) : (
            <div className="stat-grid" style={{ marginBottom: "1.75rem" }}>
              {summaryLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonStatCard key={i} />
                  ))
                : stats.map((s) => <StatCard key={s.label} {...s} />)
              }
            </div>
          )}
        </ErrorBoundary>

        {/* ── Student Table ─────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">{t("dashboard.studentsTitle")}</div>
              {!studentsLoading && total > 0 && (
                <div className="card-subtitle">{t("dashboard.studentsTotal", { count: total })}</div>
              )}
            </div>

            {/* Toolbar */}
            <div className="toolbar" role="search" aria-label={t("dashboard.filterStudentsAria")} style={{ margin: 0 }}>
              <div className="dash-search">
                <span className="dash-search-icon"><IconSearch size={14} /></span>
                <input
                  type="search"
                  placeholder={t("dashboard.searchPlaceholder")}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  aria-label={t("dashboard.searchAria")}
                  style={{
                    padding: "0.4rem 0.7rem",
                    paddingLeft: "2.125rem",
                    border: "1.5px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.8125rem",
                    fontFamily: "inherit",
                    color: "var(--text)",
                    background: "var(--card-bg)",
                    outline: "none",
                    width: 180,
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onFocus={e => { e.target.style.borderColor = "var(--accent)"; e.target.style.boxShadow = "0 0 0 3px var(--accent-subtle)"; }}
                  onBlur={e  => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                aria-label={t("dashboard.filterByStatusAria")}
                style={{
                  padding: "0.4rem 0.7rem",
                  border: "1.5px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8125rem",
                  fontFamily: "inherit",
                  color: "var(--text)",
                  background: "var(--card-bg)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="all">{t("dashboard.allStatus")}</option>
                <option value="paid">{t("status.student.paid")}</option>
                <option value="partial">{t("status.student.partial")}</option>
                <option value="unpaid">{t("status.student.unpaid")}</option>
              </select>
              <select
                value={classFilter}
                onChange={e => setClassFilter(e.target.value)}
                aria-label={t("dashboard.filterByClassAria")}
                style={{
                  padding: "0.4rem 0.7rem",
                  border: "1.5px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8125rem",
                  fontFamily: "inherit",
                  color: "var(--text)",
                  background: "var(--card-bg)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">{t("dashboard.allClasses")}</option>
                {classOptions.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {/* Density toggle — Issue #113 */}
              <TableDensityControl density={density} setDensity={setDensity} />
            </div>
          </div>

          {/* Filter chips — Issue #107 */}
          {(() => {
            const activeFilters = [
              statusFilter && statusFilter !== "all"
                ? { key: "status", label: t("dashboard.colStatus"), value: t(`status.student.${statusFilter}`) }
                : null,
              classFilter
                ? { key: "className", label: t("dashboard.colClass"), value: classFilter }
                : null,
              debouncedSearch
                ? { key: "search", label: t("dashboard.searchAria"), value: debouncedSearch }
                : null,
            ].filter(Boolean);
            return activeFilters.length > 0 ? (
              <div style={{ padding: "0 1.25rem" }}>
                <FilterChips
                  filters={activeFilters}
                  onRemove={key => {
                    if (key === "status")    setStatusFilter("all");
                    if (key === "className") setClassFilter("");
                    if (key === "search")    setSearch("");
                  }}
                  onClearAll={() => {
                    setStatusFilter("all");
                    setClassFilter("");
                    setSearch("");
                  }}
                />
              </div>
            ) : null;
          })()}

          {/* Table */}
          <ErrorBoundary>
            {studentsError ? (
              <div className="card-body">
                <StandaloneEmptyState
                    variant="error"
                  title={t("dashboard.failedToLoadStudents")}
                  description="Check your connection and try again."
                  action={{ label: t("actions.retry"), onClick: () => fetchStudents(page, debouncedSearch, statusFilter, classFilter) }}
                />
              </div>
            ) : (
              <div style={{ overflowX: "auto" }} aria-busy={studentsLoading} aria-label={t("dashboard.studentTableAria")}>
                <table
                  className="data-table"
                  data-density={density}
                  aria-label={studentsLoading ? t("dashboard.studentsLoadingAria") : t("dashboard.studentTableAria")}
                >
                  <thead>
                    <tr>
                      <th scope="col">{t("dashboard.colStudentId")}</th>
                      <th scope="col">{t("dashboard.colName")}</th>
                      <th scope="col" className="col-hide-sm">{t("dashboard.colClass")}</th>
                      <th scope="col" className="col-hide-sm">{t("dashboard.colFee")}</th>
                      <th scope="col" className="col-hide-xs">{t("dashboard.colStatus")}</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentsLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <SkeletonTableRow key={i} index={i} />
                      ))
                    ) : students.length === 0 ? (
                      <EmptyState
                        variant={search || statusFilter !== "all" || classFilter ? "filtered" : "empty"}
                        colSpan={6}
                        title={search || statusFilter !== "all" || classFilter ? t("dashboard.emptyTitle") : "No students yet"}
                        description={search || statusFilter !== "all" || classFilter ? t("dashboard.emptyFilters") : t("dashboard.emptyNone")}
                        action={search || statusFilter !== "all" || classFilter ? {
                          label: "Clear filters",
                          onClick: () => { setSearch(""); setStatusFilter("all"); setClassFilter(""); }
                        } : undefined}
                      />
                    ) : students.map(s => {
                      const st = (s.status || "unpaid").toLowerCase();
                      const badge = STATUS_BADGE[st] || STATUS_BADGE.unpaid;
                      const isExpanded = expandedRows.has(s.studentId);
                      return (
                        <>
                          <tr
                            key={s.studentId}
                            className={`row-clickable${isExpanded ? " row-expanded" : ""}`}
                            onClick={() => handleRowClick(s.studentId)}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? t("dashboard.collapseRow") : t("dashboard.expandRow")}
                            tabIndex={0}
                            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(s.studentId); } }}
                          >
                            <td className="col-mono">{s.studentId}</td>
                            <td className="student-row-name">{s.name}</td>
                            <td className="student-row-class col-hide-sm">{s.class}</td>
                            <td className="student-row-fee col-hide-sm">
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.feeAmount}</span>
                              <span style={{ marginLeft: "0.25rem", fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>XLM</span>
                            </td>
                            <td className="col-hide-xs">
                              <span className={badge.cls}>{badge.label}</span>
                            </td>
                            <td>
                              <button
                                onClick={e => { e.stopPropagation(); handleEditStudent(s); }}
                                className="btn btn-sm btn-ghost"
                              >
                                {t("actions.edit")}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${s.studentId}-detail`} className="row-detail">
                              <td colSpan="6">
                                <div className="row-detail-grid" aria-label={t("dashboard.expandedDetails")}>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colStudentId")}</span>
                                    <span className="row-detail-value col-mono">{s.studentId}</span>
                                  </div>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colName")}</span>
                                    <span className="row-detail-value">{s.name}</span>
                                  </div>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colClass")}</span>
                                    <span className="row-detail-value">{s.class}</span>
                                  </div>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colFee")}</span>
                                    <span className="row-detail-value">{s.feeAmount} XLM</span>
                                  </div>
                                  <div className="row-detail-item">
                                    <span className="row-detail-label">{t("dashboard.colStatus")}</span>
                                    <span className="row-detail-value">
                                      <span className={badge.cls}>{badge.label}</span>
                                    </span>
                                  </div>
                                  {s.parentEmail && (
                                    <div className="row-detail-item">
                                      <span className="row-detail-label">{t("studentForm.parentEmail")}</span>
                                      <span className="row-detail-value">{s.parentEmail}</span>
                                    </div>
                                  )}
                                  {s.parentPhone && (
                                    <div className="row-detail-item">
                                      <span className="row-detail-label">{t("studentForm.parentPhone")}</span>
                                      <span className="row-detail-value">{s.parentPhone}</span>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ErrorBoundary>

          {/* Pagination */}
          {total > 0 && (
            <Pagination
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              pageSizeOptions={[10, 20, 50]}
              onPageChange={setPage}
              onPageSizeChange={(size) => setPageSize(size)}
              loading={studentsLoading}
            />
          )}
        </div>
      </div>

      {editingStudentData && (
        <StudentForm
          student={editingStudentData}
          onClose={handleCloseForm}
          onSave={handleSaveStudent}
        />
      )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <RequireAdmin>
      <Dashboard />
    </RequireAdmin>
  );
}
