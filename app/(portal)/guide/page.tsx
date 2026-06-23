"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, useEffect } from "react";

/* ──────────────────────────────────────────────────────────────
   Client Setup Guide
   A walkthrough for CAMs / admins on setting up a new client.

   SCREENSHOTS: drop image files into `public/guide/` using the
   filenames shown in each placeholder box (e.g. public/guide/new-client.png).
   They appear automatically — no code change needed.
   ────────────────────────────────────────────────────────────── */

const SECTIONS: { id: string; label: string }[] = [
  { id: "overview", label: "Overview & order of work" },
  { id: "before", label: "Before you start" },
  { id: "create-client", label: "1. Create the client" },
  { id: "control-files", label: "2. Load control files (PMF, Links…)" },
  { id: "field-mapping", label: "3. Map PMF & Links fields" },
  { id: "report-settings", label: "4. Report settings (DSC, OTO, SP)" },
  { id: "logo", label: "5. Client logo" },
  { id: "data-load", label: "6. Load DISPO data" },
  { id: "reports", label: "7. Run reports" },
  { id: "checklist", label: "Quick checklist" },
  { id: "shared-data", label: "Appendix: channels & store files" },
  { id: "status", label: "Appendix: status reference (site-wide)" },
];

function Figure({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  const [ok, setOk] = useState(true);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  return (
    <figure className="my-4">
      {ok ? (
        <>
          <img
            src={src}
            alt={alt}
            onError={() => setOk(false)}
            onClick={() => setZoom(true)}
            className="w-full cursor-zoom-in rounded-lg border border-[var(--color-border)] shadow-sm transition hover:ring-2 hover:ring-[var(--color-primary)]/40"
          />
          {zoom && (
            <div
              onClick={() => setZoom(false)}
              className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-4"
            >
              <img
                src={src}
                alt={alt}
                className="max-h-[92vh] max-w-[95vw] rounded-lg object-contain shadow-2xl"
              />
              <button
                onClick={() => setZoom(false)}
                aria-label="Close"
                className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-zinc-700 shadow hover:bg-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--color-border)] bg-zinc-50 py-10 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span className="text-sm font-medium text-zinc-500">Screenshot goes here</span>
          <code className="rounded bg-zinc-200/70 px-1.5 py-0.5 text-xs text-zinc-600">{src}</code>
        </div>
      )}
      {caption && (
        <figcaption className="mt-1.5 text-center text-xs text-[var(--color-text-muted)]">{caption}</figcaption>
      )}
    </figure>
  );
}

function Callout({ tone = "info", children }: { tone?: "info" | "warn" | "tip"; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    tip: "border-green-200 bg-green-50 text-green-900",
  };
  const label = { info: "Note", warn: "Important", tip: "Tip" }[tone];
  return (
    <div className={`my-4 rounded-lg border px-4 py-3 text-sm ${styles[tone]}`}>
      <span className="font-semibold">{label}: </span>
      {children}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-[var(--color-border)] pt-8">
      <h2 className="mb-3 text-xl font-bold text-[var(--color-text)]">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-[var(--color-text)]">{children}</div>
    </section>
  );
}

export default function GuidePage() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Client Setup Guide</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          How to onboard a new client in iRam LIVE — what each setting means, and the order to do it in.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Table of contents */}
        <nav className="lg:sticky lg:top-6 lg:h-fit lg:w-64 lg:shrink-0">
          <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              On this page
            </div>
            <ul className="space-y-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-md px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-zinc-100 hover:text-[var(--color-text)]">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        {/* Content */}
        <article className="min-w-0 max-w-3xl flex-1 space-y-2">
          {/* Overview */}
          <section id="overview" className="scroll-mt-6">
            <h2 className="mb-3 text-xl font-bold text-[var(--color-text)]">Overview &amp; order of work</h2>
            <p className="text-sm leading-relaxed text-[var(--color-text)]">
              A client in iRam LIVE ties together <strong>products</strong> (the PMF), the <strong>article codes</strong> each
              retailer uses (the Links file), the <strong>stores</strong> they sell into (the store master), and the{" "}
              <strong>sales &amp; stock data</strong> you upload each period (DISPO files). Once those are connected, the
              system can produce the Vital Signs, Month-End and Charts reports.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-text)]">
              This guide covers setting up <strong>one client</strong>. It assumes the shared data that client needs —
              its channels and store master — already exists. (Creating those from a retailer&apos;s site file is a separate,
              occasional job, covered in the{" "}
              <a href="#shared-data" className="font-medium text-[var(--color-primary)] hover:underline">appendix</a>.)
              Work through the client setup in this order:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-6 text-sm text-[var(--color-text)]">
              <li>Create the client and assign its channels, vendor numbers and CAM.</li>
              <li>Upload the control files — at minimum the <strong>PMF</strong> and <strong>Links</strong>.</li>
              <li>Map the PMF and Links columns (mostly auto-matched).</li>
              <li>Set the report settings (DSC brackets, OTO multipliers, SharePoint URL).</li>
              <li>Add the client logo.</li>
              <li>Load the first DISPO file.</li>
              <li>Run the reports.</li>
            </ol>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-text)]">
              <strong>Status reference</strong> (how DISPO status codes are classified) is <em>not</em> a per-client step —
              it&apos;s site-wide and shared by all clients. It&apos;s covered in its own{" "}
              <a href="#status" className="font-medium text-[var(--color-primary)] hover:underline">appendix</a>.
            </p>
            <Callout tone="warn">
              <strong>Shared vs. client-specific.</strong> Channels and the store master are{" "}
              <strong>global</strong> — loaded once and shared by every client. Loading the MAKRO store file creates the
              MAKRO channel and its stores for the whole system, not just one client. What makes a setup{" "}
              <em>client-specific</em> is which channels you <strong>assign</strong> to the client, plus that client&apos;s own
              PMF, Links, vendor numbers, CAM, DISPO data and report settings.
            </Callout>
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    <th className="px-4 py-2">Shared across all clients</th>
                    <th className="px-4 py-2">Specific to one client</th>
                  </tr>
                </thead>
                <tbody className="text-[var(--color-text)]">
                  <tr className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-2 align-top">Channels &amp; sub-channels</td>
                    <td className="px-4 py-2 align-top">Which channels are assigned to the client</td>
                  </tr>
                  <tr className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-2 align-top">Store master (sites)</td>
                    <td className="px-4 py-2 align-top">PMF, Links, Ranging &amp; other control files</td>
                  </tr>
                  <tr className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-2 align-top">&nbsp;</td>
                    <td className="px-4 py-2 align-top">Vendor numbers, CAM, DISPO data, report settings</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Callout tone="info">
              The <strong>product data chain</strong> is the heart of it:{" "}
              <code className="rounded bg-white/60 px-1">DISPO Article</code> →{" "}
              <code className="rounded bg-white/60 px-1">Links</code> →{" "}
              <code className="rounded bg-white/60 px-1">Client Product ID</code> →{" "}
              <code className="rounded bg-white/60 px-1">PMF product details</code>. If the Links file is missing or
              an article isn&apos;t in it, that line of the DISPO can&apos;t be matched to a product, and the upload will flag it.
            </Callout>
          </section>

          {/* Before you start */}
          <Section id="before" title="Before you start">
            <p>
              Three things need to exist before you can finish setting up a client. The first two are{" "}
              <strong>shared</strong> across all clients, so they&apos;re usually already in place:
            </p>
            <ul className="list-disc space-y-1.5 pl-6">
              <li>
                <strong>The client&apos;s channels exist.</strong> Main channels (MAKRO, MASSBUILD, GAME…) and their
                sub-channels are shared. If this client trades in a retailer that&apos;s brand-new to the system, that
                retailer&apos;s channels and stores have to be created first — see the{" "}
                <a href="#shared-data" className="font-medium text-[var(--color-primary)] hover:underline">appendix</a>.
              </li>
              <li>
                <strong>The retailer&apos;s store master is loaded.</strong> Also shared, and also covered in the{" "}
                <a href="#shared-data" className="font-medium text-[var(--color-primary)] hover:underline">appendix</a>.
                DISPO sites are validated against it.
              </li>
              <li>
                <strong>The CAM exists.</strong> <strong>Control Centre → CAMs.</strong> The CAM you assign to the client
                receives the alert emails (e.g. when a DISPO contains products not in the PMF), so add them here first if
                they&apos;re new.
              </li>
            </ul>
            <Callout tone="tip">
              If you&apos;re onboarding a client for a retailer that&apos;s already in the system (which is the common case), the
              channels and stores are already there — skip straight to creating the client.
            </Callout>
          </Section>

          {/* Create client */}
          <Section id="create-client" title="1. Create the client">
            <p>
              Go to <strong>Clients → + New Client</strong>. Fill in:
            </p>
            <ul className="list-disc space-y-1.5 pl-6">
              <li><strong>Name</strong> — the client / supplier name as it should appear on reports.</li>
              <li>
                <strong>Vendor numbers</strong> — one or more supplier numbers. DISPO uploads are validated against these,
                and the first one is used in report filenames.
              </li>
              <li><strong>CAM</strong> — the account manager responsible (drives alert emails).</li>
              <li>
                <strong>Channels</strong> — tick the sub-channels this client trades in. (Behind the scenes the client stores
                sub-channel IDs; the main channels they belong to are derived from these.)
              </li>
              <li><strong>Notes</strong> — optional free text.</li>
            </ul>
            <Figure src="/guide/new-client.png" alt="New client form" caption="Clients → New Client" />
            <Callout tone="tip">
              You can edit all of these later from the client&apos;s <strong>Details</strong> tab, so don&apos;t worry about getting
              every channel right the first time.
            </Callout>
          </Section>

          {/* Control files */}
          <Section id="control-files" title="2. Load control files (PMF, Links, …)">
            <p>
              Open the client and go to the <strong>Control</strong> tab. There are five control-file slots. Only the PMF and
              Links are required for reporting; the rest are optional and unlock extra features.
            </p>
            <Figure src="/guide/control-files.png" alt="Control files tab" />
            <ul className="space-y-2.5">
              <li>
                <strong>PMF (Product Management File)</strong> — the client&apos;s global product catalogue: every SKU with its
                description, brand, category, sub-category, cost, prices and product status (ACTIVE / DISCONTINUED, etc.).
                This is the source of truth for product detail on every report. <em>Required.</em>
              </li>
              <li>
                <strong>Links</strong> — the bridge between the retailer&apos;s <em>article codes</em> (what appears in the DISPO)
                and the client&apos;s <em>product IDs</em> (what&apos;s in the PMF). Without it, DISPO lines can&apos;t be matched to
                products. <em>Required.</em>
              </li>
              <li>
                <strong>Ranging</strong> — the official list of which products should be stocked in which stores. When loaded,
                it powers the most accurate <strong>Numerical Distribution</strong> calculation (Scenario&nbsp;1) and the{" "}
                <em>ranging status</em> condition on status scenarios. <em>Optional.</em>
              </li>
              <li>
                <strong>Custom Sites</strong> — extra / non-standard stores specific to this client. <em>Optional.</em>
              </li>
              <li>
                <strong>Promotions</strong> — promotional pricing/periods used in value calculations. <em>Optional.</em>
              </li>
            </ul>
            <Callout tone="warn">
              Load the <strong>PMF before the Links file</strong> where possible — the Links file matches against products
              that exist in the PMF.
            </Callout>
          </Section>

          {/* Field mapping */}
          <Section id="field-mapping" title="3. Map PMF & Links fields">
            <p>
              After uploading the PMF and Links files, the system shows the columns it found and tries to{" "}
              <strong>auto-match</strong> them to the fields it needs (article code, product ID, description, category,
              cost, price, status, and so on). Check the matches, fix any that are wrong using the dropdowns, then{" "}
              <strong>Save mapping</strong>.
            </p>
            <Figure src="/guide/pmf-mapping.png" alt="PMF field mapping" caption="PMF field mapping — confirm the auto-matched columns." />
            <Figure src="/guide/links-mapping.png" alt="Links field mapping" caption="Links field mapping." />
            <Callout tone="tip">
              A green badge means the field was matched. If a required field can&apos;t be matched, the column probably has an
              unusual header — pick it manually from the dropdown.
            </Callout>
          </Section>

          {/* Report settings */}
          <Section id="report-settings" title="4. Report settings (DSC, OTO, SharePoint)">
            <p>
              On the client&apos;s <strong>Report Settings</strong> tab (admin only) you control how the reports behave for
              this client.
            </p>
            <Figure src="/guide/report-settings.png" alt="Report settings tab" />

            <h3 className="pt-2 font-semibold">DSC Brackets</h3>
            <p>
              <strong>DSC = Days Stock Cover</strong> — roughly how many days of stock a store is holding for a product,
              based on its recent sales rate. The report buckets every line into a DSC band so you can see who&apos;s about to
              run out and who&apos;s drowning in stock. Two thresholds are configurable:
            </p>
            <ul className="list-disc space-y-1.5 pl-6">
              <li>
                <strong>OOS Threshold</strong> (default <strong>2</strong>) — anything below this many days is treated as{" "}
                <em>&ldquo;Out of Stock&rdquo;</em>.
              </li>
              <li>
                <strong>Alert Threshold</strong> (default <strong>300</strong>) — anything at or above this many days is
                flagged <em>&ldquo;ALERT&rdquo;</em> (severely overstocked).
              </li>
            </ul>
            <p>
              The bands in between (0–10, 10–90, 90–150, 150–210, 210–Alert) are fixed. Most clients can leave these at the
              defaults unless the category behaves very differently.
            </p>

            <h3 className="pt-2 font-semibold">OTO Multipliers (per category)</h3>
            <p>
              <strong>OTO = Open To Order</strong> — the suggested order quantity for lines that are out of stock but
              should be selling (in stock-keeping terms: SOH = 0, nothing on order or in transit, product ACTIVE and a
              positive status). The order quantity is:
            </p>
            <p className="rounded-lg bg-zinc-50 px-4 py-2 font-mono text-xs">
              OTO units = category&nbsp;multiplier × R.&nbsp;Profile&nbsp;&nbsp;·&nbsp;&nbsp;OTO value = OTO units × Nett&nbsp;Cost
            </p>
            <p>
              The <strong>R. Profile</strong> (rounding profile) comes from the DISPO and tells the ordering system the
              pack/round-up quantity. The <strong>multiplier</strong> you set here scales that per category — e.g. set a
              fast-moving category to <code>2</code> to order two rounding-profiles&apos; worth. <strong>Leave it blank /
              <code>1</code></strong> to order exactly one rounding profile (the default).
            </p>
            <Callout tone="info">
              Multipliers are keyed by category, pulled from the PMF. The list of categories only appears once a PMF has been
              loaded and mapped.
            </Callout>

            <h3 className="pt-2 font-semibold">SharePoint Save Folders</h3>
            <p>
              Optional, <strong>one folder per report</strong> (Vital Signs, Month-End, and Status Robot when it&apos;s built).
              When a report is generated, it&apos;s <strong>automatically saved</strong> into that report&apos;s SharePoint folder
              (and still downloads to your browser). After download you&apos;ll see a &ldquo;saved to SharePoint ✓&rdquo; confirmation,
              or an error if it couldn&apos;t save.
            </p>
            <p>
              Paste the SharePoint <strong>web</strong> link to the folder (starts with <code>https://</code>) or a
              server-relative path like <code>/sites/Clients/Shared Documents/…</code>. <strong>Don&apos;t</strong> use a local
              synced <code>C:\</code> path — the save happens in the cloud, not on your PC. Leave a field blank to skip
              saving that report.
            </p>
            <p>Click <strong>Save Report Settings</strong> when done.</p>
          </Section>

          {/* Logo */}
          <Section id="logo" title="5. Client logo">
            <p>
              On the <strong>Logo</strong> tab, upload the client&apos;s logo (PNG or JPG, max 1.5&nbsp;MB). It appears on the
              cover sheet of the Month-End workbook.
            </p>
            <Figure src="/guide/logo-tab.png" alt="Logo tab" />
            <Callout tone="warn">
              Use <strong>PNG or JPG</strong>, not WebP — WebP can&apos;t be embedded in the Excel cover sheet.
            </Callout>
          </Section>

          {/* Data load */}
          <Section id="data-load" title="6. Load DISPO data">
            <p>
              Go to <strong>Data Load</strong>. Choose the <strong>client</strong>, the <strong>main channel</strong>, the
              <strong> file type</strong> and the <strong>period</strong> (year / month / week), then upload the DISPO file.
              On upload the system:
            </p>
            <ol className="list-decimal space-y-1.5 pl-6">
              <li>Checks the <strong>vendor number</strong> matches the client.</li>
              <li>Validates every <strong>article</strong> against the Links file — unmatched articles block the upload and email the CAM.</li>
              <li>Validates every <strong>site</strong> against the store master — unknown sites block the upload and email the uploader.</li>
              <li>On success, merges the rows into the client&apos;s sales ledger for that channel and period.</li>
            </ol>
            <Figure src="/guide/data-load.png" alt="Data load page" />
            <Callout tone="warn">
              If you get a &ldquo;missing products&rdquo; or &ldquo;missing stores&rdquo; error, it means the Links file or store master is
              out of date. Update the relevant control file, then re-upload the DISPO.
            </Callout>
          </Section>

          {/* Reports */}
          <Section id="reports" title="7. Run reports">
            <p>
              With data loaded you can produce reports from <strong>Reports</strong> (Vital Signs &amp; Month-End Excel
              downloads), explore the web <strong>Charts</strong>, and see headline numbers on the <strong>Dashboard</strong>.
              Each report has its own period selectors, so you can run different months independently.
            </p>
            <Figure src="/guide/reports.png" alt="Reports page" />
            <Callout tone="tip">
              If a brand-new column (like R. Profile) or a price doesn&apos;t show, re-upload the DISPO for that period — some
              fields are only captured at upload time.
            </Callout>
          </Section>

          {/* Checklist */}
          <Section id="checklist" title="Quick checklist">
            <ul className="space-y-1.5">
              {[
                "Channels exist and the client's store file is loaded",
                "CAM exists and is assigned to the client",
                "Client created with name, vendor number(s) and channels",
                "PMF uploaded and fields mapped",
                "Links uploaded and fields mapped",
                "(Optional) Ranging / Custom Sites / Promotions loaded",
                "DSC brackets and OTO multipliers reviewed",
                "SharePoint URL set (if used)",
                "Logo uploaded (PNG/JPG)",
                "First DISPO loaded with no validation errors",
                "Reports run successfully",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-0.5 text-[var(--color-primary)]">☐</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Section>

          {/* Appendix: shared data */}
          <Section id="shared-data" title="Appendix: channels & store files (shared data)">
            <p>
              This is a <strong>separate, occasional job</strong> — not part of setting up an individual client. You only
              do it when a retailer is new to the system, or when stores change. Everything created here is{" "}
              <strong>shared by every client</strong> that trades in that retailer.
            </p>

            <h3 className="pt-2 font-semibold">Channels</h3>
            <p>
              <strong>Control Centre → Channels.</strong> Main channels (e.g. MAKRO, MASSBUILD, GAME) are created here by
              hand. You generally only add a main channel when a brand-new retailer comes on board.{" "}
              <strong>Sub-channels</strong> (BWH, BEX, BTD, SS, DC, etc.) are <em>not</em> added manually — they&apos;re created
              automatically from the store file (next step).
            </p>
            <Figure src="/guide/channels.png" alt="Channels admin" caption="Control Centre → Channels — main channels listed; sub-channels are auto-created from store files." />

            <h3 className="pt-2 font-semibold">Store files (creates the stores)</h3>
            <p>
              <strong>Control Centre → Store Files.</strong> Upload the retailer&apos;s store master here. On upload the system:
            </p>
            <ul className="list-disc space-y-1.5 pl-6">
              <li>Detects the channel automatically from the file&apos;s <code>Channel</code> column.</li>
              <li>Creates any new <strong>sub-channels</strong> it finds.</li>
              <li>Builds/updates the shared <strong>store master</strong> that all DISPO sites are validated against.</li>
            </ul>
            <p>
              Because this is shared, you load a retailer&apos;s store file <strong>once</strong> — not once per client. Re-upload
              it only when the store list changes.
            </p>
            <Figure src="/guide/store-files.png" alt="Store files upload" />
            <Callout tone="info">
              After this is done, the retailer&apos;s channels and stores are available to every client — so when you set a
              client up you just tick the channels they trade in (step&nbsp;1) and the stores are already there.
            </Callout>
          </Section>

          {/* Appendix: status reference (site-wide) */}
          <Section id="status" title="Appendix: status reference & scenarios (site-wide)">
            <Callout tone="warn">
              This is <strong>not part of client setup</strong>. Status classification is <strong>site-wide and shared
              by every client</strong> — it&apos;s configured per channel, and any channel&apos;s settings apply to all clients
              that trade in that channel. Only <strong>site administrators</strong> can edit it.
            </Callout>
            <p>
              <strong>Status Reference</strong> (in the sidebar) is where DISPO status codes are classified as{" "}
              <strong>Positive</strong>, <strong>Negative</strong> or <strong>Unclassified</strong>. The classification
              decides, for example, whether an out-of-stock line counts as a genuine ordering opportunity. Because the same
              channels are shared across clients, you set this up once for the system — not per client.
            </p>
            <Figure src="/guide/status-reference.png" alt="Status reference page" />
            <ul className="list-disc space-y-1.5 pl-6">
              <li>
                <strong>Status definitions</strong> are set <strong>per channel</strong>. New codes are{" "}
                <em>auto-detected</em> when a DISPO is loaded, and start out <em>Unclassified</em> — a site admin uses the
                channel tabs to review each channel and set Positive / Negative.
              </li>
              <li>
                <strong>Status scenarios</strong> are conditional overrides, also <strong>per channel</strong>. When a status
                code matches a scenario&apos;s conditions — the product&apos;s <em>client status</em> (from the PMF) and/or its{" "}
                <em>ranging status</em> — that classification wins over the plain definition. The most specific match
                (most conditions met) takes priority. Tick <em>&ldquo;Show all channels&apos; scenarios&rdquo;</em> to see every
                channel at once.
              </li>
            </ul>
            <Callout tone="info">
              Everything here is generic across clients. A scenario added to a channel automatically applies to every
              client trading that channel — there&apos;s nothing client-specific to configure during onboarding.
            </Callout>
          </Section>
        </article>
      </div>
    </div>
  );
}
