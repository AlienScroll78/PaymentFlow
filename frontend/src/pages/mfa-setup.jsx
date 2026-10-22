/**
 * mfa-setup.jsx — Issue #105
 *
 * Accessible MFA enrollment and recovery screen.
 *
 * Step flow:
 *   1. Intro    — explain what MFA is and what to expect
 *   2. Scan     — QR code + manual entry key
 *   3. Verify   — enter 6-digit TOTP code to confirm app is set up
 *   4. Backup   — display one-time backup codes with download/print/copy
 *   5. Done     — confirmation and next step
 *
 * Acceptance criteria (Issue #105):
 *  - Focus order is logical (step header → content → action)
 *  - Errors identify the failed step without revealing secrets
 *  - Backup codes displayed once with download and copy options
 */
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { QRCodeSVG } from "qrcode.react";
import { setupUserMfa, verifyUserMfa } from "../services/api";
import { getErrorMessage } from "../utils/errorMessages";
import PageHero from "../components/PageHero";
import RequireAdmin from "../components/RequireAdmin";
import { useTranslation } from "react-i18next";

// ── Icons ──────────────────────────────────────────────────────────────────────
const ShieldIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

const QrIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/>
    <rect x="14" y="14" width="3" height="3"/><rect x="19" y="14" width="2" height="2"/>
    <rect x="14" y="19" width="2" height="2"/><rect x="18" y="19" width="3" height="2"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const KeyIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
  </svg>
);

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const PrintIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <polyline points="6 9 6 2 18 2 18 9"/>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
    <rect x="6" y="14" width="12" height="8"/>
  </svg>
);

// ── Step indicator ─────────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Set up",    Icon: ShieldIcon },
  { id: 2, label: "Scan",      Icon: QrIcon },
  { id: 3, label: "Verify",    Icon: CheckIcon },
  { id: 4, label: "Save codes",Icon: KeyIcon },
];

function StepIndicator({ current }) {
  return (
    <nav aria-label="MFA setup progress" style={{ marginBottom: "2rem" }}>
      <ol style={{
        display: "flex",
        alignItems: "center",
        gap: "0",
        listStyle: "none",
        padding: 0,
        margin: 0,
      }}>
        {STEPS.map((step, idx) => {
          const done    = step.id < current;
          const active  = step.id === current;
          return (
            <li key={step.id} style={{ display: "flex", alignItems: "center", flex: idx < STEPS.length - 1 ? 1 : undefined }}>
              {/* Circle */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem" }}>
                <div
                  style={{
                    width: 36, height: 36,
                    borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: done
                      ? "var(--success-bg, #ecfdf5)"
                      : active
                        ? "var(--grad-brand, linear-gradient(135deg,#059669,#0d9488))"
                        : "var(--bg-subtle, #f8f9fc)",
                    border: done
                      ? "2px solid var(--success-border, #a7f3d0)"
                      : active
                        ? "2px solid transparent"
                        : "2px solid var(--border, #e7e9f3)",
                    color: done
                      ? "var(--success-text, #047857)"
                      : active
                        ? "#fff"
                        : "var(--text-muted, #64748b)",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  aria-current={active ? "step" : undefined}
                  aria-label={`Step ${step.id}: ${step.label}${done ? " (completed)" : active ? " (current)" : ""}`}
                >
                  {done ? <CheckIcon /> : <step.Icon />}
                </div>
                <span style={{
                  fontSize: "0.68rem",
                  fontWeight: active ? 700 : 500,
                  color: active ? "var(--text, #0f172a)" : "var(--text-muted, #64748b)",
                  whiteSpace: "nowrap",
                }}>
                  {step.label}
                </span>
              </div>
              {/* Connector line */}
              {idx < STEPS.length - 1 && (
                <div style={{
                  flex: 1,
                  height: 2,
                  background: done
                    ? "var(--success-border, #a7f3d0)"
                    : "var(--border, #e7e9f3)",
                  margin: "0 0.5rem",
                  marginBottom: "1.4rem",
                  transition: "background 0.2s",
                }} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Backup codes helpers ───────────────────────────────────────────────────────
function downloadBackupCodes(codes) {
  const content = [
    "StellarEduPay — MFA Backup Codes",
    "Generated: " + new Date().toLocaleString(),
    "Store these codes somewhere safe. Each code can only be used once.",
    "",
    ...codes.map((c, i) => `${i + 1}. ${c}`),
    "",
    "If you lose access to your authenticator app, use one of these codes to sign in.",
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = "stellaredupay-mfa-backup-codes.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function printBackupCodes(codes) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`
    <html><head><title>MFA Backup Codes</title>
    <style>
      body { font-family: monospace; padding: 2rem; }
      h2 { font-size: 1.25rem; margin-bottom: 0.5rem; }
      p  { color: #555; font-size: 0.875rem; margin-bottom: 1.5rem; }
      ol { line-height: 2; font-size: 1rem; }
      @media print { body { padding: 1rem; } }
    </style></head><body>
    <h2>StellarEduPay — MFA Backup Codes</h2>
    <p>Store these codes somewhere safe. Each code can only be used once.<br>
    Generated: ${new Date().toLocaleString()}</p>
    <ol>${codes.map(c => `<li>${c}</li>`).join("")}</ol>
    </body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

// ── Step components ────────────────────────────────────────────────────────────

/** Step 1 — Intro */
function StepIntro({ onNext }) {
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} style={{ outline: "none", fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.75rem", color: "var(--text)" }}>
        Protect your account with two-factor authentication
      </h2>
      <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1.25rem", lineHeight: 1.6 }}>
        Two-factor authentication (2FA) adds a second layer of security. After your password,
        you'll enter a 6-digit code from your authenticator app.
      </p>

      <div className="card" style={{ marginBottom: "1.25rem", borderLeft: "4px solid var(--accent)" }}>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          <p style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text)", margin: 0 }}>
            Before you start, you'll need:
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
            <li>An authenticator app — <strong>Google Authenticator</strong>, <strong>Authy</strong>, or <strong>1Password</strong></li>
            <li>A safe place to store backup codes (e.g. a password manager)</li>
          </ul>
        </div>
      </div>

      <div
        role="note"
        style={{
          padding: "0.75rem 1rem",
          borderRadius: "var(--radius-sm)",
          background: "var(--warning-bg, #fffbeb)",
          border: "1px solid var(--warning-border, #fde68a)",
          fontSize: "0.8375rem",
          color: "var(--warning-text, #b45309)",
          marginBottom: "1.5rem",
          lineHeight: 1.5,
        }}
      >
        <strong>Important:</strong> After setup you'll receive 8 backup codes.
        They are shown <strong>only once</strong> — save them before leaving that screen.
      </div>

      <button type="button" className="btn btn-primary" onClick={onNext}>
        Start setup →
      </button>
    </div>
  );
}

/** Step 2 — QR Scan */
function StepScan({ qrCode, secret, onNext, onError }) {
  const { t } = useTranslation();
  const headingRef = useRef(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => { headingRef.current?.focus(); }, []);

  // Never reveal the full secret in the visible copy — only show it on demand
  // behind a toggle, and screen-reader text describes it as "manual entry key"
  // not "secret key" to avoid confusion.

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} style={{ outline: "none", fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text)" }}>
        Scan the QR code
      </h2>
      <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1.5rem", lineHeight: 1.6 }}>
        Open your authenticator app and scan the code below to add this account.
      </p>

      {/* QR code */}
      <div style={{
        display: "flex", justifyContent: "center", marginBottom: "1.25rem",
      }}>
        <div
          style={{
            padding: "1rem",
            background: "#fff",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
            display: "inline-block",
            boxShadow: "var(--shadow-sm)",
          }}
          aria-label="QR code for authenticator app setup"
          role="img"
        >
          <QRCodeSVG value={qrCode} size={180} level="M" />
        </div>
      </div>

      {/* Manual entry key — hidden by default */}
      <div style={{ marginBottom: "1.5rem", textAlign: "center" }}>
        <button
          type="button"
          onClick={() => setShowKey(s => !s)}
          className="btn btn-ghost btn-sm"
          aria-expanded={showKey}
          aria-controls="manual-entry-key"
          style={{ fontSize: "0.8125rem" }}
        >
          {showKey ? "Hide" : "Can't scan? Show"} manual entry key
        </button>

        {showKey && (
          <div
            id="manual-entry-key"
            style={{
              marginTop: "0.75rem",
              padding: "0.75rem 1rem",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontFamily: "monospace",
              fontSize: "0.9rem",
              letterSpacing: "0.12em",
              color: "var(--text)",
              wordBreak: "break-all",
              textAlign: "center",
            }}
            aria-label="Manual entry key for authenticator app"
          >
            {/* Format as groups of 4 for readability */}
            {secret?.match(/.{1,4}/g)?.join(" ") ?? secret}
          </div>
        )}
      </div>

      <div
        role="note"
        style={{
          padding: "0.625rem 0.875rem",
          borderRadius: "var(--radius-sm)",
          background: "var(--info-bg, #eff6ff)",
          border: "1px solid var(--info-border, #bfdbfe)",
          fontSize: "0.8125rem",
          color: "var(--info-text, #1d4ed8)",
          marginBottom: "1.5rem",
        }}
      >
        After scanning, your app will show a 6-digit code that changes every 30 seconds.
        Click <strong>Next</strong> when you're ready to verify it.
      </div>

      <button type="button" className="btn btn-primary" onClick={onNext}>
        Next — enter the code →
      </button>
    </div>
  );
}

/** Step 3 — Verify TOTP code */
function StepVerify({ secret, onSuccess, error, setError, submitting, setSubmitting }) {
  const { t } = useTranslation();
  const router = useRouter();
  const headingRef = useRef(null);
  const inputRef   = useRef(null);
  const [code, setCode] = useState("");

  useEffect(() => { headingRef.current?.focus(); }, []);

  // Move focus to the error when it appears
  const errorRef = useRef(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await verifyUserMfa({ secret, code: code.trim() });
      // Pass backup codes from the response (if server sends them at verify time)
      onSuccess(res?.data?.backupCodes || null);
    } catch (err) {
      setError(
        getErrorMessage(err.response?.data?.code, err.response?.data?.error) ||
        t("mfa.failedToVerify", "The code was incorrect. Please try again.")
      );
      setCode("");
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} style={{ outline: "none", fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text)" }}>
        Verify your authenticator code
      </h2>
      <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1.5rem", lineHeight: 1.6 }}>
        Open your authenticator app and enter the 6-digit code shown for this account.
      </p>

      {/* Error — identifies the step (code entry) without revealing the secret */}
      {error && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "var(--radius-sm)",
            background: "var(--danger-bg, #fff1f2)",
            border: "1px solid var(--danger-border, #fecdd3)",
            color: "var(--danger-text, #be123c)",
            fontSize: "0.875rem",
            fontWeight: 600,
            marginBottom: "1.25rem",
            outline: "none",
          }}
          aria-live="assertive"
          aria-atomic="true"
        >
          ⚠ Step 3 — Code verification failed: {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="mfa-verify-code" className="form-label">
            6-digit code
            <span style={{ marginLeft: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 400 }}>
              (changes every 30 seconds)
            </span>
          </label>
          <input
            ref={inputRef}
            id="mfa-verify-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            maxLength={6}
            pattern="[0-9]{6}"
            className="form-input"
            style={{
              fontFamily: "monospace",
              fontSize: "1.5rem",
              letterSpacing: "0.35em",
              textAlign: "center",
              maxWidth: 200,
            }}
            placeholder="000000"
            required
            aria-describedby="mfa-code-hint"
            aria-invalid={!!error}
          />
          <p id="mfa-code-hint" style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.375rem" }}>
            Enter the 6-digit code from your authenticator app.
          </p>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting || code.length !== 6}
          aria-busy={submitting}
        >
          {submitting ? "Verifying…" : "Verify and continue →"}
        </button>
      </form>
    </div>
  );
}

/** Step 4 — Backup codes */
function StepBackupCodes({ codes, onDone }) {
  const headingRef    = useRef(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => { headingRef.current?.focus(); }, []);

  function handleCopy() {
    if (!codes) return;
    navigator.clipboard.writeText(codes.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  // Fallback backup codes if the API didn't return them
  const displayCodes = codes && codes.length > 0
    ? codes
    : ["Backup codes not available — contact support to regenerate them."];

  const hasCodes = codes && codes.length > 0;

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} style={{ outline: "none", fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text)" }}>
        Save your backup codes
      </h2>
      <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.6 }}>
        These codes let you sign in if you lose access to your authenticator app.
        Each code can be used <strong>only once</strong>.
      </p>

      {/* Critical warning */}
      <div
        role="alert"
        aria-live="assertive"
        style={{
          padding: "0.75rem 1rem",
          borderRadius: "var(--radius-sm)",
          background: "var(--warning-bg, #fffbeb)",
          borderLeft: "4px solid var(--warning-text, #b45309)",
          border: "1px solid var(--warning-border, #fde68a)",
          fontSize: "0.875rem",
          color: "var(--warning-text, #b45309)",
          fontWeight: 600,
          marginBottom: "1.25rem",
          lineHeight: 1.5,
        }}
      >
        ⚠ These codes are shown <strong>only once</strong>. Download or copy them before
        continuing — you won't be able to see them again.
      </div>

      {/* Codes grid */}
      <div
        aria-label="Backup codes"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: "0.5rem",
          padding: "1rem",
          background: "var(--bg-subtle)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          marginBottom: "1rem",
          fontFamily: "monospace",
          fontSize: "0.9rem",
          letterSpacing: "0.08em",
          color: "var(--text)",
        }}
      >
        {displayCodes.map((code, i) => (
          <div
            key={i}
            style={{
              padding: "0.375rem 0.625rem",
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              textAlign: "center",
              userSelect: "all",
            }}
            aria-label={`Backup code ${i + 1}: ${code}`}
          >
            {code}
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {hasCodes && (
        <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleCopy}
            aria-live="polite"
            style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
          >
            <CopyIcon /> {copied ? "Copied!" : "Copy all codes"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => downloadBackupCodes(codes)}
            style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
          >
            <DownloadIcon /> Download .txt
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => printBackupCodes(codes)}
            style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
          >
            <PrintIcon /> Print
          </button>
        </div>
      )}

      {/* Confirmation checkbox — require acknowledgement before proceeding */}
      <div style={{ marginBottom: "1.5rem" }}>
        <label style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.625rem",
          cursor: "pointer",
          fontSize: "0.875rem",
          color: "var(--text)",
          lineHeight: 1.5,
        }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            style={{ marginTop: "0.15rem", flexShrink: 0, width: 16, height: 16, accentColor: "var(--accent)" }}
            aria-required="true"
          />
          I have saved my backup codes in a secure location and understand they are shown only once.
        </label>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        onClick={onDone}
        disabled={!confirmed}
        aria-disabled={!confirmed}
      >
        I've saved my codes — finish setup
      </button>
    </div>
  );
}

/** Step 5 — Done */
function StepDone() {
  const router     = useRouter();
  const headingRef = useRef(null);

  useEffect(() => { headingRef.current?.focus(); }, []);

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        width: 64, height: 64,
        borderRadius: "50%",
        background: "var(--success-bg, #ecfdf5)",
        border: "2px solid var(--success-border, #a7f3d0)",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 1.25rem",
        color: "var(--success-text, #047857)",
      }} aria-hidden="true">
        <CheckIcon />
      </div>

      <h2
        ref={headingRef}
        tabIndex={-1}
        style={{ outline: "none", fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text)" }}
        aria-live="polite"
        aria-atomic="true"
      >
        MFA is now active on your account
      </h2>
      <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "2rem", lineHeight: 1.6 }}>
        From now on, you'll be asked for a code from your authenticator app each time you sign in.
        Keep your backup codes somewhere safe — if you lose your device, they're your only recovery option.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => router.push("/dashboard")}
        >
          Go to dashboard
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
function MfaSetupContent() {
  const { t } = useTranslation();
  const [step, setStep]           = useState(1);
  const [secret, setSecret]       = useState(null);
  const [qrCode, setQrCode]       = useState(null);
  const [backupCodes, setBackupCodes] = useState(null);
  const [initError, setInitError] = useState("");
  const [initLoading, setInitLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const started = useRef(false);

  // Fetch the setup data when advancing to the scan step
  async function loadSetup() {
    if (started.current) return;
    started.current = true;
    setInitLoading(true);
    setInitError("");
    try {
      const res = await setupUserMfa();
      setSecret(res.data.secret);
      setQrCode(res.data.qrCode);
    } catch (err) {
      setInitError(
        getErrorMessage(err.response?.data?.code, err.response?.data?.error) ||
        t("mfa.failedToStart", "Failed to start MFA setup. Please try again.")
      );
      // Reset so the user can retry
      started.current = false;
    } finally {
      setInitLoading(false);
    }
  }

  function handleIntroNext() {
    setStep(2);
    loadSetup();
  }

  function handleScanNext() {
    setStep(3);
  }

  function handleVerifySuccess(codes) {
    setBackupCodes(codes);
    setStep(4);
  }

  function handleBackupDone() {
    setStep(5);
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 560 }}>
      <PageHero
        eyebrow={t("mfa.eyebrow", "Account security")}
        title={t("mfa.title", "Two-factor authentication setup")}
        subtitle={t("mfa.subtitle", "Secure your admin account in a few steps.")}
      />

      {/* Step indicator */}
      {step < 5 && <StepIndicator current={step} />}

      {/* Step content */}
      <div className="card">
        <div className="card-body" style={{ padding: "1.75rem" }}>

          {/* Step 1 */}
          {step === 1 && <StepIntro onNext={handleIntroNext} />}

          {/* Step 2 */}
          {step === 2 && (
            <>
              {initLoading && (
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }} aria-live="polite">
                  Loading setup…
                </p>
              )}
              {initError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  style={{
                    padding: "0.875rem 1rem",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--danger-bg)",
                    border: "1px solid var(--danger-border)",
                    color: "var(--danger-text)",
                    fontSize: "0.875rem",
                    marginBottom: "1.25rem",
                  }}
                >
                  ⚠ Step 2 — Setup failed: {initError}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ display: "block", marginTop: "0.75rem" }}
                    onClick={() => { started.current = false; loadSetup(); }}
                  >
                    Try again
                  </button>
                </div>
              )}
              {!initLoading && !initError && qrCode && (
                <StepScan
                  qrCode={qrCode}
                  secret={secret}
                  onNext={handleScanNext}
                />
              )}
            </>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <StepVerify
              secret={secret}
              onSuccess={handleVerifySuccess}
              error={verifyError}
              setError={setVerifyError}
              submitting={submitting}
              setSubmitting={setSubmitting}
            />
          )}

          {/* Step 4 */}
          {step === 4 && (
            <StepBackupCodes codes={backupCodes} onDone={handleBackupDone} />
          )}

          {/* Step 5 */}
          {step === 5 && <StepDone />}

        </div>
      </div>
    </div>
  );
}

export default function MfaSetupPage() {
  return (
    <RequireAdmin>
      <MfaSetupContent />
    </RequireAdmin>
  );
}
