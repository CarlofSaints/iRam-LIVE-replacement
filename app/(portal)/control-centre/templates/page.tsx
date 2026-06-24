const TEMPLATES: {
  file: string;
  downloadName: string;
  title: string;
  controlFile: string;
  description: string;
}[] = [
  {
    file: "/templates/client-product-management.xlsx",
    downloadName: "CLIENT Product Management.xlsx",
    title: "Product Management (PMF)",
    controlFile: "PMF control file",
    description:
      "The product master — one row per client product, with the columns used to map brand, category, costs and selling prices.",
  },
  {
    file: "/templates/client-product-links.xlsx",
    downloadName: "CLIENT Product Links.xlsx",
    title: "Product Links",
    controlFile: "Links control file",
    description:
      "Bridges channel-specific article numbers (from the DISPO) to the global Client Product IDs in the PMF.",
  },
  {
    file: "/templates/client-range-management.xlsx",
    downloadName: "CLIENT Range Management.xlsx",
    title: "Range Management",
    controlFile: "Ranging control file",
    description:
      "Defines which products are ranged per site (long format). Drives the Numerical Distribution report's Scenario 1.",
  },
  {
    file: "/templates/client-custom-store-list.xlsx",
    downloadName: "CLIENT Custom Store List.xlsx",
    title: "Custom Store List",
    controlFile: "Custom Sites control file",
    description:
      "Client-specific store/site overrides layered on top of the global store master.",
  },
  {
    file: "/templates/client-promotions-management.xlsx",
    downloadName: "CLIENT Promotions Management.xlsx",
    title: "Promotions Management",
    controlFile: "Promotions control file",
    description:
      "Promotional pricing and periods per article, used in value-of-sales calculations.",
  },
];

function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export default function TemplatesPage() {
  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Control File Templates</h1>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-[var(--color-text-muted)]">
        Blank master templates for each client control file. Download the one you need, fill it in,
        then upload it on the client&apos;s <span className="font-medium">Control Files</span> tab.
        Keep the column headers exactly as they appear in the template.
      </p>

      <div className="space-y-3">
        {TEMPLATES.map((t) => (
          <div
            key={t.file}
            className="flex items-start justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-white p-5"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">{t.title}</h3>
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
                  {t.controlFile}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">{t.description}</p>
            </div>
            <a
              href={t.file}
              download={t.downloadName}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]"
            >
              <DownloadIcon />
              Download
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
