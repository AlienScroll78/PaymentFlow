/**
 * FilterChips — Issue #107
 *
 * Renders a horizontal strip of chips, one per active filter.
 * Each chip shows a human-readable label and an × button that removes only
 * that filter while preserving every other active filter.
 *
 * A "Clear all" chip is appended when more than one filter is active so the
 * user can reset the whole set in a single interaction.
 *
 * Accessibility
 * -------------
 * - Each remove button has an `aria-label` describing exactly which filter
 *   it will remove (e.g. "Remove Status: Paid").
 * - The "Clear all" button is labelled "Clear all filters".
 * - The chip list uses `role="list"` so screen readers announce the count.
 * - Keyboard: the × button is focusable and activates on Enter/Space.
 * - An `aria-live="polite"` region announces the number of active filters
 *   whenever it changes.
 *
 * Props
 * -----
 * filters        Array<{ key: string, label: string, value: string }>
 *                Active filters to display. If empty the component renders null.
 *
 * onRemove       (key: string) => void
 *                Called when the user removes a single chip.
 *
 * onClearAll     () => void
 *                Called when the user clicks "Clear all".
 *
 * chipLabels     Optional object<key, string> to override the displayed label
 *                for a filter key.  Useful for i18n overrides at the call site.
 *
 * Example usage
 * -------------
 *   const activeFilters = [
 *     statusFilter !== "all"  && { key: "status",    label: t("dashboard.colStatus"), value: t(`status.student.${statusFilter}`) },
 *     classFilter             && { key: "className", label: t("dashboard.colClass"),  value: classFilter },
 *     debouncedSearch         && { key: "search",    label: t("dashboard.searchAria"), value: debouncedSearch },
 *   ].filter(Boolean);
 *
 *   <FilterChips
 *     filters={activeFilters}
 *     onRemove={key => {
 *       if (key === "status")    setStatusFilter("all");
 *       if (key === "className") setClassFilter("");
 *       if (key === "search")    setSearch("");
 *     }}
 *     onClearAll={() => { setStatusFilter("all"); setClassFilter(""); setSearch(""); }}
 *   />
 */

import { useTranslation } from "react-i18next";

// Close icon — lightweight inline SVG to avoid importing a full icon set.
function XIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
      <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
    </svg>
  );
}

/**
 * @param {{
 *   filters: Array<{key: string, label: string, value: string}>,
 *   onRemove: (key: string) => void,
 *   onClearAll: () => void,
 *   chipLabels?: Record<string, string>
 * }} props
 */
export default function FilterChips({ filters = [], onRemove, onClearAll }) {
  const { t } = useTranslation();

  if (!filters || filters.length === 0) return null;

  const count = filters.length;

  return (
    <>
      <style>{`
        .filter-chips-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.375rem;
          padding: 0.5rem 0;
        }
        .filter-chips-label {
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--text-muted);
          margin-right: 0.125rem;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .filter-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          padding: 0.25rem 0.3rem 0.25rem 0.6rem;
          border-radius: 20px;
          background: var(--accent-subtle);
          border: 1.5px solid var(--accent-ring);
          color: var(--accent);
          font-size: 0.75rem;
          font-weight: 600;
          line-height: 1;
          white-space: nowrap;
          max-width: 240px;
        }
        .filter-chip-text {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .filter-chip-key {
          font-weight: 400;
          opacity: 0.75;
          margin-right: 0.125rem;
        }
        .filter-chip-remove {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: transparent;
          border: none;
          cursor: pointer;
          color: inherit;
          padding: 0;
          flex-shrink: 0;
          opacity: 0.7;
          transition: opacity 0.12s, background 0.12s;
          line-height: 1;
        }
        .filter-chip-remove:hover {
          opacity: 1;
          background: rgba(5, 150, 105, 0.18);
        }
        .filter-chip-remove:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .filter-chip-clear {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.65rem;
          border-radius: 20px;
          border: 1.5px solid var(--border-strong);
          background: transparent;
          color: var(--text-muted);
          font-size: 0.72rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.12s, color 0.12s, border-color 0.12s;
        }
        .filter-chip-clear:hover {
          border-color: var(--danger-border);
          background: var(--danger-bg);
          color: var(--danger-text);
        }
        .filter-chip-clear:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        /* Active filter count badge next to label */
        .filter-chips-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          border-radius: 9px;
          background: var(--accent);
          color: #fff;
          font-size: 0.65rem;
          font-weight: 700;
          padding: 0 4px;
          margin-left: 0.125rem;
        }
      `}</style>

      {/* Announce changes to screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {count === 1
          ? t("filterChips.activeFilterCount_one", { count })
          : t("filterChips.activeFilterCount_other", { count })}
      </div>

      <div
        className="filter-chips-bar"
        role="group"
        aria-label={t("filterChips.activeFiltersAria")}
      >
        <span className="filter-chips-label" aria-hidden="true">
          {t("filterChips.activeLabel")}
          <span className="filter-chips-count" aria-hidden="true">{count}</span>
        </span>

        <ul
          role="list"
          style={{ display: "contents" }}
          aria-label={t("filterChips.chipListAria")}
        >
          {filters.map(({ key, label, value }) => (
            <li key={key} role="listitem" style={{ display: "contents" }}>
              <div className="filter-chip">
                <span className="filter-chip-text">
                  <span className="filter-chip-key">{label}:</span>
                  {" "}{value}
                </span>
                <button
                  className="filter-chip-remove"
                  onClick={() => onRemove?.(key)}
                  aria-label={t("filterChips.removeAria", { label, value })}
                  type="button"
                >
                  <XIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>

        {count > 1 && (
          <button
            className="filter-chip-clear"
            onClick={onClearAll}
            type="button"
            aria-label={t("filterChips.clearAllAria")}
          >
            {t("filterChips.clearAll")}
          </button>
        )}
      </div>
    </>
  );
}
