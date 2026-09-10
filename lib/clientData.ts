import type { Client, ControlFileType, ControlFileMeta } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

const KEY = "clients.json";

/* ── The ONE list of fields the Clients UI may set ──────────────

   Create and update used to carry SEPARATE field lists, and they drifted:
   sendConsolidatedStoreReports was in the update list and missing from
   create, so a tickbox set on the New Client form was silently thrown away
   and only took effect on a later Edit. This app has already shipped that
   exact bug once on the New User form. Both paths derive from here now, so a
   field added for one is a field added for both.

   Not in this list on purpose: `active` and `archivedAt/By` belong to
   setClientArchived(), and `controlFiles` to setControlFileMeta(). They are
   not editable through the client form and must not become settable by
   anything that can POST a JSON body. */
export const CLIENT_EDITABLE_FIELDS = [
  "name",
  "vendorNumbers",
  "camId",
  "channelIds",
  "linkedClientIds",
  "notes",
  "sendConsolidatedStoreReports",
  "sqlClientName",
  "manualControlFileLoad",
] as const;

/* The tickboxes. Listed once so createClient can write every one of them as a
   real false — an absent flag and a false one must not be two different
   states to read. [[three-state-flag-absent-is-not-false]] */
const CLIENT_BOOLEAN_FIELDS = ["sendConsolidatedStoreReports", "manualControlFileLoad"] as const;

export type ClientInput = Partial<Pick<Client, (typeof CLIENT_EDITABLE_FIELDS)[number]>>;

/* Keep only the editable fields, and normalise the ones a stray space would
   break — sqlClientName is a JOIN KEY, and a trailing space there reads as
   "SQL has no data for this client". A key the caller did not send is left
   out entirely rather than written as undefined, so a partial update patches
   instead of blanking. */
function pickClientFields(data: ClientInput): ClientInput {
  const out: Record<string, unknown> = {};
  for (const key of CLIENT_EDITABLE_FIELDS) {
    if (!(key in data)) continue;
    const v = (data as Record<string, unknown>)[key];
    if (key === "name") out[key] = String(v ?? "").trim();
    else if (key === "sqlClientName" || key === "camId" || key === "notes") {
      const t = typeof v === "string" ? v.trim() : v;
      out[key] = t === "" ? undefined : t;
    } else if (key === "vendorNumbers") {
      out[key] = (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean);
    } else if ((CLIENT_BOOLEAN_FIELDS as readonly string[]).includes(key)) {
      // Sent-but-not-true is false, never undefined.
      out[key] = v === true;
    } else out[key] = v;
  }
  return out as ClientInput;
}

const EMPTY_CONTROL_FILES: Record<ControlFileType, ControlFileMeta | null> = {
  pmf: null,
  links: null,
  ranging: null,
  custom_sites: null,
  promotions: null,
};

/**
 * Every client, ALWAYS alphabetical by name.
 *
 * Sorted here rather than in each page: clients are listed in dropdowns and
 * grids on a dozen surfaces, and the blob returns them in creation order, so
 * sorting at the source is what keeps every one of them consistent — including
 * any added later. Locale compare so case and punctuation don't split the list.
 */
export async function getClients(): Promise<Client[]> {
  const clients = await readJson<Client[]>(KEY, []);
  return [...clients].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
  );
}

/**
 * Clients that take part in OPERATIONAL flows — DISPO checklist, the 16:00
 * load-status email, store reports and their crons, DISPO upload targets and
 * the dashboard grid.
 *
 * Archived clients (active:false) are deliberately excluded here but keep all
 * their data and stay selectable in Reports/Charts, which read getClients()
 * directly. If you are adding a new scheduled job or anything that chases
 * people for data, call THIS, not getClients().
 */
export async function getActiveClients(): Promise<Client[]> {
  return (await getClients()).filter((c) => c.active);
}

export async function getClientById(id: string): Promise<Client | null> {
  const clients = await getClients();
  return clients.find((c) => c.id === id) ?? null;
}

/* sqlClientName is set at creation now that the name is PICKED from SQL
   Server's own list — the two are the same string, so the mapping the SQL
   Direct pilot needs exists from the start instead of being typed in later. */
export async function createClient(data: ClientInput & { name: string }): Promise<Client> {
  const clients = await getClients();
  const fields = pickClientFields(data);
  if (!fields.name) throw new Error("A client name is required");
  const client: Client = {
    id: uuid(),
    active: true,
    createdAt: new Date().toISOString(),
    controlFiles: { ...EMPTY_CONTROL_FILES },
    /* Every tickbox written explicitly, so a NEW client is never the odd one
       out with an absent flag where every edited client has a real false. A
       partial UPDATE still patches — this default belongs to create only. */
    ...Object.fromEntries(CLIENT_BOOLEAN_FIELDS.map((k) => [k, false])),
    ...fields,
    name: fields.name,
    vendorNumbers: fields.vendorNumbers ?? [],
    channelIds: fields.channelIds ?? [],
    linkedClientIds: fields.linkedClientIds ?? [],
  };
  clients.push(client);
  await writeJson(KEY, clients);
  return client;
}

/* Only the fields on CLIENT_EDITABLE_FIELDS are applied. The body reaching
   this comes straight off a PUT, so anything else in it — `active`,
   `controlFiles`, `archivedBy` — is dropped rather than written. */
export async function updateClient(id: string, updates: ClientInput): Promise<Client> {
  const clients = await getClients();
  const idx = clients.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error("Client not found");
  clients[idx] = { ...clients[idx], ...pickClientFields(updates) };
  await writeJson(KEY, clients);
  return clients[idx];
}

/**
 * Archive (active:false) or restore a client. Archiving keeps every byte of the
 * client's data — it only takes them out of the operational flows listed on
 * getActiveClients(). Stamps who/when so the Clients page can show it.
 */
export async function setClientArchived(
  id: string,
  archived: boolean,
  byUserName: string,
): Promise<Client> {
  const clients = await getClients();
  const idx = clients.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error("Client not found");
  clients[idx] = {
    ...clients[idx],
    active: !archived,
    archivedAt: archived ? new Date().toISOString() : undefined,
    archivedBy: archived ? byUserName : undefined,
  };
  await writeJson(KEY, clients);
  return clients[idx];
}

/**
 * Removes the client RECORD only. Callers must purge the client's stored data
 * first — see purgeClient() in lib/clientPurge.ts, which is what the DELETE
 * route uses. Calling this on its own orphans every ledger and upload blob.
 */
export async function deleteClient(id: string): Promise<void> {
  const clients = await getClients();
  const filtered = clients.filter((c) => c.id !== id);
  await writeJson(KEY, filtered);
}

export async function setControlFileMeta(
  clientId: string,
  fileType: ControlFileType,
  meta: ControlFileMeta | null
): Promise<void> {
  const clients = await getClients();
  const idx = clients.findIndex((c) => c.id === clientId);
  if (idx === -1) throw new Error("Client not found");
  clients[idx].controlFiles[fileType] = meta;
  await writeJson(KEY, clients);
}
