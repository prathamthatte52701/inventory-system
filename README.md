<div align="center">

# 📦 Inventory Management System

**Material master · Stock IN / OUT / RETURN · Weighted-average costing · Ledger corrections by reversal (nothing is ever rewritten) · Live dashboard · Excel & PDF reports**

Node.js · Express 5 · MongoDB Atlas · React 19 · Vite

</div>

---

An automated inventory system for a single location. It records material movements, prices them by **weighted-average cost**, keeps stock levels current, and reports real-time status. An admin can correct any historical entry and the system **replays the whole ledger** so every later balance, rate and amount stays consistent.

> Ground truth for fields, movement logic and status rules: `Inventory_Management_System_Workflow.pdf`.

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
  - [1. MongoDB Atlas](#1-mongodb-atlas)
  - [2. Environment variables](#2-environment-variables)
  - [3. Install](#3-install)
  - [4. Seed the admins](#4-seed-the-admins)
  - [5. Run the backend](#5-run-the-backend)
  - [6. Run the frontend](#6-run-the-frontend)
- [Roles & access](#roles--access)
- [The costing engine](#the-costing-engine)
- [API reference](#api-reference)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Security notes](#security-notes)
- [Design decisions](#design-decisions)
- [Troubleshooting](#troubleshooting)

---

## Features

| Area | What you get |
|---|---|
| **Auth** | Open signup, but an account cannot log in until an admin approves it. JWT sessions. Approval status is re-checked on **every** request, so revoking a user cuts access immediately. |
| **Material master** | Unique uppercase IDs, unit, opening quantity/rate, minimum quantity. Admin-only create/edit. **Soft delete only**: there is no hard-delete endpoint anywhere. |
| **Stock movement** | IN / OUT / RETURN by any approved user. An OUT larger than available stock is **rejected** (`400`, nothing recorded), both for live entries and for back-dated ones (see below). |
| **Costing** | Weighted-average rate on IN. OUT and RETURN use the current average. IN records the amount *actually paid*, not the blended rate. |
| **Ledger corrections** | An admin corrects a movement by posting a **reversal** plus a **corrected entry**. The original is never rewritten; it is only marked as corrected. |
| **Materials search** | The Materials page filters live by Material ID or description (case-insensitive) and by stock status (All / Available / Low Stock / Out of Stock); the two filters combine. |
| **Dashboard** | Total materials, total stock value, low-stock and out-of-stock counts, per-material status. |
| **Stock import** | Any logged-in user uploads an Excel (`.xlsx`) or Word (`.docx`, best effort) stock sheet, reviews a **preview** (nothing is written yet), fixes what can be fixed, then commits. See *Stock import* below. |
| **Reports** | Stock-value (valuation) Excel + PDF, **Low Stock** and **Out of Stock** Excel lists, movement-history Excel (filter by material and date range), and a **daily per-material stock summary** (date picker on Reports, one-click button on the Dashboard). |
| **Admin tools** | Approve/reject signups, promote/demote users, audit log of every write. |

## How it works

```
                 ┌────────────────────────── React + Vite (frontend) ──────────────────────────┐
                 │ Login · Signup · Dashboard · Materials · Stock Movement · Ledger · Reports · Users │
                 └───────────────────────────────┬──────────────────────────────────────────────┘
                                                 │ axios  (JWT on every request, 401 ⇒ logout)
                                                 ▼
   ┌──────────────────────── Express 5 API (backend) ────────────────────────┐
   │ requireAuth (token + status==='approved', every request) → requireAdmin │
   │                                                                          │
   │  /auth  /users  /materials  /movements  /reports                         │
   │                          │                                               │
   │              utils/costing.js  ← single source of truth                  │
   │        apply()  live entry ─┐        recalculate()  full replay          │
   │                             └── same rules, so they can never disagree ──┘
   └───────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
                                MongoDB Atlas
                       User · Material · Movement · AuditLog
```

Stock status (from the workflow PDF):

| Condition | Status |
|---|---|
| `currentQuantity > minimumQuantity` | **AVAILABLE** |
| `0 < currentQuantity ≤ minimumQuantity` | **LOW STOCK** |
| `currentQuantity ≤ 0` | **OUT OF STOCK** |

---

## Quick start

**Prerequisites:** Node.js 20+ (built and tested on Node 24), npm, and a free MongoDB Atlas account.

### 1. MongoDB Atlas

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access → Add New Database User.** Choose password authentication and give it *Read and write to any database*. Save the username and password.
3. **Network Access → Add IP Address.** Add your current IP (or `0.0.0.0/0` for development only).
4. **Connect → Drivers** and copy the `mongodb+srv://…` connection string.
5. Put your database name in the path, before the `?`. Collections are created automatically; the app uses `inventory_management`:

   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/inventory_management?appName=<cluster>
   ```

If your password contains special characters (`@ : / ? #`), URL-encode them.

### 2. Environment variables

There are two files, and they have different jobs:

| File | Committed? | Purpose |
|---|---|---|
| `backend/.env` | **No**, git-ignored | Your real secrets. It already exists on the machine this was built on. |
| `backend/.env.example` | **Yes** | Blank template with the same keys, so a fresh clone knows what to fill in. |
| `backend/.env.test` | **No**, git-ignored | Same keys, but `MONGO_URI` points at a **test** database (see below). The UI test suites use this instead of `.env`. |
| `backend/.env.test.example` | **Yes** | Blank template for `.env.test`. |

On a new machine:

```bash
cp backend/.env.example backend/.env
```

then fill in `backend/.env`:

```ini
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/inventory_management?appName=<cluster>
JWT_SECRET=<long random string>
ADMIN1_NAME=...
ADMIN1_EMAIL=...
ADMIN1_PASSWORD=...
ADMIN2_NAME=...
ADMIN2_EMAIL=...
ADMIN2_PASSWORD=...
PORT=4000          # optional, default 4000
```

Generate a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> `backend/.env` also holds Groq API keys as **commented-out** lines (`# GROQ_API_KEY_1=…`). Nothing reads them yet; uncomment them only when a feature needs them.

**Test database isolation.** `frontend/tests/globalSetup.js` and `frontend-admin/tests/globalSetup.js` boot the real backend against a database named `inventory_test_ui` / `inventory_test_ui_admin`. Left alone, that database still lives on whatever cluster `backend/.env`'s `MONGO_URI` points at — the real one. Copy `backend/.env.test.example` to `backend/.env.test` and point its `MONGO_URI` at a differently-named database (same Atlas cluster is fine — e.g. `inventory_management_test`) to keep test runs off the real data entirely:

```bash
cp backend/.env.test.example backend/.env.test
```

If `backend/.env.test` doesn't exist, the suites fall back to `backend/.env` with a loud console warning, rather than failing silently. Either way, `backend/utils/testEnvGuard.js` runs first and **refuses to start** if the database it resolved — from either `.env.test`'s `MONGO_URI` or the literal database name the test run is about to use — matches the real database's name or simply doesn't contain "test". This exists because a manual verification script once connected straight to the real `MONGO_URI` and left test users and a test material in production data that had to be found and deleted by hand; the guard is what stops an automated run from doing the same thing.

### 3. Install

```bash
cd backend  && npm install
cd ../frontend && npm install
cd ../frontend-admin && npm install
```

### 4. Seed the admins

Creates the two pre-approved admin accounts from `ADMIN1_*` / `ADMIN2_*`. Safe to re-run: existing emails are skipped.

```bash
cd backend
npm run seed
```

```
first@example.com: created
second@example.com: created        # second run prints "exists, skipped"
```

### 5. Run the backend

```bash
cd backend
npm run dev      # nodemon, auto-restart
# or
npm start        # plain node
```

The API listens on <http://localhost:4000>; health check: `GET /api/health`.

### 6. Run the two frontends

There are **two separate React apps**, each with its own package, build and dev server:

| App | Folder | Dev URL | Who uses it |
|---|---|---|---|
| User app | `frontend/` | <http://localhost:2000> | everyone (dashboard, materials, movements, read-only ledger, reports) |
| Admin console | `frontend-admin/` | <http://localhost:5174> | admins only (materials, movement corrections, users, audit log, analytics) |

Run all three servers, one per terminal:

```bash
cd backend && npm run dev            # terminal 1: API on :4000
cd frontend && npm run dev           # terminal 2: user app on :2000
cd frontend-admin && npm run dev     # terminal 3: admin console on :5174
```

Both Vite servers proxy `/api` to `localhost:4000`, so nothing needs CORS in development. The admin console has its own login and refuses non-admins ("This app is for admins only"). The **Admin** link in the user app's navbar (admins only) opens it in a new tab.

Addresses between the apps are configurable (see `frontend/.env.example` and `frontend-admin/.env.example`): `VITE_ADMIN_URL` (user app, default `http://localhost:5174`) and `VITE_APP_URL` (admin app's "Back to app" link, default `http://localhost:2000`).

**CORS.** The backend's `CORS_ORIGIN` is a comma-separated list, so both apps can be allowed at once. Only needed when an app talks to the API directly instead of through the Vite proxy:

```ini
CORS_ORIGIN=http://localhost:2000,http://localhost:5174
```

**UI.** Both apps use Tailwind CSS v4 and a small shadcn/ui-style component kit (`src/components/ui/`: Button, Field/Input/Select, Badge, Alert, Table, Card, page helpers), duplicated in each app rather than shared. They differ in register so you always know where you are: the user app has a light top navbar with a **blue** accent; the admin console has a dark sidebar with a **violet** accent.

The session cookie is scoped to the host, not the port, so signing in to one app signs you in to the other (for admins) and signing out of one signs out of both.

For a production build: `npm run build` in either app (output in `frontend/dist` or `frontend-admin/dist`). To point a built frontend at a different API host, set `VITE_API_URL` at build time (for example `VITE_API_URL=https://api.example.com/api npm run build`).

---

## Roles & access

| Action | Anyone | Approved user | Admin |
|---|:-:|:-:|:-:|
| Sign up | ✅ | ✅ | ✅ |
| Log in | | ✅ (once approved) | ✅ |
| View dashboard, materials, ledger | | ✅ | ✅ |
| Record IN / OUT / RETURN | | ✅ | ✅ |
| Download reports | | ✅ | ✅ |
| Create / edit / (de)activate materials | | ❌ 403 | ✅ |
| Correct a ledger movement | | ❌ 403 | ✅ |
| Approve / reject signups, change roles | | ❌ 403 | ✅ |

The frontend hides admin controls and redirects admin-only URLs, but the **API enforces every rule independently**. The UI is a convenience, not the security boundary.

## The costing engine

All the money logic lives in one function, [`backend/utils/costing.js`](backend/utils/costing.js). Live entry and full replay both call it.

| Type | Quantity | Rate used | Amount | Average rate |
|---|---|---|---|---|
| **IN** | `+ qty` | the rate **you enter** | `qty × enteredRate` (what you actually paid) | `(oldQty·oldRate + qty·enteredRate) / (oldQty + qty)` |
| **OUT** | `− qty` | current average (you don't enter one) | `qty × currentRate` | unchanged |
| **RETURN** | `+ qty` | current average | `qty × currentRate` | unchanged |

`balanceAfter` is the material's quantity right after that movement.

**SRS field-name mapping.** A few SRS terms differ from the names used in the code and API. The fields were deliberately not renamed (a rename would break stored data and every client for no functional gain); this table is the key for reading the code against the SRS.

| SRS term | Actual field | Why |
|---|---|---|
| Per Unit Rate | `rate` (on a movement; `enteredRate` is the rate actually paid on an IN) | Same value. `rate` is the effective per-unit rate of that movement |
| Movement ID | `_id` (MongoDB's built-in id) | No separate field is needed: every movement already has a unique id |
| Balance Quantity | `balanceAfter` | Same value: the material's quantity right after that movement (see above) |

**Worked example**

| # | Movement | Amount | Balance | Avg rate after |
|---|---|---:|---:|---:|
| 1 | IN 100 @ ₹400 | ₹40,000 | 100 | ₹400 |
| 2 | IN 50 @ ₹440 | **₹22,000** (not 50 × 413.33) | 150 | ₹413.33 |
| 3 | OUT 30 | ₹12,400 | 120 | ₹413.33 |
| 4 | RETURN 20 | ₹8,266.67 | 140 | ₹413.33 |

**Correcting history.** The ledger is immutable. "Correcting" movement #1 (100 -> 200 units) posts an OUT of 100 that reverses it and then a new IN of 200; #1 itself keeps its original quantity, rate, amount and balance and is only flagged `isEdited`. Both new rows carry `correctionOf` pointing at #1, and the reversal also has `isReversal: true`. The reversal is built mechanically: IN -> OUT of the same quantity, OUT -> IN of the same quantity at the rate that OUT was costed at, RETURN -> OUT. Weighted-average costing depends on the order of movements, so when other movements happened in between, the average going forward is close to, but not bit-for-bit, what rewriting history would have produced. That is how a reversing ledger works, and the original is never quietly recalculated to hide it.

**OUT beyond stock is rejected.** A live OUT is checked against the current balance inside the per-material lock before anything is written: `Cannot record OUT of <q>: only <n> <unit> available.` (exactly equal to stock is fine). A back-dated entry is inserted, the ledger is replayed, and if any balance would newly go negative the entry is deleted, the replay is re-run so every movement and the material return to their previous state, and the request fails with `Cannot insert this back-dated OUT: it would make stock negative on <date> after replay.` Negative balances that already exist in older data are left as they are (the `exceededStock` field stays on the schema for them) and are never treated as a new violation. The next IN into zero stock restarts the average at the entered rate.

## Stock import

The import is how stock gets into the system in bulk. It is two stateless calls: **preview** parses the file and returns a full plan as JSON without touching the database; the browser holds the plan, lets the user fix it, and posts it back to **commit**. The server remembers nothing in between.

**The uploaded file is never stored.** It is read from memory (multer memory storage, 10 MB limit), parsed, and discarded when the request ends. The only things ever written are real Materials and Movements, one small `ImportBatch` metadata record per commit (filename, who, counts, never the rows) and one `IMPORT_COMMIT` audit entry.

**Who:** any logged-in approved user, like `POST /movements`. Importing may auto-create materials even though `POST /materials` is admin-only; that exception is deliberate, and the auto-created materials are flagged so someone can fix them.

**File format.** Excel is the fully tested path. Columns are matched by header text (case-insensitive, any order), including real-world synonyms: `EDP No` / `Material ID`, `Size` / `Description`, plus `Stock Qty, Receipt Qty, Rate, Issue Qty, Balance Qty, Receive Date, Issue Date, Unit, Current Qty`. `Stock Value` and `Status` are recognised and ignored outright (they're the app's own computed columns). Only an identifier (**`EDP No`**/**`Material ID`**) must be present; every other column is optional, and one missing from the file behaves exactly like an empty cell (no `Size`/`Description` -> the description is the EDP, no `Stock Qty` -> opening 0, no `Unit` -> the usual `TBD` placeholder, no `Rate` on a transaction file -> that IN row shows as *needs rate* in the preview). Legacy `.xls` cannot be read; re-save it as `.xlsx` (the upload is rejected with that message). Word is **best effort**: the first table in the document is used, and its header row must satisfy the same identifier rule (there is no fuzzy matching); otherwise it is rejected with `Could not find a table with an "EDP No" (or "Material ID") column — got: <what it found>`. Word only reads the first table.

The header row also decides which of two shapes the file is, once, not row by row:

**Transaction mode** (`Receipt Qty` and/or `Issue Qty` present — the original shape).
- One row makes up to two movements: an **IN** (Receipt Qty + Receive Date + Rate) and an **OUT** (Issue Qty + Issue Date). A blank or zero side is skipped. A `Current Qty` column, if also present, is ignored outright — a file with real transaction columns is a transaction file.
- **Stock Qty / Rate** only matter the first time an EDP appears and does not exist yet: the material is auto-created with `materialId` = EDP, description = Size/Description, unit = the file's `Unit` if given, else `TBD` (never guessed), and those values as its opening stock. For an EDP that already exists, Stock Qty is ignored; the system's own balance is the truth.
- **Balance Qty** is never stored. If it differs from the balance the system computes, the preview shows an informational warning and nothing more.
- Dates accept real Excel dates, `YYYY-MM-DD`, and day-first `DD/MM/YYYY` or `DD-MM-YYYY`. If the **Receive Date** or **Issue Date column is missing entirely**, those movements are dated today (the import day) and carry the preview warning `No Receive Date column in file — used today's date.`; a date column that exists but is blank on one row is still a row error. Because such dates are the import day, re-uploading the same dateless file on another day is not detected as a duplicate.
- A bad row (missing EDP, non-numeric or negative quantity, bad date) is listed as unreadable and skipped; the rest of the file still previews. An IN with no rate is shown as **rejected** so the user can type the rate in the preview.
- **Statuses:** `ok`, `new-material` (will be created, on an auto-created material), `duplicate-skip`, `rejected` (with the reason).
- **Duplicates:** a movement is skipped if the same material already has a movement with the same type, quantity and calendar day (and, for IN, the same rate). An identical row earlier in the same file counts too. Re-uploading the same file therefore creates nothing.
- **OUT beyond stock** is rejected in the preview with the same rule as manual entry (also for back-dated rows, judged against the replayed history), so it is visible before committing.

**Sync mode** (no `Receipt Qty`/`Issue Qty`, but `Current Qty` present — a plain snapshot of what a material's balance is *today*, the shape the business's real files actually use). If neither shape is recognisable (no `Receipt Qty`, `Issue Qty`, or `Current Qty`), the file is rejected outright.
- Each row states a material's current balance, not a transaction. A brand-new EDP opens at that balance (or at `Stock Qty`, if that column is also given — the gap between the two then becomes the row's one adjustment, below).
- An existing material gets **at most one adjustment movement**: `delta = file's Current Qty − the material's balance`, computed fresh inside that material's lock at commit time (never trusted from the preview, so a stock change between preview and commit can't produce a wrong number). `delta > 0` posts an IN, `delta < 0` posts an OUT, `delta === 0` does nothing. It goes through the exact same shared movement-creation path as everything else, so it is fully audited, and it can never be blocked by the OUT-beyond-stock rule — the adjustment is built to land exactly on the file's number, which can't be negative (a negative `Current Qty` is rejected as a row error before it gets this far). The IN's rate is the file's `Rate` if given, else the material's current rate. The movement's note reads `Stock sync from import: file states <fileQty>, system had <oldQty>`, so it is unmistakable in the Ledger.
- **Statuses:** `sync-adjustment` (a movement will be posted; the preview shows the signed delta), `already-matches` (the file already agrees with the system — nothing to do), `new-material`, `duplicate-skip`, `rejected`. Re-uploading the same snapshot twice therefore shows every row as `already-matches` the second time, with nothing new created — that falls straight out of the delta calculation.
- Two rows for the same material in one file: the later row wins; the earlier one is marked superseded and never touches the database.

**Commit is server-authoritative and partial.** The server ignores the statuses the browser sends and re-validates every row against the current database (stock may have changed since the preview). Each material's movements are then posted oldest first while holding that material's lock, through the one shared movement-creation function that `POST /movements` uses, so costing, back-dated recalculation and the OUT rule are identical to manual entry. Anything that fails is reported and the rest still go through; the response lists exactly which rows were created, skipped as duplicates, or failed and why, plus every auto-created material (unit `TBD`: go set the real unit on the Materials page).

## Daily stock summary

`GET /api/reports/daily-summary?date=YYYY-MM-DD` streams an Excel file with one row for **every active material**, including ones with no movement that day: EDP No, Size, Rate, Opening, Receipt, Issue, Balance, Status. Receipt is the sum of that day's INs, Issue the sum of that day's OUTs, and Balance the closing balance at the end of the day (a material with no movement that day simply holds its balance, with Receipt and Issue at 0). A RETURN changes the balance but is counted in neither column. Days are UTC calendar days.

## API reference

All routes are under `/api`. Send `Authorization: Bearer <token>`. Errors are `{ "message": "…" }`, and validation errors also carry `errors: [{ field, message }]`.

| Method | Route | Access | Notes |
|---|---|---|---|
| `POST` | `/auth/signup` | public | Creates a **pending** user. `role`/`status` in the body are ignored. |
| `POST` | `/auth/login` | public | 403 while pending or rejected. |
| `GET` | `/auth/me` | approved | |
| `GET` | `/users?status=` | admin | |
| `PATCH` | `/users/:id/approve` · `/reject` | admin | 409 if already processed. |
| `PATCH` | `/users/:id/role` | admin | Body `{ role: "admin"\|"user" }`. Cannot change your own role. |
| `PATCH` | `/users/:id/deactivate` · `/reactivate` | admin | Soft delete: nothing is removed, so every movement and audit entry stays attributed to the user. A deactivated user is refused at login (same generic error as a wrong password) and an open session ends on its next request. 409 if already in that state; you cannot deactivate yourself. |
| `GET` | `/materials?active=true\|false` | approved | |
| `GET` | `/materials/:id` | approved | |
| `POST` | `/materials` | admin | 409 on duplicate ID. |
| `PUT` | `/materials/:id` | admin | 409 if changing opening qty/rate once movements exist. |
| `PATCH` | `/materials/:id/deactivate` · `/reactivate` | admin | Idempotent. There is **no DELETE**. |
| `POST` | `/movements` | approved | `{ material, type, quantity, rate?, movementDate?, note? }`. `rate` is required for IN and ignored otherwise. Returns `{ movement, material }`; `400` if an OUT exceeds available stock. |
| `GET` | `/movements?material=` | approved | Sorted by date, then creation time. |
| `PUT` | `/movements/:id` | admin | Correction: posts a reversal + a corrected entry and marks the original as corrected. Body fields (`type`, `quantity`, `enteredRate`, `movementDate`, `note`) default to the original's. Returns `{ original, reversal, corrected, material }`. `400` if the original was already corrected, is itself a reversal/correction, or either new entry would make stock negative (nothing is left behind). Audited as `MOVEMENT_CORRECTION`. |
| `GET` | `/reports/dashboard` | approved | |
| `GET` | `/reports/stock-value/excel` · `/pdf` | approved | File download. |
| `GET` | `/reports/stock/low-stock/excel` | approved | Same columns as stock value, only materials with `0 < qty <= minimum`. |
| `GET` | `/reports/stock/out-of-stock/excel` | approved | Same columns, only materials with `qty <= 0`. |
| `GET` | `/reports/movements/excel?material=&from=&to=` | approved | Date-only `to` is inclusive. |
| `GET` | `/reports/daily-summary?date=YYYY-MM-DD` | approved | Every active material, with that day's Receipt / Issue and closing Balance. |
| `POST` | `/imports/preview` | approved | Multipart, field `file` (`.xlsx` / `.docx`). Returns the plan; writes nothing. |
| `POST` | `/imports/commit` | approved | Body `{ filename, materials, movements }` (the reviewed plan). Partial, re-validated commit; audited as `IMPORT_COMMIT`. |
| `GET` | `/imports` | approved | Paginated import history (date, filename, who, counts). |

## Testing

Everything runs against real HTTP and a real MongoDB. Tests use **throwaway databases** (`inventory_test*`, one per suite, plus `inventory_test_ui` and `inventory_test_ui_admin` for the two UI suites) that they drop when finished, so your real data is never touched. The two UI suites additionally load `backend/.env.test` if present (see *Environment variables* above) so they connect through a separate test database rather than the real `MONGO_URI`, and refuse to start at all if the resolved database looks like the real one — see `backend/utils/testEnvGuard.js`.

```bash
cd backend  && npm test              # every backend suite below except stress
cd backend  && npm run stress        # multi-user load test; slow against a remote DB, so it is NOT part of `npm test`
cd frontend && npm test              # the user app's pages, rendered against the real API
cd frontend-admin && npm test        # admin console: harness smoke test only (see the note under the table)
```

| Suite | File | Covers |
|---|---|---|
| Models | `backend/tests/phase1.test.js` | Schema validators, virtuals, status thresholds |
| Auth & Materials | `backend/tests/api.test.js` | Signup/approval flow, JWT tampering, 403s, seed idempotency, material CRUD rules |
| Movements & Ledger | `backend/tests/movements.test.js` | Costing rules, OUT rejection, concurrency, back-dated entries, corrections |
| Reports | `backend/tests/reports.test.js` | Dashboard numbers, xlsx/pdf headers and rows, empty data, bad date ranges |
| Roles | `backend/tests/roles.test.js` | Promote/demote, self-change block |
| OUT rejection | `backend/tests/outReject.test.js` | Live and back-dated rejection, exact-equal boundary, byte-for-byte restore after a rejected back-dated entry, concurrent OUTs through the lock |
| Corrections | `backend/tests/corrections.test.js` | Reversal + corrected entry for IN/OUT/RETURN, original frozen, single-correction rule, no partial state on failure, audit trail, replay agrees with stored values |
| Materials filter | `frontend/tests/materialsFilter.test.jsx` | ID / description / status filters, AND-combination, no-match state and clearing |
| Stock import | `backend/tests/import.test.js` | Mixed-file classification, duplicates, re-upload, OUT rejection, back-dated parity with manual entry, TBD/file-supplied units, Word success/failure, partial re-validated commit, audit + batch record, access, sync-mode adjustments/no-change/negative-qty/mode-precedence/last-row-wins |
| Low / Out of Stock lists | `backend/tests/stockLists.test.js`, `frontend/tests/stockLists.test.jsx` | Boundaries match the status virtual, inactive excluded, empty workbook, live stock changes, buttons download only their own list |
| Daily report | `backend/tests/dailyReport.test.js` | Summed Receipt/Issue, materials with no movement that day, inactive excluded, empty days, RETURN handling |
| Import page / daily report UI | `frontend/tests/import.test.jsx`, `frontend/tests/dailyReport.test.jsx` | Preview rows and statuses, inline rate fix, commit rule, server-side result summary, date-picker download |
| Import page state survives navigation | `frontend/tests/importPersist.test.jsx` | File/preview/inline edits still there after navigating away and back and no re-fetch, explicit Clear, auto-clear on commit, clears on logout, starts empty |
| End-to-end | `backend/tests/e2e.test.js` | Signup → approve → material → IN/OUT → dashboard → edit first movement → all 3 reports |
| Admin backend | `backend/tests/admin.test.js` | `GET /audit` (filters, pagination, injection guards), `GET /analytics/*`, `GET /users/:id/activity`, admin-only access |
| Fixes & limits | `backend/tests/fixes.test.js` | Login lockout (5 attempts / 15 min, survives restarts and other processes), movement pagination + streamed exports, httpOnly cookie session (Set-Cookie flags, logout revocation, CORS credentials), DB-level material lock incl. a crashed holder and two real processes |
| Hardening | `backend/tests/hardening.test.js` | Shared pagination/error helpers, `GET /users` pagination, signup rate limit (default 5 per IP per hour), new indexes, generic "Invalid material data" message |
| Stress | `backend/tests/stress.test.js` | 1 admin + 4 users hammering read endpoints on a large history while writes are in flight. Run with `npm run stress` |
| **QA (adversarial)** | `backend/tests/qa.test.js` | Spec compliance against the workflow PDF, auth-bypass matrix, role escalation, injection, oversized/NaN/Infinity inputs, malformed ids, 20 simultaneous OUTs, mixed-concurrency chaos, 19-movement history with 5 edits checked against an independent oracle |
| Frontend | `frontend/tests/phase7.test.jsx`, `phase8.test.jsx` | Login, signup, dashboard, read-only materials, movement form, report downloads, navbar and route guards |
| **Frontend QA** | `frontend/tests/qa.test.jsx` | Empty submits, double-clicks, Back/Forward, corrupt/expired/tampered sessions, numeric edge cases, hostile text |
| Frontend ledger paging | `frontend/tests/ledgerPaging.test.jsx` | Every movement past the backend's 200-row page cap stays reachable through Prev/Next |
| Frontend loading state | `frontend/tests/materialsLoading.test.jsx` | The Materials page never flashes "No materials yet." before data arrives, and never shows it after a failed fetch |
| Signup rules | `frontend/tests/signupRules.test.jsx` | Live validation, strength meter, password eye, and the same messages coming back from the raw API |
| Deactivation (user app) | `frontend/tests/deactivate.test.jsx` | A deactivated user is kicked out on the next click, sees the generic login error, and is restored on reactivate |
| Admin users | `frontend-admin/tests/users.test.jsx` | Deactivate / reactivate from the admin Users page against the real backend (own row disabled) |
| Admin smoke | `frontend-admin/tests/smoke.test.jsx` | Renders `/login` and expects the "Admin sign in" heading: proves install, run and pass for the admin harness, nothing more |

> **Admin console coverage is still pending.** `frontend-admin/` has only the smoke test and the users test above, so its materials CRUD, movement corrections, user approve/reject, audit log and analytics pages are covered only indirectly (through the backend suites) until a proper suite is written there. The old in-app `/admin/*` UI tests were deleted from `frontend/tests/` when the admin console became a separate app.

## Project structure

```
inventory system/
├── backend/
│   ├── app.js  server.js
│   ├── config/db.js                 # Atlas connection (+ DNS fallback)
│   ├── models/                      # User · Material · Movement · AuditLog · LoginAttempt
│   ├── middleware/                  # auth (requireAuth/requireAdmin) · validate · fields (strict validators)
│   ├── controllers/                 # auth · user · material · movement · report · audit · analytics
│   ├── routes/
│   ├── utils/                       # costing.js (engine + DB lock) · pagination · errors · loginLimiter · cookie · jwt · audit · seedAdmins · testEnvGuard (refuses to test against the real DB)
│   ├── tests/
│   ├── .env  .env.test              # real secrets / test-db secrets, both git-ignored
│   └── .env.example  .env.test.example  # blank templates, committed
├── frontend/                        # user app (port 2000)
│   ├── src/
│   │   ├── api.js                   # axios instance (cookie session), 401 interceptor, file download
│   │   ├── AuthContext.jsx  ProtectedRoute.jsx  Navbar.jsx  MainLayout.jsx  App.jsx  useGuard.js
│   │   ├── ImportContext.jsx        # the Import page's in-progress file/preview/edits, held above the router so navigating away and back doesn't lose them
│   │   ├── components/LedgerTable.jsx   # read-only ledger
│   │   ├── components/ui/           # shadcn-style kit (button, field, badge, alert, table, card, page)
│   │   └── pages/                   # Login · Signup · Dashboard · Materials · Movement · Ledger · Reports · Import
│   └── tests/                       # harness + setup + user-app suites
└── frontend-admin/                  # admin console, separate app (port 5174)
    ├── src/
    │   ├── api.js  AuthContext.jsx  RequireAdmin.jsx  Layout.jsx  App.jsx  useGuard.js
    │   ├── components/LedgerTable.jsx   # editable ledger (movement corrections)
    │   └── pages/                   # Login · AdminDashboard · AdminMaterials · AdminLedger · AdminUsers · AdminAudit · AdminAnalytics
    └── tests/                       # harness (setup, globalSetup) + one smoke test; full admin coverage pending
```

## Security notes

- Passwords are bcrypt-hashed (`passwordHash` is `select: false`) and are never logged. Request bodies are not logged either.
- JWTs are verified on every request, and the user's **current** role and status are read from the database, so a token claiming `admin` grants nothing.
- Login returns the same message for unknown email, wrong password and a deactivated account.
- Signup rules (enforced by the model, the request validators and the controller, and mirrored live in the signup form): name 3-48 characters, a real email address, password 8-32 characters with a lowercase letter, an uppercase letter, a digit and a special character from `!@#$%^&*()_+-=[]{}|;:,.<>?`. The format is checked before the signup rate limiter is charged.
- All inputs are type-checked before reaching Mongo, which blocks operator-injection payloads such as `{ "$gt": "" }`.
- Every number must be a finite value between 0 and 1,000,000,000 and every text field has a length cap, so `NaN`, `Infinity`, arrays, objects and 10,000-character strings are rejected with a 400 before they reach the database.
- JWTs are pinned to HS256; unknown-email logins take as long as wrong-password ones (no timing oracle); responses carry `X-Content-Type-Options: nosniff`.
- `backend/.env` and `backend/.env.test` are both git-ignored. Only the blank `.env.example` / `.env.test.example` templates are committed.
- **If a real `.env` value was ever pasted into a chat, ticket or screenshot, rotate it.** That means the Atlas password, `JWT_SECRET` and the API keys.
- The UI test suites connect through `backend/.env.test`, not `backend/.env`, and `backend/utils/testEnvGuard.js` refuses to run at all if the resolved database looks like the real one — see *Test database isolation* above.

---

## Design decisions

These were **not** specified in the requirements; here is what was chosen and why.

### Foundation & data model (Phase 1)
1. Emails are stored lowercase and trimmed, so `Bob@X.com` and `bob@x.com` are the same account.
2. bcrypt cost factor is 10. `description` and `unit` are required on materials.
3. Every schema has `createdAt`/`updatedAt` timestamps. `AuditLog` has `createdAt` only.
4. `Material.currentQuantity` has no `min 0` so that negative balances in older data stay readable; new OUTs that would cause one are rejected. The other numeric fields keep `min 0`.
5. The `status` virtual treats any quantity `≤ 0` (including negative) as OUT_OF_STOCK.

### Auth & security (Phase 2)
6. Signup ignores `role` and `status` from the request body: nobody can self-promote or self-approve.
7. Login returns 401 for wrong credentials and 403 for pending/rejected. Bad credentials are checked first, so the account's state is not leaked to someone without the password.
8. JWT lifetime is 8 hours. The role in the token is ignored; the database value is used.
9. Password must be 6–128 characters.
10. Approve/reject only works on **pending** users, using an atomic update: a second approve returns 409, an unknown id 404, a malformed id 400.
11. Audit writes never throw: a failed audit log must not break the request.
12. `seedAdmins` skips an admin whose email already exists and never overwrites or resets an existing password.
13. Malformed JSON returns 400 and unknown routes return a JSON 404. Request bodies are capped at 100 kB.
14. MongoDB SRV DNS lookups sometimes fail on local resolvers, so `config/db.js` falls back to public DNS for that process.

### Material master (Phase 3)
15. A new material's `currentQuantity`/`currentRate` start equal to its opening values.
16. Editing opening rate/quantity while **no** movements exist also resets current values to match. Once any movement exists it returns 409, and re-sending an unchanged value is allowed.
17. `materialId` is immutable after creation, and the system-maintained `current*` and `isActive` fields cannot be set through create/update.
18. `GET /materials` returns active and inactive items; `?active=` filters. Deactivating an inactive material returns 200.
19. Duplicate ID returns 409, validation errors 400, non-admin writes 403 ("Admin access required").

### Movements & costing (Phase 4)
20. For IN, the movement's `rate` is the rate paid (`enteredRate`); for OUT/RETURN it is the current average.
21. The paid rate may be sent as `rate` or `enteredRate`, and is honoured only for IN. On OUT/RETURN any rate in the body is ignored, not rejected.
22. An IN into zero or negative stock resets the average to the entered rate, because blending with negative stock produces nonsense.
23. Rounding: rate 6 decimals, amount 2 decimals, quantity 4 decimals.
24. Movements are validated for a real material that is **active**; otherwise 404. IN with rate `0` is allowed (free stock).
25. A per-material in-process lock serialises concurrent requests (ten simultaneous INs are tested). It works for one server process; scale-out would need DB transactions.
26. A movement and its material update are two writes; if the second fails, the movement is deleted.
27. A back-dated `movementDate` triggers a replay so later movements stay correct.

### Ledger corrections
28. Only quantity, type, rate, date and note can be supplied. Material, amount, balance and creator are derived or fixed; other fields in the body are ignored.
29. A correction is always a reversal plus a corrected entry, even when the values are unchanged. The original gets `isEdited`, `lastEditedBy` and `lastEditedAt` and nothing else about it changes (its own stored fields; the running balance of any row after a back-dated insert is still re-derived by the replay, which is how the ledger works).
30. Changing a movement to IN requires a rate.
31. Correcting a movement of an inactive material is allowed (admin correction).
32. Both entries go through the same OUT check as a live movement. If either would make stock negative the whole correction is refused and nothing is left behind.
33. The corrected entry is dated when it is posted (right after the reversal) unless the admin picks a date; its note defaults to `Correction of movement <id>` when none is given. An original can be corrected once; a reversal or a corrected entry can never be corrected.

### Reports (Phase 6)
34. Dashboard, stock-value Excel and PDF cover **active** materials only.
35. Negative-stock materials contribute a **negative** stock value to the total (faithful to `qty × rate`).
36. Movement export sorts by date, then creation time. A date-only `to` covers that whole day.
37. `from` after `to`, an unparseable date, or a malformed material id returns 400. Unknown query parameters are ignored. A filter with no matches returns an empty sheet.
38. Empty data returns empty structures (header-only sheets, "No materials." in the PDF), never an error.
39. The backend exposes `Content-Disposition` via CORS so a cross-origin frontend can read the download filename.

### Frontend (Phases 7–8)
40. **Added a backend endpoint** the spec implied but didn't list: `PATCH /users/:id/role`, needed for the role-toggle button. Admins cannot change their own role, which prevents locking yourself out.
41. Route guard: only `/users` is admin-only. Materials, Ledger and Reports are visible to everyone, with admin controls hidden for normal users.
42. Login and signup forms use custom validation (`noValidate`) so error messages are consistent and testable.
43. The 401 interceptor only clears the session and redirects when a session exists; a wrong password on the login page shows an inline error instead.
44. The movement page lists **active** materials only, hides the rate field for OUT/RETURN, and blocks empty material, non-positive quantity and missing IN rate before any request is sent.
45. The Ledger sends `movementDate` only if the user changed the date field, so untouched rows keep their original time and ordering. After every save the whole table is re-fetched, because an edit changes later rows.
46. The Users page shows pending signups plus all users; the role button is disabled on your own row.
47. Currency is displayed as ₹ with Indian digit grouping (`en-IN`).
48. Report downloads use blob responses, and API error messages are unwrapped from the blob so the user sees the real reason.
49. The test environment uses a bigger async timeout (20 s) because it talks to a real cloud database.
50. Test-tooling note: `pdf-parse` (2018 pdf.js) randomly rejects valid PDFs made by `pdfkit`. The PDFs were verified independently (correct xref offsets, inflated streams contain the expected text), so tests retry or use a small custom extractor (`backend/tests/pdfText.js`) instead.
51. Parallel subagents were not used. The pieces were small and heavily shared, so writing them in one pass avoided desync.

### Final QA pass: bugs found and fixed
A separate adversarial pass (spec check against the PDF, attack patterns, concurrency, chaos data, frontend abuse) found and fixed the following. Each fix has a regression test; the new tests were also run against the pre-fix code to confirm they fail there (20 of 29 backend, 19 of 27 frontend).

| # | Bug | Fix |
|---|---|---|
| 52 | `quantity: "1e999"` was accepted and stored as **Infinity**, corrupting the material (`NaN` rate) | Strict numeric validator: finite, 0 to 1e9, numbers or numeric strings only |
| 53 | Arrays/objects in numeric or enum fields (`quantity:[1,2]`, `type:["IN"]`, `material:[id]`) caused **500 errors** | Type-checked validators return 400 |
| 54 | No length limits: 20,000-character description, note and name were stored | Caps: id 50, description 200, unit 30, name 100, email 254, note 500 |
| 55 | Undecodable URL path (`/materials/%zz`) and oversized body (300 kB) returned **500** | 400 and 413 respectively |
| 56 | A request with no JSON body crashed handlers that read `req.body` (Express 5 leaves it undefined) | Body defaults to `{}` |
| 57 | An admin could **demote themselves** by sending their own id in upper-case hex (the "own role" check was case-sensitive) | Ids compared case-insensitively |
| 58 | `mongoose.isValidObjectId` accepts any 12-character string as an id | Strict 24-hex check everywhere |
| 59 | Per-material lock keyed on the raw string, so the same id in different hex case bypassed it; editing a material's opening values was not locked against movements | Lock key normalised; material update takes the same lock |
| 60 | JWT verify accepted any HS-family algorithm | Pinned to HS256 |
| 61 | Unknown-email login returned about 10x faster than wrong-password (account enumeration by timing) | Dummy bcrypt comparison |
| 62 | Movement dates such as year 275760 were accepted | Dates limited to 1970 to 2100, ISO format only |
| 63 | Frontend trusted `localStorage`: an edited role showed the admin UI shell, and a garbage or expired token rendered a broken page before redirecting | Session is verified with `GET /auth/me` before any protected page renders; server role always wins |
| 64 | Double-clicking Signup, Save (materials), Approve, or Ledger Save sent the request twice (second one showed a confusing 409 error) | `useGuard`: one in-flight action at a time |
| 65 | Logged-in users pressing Back onto `/login` saw the login form | Redirected to the dashboard |
| 66 | Frontend only checked `quantity > 0`, so `1e15` and `1e999` reached the API | Client limit matches the API (0 to 1e9) |
| 67 | A user revoked after login kept seeing a half-working app (403s) | "Account not approved" now clears the session |

**Fixed in the latest pass:** login rate limiting (5 failures / 15 min per email, stored in MongoDB, 429 + `Retry-After`); `GET /movements` pagination (`?page`, `?limit` max 200; exports stream via cursor); the JWT now lives in an httpOnly, SameSite=Strict, Secure cookie (no `localStorage`; `POST /auth/logout` clears it and revokes the token); the material lock is a MongoDB lease (`lockedUntil`) so multiple API instances are safe.

**Known limitations** (not bugs against the spec, but worth knowing before exposing this publicly):
- `helmet`-style security headers beyond `nosniff` are not set.
- The cookie is `Secure`: over plain HTTP on a non-localhost host set `COOKIE_SECURE=false`, and set `CORS_ORIGIN` if the frontend is on another origin.
- Anyone can sign up (by design); an existing email returns 409, which reveals that the email is registered.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `querySrv ECONNREFUSED …mongodb.net` | Your resolver blocks SRV records. The app already falls back to public DNS; if it persists, switch your network DNS to `8.8.8.8`, or use the non-SRV connection string from Atlas. |
| `MongooseServerSelectionError` / timeout | Your IP is not in Atlas **Network Access**. |
| `bad auth` / authentication failed | Wrong DB user/password in `MONGO_URI`; URL-encode special characters. |
| Frontend shows "Network Error" | Backend is not running on port 4000 (or `PORT` differs from the proxy target in `frontend/vite.config.js`). |
| Login says "Account pending admin approval" | An admin must approve the signup on the **Users** page (or use a seeded admin). |
| Seed says `exists, skipped` | Expected on re-runs; existing accounts are never modified. |
