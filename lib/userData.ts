import type { User } from "./types";
import { readJson, readJsonStrict, writeJson } from "./blob";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";

const USERS_KEY = "users.json";

export async function getUsers(): Promise<User[]> {
  return readJson<User[]>(USERS_KEY, []);
}

/** For decisions that must FAIL CLOSED (who may see which client's data).
 *  getUsers() turns a failed read into [] — for the store-report poller that
 *  would read as "nobody is restricted" and send every client's data to a
 *  customer's rep. This throws instead, on a failed read AND on a missing file. */
export async function getUsersStrict(): Promise<User[]> {
  const users = await readJsonStrict<User[] | null>(USERS_KEY, null);
  if (!Array.isArray(users)) throw new Error("users.json could not be read");
  return users;
}

export async function getUserById(userId: string): Promise<User | null> {
  const users = await getUsers();
  return users.find((u) => u.id === userId) ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await getUsers();
  return (
    users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null
  );
}

// Email-subscription flags. Kept as one list so create and update can never
// drift apart again — previously createUser silently dropped every one of them,
// so a flag ticked on the New User form only took effect on a later Edit.
const NOTIFY_FLAGS = [
  "receiveStoreAlerts",
  "receiveProductAlerts",
  "receiveStoreReportDigest",
  "receiveActionReport",
  "receiveLoadStatus",
  "receivePortfolioHealth",
] as const;

export type NotifyFlag = (typeof NOTIFY_FLAGS)[number];

/** Picks just the notification flags out of an arbitrary request body. */
export function pickNotifyFlags(src: Record<string, unknown>): Partial<Pick<User, NotifyFlag>> {
  const out: Partial<Pick<User, NotifyFlag>> = {};
  for (const f of NOTIFY_FLAGS) if (typeof src[f] === "boolean") out[f] = src[f] as boolean;
  return out;
}

/** Every notification flag switched off. A Rep only ever gets store reports:
 *  the other mails (Portfolio Stock Health, digests, action report) scope on
 *  the PORTAL client list, where empty means every client. */
export function allNotifyFlagsOff(): Pick<User, NotifyFlag> {
  return Object.fromEntries(NOTIFY_FLAGS.map((f) => [f, false])) as Pick<User, NotifyFlag>;
}

type StoreReportScopeFields = "storeReportOwnClientsOnly" | "storeReportClientIds";

/** Picks the store-report client restriction out of a request body, shared by
 *  create and edit so neither can silently drop it. */
export function pickStoreReportScope(src: Record<string, unknown>): Partial<Pick<User, StoreReportScopeFields>> {
  const out: Partial<Pick<User, StoreReportScopeFields>> = {};
  if (typeof src.storeReportOwnClientsOnly === "boolean") out.storeReportOwnClientsOnly = src.storeReportOwnClientsOnly;
  if (Array.isArray(src.storeReportClientIds)) {
    out.storeReportClientIds = [...new Set(src.storeReportClientIds.filter((c): c is string => typeof c === "string" && c !== ""))];
  }
  return out;
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: User["role"];
  forcePasswordChange: boolean;
  clientIds?: string[];
} & Partial<Pick<User, NotifyFlag | StoreReportScopeFields>>): Promise<User> {
  const users = await getUsers();
  if (users.some((u) => u.email.toLowerCase() === data.email.toLowerCase())) {
    throw new Error(`User with email "${data.email}" already exists`);
  }
  const hash = await bcrypt.hash(data.password, 10);
  const user: User = {
    id: uuid(),
    name: data.name,
    email: data.email.toLowerCase(),
    password: hash,
    role: data.role,
    forcePasswordChange: data.forcePasswordChange,
    active: true,
    createdAt: new Date().toISOString(),
    clientIds: data.clientIds && data.clientIds.length > 0 ? data.clientIds : undefined,
    ...pickNotifyFlags(data as Record<string, unknown>),
    ...pickStoreReportScope(data as Record<string, unknown>),
  };
  users.push(user);
  await writeJson(USERS_KEY, users);
  return user;
}

export async function updateUser(
  userId: string,
  updates: Partial<
    Pick<
      User,
      | "name"
      | "email"
      | "role"
      | "active"
      | "forcePasswordChange"
      | "lastLoginAt"
      | "profilePicUrl"
      | NotifyFlag
      | StoreReportScopeFields
      | "clientIds"
    >
  >
): Promise<User> {
  const users = await getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");
  users[idx] = { ...users[idx], ...updates };
  await writeJson(USERS_KEY, users);
  return users[idx];
}

export async function setUserPassword(
  userId: string,
  newPassword: string,
  forceChange = false
): Promise<void> {
  const users = await getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");
  users[idx].password = await bcrypt.hash(newPassword, 10);
  users[idx].forcePasswordChange = forceChange;
  await writeJson(USERS_KEY, users);
}

export async function deleteUser(userId: string): Promise<void> {
  const users = await getUsers();
  const filtered = users.filter((u) => u.id !== userId);
  await writeJson(USERS_KEY, filtered);
}

export async function verifyPassword(
  user: User,
  plainPassword: string
): Promise<boolean> {
  return bcrypt.compare(plainPassword, user.password);
}
