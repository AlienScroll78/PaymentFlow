# UX Review Checklist for Financial Action Screens

This checklist must be completed for every pull request that touches a financial action screen — payment creation, fee structure changes, refunds, disputes, or any other screen where a user commits to a monetary action. Add the completed checklist to your PR description when the PR carries the `ui-ux` label.

---

## 1. Confirmation Step

- [ ] The user sees a clear summary of what they are about to commit to (amount, recipient, fee type) **before** the action is irreversible.
- [ ] Destructive or high-value actions (e.g. refund approval, fee deletion) require a secondary confirmation (modal, type-to-confirm, or step-up auth).
- [ ] The CTA button copy reflects the action, not a generic label (e.g. "Confirm Payment of 250 XLM" rather than "Submit").
- [ ] A cancel/back path is always available before the action is executed.

## 2. Error States

- [ ] Every API failure case renders a visible, dismissible error message in the UI — no silent failures.
- [ ] Error messages are actionable: they tell the user **what went wrong** and **what to do next**.
- [ ] Network timeouts and retries display a loading indicator and do not leave the UI in an indeterminate state.
- [ ] 409 Conflict (duplicate idempotency key) is handled gracefully with a "payment already submitted" message rather than a generic error.
- [ ] Validation errors are shown inline next to the offending field, not only as a banner.
- [ ] The error element receives focus (`ref.current?.focus()`) so screen readers announce it immediately.

## 3. Accessibility

- [ ] All interactive elements are reachable and operable with keyboard alone (Tab, Shift+Tab, Enter, Space, Escape for modals).
- [ ] Focus is managed correctly: after opening a modal, focus moves into it; after closing, it returns to the trigger.
- [ ] All form fields have associated `<label>` elements (or `aria-label` / `aria-labelledby`).
- [ ] Status messages (success, error, loading) use `role="alert"` or `role="status"` so assistive technology announces them without a page reload.
- [ ] Color is not the sole means of conveying information (e.g. status badges also use text or icons).
- [ ] Text contrast meets WCAG AA: ≥ 4.5:1 for normal text, ≥ 3:1 for large text and UI components. Checked with a contrast tool.
- [ ] The screen has been tested with at least one screen reader (NVDA/JAWS on Windows, VoiceOver on macOS/iOS).

## 4. Mobile / Responsive

- [ ] Layout is usable on a 375 px wide viewport (iPhone SE baseline) without horizontal scrolling.
- [ ] Touch targets are at least 44 × 44 px (WCAG 2.5.5) for all actionable elements.
- [ ] Long strings (wallet addresses, tx hashes) break or truncate gracefully — no overflow outside the card.
- [ ] The virtual keyboard on mobile does not obscure the active input field or the submit button.
- [ ] QR codes (where present) are at least 200 × 200 px so they remain scannable on a mobile screen.

## 5. Copy & Financial Language

- [ ] Currency and amounts are formatted consistently (e.g. `250 XLM`, `$10.00 USD`) — no ambiguous units.
- [ ] Financial jargon is avoided or explained inline (e.g. "Stellar Lumens (XLM)" on first mention).
- [ ] Copy has been reviewed for plain language: ideally readable at a Grade 8 reading level.
- [ ] Success and confirmation messages specify exactly what was done (amount, student ID, date) — not just "Success!".
- [ ] All user-visible strings are present in every supported locale (`en`, `fr`) with no untranslated fallbacks.

## 6. Undo / Reversal Path

- [ ] If the action is irreversible (e.g. blockchain payment), the user is warned **before** they commit.
- [ ] Where reversal is possible (disputes, refunds), the UI surfaces the path clearly on the relevant record.
- [ ] Accidental submissions can be corrected within a reasonable time window without contacting support (e.g. a dispute form is accessible directly from the payment history).

---

## Baseline Reviews

The following screens have been reviewed against this checklist as the initial baseline. Each review is documented in the linked PR.

| Screen | PR | Reviewer | Date |
|--------|----|----------|------|
| Payment Verification (`VerifyPayment.jsx`) | #260 | TBD | 2026-Q4 |
| Payment Instructions / QR (`PaymentForm.jsx`) | #260 | TBD | 2026-Q4 |
| Dispute Submission (`DisputeForm.jsx`) | #363 | TBD | 2026-Q4 |

---

## Review Sign-off

| Role | Name | Approved |
|------|------|---------|
| UX Designer | | ☐ |
| Accessibility Lead | | ☐ |
| Engineering Lead | | ☐ |

---

## Maintenance

This checklist is reviewed and updated each quarter. Lessons from production feedback, user testing, and accessibility audits are incorporated. The owner of each quarterly update adds a row to the table below.

| Quarter | Changes Made | Owner |
|---------|-------------|-------|
| 2026-Q4 | Initial version published | #363 |
