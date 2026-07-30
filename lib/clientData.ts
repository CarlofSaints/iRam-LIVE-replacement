import type { Client, ControlFileType, ControlFileMeta } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

const KEY = "clients.json";

const EMPTY_CONTROL_FILES: Record<ControlFileType, ControlFileMeta | null> = {
  pmf: null,
  links: null,
  ranging: null,
  custom_sites: null,
  promotions: null,
};

export async function getClients(): Promise<Client[]> {
  return readJson<Client[]>(KEY, []);
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

export async function createClient(data: {
  name: string;
  vendorNumbers: string[];
  camId?: string;
  channelIds: string[];
  linkedClientIds?: string[];
  notes?: string;
}): Promise<Client> {
  const clients = await getClients();
  const client: Client = {
    id: uuid(),
    name: data.name.trim(),
    vendorNumbers: data.vendorNumbers.map((v) => v.trim()).filter(Boolean),
    active: true,
    createdAt: new Date().toISOString(),
    camId: data.camId,
    channelIds: data.channelIds,
    linkedClientIds: data.linkedClientIds ?? [],
    controlFiles: { ...EMPTY_CONTROL_FILES },
    notes: data.notes,
  };
  clients.push(client);
  await writeJson(KEY, clients);
  return client;
}

export async function updateClient(
  id: string,
  updates: Partial<
    Pick<
      Client,
      | "name"
      | "vendorNumbers"
      | "active"
      | "camId"
      | "channelIds"
      | "linkedClientIds"
      | "controlFiles"
      | "notes"
      | "sendConsolidatedStoreReports"
    >
  >
): Promise<Client> {
  const clients = await getClients();
  const idx = clients.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error("Client not found");
  clients[idx] = { ...clients[idx], ...updates };
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
