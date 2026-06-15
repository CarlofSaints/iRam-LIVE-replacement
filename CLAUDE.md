# iRam LIVE Replacement — Current State (Jun 5, 2026)

## Project Location
`C:\Users\CarlDosSantos-(OUTER\Projects\iram-live-replacement`
GitHub: [iRam-LIVE-replacement](https://github.com/CarlofSaints/iRam-LIVE-replacement)
Vercel: `https://i-ram-live-replacement.vercel.app/`
Seed secret: `oj-seed-2026`

## Tech Stack
- Next.js 16.2.6, React 19, TypeScript, Tailwind CSS 4
- Vercel Blob storage (JSON files via `lib/blob.ts`)
- bcryptjs for password hashing, uuid for ID generation
- Resend for email, xlsx for Excel parsing
- Vercel Pro deployment

## What The App Does
Replacement for the legacy iRam LIVE system. Multi-client DISPO data management portal with store control files, sales ledgers, product master (PMF), LINKS file bridging, channel hierarchy, CAM management, role-based access, Vital Signs reports, and scenario-based status classification.

## Env Vars Available (noted by user Jun 3, 2026)
- iRam SP tenant ID, Client ID, and Client Secret — set for future SharePoint integration (report saving)

## Auth System
- **Session cookie:** httpOnly, base64-encoded JSON
- **SessionPayload:** `userId`, `email`, `name`, `role`, `forcePasswordChange?`, `profilePicUrl?`
- **SSO:** Integrated with iRAM Hub. Module slug: TBD
- **Roles:** `super_admin`, `admin`, `cam`, `viewer` + custom roles via `lib/types.ts`
- **Permissions:** 13 permissions (manage_users, manage_roles, manage_channels, manage_clients, manage_cams, manage_store_files, upload_data, manage_control_files, delete_uploads, view_dashboard, view_uploads, view_activity_log, export_data)

## Key Architecture

### Channel Hierarchy (Main + Sub-Channels)
- `Channel` interface: `id`, `name`, `parentId?`, `active`, `createdAt`
- Main channels created manually in Channels admin
- **Sub-channels auto-created** from store file uploads — the `Sub_Channel` column in the Excel is matched/created under the corresponding main channel
- `ensureSubChannels(mainChannelId, subChannelNames)` in `lib/channelData.ts` handles idempotent creation
- **IMPORTANT — Actual deployed channel structure:**
  - MAKRO (MAIN) = main channel (UUID `e8d2ad28-022a-43a7-8115-ce42014ab22f`) — has sub-channel "MAKRO" (`4b376583...`)
  - MASSBUILD = main channel (UUID `c3a0cee9-765c-4dfc-ae2e-fb3c0cd383dc`) — NO sub-channel named "MASSBUILD"
  - GAME = main channel (`5d0ee74f...`)
  - Sub-channels include: BEX, BWH, BTD, SS, DC, MAKRO, JUMBO, etc.
  - Channels have UUID IDs (created via UI), NOT the default string IDs
- **Client `channelIds` stores SUB-CHANNEL IDs, not main channel IDs** — to derive which main channels a client belongs to, check if any sub-channel under a main is in the client's `channelIds`. Exception: MASSBUILD has no sub-channel, so the main channel ID itself may be in `channelIds`.

### Store Control Files
- `StoreControlFile` type: `id`, `fileName`, `mainChannelIds: string[]`, `uploadedAt`, `uploadedBy`, `rowCount`
- Upload auto-detects channels from the `Channel` column in the Excel (no manual selection needed)
- Unrecognized channel names block upload with error listing what to create
- `rebuildMerged()` keeps latest file per main channel
- Merged store master at `store-files/merged.json`
- `StoreRecord` has: `siteNum`, `storeName`, `channel`, `subChannel`, `country`, `province`, `townCity`, `address`, `postalCode`, `latitude`, `longitude`, `status`, `openedDate`, `top100`, `type`, `clusterCode/Name/Group`, `tags`

### DISPO Upload Flow
1. User selects client + main channel (single select) + file type
2. Server parses DISPO via `lib/dispoParser.ts` (header detection, vendor extraction)
3. **Validates vendor** against client's vendorNumbers
4. **Validates articles against LINKS** — `getLinksLookup(clientId)` returns Article→CPID map. Missing articles block upload.
5. **Validates sites against store master** — filtered to matching main channel. Missing sites block upload.
6. **Email alerts on validation failure:**
   - Missing products → email CAM (from `client.camId`) + uploader
   - Missing stores → email uploader + all users with `receiveStoreAlerts === true`
   - Emails fire-and-forget via `Promise.allSettled()`
7. On success: saves upload metadata + raw rows, merges into sales ledger per `clientId/mainChannelId`
8. Sales ledger dedup key: `Article|Site`, date columns normalized to `MM-YYYY`

### Product Data Chain
- **PMF** (Product Master File): global product catalog per client. Column mapping via `lib/productMapping.ts`
- **LINKS**: bridges channel-specific Article numbers (in DISPO) to global Client Product IDs (in PMF). Column mapping via `lib/linksLookup.ts`
- **DISPO**: channel-specific sales/stock data with Article numbers
- Chain: DISPO Article → LINKS → Client Product ID → PMF product details

### Clients
- `Client` interface: `id`, `name`, `vendorNumbers`, `active`, `createdAt`, `camId?`, `channelIds: string[]`, `linkedClientIds`, `controlFiles` (PMF/Links/Ranging/CustomSites/Promotions), `notes?`
- `channelIds` stores **sub-channel IDs** (NOT main channel IDs) — see Channel Hierarchy section above
- `controlFiles` stores metadata per type (fileName, uploadedAt, uploadedBy, rowCount)

### Vital Signs Report
- Enriched DISPO report with DSC alerts, month last sold, site/article rankings, open-to-order calculations
- Report config per client: DSC brackets, OTO multipliers per category, SP URLs
- Multi-channel support — merges ledgers from selected channels
- **OTO Calculation (CORRECTED Jun 5):**
  - OTO (units) = category multiplier × R. Profile (rounding profile — tells ordering system to round up to X)
  - OTO Value (Rand) = OTO × Nett Cost
  - R. Profile is NOT a price — it's a rounding profile for order quantities
  - Category multiplier from reportConfig.otoMultipliers, default 1
- **Report filename:** `Vital Signs - {clientName} - {vendorNumber} - {YYYY}{MM}Wk{N}.xlsx`

### Header Resolution (lib/headers.ts)
- DISPO column "PR ST" resolves to "Status" via alias `"pr st": "Status"`
- "R. Profile" is a separate canonical header (added Jun 5) — distinct from "RP" (replenishment code like Z4)
- Aliases: `"r. profile"`, `"r_profile"`, `"r profile"` all map to `"R. Profile"`
- All report output fields check both resolved and raw key names as fallback (e.g. `row["Status"] ?? row["PR ST"]`)

### Status Scenarios (Added Jun 5)
- Conditional classification overrides — when a DISPO status code matches a scenario's conditions, its classification takes priority over the per-channel status definition
- **Global** (not per-channel) — applied across all channels
- Conditions: `clientStatus` (from PMF, e.g. "ACTIVE", "DISCONTINUED") + `rangingStatus` (from ranging control file, boolean)
- Most-specific match wins (more conditions = higher priority)
- Falls back to channel-level StatusDefinition if no scenario matches
- Client Status dropdown is **dynamic** — populated from all clients' PMF data via `/api/status-scenarios/product-statuses`
- Data stored in `status-scenarios.json` blob

### Ranging Enrichment (Added Jun 5)
- `lib/enrichment.ts` loads ranging control file via `getControlFileData(clientId, "ranging")`
- Builds `Set<string>` of article keys from ranging file
- Enriches each row with `_rangingStatus: boolean` (true if article exists in ranging file)
- Used by status scenario evaluation for the `rangingStatus` condition

## Key Files

### Core Lib
- **`lib/types.ts`** — All interfaces: User (with `receiveStoreAlerts`), Channel, CAM, StoreControlFile (with `mainChannelIds`), StoreRecord, Client, UploadMeta, SalesLedgerMeta, ProductMaster, LinksFieldMapping, LogEntry, StatusDefinition, StatusScenario, StatusScenarioConditions, permissions system
- **`lib/blob.ts`** — Vercel Blob CRUD: `readJson()`, `writeJson()`, `deleteBlob()`
- **`lib/auth.ts`** — Session management, requireLogin/requirePermission/requireRole, handleAuthError
- **`lib/useAuth.ts`** — Client-side auth hook, authFetch()
- **`lib/email.ts`** — Resend email: `sendWelcomeEmail()`, `sendPasswordResetEmail()`, `sendMissingProductsEmail()`, `sendMissingStoresEmail()`
- **`lib/userData.ts`** — User CRUD with bcrypt, updateUser accepts `receiveStoreAlerts`
- **`lib/channelData.ts`** — Channel CRUD + `ensureSubChannels()`, `getMainChannels()`, `getSubChannels()`
- **`lib/camData.ts`** — CAM CRUD
- **`lib/clientData.ts`** — Client CRUD
- **`lib/storeFileData.ts`** — Store file index/CRUD, `parseStoreExcel()`, `rebuildMerged()` (main channel keying), `getMergedStores()`
- **`lib/dispoParser.ts`** — DISPO Excel parser with dynamic header detection
- **`lib/headers.ts`** — Canonical headers, aliases (including "R. Profile", "PR ST"→"Status"), `resolveHeader()`
- **`lib/salesData.ts`** — Sales ledger merge logic (`mergeDispo()`)
- **`lib/linksLookup.ts`** — LINKS file lookup: Article→CPID mapping, auto-match headers
- **`lib/controlFileData.ts`** — Control file CRUD (PMF, Links, Ranging, Custom Sites, Promotions)
- **`lib/enrichment.ts`** — Ledger enrichment: PMF join (_brand, _category, _subCategory, _productStatus), store join (_storeName, _province, etc.), ranging join (_rangingStatus)
- **`lib/reportConfig.ts`** — DSC brackets, OTO multipliers per category, SP URLs
- **`lib/vitalSigns.ts`** — Pure computation: computeVitalSigns(), calcMonthLastSold(), calcSiteRankings(), calcArticleRankings(), calcOpenToOrder() (with scenario support)
- **`lib/statusData.ts`** — StatusDefinition CRUD, auto-detect from DISPO uploads
- **`lib/statusScenarioData.ts`** — StatusScenario CRUD + `evaluateScenarios()` (matches by statusCode, checks conditions, most-specific-match wins)
- **`lib/activityLog.ts`** — Activity logging

### API Routes
- **`app/api/store-files/route.ts`** — GET index, POST upload (auto-detect channels, auto-create sub-channels)
- **`app/api/store-files/[id]/route.ts`** — DELETE individual store file
- **`app/api/store-files/merged/route.ts`** — GET merged store master
- **`app/api/uploads/route.ts`** — GET index, POST upload (DISPO validation + email alerts)
- **`app/api/uploads/[id]/route.ts`** — DELETE individual upload
- **`app/api/channels/route.ts`** — GET/POST channels
- **`app/api/channels/[id]/route.ts`** — PUT/DELETE individual channel
- **`app/api/clients/route.ts`** — GET/POST clients
- **`app/api/clients/[id]/route.ts`** — GET/PUT/DELETE individual client
- **`app/api/clients/[id]/control-files/route.ts`** — Control file uploads (PMF, Links, etc.)
- **`app/api/clients/[id]/links-mapping/route.ts`** — LINKS field mapping CRUD
- **`app/api/clients/[id]/product-mapping/route.ts`** — PMF field mapping CRUD
- **`app/api/clients/[id]/product-master/route.ts`** — Product master CRUD
- **`app/api/sales/route.ts`** — Sales data queries
- **`app/api/reports/vital-signs/route.ts`** — GET Vital Signs Excel download (accepts year/month/week params)
- **`app/api/reports/config/route.ts`** — GET/PUT report config per client
- **`app/api/reports/stats/route.ts`** — GET stats (totalDispos, ytdVolume, ytdValue, totalSkus, totalStores)
- **`app/api/status-definitions/route.ts`** — GET all (optional channelId filter), POST create
- **`app/api/status-definitions/[id]/route.ts`** — PUT/DELETE individual status definition
- **`app/api/status-scenarios/route.ts`** — GET all, POST create
- **`app/api/status-scenarios/[id]/route.ts`** — PUT/DELETE individual scenario
- **`app/api/status-scenarios/product-statuses/route.ts`** — GET distinct product statuses from all clients' PMFs
- **`app/api/users/route.ts`** — GET/POST/PUT/DELETE users (accepts `receiveStoreAlerts`)
- **`app/api/cams/route.ts`** — CAM CRUD
- **`app/api/logs/route.ts`** — Activity log queries
- **`app/api/auth/route.ts`** — Login/logout
- **`app/api/sso/callback/route.ts`** — SSO callback
- **`app/api/super-admin/seed/route.ts`** — Super admin seeding

### Pages (via `(portal)` route group)
- **`/`** — Dashboard
- **`/clients`** — Client list
- **`/clients/[id]`** — Client detail (control files, field mapping, Report Settings: DSC brackets, OTO multipliers, SP URL)
- **`/data-load`** — DISPO upload (client + main channel single-select, year/month/week selectors, validation error display)
- **`/reports`** — Reports page with stats cards (DISPOs, YTD Volume, YTD Value, SKUs, Stores), period selectors (Year/Month/Week), Vital Signs download
- **`/status-reference`** — Per-channel status definitions table + global Status Scenarios section (add/edit/delete with dynamic dropdowns)
- **`/activity-log`** — Activity log viewer
- **`/account`** — User account
- **`/control-centre/users`** — User admin (with `receiveStoreAlerts` checkbox + badge)
- **`/control-centre/channels`** — Channel admin (main-only creation, sub-channels labelled "Auto-created from store files")
- **`/control-centre/store-files`** — Store file upload (no channel selection — auto-detected from file)
- **`/control-centre/cams`** — CAM management
- **`/control-centre/roles`** — Role permissions matrix

## Session Work (Jun 3, 2026)

### Sub-Channel Auto-Creation + DISPO Validation + Email Alerts (Commit `625bfcf`)
12 files modified. Sub-channels auto-created from store file uploads. DISPO upload validates articles against LINKS and sites against store master. Email alerts on validation failure. `receiveStoreAlerts` user flag. Store files auto-detect channels from file content.

## Session Work (Jun 4, 2026)

### Vital Signs Report (Commits up to `66a831f`, `dc0536a`)
Full Vital Signs report feature built and deployed.

**New files:** `lib/reportConfig.ts`, `lib/vitalSigns.ts`, `app/api/reports/vital-signs/route.ts`, `app/api/reports/config/route.ts`, `app/(portal)/reports/page.tsx`

**Modified:** `lib/types.ts` (subCategory, reportYear/Month/Week on UploadMeta + SalesLedgerMeta), `lib/productMasterData.ts` (subCategory auto-match), `lib/enrichment.ts` (_subCategory), `components/Sidebar.tsx` (Reports nav), `app/(portal)/clients/[id]/page.tsx` (Report Settings section)

### Status Reference Seed Fix (Commits `0f2d547` through `8edaab8`)
- Seed endpoint resolves channel NAMES to UUIDs at runtime. Orphaned statuses cleaned (87 → 41).

### Channel Filtering Fixes (Commit `d103d78`)
- Data-load + reports pages derive main channels from client's assigned sub-channel IDs

### Period Selectors (Commit `d7c717a`)
- Year/Month/Week dropdowns on data-load page. Period stored in UploadMeta/SalesLedgerMeta.

### LINKS Mapping Badge Fix (Commit `197717e`)
- Badge shows correctly after page refresh (was only set after saving, not on load)

### Channel Display Fix — Clients Pages (Commit `7517274`)
- Show main channel NAMES instead of raw sub-channel UUIDs

### CRITICAL WARNING — Vercel Blob `get()` and `useCache`
- **DO NOT** add `useCache: false` to `@vercel/blob` `get()` — causes ALL reads to silently fail
- Commit `4afc651` added it, `4ce583d` reverted it
- For CDN cache issues, use the existing write-through in-memory cache (30s TTL) in `lib/blob.ts`

### SP API Permissions (Jun 4, 2026)
- All Entra ID permissions granted: Files.ReadWrite.All, SharePointTenantSettings.ReadWrite.All, Sites.FullControl.All, User.Read, Sites.ReadWrite.All (Application)

## Session Work (Jun 5, 2026)

### Vital Signs Bug Fixes + Stats + Scenarios (Commits `962295c`, `1e7f004`, `49df0c7`, `a373767`)

**Phase 1 — Bug Fixes:**
1. **R. Profile**: Added as canonical header in `lib/headers.ts` with 3 aliases. Report output now reads `row["R. Profile"]` (numeric rounding profile) instead of `row["RP"]` (status code like Z4)
2. **Replenishment**: Now reads `row["RP"]` (replenishment codes) instead of `row["PR QTY"]`
3. **OTO Value NaN**: Used `row["R. Profile"]` with NaN guard instead of `row["RP"]` (Number("Z4") = NaN)
4. **Ave Monthly Sales**: Filters to current-year date columns only (max year from data), excludes previous year months
5. **OTO Calculation corrected**: OTO (units) = category multiplier × R. Profile. OTO Value = OTO × Nett Cost. Previously was binary 1/0 × R.Profile.
6. **PR ST column**: Falls back to both `row["Status"]` and `row["PR ST"]` keys for resilience against ledger data stored under either key

**Phase 2 — Stats Cards on Reports Page:**
- New: `app/api/reports/stats/route.ts` — returns totalDispos (deduplicated by fileName), ytdVolume, ytdValue (units × Nett Cost), totalSkus, totalStores
- 5 stat cards in a grid above the Vital Signs report card, updates on client/channel change

**Phase 3 — Period Selectors on Reports Page:**
- Year/Month/Week dropdowns (default from latest ledger meta), passed as query params to Vital Signs download
- `app/api/reports/vital-signs/route.ts` accepts `year`, `month`, `week` query params for filename override

**Phase 4 — Scenario-Based Status Classification:**
- `lib/types.ts`: Added `StatusScenario`, `StatusScenarioConditions` interfaces
- New `lib/statusScenarioData.ts`: CRUD + `evaluateScenarios()` — matches by statusCode, checks conditions against enriched row fields (_productStatus for clientStatus, _rangingStatus for rangingStatus). Most-specific match wins (more conditions = higher priority). Returns null if no match → falls back to old StatusDefinition.
- `lib/enrichment.ts`: Added ranging lookup — loads ranging control file, builds Set of article keys, enriches rows with `_rangingStatus: boolean`
- New `app/api/status-scenarios/route.ts` (GET all, POST create) + `[id]/route.ts` (PUT, DELETE)
- New `app/api/status-scenarios/product-statuses/route.ts` — GET distinct product statuses from ALL clients' PMFs (dynamic dropdown)
- `lib/vitalSigns.ts`: calcOpenToOrder() + computeVitalSigns() now accept and use statusScenarios param — tries scenario evaluation first, falls back to channel-level status defs
- `app/api/reports/vital-signs/route.ts`: Loads scenarios in parallel, passes to computeVitalSigns()
- `app/(portal)/status-reference/page.tsx`: New "Status Scenarios" section with add/edit/delete, dropdowns for status code (from all channels), client status (dynamic from PMFs), ranging status (True/False/Any), classification (Positive/Negative)

**NOTE:** After deploying, users must re-upload DISPOs for the "R. Profile" column to appear in the sales ledger (since the header wasn't previously recognized as canonical). PR ST / Status column may also need re-upload if existing ledger data has blank values.

## OPEN BUG — Channel Display Regression (Jun 4, 2026)
**Problem:** After commit `7517274`, the clients page shows ONLY "MASSMART" as the main channel, with MAKRO and MASSBUILD collapsed under it as if they were sub-channels.

**Root cause (not yet investigated):** The `clientMainChannelNames()` helper filters channels without `parentId`. Need to check actual channel data in blob.

**This bug needs to be fixed in the next session.**

## Git
- Remote: `origin` → `https://github.com/CarlofSaints/iRam-LIVE-replacement.git`
- Latest commit: `a014fdd` — Add independent period selectors to Month-End report
- Vercel: auto-deploys from GitHub

## Session Work (Jun 7, 2026)

### Vital Signs Bug Fixes (Commits `b8e41c6` through `fcaba51`)

1. **Blob readJson fix** (`b8e41c6`): `lib/blob.ts` was using `@vercel/blob` `get()` which returns metadata, not a Response. All reads silently returned fallback. Switched to `list()` + `fetch(url?t=timestamp)` with `cache: "no-store"`. **CRITICAL: Never use `get()` from `@vercel/blob` v2.x.**
2. **Curr Y/S LY columns** (`e43f598`): Were hardcoded to `""`. Now sum last year's monthly columns for the same period (months 01..maxMonth of previous year).
3. **Nett Cost snapshots** (`f63fb28`): LY values were using current prices. Added `_nettCost_{year}` snapshots during DISPO merge in `lib/salesData.ts`.
4. **Selling price ex-VAT** (`fcaba51`): Changed all value calculations from Nett Cost to selling price ex-VAT. Formula: `(Prom SP > 0 ? Prom SP : Incl SP) / 1.15`. Also snapshots `_inclSP_{year}` and `_promSP_{year}` during merge. OTO Value still uses Nett Cost (cost-based). **User must re-upload 2025 DISPOs to capture LY price snapshots.**

### Month-End Report (Commit `5dd69b3`)

Multi-sheet Excel report using exceljs with professional formatting.

**New files:**
- **`lib/monthEndReport.ts`** — Computation engine: `buildDateContext()` classifies date columns, `buildSalesSummary()` aggregates at 5 levels (Sub-Channel, Province, Category, Store, Product) each with Volume + Value tables, `buildOOSSummary()` counts OOS (SOH < 1), `buildOOSDetail()` granular filtered list
- **`lib/monthEndExcel.ts`** — Excel builder: Sheet 1 "Sales" (cascading summary tables, dark blue headers, green totals, green/red growth %), Sheet 2 "OOS" (summary stats + product OOS table), Sheet 3 "OOS Detail" (15-column list with auto-filter + frozen header)
- **`app/api/reports/month-end/route.ts`** — GET endpoint, `maxDuration=120`, enriches with PMF/store/DSC, filename: `Month End - {clientName} - {vendorNum} - {YYYY}{MM}Wk{N}.xlsx`

**Modified:** `app/(portal)/reports/page.tsx` — Added Month-End report card below Vital Signs card

**Summary row columns:** Entity, # Stores, YTD, LY YTD, Current Month, Same Month LY, Last Month, Growth YTD %, Growth vs LM %, Growth vs PYM %, Contribution %

**Value calculations:** Units × effective selling price ex-VAT (Prom SP > 0 ? Prom SP : Incl SP) / 1.15. LY values use historical price snapshots (`_inclSP_{lastYear}`, `_promSP_{lastYear}`).

### Independent Period Selectors per Report (Commit `a014fdd`)

Each report section now has its own Year/Month/Week dropdowns:
- **Vital Signs**: `reportYear`, `reportMonth`, `reportWeek` state vars
- **Month-End**: `meYear`, `meMonth`, `meWeek` state vars (independent)
- Both default from latest ledger metadata when client changes
- Users can run each report for different periods independently


### Diagnostic Endpoints Still Present (cleanup later)
- `app/api/debug/ledger-check/route.ts` — bypasses readJson, inspects blob data directly (requires auth)

---

## Session Work (Jun 15, 2026) — Month-End Report MAJOR EXPANSION (all DEPLOYED)

Massive expansion of the Month-End report (`/api/reports/month-end` + `lib/monthEndReport.ts` engine + `lib/monthEndExcel.ts` exceljs builder + `app/(portal)/reports/page.tsx` UI). All pushed to `master`, Vercel auto-deploys.

### Workbook now has these sheets (in order)
**Menu · Sales · OOS · OOS Detail · Status · Status Detail · Margin · Phantom · ND · ND Detail · ND False · Data**

### Key commits (chronological)
- `98d7167` — Sales fixes (Store grid → "Number of SKU's"; dimension headers not "Entity"; unique-store grand total); OOS base fix (base = stock and/or sales, OOS = SOH≤0) + Store OOS Summary + Product Status col; **STATUS sheet** (PR ST breakdown + PR ST×PMF classification via Status Reference scenarios+defs) + Status Detail (negatives only); **all calcs as live Excel formulas**; Sub-Channel/Category UI filters (scope every sheet via `/api/reports/dimensions`) + flat **Data sheet** w/ AutoFilter
- `cde5596` — **Phantom** sheet (SOH>0 + last-sold older than X mo AND last-received older than Y mo; UI dropdowns 1-6 mo, default 3/3; ref = end of report month; blank dates = old); **Margin merged** to one sheet; Data sheet YTD/PY/growth/STK+Prod margin cols; **Prod Margin dual-source** (DISPO `Prod Marg` if present else calc)
- `6211586` — gridlines OFF all sheets; headings centered (h+v); emoji **header icons** (post-pass keyed by header text, see `HEADER_ICONS`)
- `684f8c7` — report period defaults to **latest month in the DATA** (date columns), not stale upload metadata
- `1a91888` — **sheet-selection** tickbox dropdown (default all); `sheets` param → `want()` gating in builder
- `e84fe97` — **Numerical Distribution** (ND/ND Detail/ND False) — see below
- `f634640` — **download regression fix** (ND Scenario-2 was cartesian over ENTIRE store master → timeout; now scoped to report channels + null-hardened + ND wrapped in try/catch so failure skips ND sheets not whole report) + **Menu/cover sheet** (client+channel logos, bold header, hyperlinks to every sheet) + logo API/storage
- `49fa73d` — Sub-Channel filter **defaults to MAKRO/BWH/BEX/BTD/SS** (those present), not all
- `4287114` — logo upload UIs: client **Logo tab** (4th on client detail) + per-main-channel logo on channel admin

### Numerical Distribution logic (lib/monthEndReport.ts `buildNumericalDistribution`)
- **Scenario 1 (ranging file loaded):** universe = ranging rows where `RangeIndicator`=TRUE. ND=1 if window sales OR any stock (SOH/SOO/SIT). Ranging file is **long format** (one row per ProductID×SiteCode) with headers carrying `Helper`/`Mandatory` prefixes — `rangingField()` resolver strips those. Fields: ProductID, ArticleChannelCode, SiteCode, Sub_Channel, Province, Store Name, Product Description, RangeIndicator. **ND False sheet** = SOH>0 in NOT-ranged combos (scenario 1 only).
- **Scenario 2 (no ranging file):** universe = active PMF SKUs (status=ACTIVE) × store-master ACTIVE sites **scoped to the report's channel names** (critical — unscoped exploded the cartesian). ND False not produced.
- Presence detected via `client.controlFiles.ranging != null`. Rolling window 1-24 mo (UI dropdown, default 6), counts back from report period month.
- Cover-note on ND sheet tells viewer which scenario applied.

### Logos (lib/logoData.ts + `/api/clients/[id]/logo` + `/api/channels/[id]/logo`)
- Stored as base64 dataURL in blob JSON (`clients/{id}/logo.json`, `channels/{id}/logo.json`). Embedded server-side via exceljs `addImage` on the Menu sheet (client left, channel right). Channel logo fetched by **mainChannelId** (passed from UI). Channel logos generic across clients.

### KNOWN ISSUES / PICK UP HERE (Jun 16)
1. **Ranging file parse bug (Scenario 1 likely never triggers):** `parseRangingSheet` in `lib/controlFileData.ts` filters rows on plain `r["ProductID"]`, but real headers are `HelperProductID` → filters ALL rows out → stored `ranging.json` is empty → `hasRanging` meta exists but `rangingRows.length===0` → falls to Scenario 2. **FIX:** make `parseRangingSheet` use a tolerant resolver (strip Helper/Mandatory), then user must re-upload ranging. Until then Henkel ND runs Scenario 2.
- Also the OLD article-level `_rangingStatus` enrichment (`lib/enrichment.ts`) keys off `r["Article"]` from ranging rows — also broken by the header prefixes; only matters for Status scenarios' ranging condition.
2. **Logo embedding:** webp not embeddable by exceljs (png/jpeg/gif only) — `addLogoImage` skips webp. Validation allows webp upload though; consider blocking webp or converting.
3. **STK Margin / Prod Margin format:** auto-detects fraction(0.47) vs percent-points(47) via `marginFraction` (>1 ⇒ /100). Verify against a real DISPO.
4. **Design choices flagged (confirm w/ user):** "MAC vs Nett Cost" = Nett−MAC (per literal instruction); Product Code = `_clientProductId`; week default = Auto when not stamped on the May upload (re-upload with Wk selected to stamp).
5. Diagnostic endpoint `app/api/debug/ledger-check` still present — clean up.

### Verification approach used
Each feature smoke-tested with `npx tsx` scripts (mock data → `buildMonthEndWorkbook` → reopen with exceljs, assert sheets/formulas/counts) then `npm run build`. All green.

---

