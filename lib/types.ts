/* ──────────────────────────────────────────────────────────────
   iRam LIVE — Shared Types
   ────────────────────────────────────────────────────────────── */

// ── Roles ──

export type UserRole = "super_admin" | "admin" | "cam" | "viewer" | (string & {});

export const SYSTEM_ROLES = ["super_admin", "admin", "cam", "viewer"] as const;

// ── Permissions (Clippa pattern) ──

export interface PermissionDef {
  key: PermissionKey;
  label: string;
}

export const ALL_PERMISSIONS = [
  // Admin
  { key: "manage_users" as const, label: "Manage Users" },
  { key: "manage_roles" as const, label: "Manage Roles" },
  { key: "manage_channels" as const, label: "Manage Channels" },
  { key: "manage_clients" as const, label: "Manage Clients (add / edit / archive)" },
  /* Split out of manage_clients on 6 Aug 2026. Adding a client and destroying
     one are not the same act: a CAM needs the first to do their job, and the
     second is irreversible — it purges every ledger, upload and control file
     the client has. Granting add/edit should never imply the ability to
     delete. Archive stays under manage_clients: it is reversible and keeps
     all the data. */
  { key: "delete_clients" as const, label: "Delete Clients (permanent, purges all data)" },
  { key: "manage_cams" as const, label: "Manage CAMs" },
  { key: "manage_store_files" as const, label: "Manage Store Control Files" },
  { key: "manage_statuses" as const, label: "Manage Status Definitions" },
  // Data
  { key: "upload_data" as const, label: "Upload Data" },
  { key: "manage_control_files" as const, label: "Manage Client Control Files" },
  { key: "delete_uploads" as const, label: "Delete Uploads" },
  { key: "manage_store_reports" as const, label: "Manage Store Reports (arm/exclude/send)" },
  // View
  { key: "view_dashboard" as const, label: "View Dashboard" },
  { key: "view_uploads" as const, label: "View Uploads" },
  { key: "view_activity_log" as const, label: "View Activity Log" },
  { key: "view_charts" as const, label: "View Charts" },
  { key: "download_templates" as const, label: "Download Control File Templates" },
  { key: "export_data" as const, label: "Export Data" },
  /* SQL Direct pilot — reads DISPO / store / product data straight from SQL
     Server instead of the manual uploads, so it can be compared against what
     is loaded today before anything switches over. Deliberately absent from
     the admin / CAM / viewer permission lists below: super_admin's list is
     computed from ALL_PERMISSIONS, so this lands on the super admin ONLY and
     mergeRoleDefaults will not grant it to any other role. That is what keeps
     the pilot invisible to the team without hard-coding anyone's user id. */
  { key: "view_sql_pilot" as const, label: "SQL Direct (pilot) — super admin only" },
] as const;

export type PermissionKey = (typeof ALL_PERMISSIONS)[number]["key"];

export interface RoleDefinition {
  role: string;
  label: string;
  description: string;
  permissions: PermissionKey[];
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    role: "super_admin",
    label: "Super Admin",
    description: "Full unrestricted access",
    permissions: ALL_PERMISSIONS.map((p) => p.key) as PermissionKey[],
  },
  {
    role: "admin",
    label: "Admin",
    description: "Manage clients, channels, data, and users",
    permissions: [
      "manage_users", "manage_channels", "manage_clients", "delete_clients", "manage_cams",
      "manage_store_files", "manage_statuses", "upload_data", "manage_control_files",
      "delete_uploads", "manage_store_reports", "view_dashboard", "view_uploads", "view_activity_log", "view_charts", "download_templates", "export_data",
    ],
  },
  {
    role: "cam",
    label: "CAM",
    description: "Upload data and manage client control files",
    permissions: [
      "upload_data", "manage_control_files", "manage_store_reports", "view_dashboard", "view_uploads", "view_charts", "download_templates",
    ],
  },
  {
    role: "viewer",
    label: "Viewer",
    description: "Read-only access to dashboards and uploads",
    permissions: ["view_dashboard", "view_uploads", "view_charts"],
  },
  {
    role: "client",
    label: "Client",
    description: "External client — charts for their assigned client(s) only",
    permissions: ["view_charts"],
  },
];

export interface RolePermissions {
  role: string;
  permissions: PermissionKey[];
}

// ── Users ──

export interface User {
  id: string;
  name: string;
  email: string;
  password: string; // bcrypt hash
  role: string;
  forcePasswordChange: boolean;
  active: boolean;
  createdAt: string; // ISO
  lastLoginAt?: string; // ISO
  profilePicUrl?: string;
  receiveStoreAlerts?: boolean;
  receiveProductAlerts?: boolean;  // gets missing-article (LINKS/PMF) validation emails on DISPO load
  receiveStoreReportDigest?: boolean;  // gets the daily store-report engagement digest
  receiveActionReport?: boolean;       // gets the weekly rep action-claim spreadsheet (manager/CAM)
  receiveLoadStatus?: boolean;         // gets the 16:00 weekday "who hasn't loaded a DISPO this week" status email
  // Client scoping — when non-empty, this user may only see data for these
  // client IDs (external "client" accounts). Empty/undefined = all clients.
  clientIds?: string[];
}

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
  forcePasswordChange?: boolean;
  profilePicUrl?: string;
  clientIds?: string[];
}

// ── Password Reset ──

export interface PasswordResetToken {
  token: string;
  email: string;
  expiresAt: string; // ISO
  used: boolean;
}

// ── Channels ──

export interface Channel {
  id: string;
  name: string;
  parentId?: string;
  active: boolean;
  createdAt: string; // ISO
  // For a MAIN channel: other main channels whose stores arrive inside THIS
  // channel's DISPO export (e.g. Makro's export also carries Walmart sites).
  // When a DISPO is loaded for this channel, sites are validated against this
  // channel + its companions' store masters, and rows are split per site's own
  // channel into the matching ledger.
  companionChannelIds?: string[];
}

// ── CAMs ──

export interface CAM {
  id: string;
  name: string;
  surname: string;
  email: string;
  cell: string;
  active: boolean;
  createdAt: string; // ISO
}

// ── Store Control Files ──

export interface StoreControlFile {
  id: string;
  fileName: string;
  mainChannelIds: string[];
  uploadedAt: string;
  uploadedBy: string;
  rowCount: number;
}

export interface StoreRecord {
  siteNum: string;
  storeName: string;
  channel: string;
  subChannel: string;
  country?: string;
  province?: string;
  townCity?: string;
  address?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  status: string;
  openedDate?: string;
  top100?: boolean;
  type?: string;
  clusterCode?: string;
  clusterName?: string;
  clusterGroup?: string;
  tags?: string;
}

// ── Clients ──

export type ControlFileType = "pmf" | "links" | "ranging" | "custom_sites" | "promotions";

export interface ControlFileMeta {
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  rowCount: number;
}

export interface Client {
  id: string;
  name: string;
  vendorNumbers: string[];
  active: boolean;
  createdAt: string; // ISO
  camId?: string;
  channelIds: string[];
  linkedClientIds: string[];
  controlFiles: Record<ControlFileType, ControlFileMeta | null>;
  notes?: string;
  /* This client's name on the SQL Server side (SQL Direct pilot).
     SQL keys every stored procedure on a client NAME string and uses short
     trading names where iRam uses full legal ones — "BISCO" vs "BISCO PLUS
     (PTY) LTD" — so only 1 of 30 clients matched by name alone. A wrong or
     missing name is indistinguishable from "SQL has no data for this client",
     which is why this is set explicitly rather than guessed by fuzzy match. */
  sqlClientName?: string;
  // When true, this client's data is pooled into the consolidated store
  // reports emailed to reps (see the Send Store Reports module).
  sendConsolidatedStoreReports?: boolean;
  // Archive = active:false. All data is retained and stays readable in
  // Reports/Charts, but the client drops out of every operational flow
  // (DISPO checklist, load-status email, store reports, crons, uploads,
  // dashboard). See getActiveClients() in lib/clientData.ts.
  archivedAt?: string;   // ISO
  archivedBy?: string;   // user name who archived it
}

// ── Uploads ──

export type FileType = "dispo" | "aged_stock";

export interface UploadMeta {
  id: string;
  clientId: string;
  clientName: string;
  channelId: string;
  channelName: string;
  subChannelId?: string;
  subChannelName?: string;
  fileType: FileType;
  fileName: string;
  uploadDate: string;
  uploadedBy: string;
  uploadedByName: string;
  vendorNumber: string;
  period: string;
  rowCount: number;
  dateColumns: string[];
  reportYear?: number;
  reportMonth?: number;
  reportWeek?: number;
  status: "processed" | "error";
  errorMessage?: string;
}

// ── Sales Ledger ──

export interface SalesLedgerMeta {
  clientId: string;
  clientName: string;
  channelId: string; // sub-channel ID (or main channel if no sub)
  channelName: string;
  vendorNumber: string;
  totalRows: number;
  dateColumns: string[]; // normalized MM-YYYY format
  mergedUploadIds: string[];
  lastMergedAt: string; // ISO timestamp
  reportYear?: number;
  reportMonth?: number;
  reportWeek?: number;
}

// ── Product Master ──

export interface ProductFieldMapping {
  clientProductId: string; // which PMF column = Client Product ID (global SKU key, joins to LINKS)
  brand?: string;          // which PMF column = Brand
  category?: string;       // which PMF column = Category
  subCategory?: string;    // which PMF column = Sub Category
  status?: string;         // which PMF column = Product Status (Active/Discontinued)
  description?: string;    // which PMF column = Product Description
  barcode?: string;        // which PMF column = Barcode/EAN
}

export interface ProductMaster {
  clientProductId: string; // Client Product ID (global key — joins to LINKS, NOT Article)
  brand?: string;
  category?: string;
  subCategory?: string;
  status?: string;
  description?: string;
  barcode?: string;
}

// ── Links Field Mapping ──

export interface LinksFieldMapping {
  article: string;          // which LINKS column = Article (channel-specific, joins to DISPO)
  clientProductId: string;  // which LINKS column = Client Product ID (joins to PMF)
}

// ── Status Definitions ──

export type StatusClassification = "POSITIVE" | "NEGATIVE" | "UNCLASSIFIED";

export interface StatusDefinition {
  id: string;
  code: string;               // normalized: UPPERCASE, trimmed
  channelId: string;           // main channel ID
  classification: StatusClassification;
  description: string;
  notes?: string;
  autoDetected: boolean;       // true = surfaced from DISPO upload scan
  createdAt: string;
  updatedAt: string;
}

// ── Status Scenarios (conditional classification) ──

export interface StatusScenarioConditions {
  /** One or more PMF statuses (e.g. ["ACTIVE", "DISCONTINUED"]). The row
   *  matches if its PMF status is ANY of these. Empty/absent = any status. */
  clientStatuses?: string[];
  /** @deprecated Single-status form, kept so scenarios saved before
   *  multi-select still evaluate. Read via `scenarioClientStatuses()`, never
   *  directly — anything saved from now on writes `clientStatuses`. */
  clientStatus?: string;
  rangingStatus?: boolean;     // from ranging control file (true/false)
}

export interface StatusScenario {
  id: string;
  statusCode: string;         // DISPO status code (normalized uppercase)
  channelId: string;          // main channel ID this scenario applies to
  conditions: StatusScenarioConditions;
  classification: "POSITIVE" | "NEGATIVE";
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Store-Report Sends (per-store report log + dedup ledger) ──

export interface StoreReportIncludedStream {
  clientId: string;
  clientName: string;
  channel: string;
  vendor: string;
}

export interface StoreReportSend {
  id: string;
  periodKey: string;            // armed week the send belongs to (year-MM-week)
  siteCode: string;
  storeName: string;
  repEmail: string;
  visitGuid: string;            // dedupes Perigee's duplicate check-in/check-out fires
  sentAt: string;               // ISO
  status: "sent" | "failed" | "skipped_no_data";
  includedStreams: StoreReportIncludedStream[];
  error?: string;
}

// ── Activity Log ──

export interface LogEntry {
  id: string;
  timestamp: string; // ISO
  userId: string;
  userName: string;
  action: string;
  details?: string;
  status?: "success" | "error";
  clientId?: string;   // set on client-scoped actions (DISPO / control-file loads, etc.)
  clientName?: string; // denormalised for filtering/display without a client lookup
}
