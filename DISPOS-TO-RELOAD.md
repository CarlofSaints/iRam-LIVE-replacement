# DISPOs that need re-uploading

Generated 12 Aug 2026 from the 667 DISPO loads on record. The header fixes are
live, but **they do not repair data already written** — only a re-upload does.

Regenerate this at any time (it will shrink as the team works through it):

```powershell
$env:IRAM_EMAIL="you@iram.co.za"; $env:IRAM_PASSWORD="…"
npx tsx scripts/list-dispos-to-reload.ts --csv reload.csv
npx tsx scripts/list-dispos-to-reload.ts --latest-only   # just the ones that fix stock
```

**108 loads, 56 client/channel/period combinations, 17 client+channel streams.**

## What was lost

| Problem | Loads | Cause |
|---|---:|---|
| No sales months merged at all | 79 | every month column was `26-Jul`-style (year first), which was not recognised as a date |
| Only part of the sales history | 6 | `8/1/25`-style columns, and `Sept-2025` which had no entry in the month table |
| No vendor number | 43 | the verbose export says `Vendor Number`, only `Vendor` was aliased |

The 43 no-vendor loads also lost **R. Profile** (so Open-to-Order read zero),
**Promotion SP** (promo prices ignored, sales value overstated), **Last Receipt
Date** (the Phantom sheet treats a blank date as old, so its count is inflated),
**BMC**, **Vendor Product Code** and **Terms of Payment**.

## The list

Order does not matter — an older file can no longer roll back stock. But the
**latest period per client+channel must be among what you reload**, or that
client's stock, prices and R. Profile stay wrong.

| Client | Channel | Loads | What was lost | Periods to reload |
|---|---|---:|---|---|
| CARTOON CANDY | MAKRO | 1 | 3 of 7 months | Wk4 Jan |
| CARTOON CANDY | WALMART | 1 | 3 of 7 months | Wk4 Jan |
| CLIPPA SALES | MASSBUILD | 4 | no sales | Wk2 Jul · Wk3 Jul |
| GASPRO TECHNOLOGIES | MASSBUILD | 3 | no sales, 6 of 7 months | Wk1 Jul · Wk3 Jul · Wk5 Jul |
| HELLERMANN TYTON | MASSBUILD | 3 | no sales | Wk1 Jul · Wk2 Jul · Wk3 Jul |
| LIBRA MARKETING & SALES | MASSBUILD | 9 | no sales | Wk4 Jun · Wk1 Jul · Wk2 Jul · Wk3 Jul |
| **MAJOR TECH** | MASSBUILD | 23 | no sales, **no vendor** | Wk1 Jul · Wk2 Jul · Wk3 Jul · Wk5 Jul · **Wk1 Aug** |
| QUALICHEM GENKEM | MASSBUILD | 5 | no sales, **no vendor** | Wk1 Jul · Wk2 Jul · Wk3 Jul · Wk5 Jul |
| **ROVIC AND LEERS** | MASSBUILD | 5 | no sales, **no vendor** | Wk1 Jul · Wk3 Jul · Wk5 Jul · **Wk1 Aug** |
| SAFE TOP RETAIL DISTRIBUTORS | MASSBUILD | 6 | no sales, **no vendor** | Wk1 Jul · Wk2 Jul · Wk3 Jul |
| SEAGULL INDUSTRIES | MASSBUILD | 2 | no sales, **no vendor** | Wk1 Jul · Wk3 Jul |
| **TALBORNE URBAN ORGANICS** | MASSBUILD | 7 | no sales, **no vendor** | Wk1 Jul · Wk2 Jul · Wk3 Jul · Wk4 Jul · Wk5 Jul · **Wk1 Aug** |
| TOPLINE DISTRIBUTORS | MASSBUILD | 13 | no sales, 6 of 7 months | Wk1 Jul · Wk2 Jul · Wk3 Jul · Wk4 Jul · Wk5 Jul |
| TRAMONTINA AFRICA | MASSBUILD | 4 | no sales | Wk1 Jul · Wk2 Jul · Wk3 Jul |
| USABCO | MASSBUILD | 7 | no sales | Wk4 Jun · Wk2 Jul · Wk3 Jul |
| VERIGREEN | MASSBUILD | 5 | no sales, **no vendor** | Wk2 Jul · Wk5 Jul |
| VERMONT SALES | MASSBUILD | 10 | no sales, 6 of 7 months, **no vendor** | Wk4 Jun · Wk1 Jul · Wk2 Jul · Wk3 Jul · Wk5 Jul |

Bold rows already have an **Aug Wk1** load on record, so re-uploading that one
restores their current stock and prices as well as the history.

## Two notes

**Almost all of this is MASSBUILD, July 2026.** The bad loads run from 6 to 24
July. On 24 July a hard-block shipped that rejects a DISPO whose sales columns
don't contain the month being stamped — which is exactly what these files look
like. That is a plausible reason the team stopped getting MASSBUILD files in
after July, and worth asking Sihle about: they may have been hitting a
rejection, not skipping the load. The block will stop firing on these files now
that the columns parse.

**One blank vendor is a different problem.** `D102_EXPORT.xlsx` (SAFE TOP,
MASSBUILD, 8 Jul) has a proper `Vendor` column, but every row carries the DC
code `D102` rather than a numeric vendor, so the parser had no real vendor to
find. That is the parser working as designed on a DC-only export, not the header
bug, and a re-upload will not change it.
