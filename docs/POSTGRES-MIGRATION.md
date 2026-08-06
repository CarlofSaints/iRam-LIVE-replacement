# Moving the sales ledger to Postgres

**Status:** proposal, not started. Written 6 Aug 2026.
**Do not start this while historical DISPOs are still being loaded.**

---

## 1. What is actually being proposed

Move **four** things from Vercel Blob to Neon Postgres:

| Move | Why |
|---|---|
| The sales ledger | Concurrent writers + read-modify-write + aggregate queries |
| The uploads index | Concurrent appends to one shared document |
| The store master | So reports can JOIN instead of enriching in Node |
| The product master (PMF) | Same |

Leave **everything else on Blob.** Users, clients, channels, CAMs, roles,
report config, status definitions and scenarios, logos, control files
(LINKS/ranging/promotions), store-report state, activity log. Those are single
small documents, read whole, written rarely, by one person at a time. Blob is
genuinely good at that and there is nothing to gain by moving them.

This is a targeted migration of the hot data, **not a rewrite.** 32 modules
import `lib/blob.ts`; only `lib/salesData.ts`, `lib/uploadData.ts`,
`lib/storeFileData.ts` and `lib/productMasterData.ts` are in scope.

---

## 2. Why — the specific failures this removes

Every one of these is a database primitive the app currently hand-builds:

| Problem we have hit | What Postgres does instead |
|---|---|
| Two uploads erase each other's ledger rows | One transaction |
| `Article\|Site` dedup done in a JS `Map` | That *is* a primary key; merge becomes `ON CONFLICT DO UPDATE` |
| The app-wide upload lock (`lib/uploadLock.ts`) | **Deleted.** Row-level locking makes concurrent loads safe by construction |
| The lock wedging the whole app (6 Aug) | Cannot happen — there is no lock |
| `uploads/index.json` last-write-wins, plus the meta-blob reconciliation and `appendToIndex()` retry that fixed it | **All deleted.** One `INSERT` |
| Stale read-after-write (`list()`+`fetch`) | Read-after-write consistency, guaranteed |
| Month-End loading 20k+ wide rows into Node and looping 12 times | `GROUP BY` on an index |
| `readJsonStrict` existing at all — a failed read that must not be saved as empty | Transactions roll back |

Two of these cost a full working day in the first week of August.

**What it does NOT fix:** Vercel's ~4.5MB request body limit. Large DISPOs
still upload browser → Blob → server. Blob keeps that job, correctly.

---

## 3. Schema

Two design decisions drive everything:

**(a) The monthly sales columns become rows, not columns.** Today a ledger row
carries `"07-2026": 412`, `"06-2026": 388`, … as keys. That is why every report
has to load every row and loop. As rows, a month range is a `WHERE` clause and
a total is a `SUM`.

**(b) A `jsonb` column preserves the schema-flexibility we actually rely on.**
DISPO layouts differ per client and the parser is deliberately tolerant. We
promote the columns reports use to real typed columns (indexable, aggregatable)
and keep everything else in `extra`. Nothing is lost.

```sql
-- ── The line: one row per SKU-in-store, holding point-in-time DISPO fields
--    from the LATEST upload that contained it. Replaces sales/{client}/{channel}.json
create table sales_line (
  client_id      uuid        not null,
  channel_id     uuid        not null,
  article        text        not null,
  site           text        not null,

  vendor_number  text,
  status         text,          -- "PR ST"
  soh            numeric,
  soo            numeric,
  sit            numeric,
  nett_cost      numeric,
  incl_sp        numeric,
  prom_sp        numeric,
  r_profile      numeric,       -- rounding profile, NOT a price
  rp             text,          -- replenishment code, e.g. "Z4"
  act_dsc        numeric,
  mac            numeric,
  stk_margin     numeric,
  prod_margin    numeric,

  extra          jsonb       not null default '{}',   -- everything not promoted
  last_loaded_at timestamptz not null,

  primary key (client_id, channel_id, article, site)
);

-- ── The accumulating part: monthly units. Replaces the "MM-YYYY" keys.
create table sales_month (
  client_id  uuid    not null,
  channel_id uuid    not null,
  article    text    not null,
  site       text    not null,
  month      date    not null,     -- first of month; "07-2026" -> 2026-07-01
  units      numeric not null,

  primary key (client_id, channel_id, article, site, month),
  foreign key (client_id, channel_id, article, site)
    references sales_line (client_id, channel_id, article, site) on delete cascade
);

create index on sales_month (client_id, channel_id, month);

-- ── Historical prices, so last-year value uses last-year's price.
--    Replaces the _nettCost_2025 / _inclSP_2025 / _promSP_2025 keys.
create table sales_price_snapshot (
  client_id  uuid not null,
  channel_id uuid not null,
  article    text not null,
  site       text not null,
  year       int  not null,
  nett_cost  numeric,
  incl_sp    numeric,
  prom_sp    numeric,
  primary key (client_id, channel_id, article, site, year)
);

-- ── Uploads. Replaces uploads/index.json AND uploads/meta/{id}.json.
create table uploads (
  id               uuid primary key,
  client_id        uuid        not null,
  channel_id       uuid        not null,
  sub_channel_id   uuid,
  file_type        text        not null,
  file_name        text        not null,
  vendor_number    text,
  report_year      int,
  report_month     int,
  report_week      int,
  row_count        int         not null default 0,
  date_columns     text[]      not null default '{}',
  status           text        not null default 'processed',
  error_message    text,
  uploaded_by      uuid        not null,
  uploaded_by_name text        not null,
  uploaded_at      timestamptz not null default now()
);

-- The DISPO Load Checklist reads exactly this.
create index on uploads (client_id, channel_id, report_year, report_month, report_week);
create index on uploads (uploaded_at desc);

-- ── Dimensions, so reports JOIN instead of enriching in Node.
create table stores (
  site_num     text primary key,
  store_name   text,
  channel      text,
  sub_channel  text,
  province     text,
  town_city    text,
  status       text,
  top100       boolean,
  extra        jsonb not null default '{}'
);
create index on stores (sub_channel);
create index on stores (province);

create table products (
  client_id         uuid not null,
  client_product_id text not null,
  description       text,
  brand             text,
  category          text,
  sub_category      text,
  product_status    text,     -- ACTIVE / DISCONTINUED
  extra             jsonb not null default '{}',
  primary key (client_id, client_product_id)
);
create index on products (client_id, category);
```

`SalesLedgerMeta` (`totalRows`, `dateColumns`, `mergedUploadIds`,
`lastMergedAt`, report period) stops being a stored document — every field is a
query. Keep a thin `sales_ledger_meta` view if it is easier than changing
callers:

```sql
create view sales_ledger_meta as
select client_id, channel_id,
       count(*)                    as total_rows,
       max(last_loaded_at)         as last_merged_at,
       array_agg(distinct to_char(m.month, 'MM-YYYY')) as date_columns
from sales_line l
left join sales_month m using (client_id, channel_id, article, site)
group by client_id, channel_id;
```

---

## 4. What the merge becomes

Today: read the entire ledger, build a `Map`, merge in JS, write the entire
ledger back. ~200 lines, and unsafe under concurrency.

After — one transaction, no lock, no read of existing rows:

```sql
begin;

-- Point-in-time fields: latest upload wins, but never overwrite with a blank.
insert into sales_line (client_id, channel_id, article, site,
                        vendor_number, status, soh, soo, sit,
                        nett_cost, incl_sp, prom_sp, extra, last_loaded_at)
select ... from unnest($1::sales_line_input[])
on conflict (client_id, channel_id, article, site) do update set
  vendor_number  = coalesce(excluded.vendor_number,  sales_line.vendor_number),
  status         = coalesce(excluded.status,         sales_line.status),
  soh            = coalesce(excluded.soh,            sales_line.soh),
  -- ...
  extra          = sales_line.extra || excluded.extra,
  last_loaded_at = excluded.last_loaded_at;

-- Monthly units accumulate; a re-upload of the same month overwrites that month
-- only. This is what makes a duplicate load a genuine no-op.
insert into sales_month (client_id, channel_id, article, site, month, units)
select ... from unnest($2::sales_month_input[])
on conflict (client_id, channel_id, article, site, month) do update set
  units = excluded.units;

insert into sales_price_snapshot (...) values (...)
on conflict (client_id, channel_id, article, site, year) do update set ...;

insert into uploads (...) values (...);

commit;
```

`coalesce(excluded.x, existing.x)` is the `hasValue()` rule, in SQL.
The "don't overwrite with blank" behaviour is preserved exactly — normalise
empty strings to `NULL` when building the input array.

**`lib/uploadLock.ts` and its API route get deleted in the same commit.**

---

## 5. What Month-End becomes

The Sales sheet currently loads every row, enriches it, and aggregates five
ways in JavaScript. Replaced by one query per rollup:

```sql
select s.sub_channel,
       count(distinct l.site)                                   as stores,
       sum(m.units)                                             as units,
       sum(m.units * coalesce(nullif(l.prom_sp,0), l.incl_sp) / 1.15) as value
from sales_month m
join sales_line l using (client_id, channel_id, article, site)
join stores     s on s.site_num = l.site
join products   p on p.client_id = l.client_id
                 and p.client_product_id = l.extra->>'_clientProductId'
where l.client_id = $1
  and l.channel_id = any($2)
  and m.month between $3 and $4
  and ($5::text[] is null or s.sub_channel = any($5))
  and ($6::text[] is null or p.category    = any($6))
group by s.sub_channel
order by value desc;
```

That is the sheet. Milliseconds on an indexed table, versus the current
full-ledger scan that just timed out. The same shape covers Province,
Category, Store and Product by changing the `group by`.

The row-count-proportional detail sheets (Data, OOS Detail, Status Detail,
DSC Detail, ND Detail) become `LIMIT`/cursor-paged queries instead of
materialising every row in memory — which is the actual fix for the
Month-End failure, rather than raising `maxDuration` again.

---

## 6. Phasing

Each phase ships on its own and is independently useful. Stop after any of them.

| Phase | Scope | Effort | Payoff |
|---|---|---|---|
| **0** | Neon project, `pg` client, migration runner, `docs/` schema applied to a branch DB | 0.5 day | — |
| **1** | `uploads` table. Backfill from `uploads/meta/*` + index. Checklist + activity read from SQL | 0.5 day | Kills the index reconciliation, `appendToIndex`, the meta blobs |
| **2** | `sales_line` + `sales_month` + `sales_price_snapshot`. `mergeDispo` becomes the upsert above. **Delete `uploadLock.ts`** | 1 day | Kills the lock and the whole lost-rows class |
| **3** | `stores` + `products` | 0.5 day | Enables the joins |
| **4** | Rewrite Month-End + Vital Signs + Charts aggregations as SQL | 1 day | The report timeout goes away for good |

**Total ≈ 3.5 days.** Phases 1–2 alone (1.5 days) remove every bug from the
first week of August.

---

## 7. Migration mechanics

1. **Backfill is a script, not a cutover.** Read every `sales/{client}/{channel}.json`
   blob, explode the `MM-YYYY` keys into `sales_month` rows, insert. It is
   idempotent (all upserts) so it can be re-run as many times as needed.
2. **Dual-write for one week.** Writes go to both Blob and Postgres; reads come
   from Postgres. If anything is wrong, flip one env flag back to Blob and
   nothing has been lost.
3. **Verify before flipping reads.** Per client+channel, assert row count and
   `SUM(units)` per month match the blob exactly. A mismatch means the backfill
   is wrong, and it will be visible as a number, not a vibe.
4. **The blobs stay** for at least a month after cutover, read-only. That is
   the rollback.
5. **Do it per client**, biggest last. Libra or Majortech first.

### Gotchas to respect

- **Use the pooled Neon connection string** (`-pooler`) or the serverless
  HTTP driver. A serverless function per request against a direct connection
  exhausts Postgres connections under any real load.
- **Skip the ORM here.** The value of this migration is SQL aggregation;
  an ORM is friction in the way of it, and Prisma 7 has already cost time on
  other projects (no `--skip-generate` on `db push`, adapter required,
  `migrate dev` cannot run non-interactively in an agent shell). Use `pg` or
  `postgres.js` with plain `.sql` migration files.
- **Preview and Production must not share a database.** Use a Neon branch for
  Preview. (Price my Prang currently shares one — do not repeat that here.)
- **`extra jsonb` needs a GIN index** only if we start filtering on it. Do not
  add one speculatively.
- **Money stays `numeric`**, never `float`.

---

## 8. The honest counter-argument

Blob was not a mistake for this app in general, and most of it should stay.
It is cheap, needs no connection management, survived a laptop theft with no
data loss, and the gzip work cut storage 97%. Roughly 28 of the 32 modules
using it are perfectly well served.

The mistake was narrower: **the sales ledger has concurrent writers, does
read-modify-write on a shared collection, and is queried in aggregate.** Any
one of those alone is survivable on Blob. All three together is a database,
and we ended up hand-building transactions, upserts, locking and indexes on top
of a document store — each one arriving as a production bug rather than a
design decision.

The test for the rest of Carl's apps is that same three-part check, not
"Blob bad, Postgres good".
