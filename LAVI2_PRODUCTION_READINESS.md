# LAVI 2.0 — Production Readiness Gate

This branch is a preparation branch based on `lavi-2.0-sandbox`. It does **not** switch or deploy the existing LAVI 5A service.

## Current verified limitations

- The application identifies itself as a sandbox and intentionally exits if `NODE_ENV=production` while `LAVI_DEMO_MODE` is not `true`.
- The README says contact details are not verified and OTP is not implemented.
- The available demo accounts and synthetic student data must never be exposed as production accounts.
- Core production features (full question bank/import, assignment workflows, games, parent accounts, student digital portfolio) are not complete in this MVP.
- A persistent disk is configured in the sandbox blueprint, but a production service must have its own disk, environment variables, secret, and backup policy.

## Required before public launch

1. Implement and test verified email/phone signup (OTP through a selected provider), password reset, account recovery, abuse/rate-limit controls, and admin account recovery.
2. Add a production mode that refuses demo credentials and synthetic seeding; keep the sandbox's demo mode isolated.
3. Verify authorization boundaries for every API and every class-owned resource, including cross-teacher access tests.
4. Add tested backup/restore, retention, export/delete procedures, and verify that restore works on a fresh database. Do not store production secrets in GitHub.
5. Add production dependencies and workflows for the required feature set: question bank and Excel/Word import, assignments/submissions/scoring, point ledger, student progress feedback, and digital-skills portfolio.
6. Run automated tests and a manual acceptance checklist on a separate staging service with synthetic data.
7. Create a **new** Render service for LAVI 2.0 with root directory `lavi2`, branch `lavi-2.0-production-prep` (or a later approved release branch), Node 22, `npm install`, `npm start`, health check `/api/health`, a unique `LAVI_JWT_SECRET` (32+ characters), `LAVI_DEMO_MODE=false`, and a new persistent disk mounted at `/var/data`. Do not reuse the LAVI 5A service, disk, JWT secret, or production data.
8. Do not direct real users to the service until all gates pass and the owner explicitly approves the release.

## Release decision

**Not approved for production yet.** This is a deliberate safety gate, not a claim that deployment has occurred. The current sandbox guard remains unchanged. The existing LAVI 5A production service is not modified by this branch.
