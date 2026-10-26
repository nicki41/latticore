import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, matchPath } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  PlusCircle,
  Puzzle,
  Users,
  ShieldCheck,
  ScrollText,
  Settings,
  Gauge,
  SquareTerminal,
  FolderOpen,
  Blocks,
  UsersRound,
  SlidersHorizontal,
  Archive,
  CalendarClock,
  Network,
  ChevronRight,
  Waypoints,
} from "lucide-react";
import { isProxySoftware, type Permission, type ServerSoftware } from "@minecraftpanel/shared";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useServers } from "@/lib/servers";
import { StatusDot } from "@/components/servers/StatusBadge";
import { Logo } from "./Logo";

type ServerNavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };

const SERVER_NAV_SECTIONS: { title: string; items: ServerNavItem[] }[] = [
  {
    title: "Monitor",
    items: [
      { to: "overview", label: "Overview", icon: Gauge },
      { to: "console", label: "Console", icon: SquareTerminal },
    ],
  },
  {
    title: "Manage",
    items: [
      { to: "files", label: "Files", icon: FolderOpen },
      { to: "plugins", label: "Plugins/Mods", icon: Blocks },
      { to: "players", label: "Players", icon: UsersRound },
    ],
  },
  {
    title: "Automation",
    items: [
      { to: "backups", label: "Backups", icon: Archive },
      { to: "scheduler", label: "Scheduler", icon: CalendarClock },
    ],
  },
  {
    title: "Configuration",
    items: [{ to: "settings", label: "Settings", icon: SlidersHorizontal }],
  },
];

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  /** Hidden unless the user holds this global permission (Owner always sees everything). */
  permission?: Permission;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  { items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard, end: true }] },
  {
    title: "Servers",
    items: [
      { to: "/servers/networks", label: "Networks", icon: Waypoints, permission: "servers.view" },
      { to: "/servers/allocations", label: "Allocations", icon: Network, permission: "servers.view" },
      { to: "/servers/new", label: "Create Server", icon: PlusCircle, permission: "servers.create" },
    ],
  },
  {
    title: "Tools",
    items: [{ to: "/modrinth", label: "Modrinth", icon: Puzzle, permission: "plugins.view" }],
  },
  {
    title: "Admin",
    items: [
      { to: "/admin/users", label: "Users", icon: Users, permission: "users.view" },
      { to: "/admin/roles", label: "Roles", icon: ShieldCheck, permission: "roles.view" },
      { to: "/admin/audit-log", label: "Audit Log", icon: ScrollText, permission: "audit.view" },
    ],
  },
  {
    title: "System",
    items: [{ to: "/settings", label: "Settings", icon: Settings }],
  },
];

interface SidebarProps {
  /** Desktop (≥md) collapse state — shrinks the flex-row aside to zero width. */
  collapsed?: boolean;
  /** Mobile (<md) off-canvas drawer state — slides in as a fixed overlay. */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const SWIPE_CLOSE_THRESHOLD_PX = 60;
const NON_SERVER_PATHS = new Set(["new", "allocations", "networks"]);

/** Proxies have no players of their own; they get a Network tab in that slot instead. */
function serverNavSections(software: ServerSoftware | undefined) {
  if (!software || !isProxySoftware(software)) return SERVER_NAV_SECTIONS;
  return SERVER_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item): ServerNavItem => (item.to === "players" ? { to: "network", label: "Network", icon: Waypoints } : item)),
  }));
}

export function Sidebar({ collapsed = false, mobileOpen = false, onCloseMobile }: SidebarProps) {
  const { hasPermission } = useAuth();
  const location = useLocation();
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);

  // Close the drawer on Escape while it's open.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseMobile?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    touchDeltaX.current = 0;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || !e.touches[0]) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };
  const handleTouchEnd = () => {
    if (touchDeltaX.current < -SWIPE_CLOSE_THRESHOLD_PX) onCloseMobile?.();
    touchStartX.current = null;
    touchDeltaX.current = 0;
  };

  // "/servers/new", "/servers/allocations" and "/servers/networks" also match
  // this splat pattern — excluded explicitly since those are the creation
  // wizard and instance-wide pages, not an existing server.
  const serverMatch = matchPath("/servers/:id/*", location.pathname);
  const serverId =
    serverMatch && !NON_SERVER_PATHS.has(serverMatch.params.id ?? "") ? serverMatch.params.id : undefined;

  const [allServersOpen, setAllServersOpen] = useState(() => Boolean(serverId));
  const { data } = useServers();
  const servers = data?.servers ?? [];

  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.permission || hasPermission(item.permission)),
    }))
    .filter((section) => section.items.length > 0);

  const canViewServers = hasPermission("servers.view");

  return (
    <>
      {/* Mobile-only backdrop — tapping it closes the drawer, same as swipe/Escape. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          // Mobile (<md): always position:fixed (out of the flex-row layout
          // flow regardless of open/closed) and slid on/off screen via
          // transform, so open/close animates smoothly with no layout jump.
          "fixed inset-y-0 left-0 z-50 flex h-full w-72 flex-col border-r border-border bg-card shadow-2xl transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop (md+): back in normal flow, original collapse-to-zero-width behavior.
          "md:static md:z-auto md:w-64 md:translate-x-0 md:shadow-none md:transition-[width] md:duration-200",
          collapsed && "md:w-0 md:overflow-hidden md:border-r-0",
        )}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <Link to="/" onClick={onCloseMobile} className="flex h-14 shrink-0 items-center gap-2 px-4 hover:bg-accent/50">
        <Logo className="h-7 w-7 shrink-0" />
        <span className="text-sm font-semibold tracking-tight">
          mine<span className="font-bold text-primary">controller</span>
        </span>
      </Link>

      {serverId ? (
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 scrollbar-thin">
          {serverNavSections(servers.find((s) => s.id === serverId)?.software).map((section) => (
            <div key={section.title}>
              <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={`/servers/${serverId}/${item.to}`}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      ) : (
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 scrollbar-thin">
          {visibleSections.map((section, i) => (
            <div key={i}>
              {section.title && (
                <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.title === "Servers" && canViewServers && (
                  <div>
                    <button
                      type="button"
                      aria-expanded={allServersOpen}
                      onClick={() => setAllServersOpen((v) => !v)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Server className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate text-left">All Servers</span>
                      <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", allServersOpen && "rotate-90")} />
                    </button>

                    {allServersOpen && servers.length > 0 && (
                      <div className="ml-4 space-y-0.5 border-l border-border pl-2.5">
                        {servers.map((server) => (
                          <NavLink
                            key={server.id}
                            to={`/servers/${server.id}`}
                            className={({ isActive }) =>
                              cn(
                                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                                isActive
                                  ? "bg-primary/15 font-medium text-primary"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                              )
                            }
                          >
                            <StatusDot status={server.status} />
                            <span className="truncate">{server.name}</span>
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      )}
      </aside>
    </>
  );
}
