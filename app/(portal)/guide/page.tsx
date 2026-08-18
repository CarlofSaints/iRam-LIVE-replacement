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
  { id: "data-model", label: "Appendix: how a DISPO becomes a number" },
  { id: "pack-prices", label: "Appendix: the pack-price problem" },
  { id: "troubleshooting", label: "Appendix: when a number looks wrong" },
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
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  // Scroll-spy: highlight the TOC item for the section currently in view
  useEffect(() => {
    const els = SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { rootMargin: "0px 0px -65% 0px", threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">iRam LIVE Guide</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          How to onboard a new client — what each setting means and the order to do it in — plus, in the
          appendices, how DISPO data turns into a report figure and what to check when one looks wrong.
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
              {SECTIONS.map((s) => {
                const active = s.id === activeId;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={active ? "true" : undefined}
                      className={`block rounded-md px-2 py-1 text-sm transition-colors ${
                        active
                          ? "bg-[var(--color-primary)]/10 font-medium text-[var(--color-primary)]"
                          : "text-[var(--color-text-muted)] hover:bg-zinc-100 hover:text-[var(--color-text)]"
                      }`}
                    >
                      {s.label}
                    </a>
                  </li>
                );
              })}
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
                they&apos;re new. A CAM is just a contact record — it&apos;s <em>not</em> a login. When adding one you can tick{" "}
                <em>&ldquo;Also create a portal login&rdquo;</em> to create a matching user account (CAM role) in one step.
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
                <strong>Alert Threshold</strong> (default <strong>90</strong>) — anything at or above this many days is
                flagged <em>&ldquo;ALERT&rdquo;</em> (severely overstocked).
              </li>
            </ul>
            <p>
              The bands in between (0–10, 10–90, 90–150, 150–210, 210–Alert) are fixed, but any band at or above the Alert
              Threshold is superseded by &ldquo;ALERT&rdquo; (so at the default of 90, anything 90+ days reads as ALERT). Most
              clients can leave these at the defaults unless the category behaves very differently.
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

          <Section id="data-model" title="Appendix: how a DISPO becomes a number">
            <p>
              Written up in August 2026 after a run of report defects that all traced back to the same few
              facts about the data. If a number ever looks wrong, start here — most of the surprises live in
              this section rather than in the report code.
            </p>

            <h3 className="pt-2 font-semibold">1. A Makro DISPO lists every product several times</h3>
            <p>
              A Makro-style DISPO carries <strong>one row per Article × Site × unit of measure</strong> —
              EA (each), CS (case), PAL (pallet), LAY (layer), and a <code>**</code> total line. In a typical
              file <em>every</em> Article|Site appears 2–5 times. Sales and stock sit <strong>only on the
              selling-unit (EA) row</strong>; the pack rows carry zero units but <strong>real pack money</strong>:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-zinc-50 p-3 text-xs leading-relaxed">{`uom=EA   SOH=395  Incl SP=48.95     Nett Cost=28.81
uom=CS   SOH=0    Incl SP=1194.95   Nett Cost=720.25     <- case of 25
uom=PAL  SOH=0    Incl SP=(blank)   Nett Cost=25929.00   <- pallet of 900
uom=**   SOH=0    Incl SP=(blank)   Nett Cost=(blank)    <- the file's own total line`}</pre>
            <Callout tone="warn">
              <strong>Never sum a month column straight down a DISPO.</strong> You will roughly double the
              answer. Verigreen&apos;s August file summed to 34,048 units for Aug-2025; the real figure is
              16,812. The report was right and the spreadsheet check was wrong.
            </Callout>
            <p>
              The parser collapses each Article|Site to <strong>one row — the highest-SOH one</strong>, which
              is the selling unit. That happens in <code>collapseUomRows</code> and has been in place since
              30 June 2026.
            </p>
            <Callout tone="info">
              The DISPO also ends with its own <strong>grand-total line</strong> — Article and Site both blank.
              It is ignored when building the ledger, but it will silently inflate anything you total up
              yourself, including in Excel.
            </Callout>

            <h3 className="pt-2 font-semibold">2. Two kinds of column, two different rules</h3>
            <ul className="list-disc space-y-1.5 pl-6">
              <li>
                <strong>Sales columns</strong> (the monthly <code>MM-YYYY</code> ones) are <em>history</em>.
                Every DISPO carrying a month is a valid source for it, so back-loading old files is how gaps
                get filled. These accumulate.
              </li>
              <li>
                <strong>Snapshot columns</strong> (SOH, SOO, SIT, PR ST, RP, MAC, Nett Cost, Incl SP, Prom SP,
                Curr Y/S) are <em>state as at the moment the DISPO was cut</em>. There is one right answer, and
                it belongs to the <strong>most recent report period</strong> — not the most recent upload.
              </li>
            </ul>
            <Callout tone="warn">
              <strong>The week you stamp at upload decides who owns the stock.</strong> Re-load the current
              DISPO stamped Wk1 while the ledger already holds Wk5 and the stock update is correctly rejected —
              the load reports success, sales merge, SOH does not move. From the screen that looks identical to
              a load that worked.
            </Callout>

            <h3 className="pt-2 font-semibold">3. Last year&apos;s Rands use last year&apos;s prices</h3>
            <p>
              When a DISPO is merged, each row&apos;s prices are also stored under the year of its newest month —{" "}
              <code>_inclSP_2025</code>, <code>_promSP_2025</code>, <code>_nettCost_2025</code> — so that
              &ldquo;Same Month LY&rdquo; and &ldquo;LY YTD&rdquo; are valued in the money of the time rather
              than today&apos;s price.
            </p>
            <Callout tone="warn">
              Those stored prices are only ever written by a load whose <strong>newest month is in that
              year</strong>. Nobody re-uploads 2025 DISPOs, so <strong>a wrong value in them never heals by
              itself</strong> — unlike the live price columns, which every load rewrites. That asymmetry is
              what caused the August 2026 problem in the next section.
            </Callout>

            <h3 className="pt-2 font-semibold">4. A row goes to the ledger its STORE belongs to</h3>
            <p>
              You pick one main channel when you upload, but rows are routed per row: each site is looked up in
              the store master, and the row is merged into the ledger of the <strong>main channel that owns
              that site</strong> — not necessarily the one you selected. One DISPO can therefore populate
              several ledgers, and a report run on one main channel will not show the rows that went elsewhere.
            </p>
            <Callout tone="info">
              <strong>Known open issue.</strong> Verigreen&apos;s Walmart stores show zero sales in the MAKRO
              Month-End for exactly this reason: their live data goes to another ledger, and the copies sitting
              in MAKRO are stale rows from before the routing existed. The gap is exact — 106 units in August
              2026. Not yet fixed.
            </Callout>

            <h3 className="pt-2 font-semibold">5. The ledger key is Article | Site</h3>
            <p>
              One row per Article|Site per ledger. Two consequences worth knowing: a product supplied both
              direct and via a DC cannot be held separately (the higher-SOH line wins), and a site code that
              Excel mangled — <code>R001</code> saved as a Rand value becoming <code>R1</code> — is repaired
              against the store master before matching, so it still lines up.
            </p>
          </Section>

          <Section id="pack-prices" title="Appendix: the pack-price problem (August 2026)">
            <p>
              The single largest data defect found so far, kept here because the shape of it will recur.
            </p>

            <h3 className="pt-2 font-semibold">What went wrong</h3>
            <p>
              Before 30 June 2026 the merge folded a product&apos;s per-UOM rows onto one ledger key with the
              last non-blank value winning — so the <strong>case price stuck</strong> (R1,194.95 instead of
              R48.95). The per-year price snapshots captured that. The result: last-year Rand columns reading
              up to <strong>25× too high</strong>, while every unit count stayed correct.
            </p>
            <p>
              Verigreen&apos;s August 2026 Month-End printed <strong>R13,883,224</strong> for Same Month LY
              against a true <strong>R775,072</strong> — R825.81 for a refuse bag.
            </p>
            <Callout tone="tip">
              <strong>The check that found it:</strong> divide the total by its own unit count. A wrong
              aggregate is invisible; a wrong price per unit is obvious to anyone who knows the products.
            </Callout>

            <h3 className="pt-2 font-semibold">What the repair does</h3>
            <p>
              <strong>Control Centre → Data Health → Pack prices in last year&apos;s values.</strong>{" "}
              <em>Check for pack prices</em> is read-only and safe; <em>Repair</em> needs super admin and a
              second confirming click, and takes the upload lock so nobody can load a DISPO while it runs.
            </p>
            <ul className="list-disc space-y-1.5 pl-6">
              <li>
                A stored year-price <strong>3× or more above</strong> the product&apos;s current price is a pack
                price and is deleted. The report then falls back to the current price — out by inflation
                instead of by a factor of 25.
              </li>
              <li>
                A stored price far <strong>below</strong> the current one means the <em>current</em> price is
                the pack one. Those are reported and deliberately left alone — they clear when that
                client&apos;s latest DISPO is re-uploaded.
              </li>
              <li>
                A row with no current price of its own is judged against{" "}
                <strong>the same product&apos;s price at another store</strong> (the median, so a few
                still-bad siblings cannot skew it). Products no store prices at all are reported, never guessed.
              </li>
              <li>Sales, stock and the current price columns are never touched. Running it twice does nothing the second time.</li>
            </ul>
            <Callout tone="warn">
              <strong>Order matters.</strong> Load the latest DISPO <em>first</em>, then run the repair. A
              stored price is judged against the current price, so while the current price is also a pack price
              the two look alike and the bad one is kept. Re-run the repair after any batch of loads.
            </Callout>

            <h3 className="pt-2 font-semibold">Which reports it affects</h3>
            <ul className="list-disc space-y-1.5 pl-6">
              <li><strong>Month-End</strong> — Same Month LY and LY YTD value columns, and every growth % based on them.</li>
              <li><strong>Vital Signs</strong> — the <code>Curr Y/S Value LY</code> column.</li>
              <li><strong>Charts</strong> — the current-vs-prior-year value bars and the 24-month value lines.</li>
              <li><strong>Store Reports</strong> — <em>not</em> affected. It only ever reads current prices.</li>
            </ul>
            <Callout tone="tip">
              <strong>The acceptance test.</strong> Unit growth % and value growth % should roughly agree.
              Verigreen read <strong>+293% on units and −78% on value</strong> for the same period, which
              cannot both be true when prices are stable. If they disagree wildly, the value side is wrong.
            </Callout>
          </Section>

          <Section id="troubleshooting" title="Appendix: when a number looks wrong">
            <p>
              A running order for &ldquo;this figure does not match the DISPO&rdquo;. Each step has caught a real
              defect at least once.
            </p>
            <ol className="list-decimal space-y-2 pl-6">
              <li>
                <strong>Divide the total by its own count.</strong> Rands ÷ units, stores ÷ region, rows ÷ SKU.
                A unit rate that is obviously wrong for the product tells you which half of the calculation to
                look at, in one step.
              </li>
              <li>
                <strong>Check whether the file was loaded before the report was run.</strong> Compare the two
                files&apos; modified times. A DISPO saved after the report was generated explains a small gap
                and nothing else — this nearly sent us hunting a bug that did not exist.
              </li>
              <li>
                <strong>Do not sum the DISPO by hand without collapsing UOM rows</strong> and without excluding
                the file&apos;s own total line. See the appendix above.
              </li>
              <li>
                <strong>Compare unit growth against value growth.</strong> If units say up and value says
                down for the same period, it is a pricing problem, not a sales problem.
              </li>
              <li>
                <strong>Use the Month-End <code>Data</code> sheet as the evidence.</strong> It is the ledger,
                one row per Article|Site, with the prices and every month column. Anything the summary sheets
                claim can be re-derived from it — that is how each of these defects was proven rather than
                guessed at.
              </li>
              <li>
                <strong>Check the report is reading the channel the data went to.</strong> Sales can be in a
                different ledger — see &ldquo;a row goes to the ledger its store belongs to&rdquo; above.
              </li>
              <li>
                <strong>Check the period stamp.</strong> Each Reports card prints the period the sheets and
                filename will use. If stock looks stale, the last load may have been stamped an earlier week
                and correctly refused.
              </li>
              <li>
                <strong>Run the Data Health checks.</strong> Bad descriptions and pack prices both have
                read-only scans there, and the pack-price scan lists <em>every</em> ledger with its row counts —
                useful on its own for seeing which channels a client actually has data in.
              </li>
            </ol>
            <Callout tone="info">
              The Month-End filename names the <strong>vendors actually in the file</strong>. If a client
              trades under several vendor numbers you will see them joined, e.g.{" "}
              <code>1544+9677</code>. Before 17 Aug 2026 it always printed the client&apos;s first vendor
              number regardless of the contents, so older files on SharePoint may be misnamed.
            </Callout>
          </Section>
        </article>
      </div>
    </div>
  );
}
