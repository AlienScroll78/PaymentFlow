## Summary

<!-- One paragraph explaining what this PR does and why. Link to the GitHub issue. -->

Closes #

---

## Changes

<!-- List the key files changed and what each change does. -->

-
-

---

## Testing

<!-- Describe what you tested and how. -->

- [ ] Unit tests added / updated
- [ ] Integration tests pass locally
- [ ] Manual smoke test performed

---

## Migration Checklist

<!-- Complete this section if this PR adds or modifies a file in backend/migrations/. -->
<!-- If no migration changes, delete this section or leave all boxes unchecked. -->

- [ ] **This PR does not include a migration** *(delete remaining items if so)*
- [ ] Migration filename follows `NNN_short_description.js` with a unique, sequential number
- [ ] `version` export matches the filename exactly (without `.js`)
- [ ] `up()` function is implemented and idempotent (safe to run twice)
- [ ] `down()` function is implemented — see [`docs/migrations.md`](../docs/migrations.md) for requirements
- [ ] Large backfills use cursor-based batching (not a single `updateMany` over millions of docs)
- [ ] Index creation wraps `createIndex` in a try/catch for error codes 85 and 86
- [ ] No plaintext PII, passwords, or secret values are logged inside the migration
- [ ] Migration does not read environment variables that are not available in CI
- [ ] `node scripts/validate-migrations.js` passes with no errors
- [ ] Migration has been tested locally with `node scripts/migrate.js`
- [ ] Rollback (`down()`) has been tested locally

---

## Security

<!-- Check any that apply. -->

- [ ] No secrets, keys, or tokens are introduced or logged
- [ ] Input validation is applied to any new API parameters
- [ ] No new admin-only routes are exposed without authentication

---

## Documentation

- [ ] README or relevant docs updated (if user-facing behaviour changed)
- [ ] `[Unreleased]` section in `CHANGELOG.md` updated
