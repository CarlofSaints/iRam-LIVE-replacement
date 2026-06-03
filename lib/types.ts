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
  { key: "manage_clients" as const, label: "Manage Clients" },
  { key: "manage_cams" as const, label: "Manage CAMs" },
  { key: "manage_store_files" as const, label: "Manage Store Control Files" },
  // Data
  { key: "upload_data" as const, label: "Upload Data" },
  { key: "manage_control_files" as const, label: "Manage Client Control Files" },
  { key: "delete_uploads" as const, label: "Delete Uploads" },
  // View
  { key: "view_dashboard" as const, label: "View Dashboard" },
  { key: "view_uploads" as const, label: "View Uploads" },
  { key: "view_activity_log" as const, label: "View Activity Log" },
  { key: "export_data" as const, label: "Export Data" },
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
      "manage_users", "manage_channels", "manage_clients", "manage_cams",
      "manage_store_files", "upload_data", "manage_control_files", "delete_uploads",
      "view_dashboard", "view_uploads", "view_activity_log", "export_data",
    ],
  },
  {
    role: "cam",
    label: "CAM",
    description: "Upload data and manage client control files",
    permissions: [
      "upload_data", "manage_control_files", "view_dashboard", "view_uploads",
    ],
  },
  {
    role: "viewer",
    label: "Viewer",
    description: "Read-only access to dashboards and uploads",
    permissions: ["view_dashboard", "view_uploads"],
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
}

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
  forcePasswordChange?: boolean;
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
  subChannelIds: string[];
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
  status: "processed" | "error";
  errorMessage?: string;
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
}
