import { getClients } from "./clientData";
import { getAllSalesLedgers, getSalesLedger } from "./salesData";

// Payment-terms / trading-terms wording that leaked into "Article Desc" when a
// stray column (e.g. Libra's "Descriptio") collided with the real description.
// Product names never read like this, so a match is a strong "junk" signal.
const JUNK_RE =
  /cash discount|baseline date|within\s+\d+\s*days|net\s*\d+\s*days|\d+\s*%\s*(cash|discount)|payment\s*term/i;

export interface LedgerDescIssue {
  clientId: string;
  clientName: string;
  channelId: string;
  channelName: string;
  totalRows: number;
  flaggedRows: number;
  samples: string[]; // a few distinct junk descriptions seen
}

export interface DescAuditReport {
  generatedAt: string;
  metered: boolean;
  affectedClients: string[]; // distinct client names needing a reload
  issues: LedgerDescIssue[]; // per client+channel, only where flaggedRows > 0
}

export async function auditDescriptions(): Promise<DescAuditReport> {
  const generatedAt = new Date().toISOString();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { generatedAt, metered: false, affectedClients: [], issues: [] };
  }

  const clients = await getClients();
  const issues: LedgerDescIssue[] = [];

  for (const client of clients) {
    const ledgers = await getAllSalesLedgers(client.id);
    const perLedger = await Promise.all(
      ledgers.map(async (meta) => {
        const rows = await getSalesLedger(client.id, meta.channelId);
        let flagged = 0;
        const samples = new Set<string>();
        for (const row of rows) {
          const desc = String(row["Article Desc"] ?? "");
          if (desc && JUNK_RE.test(desc)) {
            flagged++;
            if (samples.size < 5) samples.add(desc.trim());
          }
        }
        if (flagged === 0) return null;
        return {
          clientId: client.id,
          clientName: client.name,
          channelId: meta.channelId,
          channelName: meta.channelName ?? meta.channelId,
          totalRows: rows.length,
          flaggedRows: flagged,
          samples: [...samples],
        } as LedgerDescIssue;
      }),
    );
    for (const r of perLedger) if (r) issues.push(r);
  }

  issues.sort((a, b) => b.flaggedRows - a.flaggedRows);
  const affectedClients = [...new Set(issues.map((i) => i.clientName))];

  return { generatedAt, metered: true, affectedClients, issues };
}
