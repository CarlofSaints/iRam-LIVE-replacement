# Makro DISPO via SQL — stored procedures to send to Mark

Response to `EXTERNAL_CONSUMER_BRIEF.md` (database `RETAIL_Dispo_Makro`).

**Status: draft for Mark's review, 10 Aug 2026.** Nothing in iRam reads these yet — the
manual DISPO upload path stays live and untouched until the two are proven to agree.
See `docs/` siblings and the SQL Direct pilot at `/sql-pilot`.

---

## Why this database changes the picture

The earlier SQL Direct attempt stalled because the only sales source we had
(`GetDataForCustomDev_<CH>_Sales`, via the ARIA proxy) is a **scorecard aggregate** —
period totals keyed to one `MaxDate`, with no `SOH`/`SOO`/`SIT`, no costs, no DISPO
status code, and no month-by-month series. No transform recovers a DISPO from it.

`RETAIL_Dispo_Makro` is row-level DISPO data and does not have that problem.

It also solves the **client-name mapping blocker** for free: every fact here is keyed on
`VendorNo`, and iRam already stores `vendorNumbers` per client. We can drive the whole
thing off vendor number and never touch the `sqlClientName` free-text mapping for Makro.

---

## 1. The T-SQL

Three procedures. The first two are the pilot; the third is optional — see the note
under it before creating it.

### `rpt.usp_iRamDispoCurrent` — the DISPO row

```sql
CREATE OR ALTER PROCEDURE rpt.usp_iRamDispoCurrent
    @VendorNo         VARCHAR(20) = NULL,   -- NULL = all vendors
    @SiteCode         VARCHAR(20) = NULL,   -- NULL = all sites
    @OnlyWithActivity BIT         = 0       -- 1 = drop rows with no stock at all
AS
BEGIN
    SET NOCOUNT ON;

    /* Quantities come from vw.CurrentStockEA (already Compo-multiplied, UOM
       aggregated away, ** and KG excluded).

       Prices, margins, status and dates are per-UOM and NOT additive, so they are
       taken from ONE representative UOM row per product rather than aggregated.
       The pick is deliberate and deterministic:
         1. a row that actually carries commercial values beats one that does not
            (PAL/LAY define pack sizes and carry no measures);
         2. then the smallest real selling unit, EA first;
         3. then UOM alphabetically, so the result never depends on row order.
       ── Mark: this is the rule we would most like you to sanity-check. If the
          source has a definitive "selling unit" flag we would rather use that. */
    WITH SellingUom AS (
        SELECT
            cs.VendorNo,
            cs.SiteCode,
            cs.ArticleNo,
            cs.UOM,
            cs.Compo,
            cs.Barcode,
            cs.BMC,
            cs.BMCDescription,
            cs.PBC,
            cs.VendorProdCode,
            cs.ArticleClass,
            cs.Class          AS DispoClass,   -- both exist here; aliased on purpose
            cs.CurrYS,
            cs.ActDSC,
            cs.PlanDSC,
            cs.MAC,
            cs.StockMargin,
            cs.ListPrice,
            cs.NetCost,
            cs.ProductMargin,
            cs.PlannedMargin,
            cs.InclSP,
            cs.PromSP,
            cs.Status,
            cs.RP,
            cs.EndDate,
            cs.EndDateIsOpen,
            cs.LastReceived,
            cs.LastSold,
            cs.IsStale,
            cs.DateUpdated,
            ROW_NUMBER() OVER (
                PARTITION BY cs.VendorNo, cs.SiteCode, cs.ArticleNo
                ORDER BY
                    CASE WHEN cs.ListPrice IS NOT NULL
                           OR cs.NetCost   IS NOT NULL
                           OR cs.MAC       IS NOT NULL
                           OR cs.InclSP    IS NOT NULL THEN 0 ELSE 1 END,
                    CASE cs.UOM WHEN 'EA'  THEN 0
                                WHEN 'CS'  THEN 1
                                WHEN 'PK'  THEN 2
                                WHEN 'SW'  THEN 3
                                WHEN 'CAR' THEN 4
                                WHEN 'PAL' THEN 8
                                WHEN 'LAY' THEN 9
                                ELSE 5
                    END,
                    cs.UOM
            ) AS UomRank
        FROM vw.CurrentStar AS cs
        WHERE cs.UOM NOT IN ('**', 'KG')
          AND (@VendorNo IS NULL OR cs.VendorNo = @VendorNo)
          AND (@SiteCode IS NULL OR cs.SiteCode = @SiteCode)
    )
    SELECT
        ea.VendorNo                 AS [Vendor],
        ea.VendorName               AS [Name],
        u.VendorProdCode            AS [Vendor Prod Code],
        ea.ArticleNo                AS [Article],
        ea.ArticleDesc              AS [Article Desc],
        u.Barcode                   AS [Barcode],
        u.BMC                       AS [BMC],
        u.BMCDescription            AS [BMC Description],
        u.PBC                       AS [PBC],
        u.ArticleClass              AS [Article Class],
        u.DispoClass                AS [Dispo Class],
        ea.SiteCode                 AS [Site],
        ea.SiteName                 AS [Site Name],
        u.UOM                       AS [UOM],
        u.Compo                     AS [Compo],
        u.CurrYS                    AS [Curr Y/S],
        ea.SOH_EA                   AS [SOH],
        ea.SOO_EA                   AS [SOO],
        ea.SIT_EA                   AS [SIT],
        ea.PRQTY_EA                 AS [PR QTY],
        ea.RetOrd_EA                AS [Ret Ord],
        u.MAC                       AS [MAC],
        u.NetCost                   AS [Nett Cost],
        u.ListPrice                 AS [List Price],
        u.InclSP                    AS [Incl SP],
        u.PromSP                    AS [Prom SP],
        u.StockMargin               AS [Stock Margin],
        u.ProductMargin             AS [Product Margin],
        u.PlannedMargin             AS [Planned Margin],
        u.ActDSC                    AS [Act DSC],
        u.PlanDSC                   AS [Plan DSC],
        u.Status                    AS [Status],
        u.RP                        AS [RP],
        CASE WHEN u.EndDateIsOpen = 1 THEN NULL ELSE u.EndDate END AS [End Date],
        u.LastReceived              AS [Last Recv],
        u.LastSold                  AS [Last Sold],
        ea.MonthYearKey             AS [MonthYearKey],
        ea.AsOfExtractDate          AS [AsOfExtractDate],
        u.IsStale                   AS [IsStale],
        u.DateUpdated               AS [DateUpdated],
        ea.UomRowCount              AS [UomRowCount]
    FROM vw.CurrentStockEA AS ea
    LEFT JOIN SellingUom AS u
           ON  u.VendorNo  = ea.VendorNo
           AND u.SiteCode  = ea.SiteCode
           AND u.ArticleNo = ea.ArticleNo
           AND u.UomRank   = 1
    WHERE (@VendorNo IS NULL OR ea.VendorNo = @VendorNo)
      AND (@SiteCode IS NULL OR ea.SiteCode = @SiteCode)
      AND ( @OnlyWithActivity = 0
         OR ea.SOH_EA    <> 0
         OR ea.SOO_EA    <> 0
         OR ea.SIT_EA    <> 0
         OR ea.RetOrd_EA <> 0 )
    ORDER BY ea.VendorNo, ea.SiteCode, ea.ArticleNo;
END
```

### `rpt.usp_iRamMonthlySalesEA` — the month-by-month series

```sql
CREATE OR ALTER PROCEDURE rpt.usp_iRamMonthlySalesEA
    @VendorNo         VARCHAR(20) = NULL,
    @SiteCode         VARCHAR(20) = NULL,
    @FromMonthYearKey INT         = NULL,   -- default: 24 months ending at @To
    @ToMonthYearKey   INT         = NULL,   -- default: newest CLOSED month
    @ExcludeOpenMonth BIT         = 1       -- 1 = drop the month-to-date month
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @MaxKey INT = (SELECT MAX(MonthYearKey) FROM vw.MonthlySalesEA);

    /* The newest month is in progress and grows weekly. Included, it makes every
       trend read as a collapse at the right-hand edge. */
    DECLARE @NewestClosed INT =
        CASE WHEN @ExcludeOpenMonth = 1
             THEN (SELECT MAX(MonthYearKey) FROM vw.MonthlySalesEA WHERE MonthYearKey < @MaxKey)
             ELSE @MaxKey
        END;

    SET @ToMonthYearKey = ISNULL(@ToMonthYearKey, @NewestClosed);

    IF @ExcludeOpenMonth = 1 AND @ToMonthYearKey > @NewestClosed
        SET @ToMonthYearKey = @NewestClosed;

    /* Default window is 24 months so the caller always holds the prior-year month
       for every month it reports on — our year-on-year columns need it. */
    IF @FromMonthYearKey IS NULL
    BEGIN
        DECLARE @ToStart   DATE = DATEFROMPARTS(@ToMonthYearKey / 100, @ToMonthYearKey % 100, 1);
        DECLARE @FromStart DATE = DATEADD(MONTH, -23, @ToStart);
        SET @FromMonthYearKey = (YEAR(@FromStart) * 100) + MONTH(@FromStart);
    END

    SELECT
        s.VendorNo        AS [Vendor],
        s.VendorName      AS [Name],
        s.SiteCode        AS [Site],
        s.SiteName        AS [Site Name],
        s.ArticleNo       AS [Article],
        s.ArticleDesc     AS [Article Desc],
        s.MonthYearKey    AS [MonthYearKey],
        s.MonthYear       AS [MonthYear],
        s.PeriodStart     AS [PeriodStart],
        s.SalesQty_EA     AS [SalesQty_EA],
        s.AsOfExtractDate AS [AsOfExtractDate]
    FROM vw.MonthlySalesEA AS s
    WHERE s.MonthYearKey BETWEEN @FromMonthYearKey AND @ToMonthYearKey
      AND (@VendorNo IS NULL OR s.VendorNo = @VendorNo)
      AND (@SiteCode IS NULL OR s.SiteCode = @SiteCode)
    ORDER BY s.VendorNo, s.SiteCode, s.ArticleNo, s.MonthYearKey;
END
```

### `rpt.usp_iRamMonthlyPriceSeries` — optional, only if we do prior-year values properly

```sql
CREATE OR ALTER PROCEDURE rpt.usp_iRamMonthlyPriceSeries
    @VendorNo         VARCHAR(20) = NULL,
    @SiteCode         VARCHAR(20) = NULL,
    @FromMonthYearKey INT         = NULL,
    @ToMonthYearKey   INT         = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @MaxKey INT = (SELECT MAX(MonthYearKey) FROM vw.MonthlyStar);

    SET @ToMonthYearKey = ISNULL(@ToMonthYearKey, @MaxKey);

    IF @FromMonthYearKey IS NULL
    BEGIN
        DECLARE @ToStart   DATE = DATEFROMPARTS(@ToMonthYearKey / 100, @ToMonthYearKey % 100, 1);
        DECLARE @FromStart DATE = DATEADD(MONTH, -23, @ToStart);
        SET @FromMonthYearKey = (YEAR(@FromStart) * 100) + MONTH(@FromStart);
    END

    /* Same representative-UOM rule as usp_iRamDispoCurrent, applied per month.
       Prices are per-UOM and never summed or Compo-multiplied. */
    WITH SellingUom AS (
        SELECT
            ms.MonthYearKey,
            ms.MonthYear,
            ms.PeriodStart,
            ms.VendorNo,
            ms.SiteCode,
            ms.ArticleNo,
            ms.UOM,
            ms.Compo,
            ms.MAC,
            ms.NetCost,
            ms.ListPrice,
            ms.InclSP,
            ms.PromSP,
            ms.StockMargin,
            ms.ProductMargin,
            ms.Status,
            ROW_NUMBER() OVER (
                PARTITION BY ms.VendorNo, ms.SiteCode, ms.ArticleNo, ms.MonthYearKey
                ORDER BY
                    CASE WHEN ms.ListPrice IS NOT NULL
                           OR ms.NetCost   IS NOT NULL
                           OR ms.MAC       IS NOT NULL
                           OR ms.InclSP    IS NOT NULL THEN 0 ELSE 1 END,
                    CASE ms.UOM WHEN 'EA'  THEN 0
                                WHEN 'CS'  THEN 1
                                WHEN 'PK'  THEN 2
                                WHEN 'SW'  THEN 3
                                WHEN 'CAR' THEN 4
                                WHEN 'PAL' THEN 8
                                WHEN 'LAY' THEN 9
                                ELSE 5
                    END,
                    ms.UOM
            ) AS UomRank
        FROM vw.MonthlyStar AS ms
        WHERE ms.UOM NOT IN ('**', 'KG')
          AND ms.MonthYearKey BETWEEN @FromMonthYearKey AND @ToMonthYearKey
          AND (@VendorNo IS NULL OR ms.VendorNo = @VendorNo)
          AND (@SiteCode IS NULL OR ms.SiteCode = @SiteCode)
    )
    SELECT
        u.VendorNo      AS [Vendor],
        u.SiteCode      AS [Site],
        u.ArticleNo     AS [Article],
        u.MonthYearKey  AS [MonthYearKey],
        u.MonthYear     AS [MonthYear],
        u.PeriodStart   AS [PeriodStart],
        u.UOM           AS [UOM],
        u.Compo         AS [Compo],
        u.MAC           AS [MAC],
        u.NetCost       AS [Nett Cost],
        u.ListPrice     AS [List Price],
        u.InclSP        AS [Incl SP],
        u.PromSP        AS [Prom SP],
        u.StockMargin   AS [Stock Margin],
        u.ProductMargin AS [Product Margin],
        u.Status        AS [Status]
    FROM SellingUom AS u
    WHERE u.UomRank = 1
    ORDER BY u.VendorNo, u.SiteCode, u.ArticleNo, u.MonthYearKey;
END
```

---

## 2. The note

**What the result sets are for.** iRam LIVE produces three client-facing reports —
Month-End, Vital Signs and Store Reports — today rebuilt from hand-uploaded Makro DISPO
files. These replace that upload. `usp_iRamDispoCurrent` supplies the current state of
every product at every store (stock, price, margin, status, DSC, dates);
`usp_iRamMonthlySalesEA` supplies the monthly unit series the trend, YTD and
year-on-year columns are built from.

**Grain.**
- `usp_iRamDispoCurrent` — one row per `(VendorNo, SiteCode, ArticleNo)`. UOM aggregated
  away for quantities; prices from a single representative UOM row.
- `usp_iRamMonthlySalesEA` — one row per `(VendorNo, SiteCode, ArticleNo, MonthYearKey)`.
- `usp_iRamMonthlyPriceSeries` — one row per `(VendorNo, SiteCode, ArticleNo, MonthYearKey)`.

**Expected row count.** Per vendor, roughly 5k–15k for the current row (a few hundred
SKUs across ~40 Makro stores), and 24× that for a full 24-month series — so 120k–350k
rows on a default call. Unfiltered across all vendors it will be far larger, which is why
`@VendorNo` and `@SiteCode` are both there; we will normally call per vendor.

**How often.** Once a week per vendor, Wednesday or later per your refresh note, plus
ad-hoc when someone regenerates a report. Not on a per-page-load path.

**EA-normalised or per-UOM?** EA for all quantities. Per-UOM only where the brief says it
must be — prices and margins, taken from one representative row and never summed.

**Traps we have deliberately handled:** the open month is excluded by default; `VendorNo`
is in every join key; `**` and `KG` are excluded wherever we read `*Star` directly;
`EndDate` is nulled when `EndDateIsOpen = 1`; `ArticleClass` and `Class` are aliased
apart; we re-pull the whole window every run rather than caching months, per the
restatement warning.

---

## 3. What we could not do

**One genuine gap: `R. Profile`.** None of the ten views expose it. It is a rounding
profile — the order multiple a store rounds up to — and it is not a price or a quantity.
We use it to size suggested replenishment (`Open to Order units = category multiplier ×
R. Profile`), which is a headline number in both Month-End and Vital Signs.

Without it that feature cannot be computed at all — there is no approximation we would
trust, so we would rather ask than fake it. **Is it available on the underlying fact
rows, and could it be added to `vw.CurrentStar`?** In the SAP DISPO export it sits near
`RP` and `Dist.Prof.`.

**Two questions rather than gaps:**

1. **Is there a definitive "selling unit" flag per product?** We infer it (see the
   `SellingUom` rule). If the source knows it outright we would rather use that than a
   heuristic, because getting it wrong silently attaches the wrong price to a product.
2. **`CurrYS`** — your brief lists it as unconfirmed. We map it to our `Curr Y/S` column,
   which we treat as current-year-to-date units. Confirmation either way would be useful;
   if it means something else we will stop surfacing it.

**Not gaps, for the record:** `SB`, `TB`, `RR`, `P Term`, `Dist.Prof.` and `Order Unit`
exist in the DISPO file and our parser keeps them, but nothing in any report reads them.
We are not asking for them.

**Channel, sub-channel and province** are not in these views and do not need to be — iRam
holds its own store master and enriches on `SiteCode`.
