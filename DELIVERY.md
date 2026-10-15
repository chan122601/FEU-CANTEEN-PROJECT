# Enhancement delivery and review status

Branch: `feature/feu-pos-security-reporting`.

Implementation commit: `3da7c9e8bdff59503b4d568557b2c0e6681d3342` (followed by a documentation-only status update).

Draft PR: https://github.com/chan122601/FEU-CANTEEN-PROJECT/pull/1 — open, not merged. GitHub reports it mergeable with no conflicts against the current `main`.

GitHub CI status: **blocked before execution**. [Verify POS run](https://github.com/chan122601/FEU-CANTEEN-PROJECT/actions/runs/38695018725) failed without starting any steps. GitHub's check annotation states: “The job was not started because your account is locked due to a billing issue.” The account owner must resolve that issue before CI or Actions-based Pages deployment can run. Local checks passed; this is not a successful GitHub CI run.

Merge status: awaiting review and approval. Latest frontend deployment/live verification: pending merge, account unlock and successful deployment; no live update is claimed.

This is a reviewable enhancement, **not a fully verified production release**. Merge requires the user's review and approval. Backend hosting, browser visual QA, physical printing and live deployment remain release gates.

## Implemented

- Local Python/SQLite API with first-owner setup token, owner/staff accounts, salted PBKDF2 password/PIN hashes, masked six-digit PIN inputs, persistent account/IP recovery limits, temporary lockouts, generic recovery errors, current-password verification, CSRF protection, exact-origin validation and session invalidation.
- Audited operator-approved recovery workflow for forgotten PINs, with identity-verification reference.
- Owner-managed Senior Citizen/PWD/promotional/custom discounts, percentage/fixed values, product/category scope, validity dates, active status, restrictions, creator/updater information and audit history.
- Server-authoritative quotes and atomic checkout with stock validation, idempotent sale creation, inventory deduction, customer counters and movement history in one transaction. Staff cannot change discount definitions, inventory resources or accounts.
- Scoped statutory restaurant calculations, explicit eligibility/personal-consumption confirmations, VAT removal, one discount per transaction and owner-reviewed configuration gate. Full legal/establishment validation is still required before production enablement.
- Independent applied date controls and print/PDF actions for daily summary, financial summary, staff sales, expenses, payments, product sales, customer sales, transactions and discounts. Current inventory is clearly labeled as a snapshot.
- SQL-backed sales search/date/payment/discount/staff filtering, record totals and pagination; individual receipts and all-filtered-record sales printing. Receipt output includes eligible amount, discounts and VAT adjustment.
- Shared 10/25/50/100-row controls, page numbers, Previous/Next, visible-range/count text and empty states on populated large tables and report charts. Remaining legacy modules paginate in memory.
- Shared FEU colors, form/filter/table/modal/pagination treatment, visible focus states, small-screen control wrapping and reduced-motion handling. Existing page layouts are retained.
- Validated, transactional business-data import into an empty backend, preserving existing offline browser data. Backend credentials require explicit enrollment.
- Verification workflow and frontend-only Pages packaging workflow.

## Files

- Existing `index.html`, every `pages/*.html`, `js/app.js`, `css/canteen_theme.css`, and `.gitignore` updated.
- New module: `pages/discounts.html`, `js/discounts.js`.
- Shared integration: `js/config.js`, `js/api-client.js`, `js/auth.js`, `js/data-tools.js`, `js/enhancements.js`.
- Backend/schema migration: `server/server.py`.
- Tests: `tests/test_server.py`, `tests/data-tools.test.js`, `tests/pages.test.js`, plus pinned `package.json`/`package-lock.json` development dependencies.
- Operations/collaboration: `README.md`, this report, `.github/workflows/verify.yml`, `.github/workflows/pages.yml`.

## Database and data handling

Schema version 1 creates users, sessions, persistent attempt counters, versioned JSON resources, indexed sales, discounts and audit tables. Startup is idempotent. No real records were deleted or used for tests. Tests create disposable databases in ignored `test-results`. The private runtime database and environment files are ignored by Git and excluded from the Pages artifact.

Existing offline account passwords are not automatically migrated. Existing users can configure a PIN once enrolled in the backend, after verifying their backend password. Keep the offline backup and enroll staff explicitly. Existing history that cannot support complete historical stock reconstruction is not used to invent historical inventory balances.

## Verification evidence

- `npm.cmd test`: pure date/timezone/pagination tests and DOM regression checks pass.
- DOM suite checks all 12 screens in both offline and server modes, masked PIN/first setup wiring, shared pagination, server sales paging, independent product-report filters, invalid ranges, transactional POS calls, receipt fields and print workflows performing no API writes.
- Isolated HTTP tests cover setup, existing-account login, secure hashes, invalid credentials, origin/CSRF denial, PIN configuration, correct/incorrect recovery, unknown-account generic errors, persisted lockout and expiry, session invalidation, owner/staff permission boundaries, staff disablement, discount scope/edit/duplicates/dates, VAT and non-VAT statutory cases, atomic/idempotent checkout, concurrent last-item purchases, insufficient stock, GCash reference requirements, stale writes, sales filters/counts/pagination, read-only queries, safe import, and server restart persistence.
- Pagination datasets cover 0, 10, 25, 30, 50 and 105 records with 10/25/50/100 page sizes; combined search/date/payment/discount pagination is covered by API tests.
- JavaScript/Python syntax checks and `git diff --check` pass. Remote `main` was fetched and is an ancestor of the feature branch, so the fetched baseline has no merge divergence.

The initial API run was blocked by sandbox temporary-directory permissions. Tests were rerun with permission in the isolated test directories. One test helper initially replaced a deliberately forged CSRF token with a refreshed valid token; the test was corrected and the suite rerun.

## Remaining limitations and release gates

1. No connected browser was available. DOM tests cannot verify visual layout, responsive screenshots, real browser printing, focus behavior or physical receipt printers. Complete these checks before release.
2. Backend is prepared for local operation; no production host has been selected or deployed. GitHub Pages alone cannot provide secure recovery, server accounts, shared inventory or checkout. Offline mode remains explicitly labeled and retains its original browser-security limitations.
3. Staff must be enrolled in the backend; real business-data migration needs owner verification. Backup JSON exports omit server credentials and also omit server discount definitions/audit history; use private SQLite backups for full recovery.
4. Remaining legacy reports/catalog/resources load data into memory and use a synchronous persistence compatibility layer. Only Sales has SQL pagination end to end. Normalize remaining JSON datasets and add server report aggregates for large-scale multi-terminal use.
5. Statutory support is intentionally limited to separate qualifying restaurant purchases. Shared/bulk-order allocation, MEMC automation, other statutory programs and automatic best-offer comparison are not implemented. Owner/accountant review is required before enabling these discounts.
6. GCash payment is manually verified; no payment-gateway settlement integration is provided.
7. CI status, PR review, merge approval, GitHub Pages settings/deployment and live frontend verification must be checked on GitHub. Do not infer live deployment success from local tests or a pushed feature branch.

Intended live frontend: https://chan122601.github.io/FEU-CANTEEN-PROJECT/

GitHub receives changes after commit and push. Collaborators use `git pull` after merge. Live Share shows the host workspace but does not synchronize separate local Git repositories. Pages updates after successful deployment of the merged frontend.
