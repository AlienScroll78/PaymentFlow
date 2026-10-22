/**
 * ConfirmDialog — Issue #108
 *
 * A reusable, context-aware confirmation dialog for destructive actions
 * (refunds, cancellations, role changes, overrides, deletions).
 *
 * Design principles
 * -----------------
 * 1. Names the target — always displays what will be affected.
 * 2. States the consequence — one-sentence impact summary.
 * 3. Prevents accidental Enter — the confirm button is NOT the default focus;
 *    the cancel button receives focus on mount so pressing Enter dismisses
 *    rather than confirms.
 * 4. Requires deliberate interaction — the confirm button for the most
 *    dangerous variant (variant="danger") requires the user to TYPE the
 *    target name before the button becomes active.
 * 5. Handles pending/failure states — shows a spinner while submitting and
 *    surfaces errors inline without closing the dialog.
 * 6. Predictable focus return — when the dialog closes, focus returns to the
 *    element that triggered it (caller passes `triggerRef` or the component
 *    captures `document.activeElement` on mount).
 *
 * Props
 * -----
 * isOpen          boolean           Whether the dialog is visible.
 * onConfirm       () => Promise     Async callback; dialog stays open until it resolves/rejects.
 * onCancel        () => void        Called when the user dismisses without confirming.
 * title           string            Dialog heading (e.g. "Delete fee structure?").
 * description     string|ReactNode  Impact summary (e.g. "This will remove Class A for 12 students.").
 * confirmLabel    string?           Label for the confirm button (default: "Confirm").
 * cancelLabel     string?           Label for the cancel button (default: "Cancel").
 * variant         "danger"|"warning"|"info"  Controls colour scheme (default: "danger").
 * requireTyping   string?           When set the user must type this exact string to enable confirm.
 * error           string?           External error message to display (e.g. from a parent component).
 *
 * Example
 * -------
 *   <ConfirmDialog
 *     isOpen={showDeleteDialog}
 *     title={t("fees.deleteTitle")}
 *     description={`You are about to delete ${fee.className}. This cannot be undone.`}
 *     confirmLabel={t("actions.delete")}
 *     variant="danger"
 *     requireTyping={fee.className}
 *     onConfirm={handleDelete}
 *     onCancel={() => setShowDeleteDialog(false)}
 *   />
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconAlertTriangle, IconCheck } from "./Icons";

// ── Variant config ────────────────────────────────────────────────────────────

const VARIANT_CONFIG = {
  danger: {
    headerBg:    "var(--danger-bg)",
    headerColor: "var(--danger-text)",
    btnClass:    "btn-danger",
    iconColor:   "var(--danger)",
    borderColor: "var(--danger-border)",
  },
  warning: {
    headerBg:    "var(--warning-bg)",
    headerColor: "var(--warning-text)",
    btnClass:    "btn-warning",
    iconColor:   "var(--warning)",
    borderColor: "var(--warning-border)",
  },
  info: {
    headerBg:    "var(--info-bg)",
    headerColor: "var(--info-text)",
    btnClass:    "btn-primary",
    iconColor:   "var(--info)",
    borderColor: "var(--info-border)",
  },
};

function getVariantConfig(variant) {
  return VARIANT_CONFIG[variant] || VARIANT_CONFIG.danger;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   isOpen: boolean,
 *   onConfirm: () => Promise<void>,
 *   onCancel: () => void,
 *   title: string,
 *   description: string | import("react").ReactNode,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   variant?: "danger" | "warning" | "info",
 *   requireTyping?: string,
 *   error?: string,
 * }} props
 */
export default function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  requireTyping,
  error: externalError,
}) {
  const { t } = useTranslation();
  const dialogRef   = useRef(null);
  const cancelRef   = useRef(null);
  const triggerRef  = useRef(null); // captures the element that had focus before open

  const [submitting, setSubmitting] = useState(false);
  const [internalError, setInternalError] = useState(null);
  const [typedValue, setTypedValue] = useState("");

  const cfg = getVariantConfig(variant);
  const resolvedConfirmLabel = confirmLabel || t("actions.confirm");
  const resolvedCancelLabel  = cancelLabel  || t("actions.cancel");
  const errorMessage = internalError || externalError;

  // Typing guard — confirm only enabled when typed value matches target.
  const typingRequired = Boolean(requireTyping);
  const typingMatch    = typedValue === requireTyping;
  const confirmEnabled = !submitting && (!typingRequired || typingMatch);

  // On open: capture trigger, focus cancel button, reset state.
  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement;
      setInternalError(null);
      setTypedValue("");
      // Small rAF so the dialog has rendered before focusing.
      requestAnimationFrame(() => cancelRef.current?.focus());
    } else {
      // On close: restore focus to the element that triggered the dialog.
      triggerRef.current?.focus();
    }
  }, [isOpen]);

  // Escape closes the dialog (unless submission is in progress).
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e) {
      if (e.key === "Escape" && !submitting) onCancel?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, submitting, onCancel]);

  // Focus trap within the dialog.
  useEffect(() => {
    if (!isOpen) return;
    const el = dialogRef.current;
    if (!el) return;
    function trapFocus(e) {
      if (e.key !== "Tab") return;
      const focusable = el.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    }
    el.addEventListener("keydown", trapFocus);
    return () => el.removeEventListener("keydown", trapFocus);
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleConfirm() {
    if (!confirmEnabled) return;
    setInternalError(null);
    setSubmitting(true);
    try {
      await onConfirm?.();
    } catch (err) {
      setInternalError(
        err?.message || t("errors.INTERNAL_ERROR")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <style>{`
        .cdlg-overlay {
          position: fixed;
          inset: 0;
          background: rgba(10, 15, 30, 0.55);
          backdrop-filter: blur(3px);
          z-index: 450;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .cdlg-dialog {
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-lg);
          width: 100%;
          max-width: 440px;
          animation: cdlgIn 0.18s ease both;
          display: flex;
          flex-direction: column;
        }
        @keyframes cdlgIn {
          from { opacity: 0; transform: scale(0.96) translateY(-6px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        .cdlg-header {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 1.125rem 1.25rem 1rem;
          border-radius: var(--radius-md) var(--radius-md) 0 0;
        }
        .cdlg-icon-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .cdlg-title {
          margin: 0;
          font-size: 1rem;
          font-weight: 700;
          color: var(--text);
          line-height: 1.3;
          flex: 1;
        }
        .cdlg-body {
          padding: 0 1.25rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.875rem;
        }
        .cdlg-description {
          font-size: 0.875rem;
          color: var(--text);
          line-height: 1.55;
          margin: 0;
        }
        .cdlg-error {
          padding: 0.5rem 0.75rem;
          background: var(--danger-bg);
          color: var(--danger-text);
          border: 1px solid var(--danger-border);
          border-radius: var(--radius-sm);
          font-size: 0.8125rem;
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
        }
        .cdlg-typing-wrap {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .cdlg-typing-label {
          font-size: 0.75rem;
          color: var(--text-muted);
          line-height: 1.45;
        }
        .cdlg-typing-label strong {
          font-family: monospace;
          font-size: 0.85rem;
          color: var(--text);
          background: var(--bg-subtle);
          padding: 0.05rem 0.3rem;
          border-radius: 3px;
          border: 1px solid var(--border);
        }
        .cdlg-typing-input {
          width: 100%;
          padding: 0.45rem 0.7rem;
          border: 1.5px solid var(--border);
          border-radius: var(--radius-sm);
          font-family: monospace;
          font-size: 0.875rem;
          color: var(--text);
          background: var(--card-bg);
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          box-sizing: border-box;
        }
        .cdlg-typing-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-subtle);
        }
        .cdlg-typing-input.match {
          border-color: var(--success);
          box-shadow: 0 0 0 3px rgba(16,185,129,0.15);
        }
        .cdlg-footer {
          display: flex;
          gap: 0.625rem;
          justify-content: flex-end;
          padding: 0.875rem 1.25rem;
          border-top: 1px solid var(--border);
          background: var(--bg-subtle, var(--bg));
          border-radius: 0 0 var(--radius-md) var(--radius-md);
        }
        /* Spinner */
        @keyframes cdlgSpin { to { transform: rotate(360deg); } }
        .cdlg-spinner {
          display: inline-block;
          width: 13px; height: 13px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: cdlgSpin 0.6s linear infinite;
          margin-right: 0.35rem;
          vertical-align: middle;
        }
        /* Ensure danger button style exists even if globals don't define it */
        .btn-danger {
          background: var(--danger, #f43f5e);
          color: #fff;
          border: none;
        }
        .btn-danger:hover:not(:disabled) {
          filter: brightness(0.92);
        }
        .btn-danger:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .btn-warning {
          background: var(--warning, #f59e0b);
          color: #fff;
          border: none;
        }
        .btn-warning:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="cdlg-overlay"
        onClick={e => { if (e.target === e.currentTarget && !submitting) onCancel?.(); }}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className="cdlg-overlay"
        style={{ pointerEvents: "none" }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cdlg-title"
          aria-describedby="cdlg-description"
          className="cdlg-dialog"
          style={{ pointerEvents: "auto" }}
        >
          {/* Header */}
          <div
            className="cdlg-header"
            style={{ borderBottom: `2px solid ${cfg.borderColor}` }}
          >
            <div
              className="cdlg-icon-wrap"
              style={{ background: cfg.headerBg }}
              aria-hidden="true"
            >
              <IconAlertTriangle size={18} style={{ color: cfg.iconColor }} />
            </div>
            <h2 id="cdlg-title" className="cdlg-title">{title}</h2>
          </div>

          {/* Body */}
          <div className="cdlg-body" id="cdlg-description">
            <p className="cdlg-description">{description}</p>

            {/* Inline error */}
            {errorMessage && (
              <div className="cdlg-error" role="alert" aria-live="assertive">
                <IconAlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Typing confirmation guard */}
            {typingRequired && (
              <div className="cdlg-typing-wrap">
                <label
                  htmlFor="cdlg-typing-input"
                  className="cdlg-typing-label"
                >
                  {t("confirmDialog.typeToConfirm")}{" "}
                  <strong>{requireTyping}</strong>{" "}
                  {t("confirmDialog.typeToConfirmSuffix")}
                </label>
                <input
                  id="cdlg-typing-input"
                  type="text"
                  value={typedValue}
                  onChange={e => setTypedValue(e.target.value)}
                  className={`cdlg-typing-input${typingMatch ? " match" : ""}`}
                  placeholder={requireTyping}
                  autoComplete="off"
                  spellCheck="false"
                  aria-describedby="cdlg-typing-hint"
                  disabled={submitting}
                />
                {typingMatch && (
                  <span
                    id="cdlg-typing-hint"
                    style={{ fontSize: "0.72rem", color: "var(--success)", display: "flex", alignItems: "center", gap: "0.25rem" }}
                  >
                    <IconCheck size={11} />
                    {t("confirmDialog.typingMatched")}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="cdlg-footer">
            <button
              ref={cancelRef}
              type="button"
              className="btn btn-ghost"
              onClick={onCancel}
              disabled={submitting}
              aria-label={resolvedCancelLabel}
            >
              {resolvedCancelLabel}
            </button>

            <button
              type="button"
              className={`btn ${cfg.btnClass}`}
              onClick={handleConfirm}
              disabled={!confirmEnabled}
              aria-label={submitting ? t("actions.loading") : resolvedConfirmLabel}
              aria-busy={submitting}
            >
              {submitting && <span className="cdlg-spinner" aria-hidden="true" />}
              {submitting ? t("actions.loading") : resolvedConfirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
