## Summary

<!-- A concise description of what this PR changes and why. -->

## Changes

<!-- List the files / areas of the codebase that changed. -->

## Testing

<!-- How was this tested? Unit tests, integration tests, manual steps. -->
- [ ] Existing tests pass (`npm test`)
- [ ] New tests added for changed behaviour
- [ ] Manual smoke-test performed locally

## Checklist

- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Documentation updated (if applicable)
- [ ] No secrets or `.env` files committed

---

<!-- ──────────────────────────────────────────────────────────────────────
     UI/UX SECTION — complete this block for any PR labelled `ui-ux`.
     Delete this section for PRs that do not touch user-facing screens.
     Full checklist: docs/ux-review-checklist.md
     ────────────────────────────────────────────────────────────────── -->

## UX Review (required for `ui-ux` labelled PRs)

> Complete every item in the checklist below. Check the box only when you have
> verified the criterion — not as a formality. Refer to the full guidance in
> [`docs/ux-review-checklist.md`](docs/ux-review-checklist.md).

### 1. Confirmation Step
- [ ] User sees a clear summary before committing to an irreversible action
- [ ] High-value / destructive actions have a secondary confirmation
- [ ] CTA button copy reflects the specific action (not just "Submit")
- [ ] Cancel / back path is always available

### 2. Error States
- [ ] All API failure cases render a visible, actionable error message
- [ ] 409 Conflict (duplicate submission) handled with a friendly message
- [ ] Validation errors shown inline next to the offending field
- [ ] Error element receives focus for screen reader announcement

### 3. Accessibility
- [ ] All interactive elements are keyboard-navigable
- [ ] Focus management is correct (modals trap focus; trigger regains focus on close)
- [ ] All form fields have associated labels
- [ ] Status messages use `role="alert"` or `role="status"`
- [ ] Color is not the sole means of conveying information
- [ ] Text contrast meets WCAG AA (≥ 4.5:1)
- [ ] Tested with a screen reader (VoiceOver / NVDA)

### 4. Mobile / Responsive
- [ ] Usable on a 375 px wide viewport without horizontal scrolling
- [ ] Touch targets ≥ 44 × 44 px
- [ ] Long strings (addresses, hashes) break or truncate gracefully

### 5. Copy & Financial Language
- [ ] Amounts formatted consistently with explicit units (e.g. `250 XLM`)
- [ ] Plain language — no unexplained financial jargon
- [ ] All user-visible strings present in every supported locale (`en`, `fr`)

### 6. Undo / Reversal Path
- [ ] Irreversible actions carry a warning before the user commits
- [ ] Reversal path (dispute / refund) is surfaced on the payment record

### UX Sign-off
| Role | Name | Approved |
|------|------|---------|
| UX Designer | | ☐ |
| Accessibility Lead | | ☐ |

Closes #
