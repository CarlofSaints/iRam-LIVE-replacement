"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/useAuth";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const topNav: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
    ),
  },
  {
    label: "Data Load",
    href: "/data-load",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
    ),
  },
  {
    label: "Clients",
    href: "/clients",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
    ),
  },
  {
    label: "Status Reference",
    href: "/status-reference",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
    ),
  },
  {
    label: "Reports",
    href: "/reports",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
    ),
  },
  {
    label: "Charts",
    href: "/charts",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
    ),
  },
];

const controlCentreNav: NavItem[] = [
  {
    label: "Channels",
    href: "/control-centre/channels",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
    ),
  },
  {
    label: "Store Files",
    href: "/control-centre/store-files",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
    ),
  },
  {
    label: "CAMs",
    href: "/control-centre/cams",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
    ),
  },
  {
    label: "Users",
    href: "/control-centre/users",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
    ),
  },
  {
    label: "Roles & Permissions",
    href: "/control-centre/roles",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
    ),
  },
];

const bottomNav: NavItem[] = [
  {
    label: "Activity Log",
    href: "/activity-log",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
    ),
  },
  {
    label: "Account",
    href: "/account",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
    ),
  },
];

function NavLink({ item, collapsed }: { item: NavItem; collapsed?: boolean }) {
  const pathname = usePathname();
  const active =
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
          : "text-[var(--color-text-muted)] hover:bg-zinc-100 hover:text-[var(--color-text)]"
      } ${collapsed ? "pl-8" : ""}`}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [ccOpen, setCcOpen] = useState(
    pathname.startsWith("/control-centre")
  );

  return (
    <aside className="flex h-full w-60 flex-col border-r border-[var(--color-border)] bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-primary)] text-sm font-bold text-white">
          L
        </div>
        <div>
          <div className="text-sm font-bold text-[var(--color-text)]">
            iRam LIVE
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            OuterJoin
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          {topNav.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>

        {/* Control Centre — collapsible */}
        <div className="mt-4">
          <button
            onClick={() => setCcOpen(!ccOpen)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:bg-zinc-50"
          >
            <span>Control Centre</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${ccOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {ccOpen && (
            <div className="mt-0.5 space-y-0.5">
              {controlCentreNav.map((item) => (
                <NavLink key={item.href} item={item} collapsed />
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 space-y-0.5">
          {bottomNav.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>
      </nav>

      {/* User footer */}
      {user && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              {user.profilePicUrl ? (
                <img src={user.profilePicUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-bold text-white">
                  {user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--color-text)]">
                  {user.name}
                </div>
                <div className="truncate text-xs text-[var(--color-text-muted)]">
                  {user.role.replace("_", " ")}
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              className="ml-2 rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-zinc-100 hover:text-red-600"
              title="Sign out"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
