# LAVI 2.0 — Production Readiness Gate

This is a preparation branch based on the isolated LAVI 2.0 sandbox. It does **not** switch or deploy the existing LAVI 5A service.

## Current implementation status

Implemented in the preparation branch:
- Teacher registration/login with normalized email or Vietnamese phone number, password hashing and basic rate limits.
- Teacher-owned classes/students with server-side ownership checks.
- Question banks, Excel/Word import support, test sets, assignments, submissions, automatic grading and teacher manual grading.
- Point transaction ledger with reason, class totals, student history and progress feedback APIs/UI.
- JSON backup/restore with duplicate-restore protection; local SQLite snapshots and a backup-status endpoint.
- Automated tests for core flows, authorization boundaries, scoring, backup/restore and point/progress behavior. A GitHub Actions workflow was added; its successful execution still needs to be verified.

## Release blockers

- Email/phone ownership is not verified: OTP delivery and verification are not implemented.
- Password reset, account recovery and admin recovery are incomplete.
- Demo accounts and synthetic seeding must be impossible in production.
- Need full authorization tests for every class-owned resource and abuse controls; review CSRF/CORS, session expiry and audit coverage.
- Need a separately tested external backup and restore drill. Same-disk SQLite snapshots are not disaster recovery.
- Need acceptance testing for imports, multi-answer/short-answer grading, mobile workflows, point ledger, progress feedback, exports and data deletion.
- Game modules, parent accounts and student digital-skills portfolio are not fully accepted.

## Required before public launch

1. Select an email/SMS provider and implement OTP with expiry, single use, rate limits and verified-contact status.
2. Implement secure password reset and account recovery without revealing whether an account exists.
3. Add an explicit production mode that refuses demo credentials and synthetic seeding.
4. Run CI and resolve all failures; execute manual acceptance tests on a separate staging service using synthetic data.
5. Create a separate Render production service with its own Persistent Disk, environment variables and secrets. Never reuse LAVI 5A storage or credentials.
6. Verify the actual database path is /var/data/lavi2-sandbox.sqlite (or the documented production filename) and prove data survives restart/deploy.
7. Run and document backup/restore on a fresh test database; add an encrypted off-service copy with retention and access controls.
8. Complete privacy, retention, export/delete and school-account administration procedures.
9. Only after these gates pass, schedule a production release. Do not merge/deploy this preparation branch to the LAVI 5A service.

## Rollout rule

LAVI 5A remains the stable live system. LAVI 2.0 must remain isolated until all blockers are closed and a separate production service is verified.
