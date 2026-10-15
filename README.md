# FEU Roosevelt Canteen POS

Enhancement of the existing HTML/CSS/JavaScript application. Existing screens and offline browser records are retained. A Python/SQLite backend adds server-enforced accounts, recovery, discounts and atomic checkout.

## Run the local backend

Requires Python 3.11 or newer. No Python packages are needed.

From this project directory in PowerShell:

```powershell
$env:FEU_SETUP_TOKEN = Read-Host 'Choose a temporary server setup token'
python server/server.py
```

Open **http://127.0.0.1:8000/pages/login.html**. Create the owner account using that setup token, a password of at least ten characters, and an exactly six-digit recovery PIN. The setup token is used only while the database has no accounts. Remove it from the server environment after setup. Never commit it or put it in `js/config.js`.

Create staff accounts under **Accounts**. Every signed-in user can open **Account security** in the header to configure their PIN after verifying their current password. Changing a password or resetting it invalidates all that account's sessions. Sessions expire after eight hours; cookies are HttpOnly. Passwords and PINs use separate random salts and PBKDF2-HMAC-SHA256 with 600,000 iterations. Failed login/recovery attempts are persisted in SQLite: five account attempts per 15 minutes and 30 IP attempts per endpoint per 15 minutes. Successful PIN recovery does not clear its attempt window.

The default server binds only to loopback. Use Ctrl+C to stop; restart with the same command to retain records. The database is `server/data/pos.sqlite3` unless `FEU_DATABASE` specifies an absolute private path. Do not create or commit a database inside public frontend directories.

## Preserve and migrate existing data

The original offline installation continues to use its existing localStorage keys. Server mode uses an in-memory compatibility adapter and authenticated API calls; it does not copy passwords, PINs or sessions into localStorage. The server never automatically imports or overwrites browser records.

1. In the original offline installation, export its JSON backup from Settings. Keep an independent copy.
2. Start the backend, create the owner account, then open Settings → **Import existing browser data**.
3. Select the backup and choose **Validate and import backup**. Import requires an empty server product catalog and sales ledger. The whole import is transactional; duplicate transaction numbers or invalid records roll it back.
4. Verify product quantities, historical transaction totals and customers before entering new sales. Import does not deduct stock again.
5. Enroll existing staff accounts with new passwords and recovery PINs. Offline account credentials are intentionally not migrated or trusted. Browser records remain available in the original installation.

SQLite schema version 1 creates `users`, `sessions`, `attempts`, `resources`, `sales`, `discounts`, and `audit`. Schema creation is idempotent and never resets existing records. Sales have date/order and payment/date indexes. Inventory, customers, settings and other legacy datasets remain versioned JSON resources to preserve existing screen behavior. Stale resource writes return HTTP 409; reload before retrying rather than overwriting another terminal's changes. Checkout writes sales, inventory, customer counters, movement history and audit records in one `BEGIN IMMEDIATE` transaction, with a unique idempotency key for duplicate-submit protection.

Back up the database using SQLite's backup API (or stop the server and copy it). Copying only the main database file while WAL mode is active can omit recent transactions. Keep backups private and access-controlled; they contain account hashes and business records. The frontend JSON export is a business-data export, not a complete server backup; it omits server accounts, sessions, recovery hashes, discount definitions and the audit ledger.

## Discounts and Philippine restaurant rules

Owners manage Senior Citizen, PWD, Promotional and Custom discounts. Specify percentage/fixed amount, product/category scope, dates, status and owner-only restrictions. Changes record creator/updater and an audit event. A checkout selects a single discount; stacking is not supported. Compare an applicable promotion against the statutory benefit and select the more favorable applicable offer.

Statutory restaurant discounts are disabled until an owner explicitly reviews the tax and eligibility configuration in Settings. They require an explicit qualifying product/category scope, verified entitlement, and a separate qualifying purchase for the person's exclusive consumption. Companion purchases and bulk orders must be excluded. The interface stores confirmation flags only in the request, not identity documents or ID numbers. VAT-inclusive registered restaurant prices use gross / 1.12, then 20% off the net eligible amount, with no VAT charged on that qualifying transaction. A PHP112 eligible VAT-inclusive purchase therefore produces PHP100 eligible base, PHP12 VAT removed, PHP20 discount and PHP80 payable. A non-VAT PHP112 purchase produces PHP22.40 discount and PHP89.60 payable. Monetary results round half up to centavos.

This implementation supports the separate eligible restaurant-purchase workflow. It does not infer qualifying products, split shared/bulk orders, determine MEMC limits, implement the separate basic-necessities discount program, or automatically compare every promotional offer. Have the owner/accountant verify establishment classification, current entitlement requirements, take-out handling, scope, VAT registration and the more favorable offer before production enablement. Configure final restaurant selling prices explicitly; server checkout ignores the old blanket default-discount preference.

Primary references reviewed October 15, 2026:

- [BIR RR 7-2010, Supreme Court E-Library](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/55830): eligible restaurant purchases, separate consumption and VAT treatment.
- [RA 10754 and implementing rules, NCDA](https://ncda.gov.ph/disability-laws/implementing-rules-and-regulations-irr/irr-of-ra-10754-an-act-expanding-the-benefits-and-privileges-of-persons-with-disability-pwd/): PWD eligibility and VAT exemption.
- [DOT Memorandum Circular 2017-02, NCDA](https://ncda.gov.ph/disability-laws/dot-memorandum-circular-no-2017-02-series-of-2017-guidelines-on-the-provision-of-the-expanded-benefits-and-privileges-to-persons-with-disability-pursuan-to-republic-act-no-10754-otherwi/): entitlement and restrictions on combining discount programs.

## Recovery if the PIN is forgotten

There is no browser bypass or unauthenticated administrator-reset endpoint. After the owner verifies identity through the organization's approved process, a trusted server operator runs:

```powershell
python server/server.py --approve-recovery USERNAME
```

The operator supplies a non-sensitive approval reference and enters the new password and PIN in masked terminal prompts. The action is audited and existing sessions are invalidated. Do not enter passwords or PINs as command-line arguments.

## Reports, pagination and printing

Every existing report section gets its own applied date range and print action. Today, Yesterday, Last 7 Days, This Month, Last Month and Custom Range use Asia/Manila business dates. Changing one report does not change another. Inventory is labeled as a current snapshot; no incomplete historical stock balance is inferred. Discount reports include discount and VAT-removal totals. Best-product/customer charts retain the existing design and paginate their records.

Shared pagination offers 10/25/50/100 rows, previous/next, numbered pages, record counts and empty states. Sales use server-side SQL filtering/counts and LIMIT/OFFSET with stable date/reference ordering; printing fetches all matching rows independently of the visible page. The remaining legacy screens and reports load their datasets into memory and paginate their rendered rows. For high-volume catalogs, migrate these remaining JSON resources and report aggregates to indexed row tables and server-side queries before large-scale rollout. The compatibility layer uses synchronous XHR to retain existing save-before-render behavior; slow remote API connections can block the UI. This local-first release does not claim full high-volume database pagination for every module.

Individual receipts show items, prices, quantities, subtotal, discount, eligible amount, VAT adjustment, taxes, total, payment and cash/change or GCash reference. Printing creates an isolated frame and performs no business-data writes. Receipt layout targets 80mm paper; report printing uses standard paper and browser **Save as PDF**. Validate margins on the actual printer. GCash references are recorded after staff verification; this is not a payment-gateway integration.

## Hosting and GitHub Pages

GitHub Pages serves static frontend files only. The supplied Pages workflow packages only `index.html`, `pages`, `js`, `css`, and `assets`. It excludes the backend, database, tests, environment files and Git metadata. In repository Settings → Pages, choose **GitHub Actions** before enabling this workflow. Existing branch-based Pages configuration may need to be switched by the repository owner.

For backend hosting, use a persistent Python host/VM with private persistent storage and an HTTPS reverse proxy. Keep the Python service on loopback, configure the proxy's connection/body limits and authentication endpoint rate limits, restrict access to the database, run as an unprivileged service account and schedule private backups. The standard-library server is intended for local operation; production hosting requires operational hardening and load/security review.

Recommended: serve the frontend and `/api/` through one HTTPS origin. Set `FEU_ALLOWED_ORIGINS` to that exact frontend origin and `FEU_SECURE_COOKIE=1`. If the proxy is same-origin, remove `SameSite=None` in favor of Strict/Lax as appropriate for the deployment. The development default is HttpOnly/SameSite=Strict without Secure on loopback HTTP only.

If retaining the frontend on GitHub Pages, set `window.FEU_API_BASE` in `js/config.js` to the external HTTPS API origin; set `FEU_ALLOWED_ORIGINS=https://chan122601.github.io` and `FEU_SECURE_COOKIE=1` on the backend. This uses Secure/SameSite=None cookies and exact-origin credentialed CORS plus CSRF tokens. Browsers that block third-party cookies can prevent this split-origin setup from signing in; prefer a same-origin deployment. GitHub Pages must never contain setup tokens, database credentials, PIN hashes or other secrets. A configured-but-unavailable backend fails closed. When no backend is configured or detected, the original offline installation remains available and is explicitly labeled; it is not server-secured and secure recovery/discount management are unavailable.

## Verification and collaboration

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
python -m unittest discover -s tests -p test_server.py -v
```

Node dependencies are development-only. Tests use isolated SQLite databases under ignored `test-results` and synthetic DOM data. They do not delete or modify real browser or server records. The GitHub verification workflow runs the same suites.

DOM checks do not establish visual responsiveness or physical printing. Before approval, test real desktop/mobile browsers, keyboard navigation, receipt and report printer output, actual backup migration, the intended HTTPS host and deployment. See `DELIVERY.md` for the release status and remaining gates.

GitHub receives changes after commit and push. Collaborators obtain reviewed, merged changes with `git pull`. VS Code Live Share participants see the host's shared workspace; Live Share does not automatically synchronize separate local Git repositories. The Pages website changes only after the relevant branch is merged and deployment succeeds.
