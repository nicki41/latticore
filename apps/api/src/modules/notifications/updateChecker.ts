import type { PrismaClient } from "@prisma/client";
import type { ServerSoftware } from "@latticore/shared";
import { getProvider } from "../../minecraft/providers/index.js";
import { logger } from "../../lib/logger.js";
import type { NotificationDispatcherService } from "./notificationDispatcher.service.js";

const CHECK_MS = 6 * 60 * 60_000; // every 6h — a version check is a handful of outbound HTTP calls, no need to poll often
const STARTUP_DELAY_MS = 60_000; // let the app finish booting before the first check

/**
 * Periodically compares each server's installed version against what its
 * provider (see minecraft/providers/) currently resolves as the latest
 * build/loader version for that same Minecraft version — the same lookup
 * the create-server wizard already uses, just re-run against an existing
 * server's pinned mcVersion instead of a fresh install. Vanilla has no
 * separate build number (its provider's loaderVersion is always null), so
 * it's compared by newest stable Minecraft version instead. Forge/NeoForge
 * install-plan resolution isn't implemented yet (see architecture.md) and
 * simply fails the try/catch below — skipped, not reported as an error.
 *
 * lastNotifiedVersion is in-memory only (resets on API restart, same
 * rationale as MetricsHistoryStore) — acceptable since worst case is one
 * repeat notification after a restart, not a growing spam problem.
 */
export class UpdateChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly lastNotifiedVersion = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly dispatcher: NotificationDispatcherService,
  ) {}

  start(): void {
    if (this.timer || this.startupTimer) return;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.checkAll();
      this.timer = setInterval(() => void this.checkAll(), CHECK_MS);
      this.timer.unref?.();
    }, STARTUP_DELAY_MS);
    this.startupTimer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = null;
    this.startupTimer = null;
  }

  private async checkAll(): Promise<void> {
    const servers = await this.prisma.server.findMany({
      where: { runtime: "PANEL_MANAGED" },
      select: { id: true, name: true, software: true, mcVersion: true, buildVersion: true },
    });

    for (const server of servers) {
      // SQLite stores Server.software as a plain string (no native enum) —
      // see the doc comment on Server.software in schema.prisma; only ever
      // written through the create-server wizard's Zod-validated schema.
      await this.checkOne({ ...server, software: server.software as ServerSoftware }).catch((err) =>
        logger.debug({ err, serverId: server.id }, "Update check failed"),
      );
    }
  }

  private async checkOne(server: {
    id: string;
    name: string;
    software: ServerSoftware;
    mcVersion: string;
    buildVersion: string | null;
  }): Promise<void> {
    const provider = getProvider(server.software);

    let latestVersion: string;
    if (server.software === "VANILLA") {
      const versions = await provider.listVersions();
      const latestStable = versions.find((v) => v.stable);
      if (!latestStable || latestStable.id === server.mcVersion) return;
      latestVersion = latestStable.id;
    } else {
      const plan = await provider.resolveInstallPlan(server.mcVersion);
      if (!plan.loaderVersion || plan.loaderVersion === server.buildVersion) return;
      latestVersion = plan.loaderVersion;
    }

    if (this.lastNotifiedVersion.get(server.id) === latestVersion) return; // already notified about this exact version
    this.lastNotifiedVersion.set(server.id, latestVersion);

    await this.dispatcher.dispatch({
      serverId: server.id,
      category: "updateAvailable",
      title: `${server.name}: update available`,
      body: `Version ${latestVersion} is available (currently on ${server.buildVersion ?? server.mcVersion}).`,
    });
  }
}
