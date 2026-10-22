/**
 * EmptyState — Consistent empty/loading/error states for operational lists.
 *
 * Variants:
 *  - "empty"    : No data exists yet. Shows icon + title + description + optional CTA.
 *  - "filtered" : Data exists but active filters/search return nothing.
 *  - "loading"  : Skeleton placeholder while data is being fetched.
 *  - "error"    : Request failed. Shows alert icon + message + retry button.
 *
 * All variants use ARIA live-regions and roles so screen-readers announce
 * state changes without a page refresh.
 */

const InboxIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
  </svg>
);

const FilterIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
);

const AlertCircleIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

const SKELETON_WIDTHS = [
  [90, 140, 60, 80, 52, 36],
  [72, 120, 48, 72, 52, 36],
  [84, 155, 54, 88, 52, 36],
  [66, 130, 50, 68, 52, 36],
  [78, 110, 58, 76, 52, 36],
];

function SkeletonRow({ widths }) {
  return (
    <tr aria-hidden="true">
      {widths.map((w, i) => (
        <td key={i}>
          <div
            className="skeleton"
            style={{ height: i === 4 ? 20 : 12, width: w, borderRadius: i === 4 ? 20 : 4 }}
          />
        </td>
      ))}
    </tr>
  );
}

export default function EmptyState({
  variant = "empty",
  title,
  description,
  action,       // { label: string, onClick?: fn, href?: string }
  colSpan = 6,  // for use inside <td colSpan={n}>
}) {
  /* ── Loading skeleton ─────────────────────────────────────── */
  if (variant === "loading") {
    return (
      <>
        {SKELETON_WIDTHS.map((widths, i) => (
          <SkeletonRow key={i} widths={widths} />
        ))}
      </>
    );
  }

  const isError    = variant === "error";
  const isFiltered = variant === "filtered";

  const defaultTitle = isError
    ? "Something went wrong"
    : isFiltered
      ? "No results found"
      : "Nothing here yet";

  const defaultDesc = isError
    ? "We couldn't load this data. Check your connection and try again."
    : isFiltered
      ? "Try adjusting or clearing your filters."
      : "There's no data to display right now.";

  const defaultAction = isError
    ? null   // caller must supply a retry handler
    : isFiltered
      ? null  // caller supplies clear-filter handler
      : null;

  const resolvedTitle  = title       ?? defaultTitle;
  const resolvedDesc   = description ?? defaultDesc;
  const resolvedAction = action      ?? defaultAction;

  const iconColor = isError ? "var(--danger-text, #be123c)" : isFiltered ? "var(--warning-text, #b45309)" : "var(--accent)";
  const iconBg    = isError ? "var(--danger-bg, #fff1f2)"   : isFiltered ? "var(--warning-bg, #fffbeb)"   : "var(--accent-subtle)";

  const Icon = isError ? AlertCircleIcon : isFiltered ? FilterIcon : InboxIcon;

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0, border: "none" }}>
        <div
          className="empty-state"
          role={isError ? "alert" : "status"}
          aria-live={isError ? "assertive" : "polite"}
          aria-atomic="true"
          aria-label={resolvedTitle}
        >
          <style>{`
            .empty-state-action-btn {
              display: inline-flex;
              align-items: center;
              gap: 0.4rem;
              margin-top: 0.75rem;
              padding: 0.5rem 1.25rem;
              border-radius: 9px;
              font-size: 0.875rem;
              font-weight: 600;
              font-family: inherit;
              cursor: pointer;
              transition: background 0.14s, border-color 0.14s, color 0.14s;
              text-decoration: none;
            }
            .empty-state-action-btn-primary {
              background: var(--grad-brand, linear-gradient(135deg,#059669,#0d9488));
              color: #fff;
              border: none;
              box-shadow: 0 4px 14px -4px rgba(5,150,105,0.45);
            }
            .empty-state-action-btn-primary:hover { filter: brightness(1.07); }
            .empty-state-action-btn-ghost {
              background: var(--card-bg, #fff);
              color: var(--text-muted, #64748b);
              border: 1.5px solid var(--border, #e7e9f3);
            }
            .empty-state-action-btn-ghost:hover {
              background: var(--bg-subtle, #f8f9fc);
              border-color: var(--border-strong, #d4d8ea);
              color: var(--text, #0f172a);
            }
          `}</style>

          <div
            className="empty-state-icon"
            style={{ background: iconBg, color: iconColor }}
          >
            <Icon />
          </div>

          <div className="empty-state-title">{resolvedTitle}</div>
          <div className="empty-state-desc">{resolvedDesc}</div>

          {resolvedAction && (
            resolvedAction.href ? (
              <a
                href={resolvedAction.href}
                className="empty-state-action-btn empty-state-action-btn-primary"
              >
                {resolvedAction.label}
              </a>
            ) : (
              <button
                type="button"
                className={`empty-state-action-btn ${isError || isFiltered ? "empty-state-action-btn-ghost" : "empty-state-action-btn-primary"}`}
                onClick={resolvedAction.onClick}
              >
                {resolvedAction.label}
              </button>
            )
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * StandaloneEmptyState — use this outside a <table> context (e.g. a card body).
 * Same props as EmptyState except no colSpan / <tr><td> wrapping.
 */
export function StandaloneEmptyState({
  variant = "empty",
  title,
  description,
  action,
}) {
  /* ── Loading skeleton ─────────────────────────────────────── */
  if (variant === "loading") {
    return (
      <div style={{ padding: "2rem 1.5rem" }} aria-busy="true" aria-label="Loading…">
        <style>{`
          @keyframes skel-pulse {
            0%,100% { opacity:1; } 50% { opacity:0.45; }
          }
          .sa-skel {
            border-radius: 4px;
            background: var(--border);
            animation: skel-pulse 1.4s ease-in-out infinite;
          }
        `}</style>
        {[90, 72, 84, 66, 78].map((w, i) => (
          <div key={i} style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "0.875rem" }}>
            <div className="sa-skel" style={{ width: 36, height: 12, borderRadius: 4 }} />
            <div className="sa-skel" style={{ width: w * 1.5, height: 12 }} />
            <div className="sa-skel" style={{ width: 48, height: 12 }} />
            <div className="sa-skel" style={{ width: 60, height: 20, borderRadius: 20, marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    );
  }

  const isError    = variant === "error";
  const isFiltered = variant === "filtered";

  const defaultTitle = isError
    ? "Something went wrong"
    : isFiltered
      ? "No results found"
      : "Nothing here yet";

  const defaultDesc = isError
    ? "We couldn't load this data. Check your connection and try again."
    : isFiltered
      ? "Try adjusting or clearing your filters."
      : "There's no data to display right now.";

  const resolvedTitle  = title       ?? defaultTitle;
  const resolvedDesc   = description ?? defaultDesc;
  const resolvedAction = action;

  const iconColor = isError ? "var(--danger-text, #be123c)" : isFiltered ? "var(--warning-text, #b45309)" : "var(--accent)";
  const iconBg    = isError ? "var(--danger-bg, #fff1f2)"   : isFiltered ? "var(--warning-bg, #fffbeb)"   : "var(--accent-subtle)";

  const Icon = isError ? AlertCircleIcon : isFiltered ? FilterIcon : InboxIcon;

  return (
    <div
      className="empty-state"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={resolvedTitle}
    >
      <div className="empty-state-icon" style={{ background: iconBg, color: iconColor }}>
        <Icon />
      </div>
      <div className="empty-state-title">{resolvedTitle}</div>
      <div className="empty-state-desc">{resolvedDesc}</div>
      {resolvedAction && (
        resolvedAction.href ? (
          <a
            href={resolvedAction.href}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
              marginTop: "0.75rem", padding: "0.5rem 1.25rem",
              borderRadius: "9px", fontSize: "0.875rem", fontWeight: 600,
              background: "var(--grad-brand)", color: "#fff", border: "none",
              textDecoration: "none", cursor: "pointer",
            }}
          >
            {resolvedAction.label}
          </a>
        ) : (
          <button
            type="button"
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
              marginTop: "0.75rem", padding: "0.5rem 1.25rem",
              borderRadius: "9px", fontSize: "0.875rem", fontWeight: 600,
              fontFamily: "inherit", cursor: "pointer",
              background: isError || isFiltered ? "var(--card-bg)" : "var(--grad-brand)",
              color: isError || isFiltered ? "var(--text-muted)" : "#fff",
              border: isError || isFiltered ? "1.5px solid var(--border)" : "none",
              transition: "background 0.14s",
            }}
            onClick={resolvedAction.onClick}
          >
            {resolvedAction.label}
          </button>
        )
      )}
    </div>
  );
}
