import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachConsoleSession } from "./AttachConsoleSession.js";

/** Minimal fake matching the slice of dockerode's Container that AttachConsoleSession actually calls. */
function makeFakeContainer(backlogText = "") {
  const stream = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
  stream.write = vi.fn();
  stream.destroy = vi.fn();

  return {
    logs: vi.fn(async () => Buffer.from(backlogText)),
    attach: vi.fn(async () => stream),
    // Test-only escape hatch — production code never reaches into this.
    __stream: stream,
     
  } as any;
}

function emitLine(container: ReturnType<typeof makeFakeContainer>, text: string): void {
  container.__stream.emit("data", Buffer.from(`${text}\n`));
}

describe("AttachConsoleSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds the backlog from a one-shot non-follow logs() call on open", async () => {
    const container = makeFakeContainer("line one\nline two\n");
    const session = new AttachConsoleSession(container);
    await session.open();

    expect(container.logs).toHaveBeenCalledWith(expect.objectContaining({ follow: false, tail: 200 }));
    expect(session.getBacklog().map((l) => l.text)).toEqual(["line one", "line two"]);
  });

  it("broadcasts every live line to onLine subscribers, ANSI intact", async () => {
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const seen: string[] = [];
    session.onLine((line) => seen.push(line.text));
    emitLine(container, "[32mHello[0m");

    expect(seen).toEqual(["[32mHello[0m"]);
  });

  it("resolves a 'list' command against a real, timestamp-prefixed console line, stripped of ANSI and the log prefix", async () => {
    // Real captured shape (verified against an actual server, not assumed):
    // "[09:47:18] [Server thread/INFO]: There are 0 of a max of 20 players online: ".
    // A response value that still carried this prefix silently broke
    // PlayerActivityTracker.parseOnlineNames()/PlayerService.getOnlinePlayerNames()
    // (both split on the *first* colon, landing inside the timestamp) --
    // this test pins the exact real format so that regression can't return.
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const pending = session.sendCommand("list");
    expect(container.__stream.write).toHaveBeenCalledWith("list\n");

    emitLine(container, "[09:47:18] [32m[Server thread/INFO]: There are 2 of a max of 20 players online: Alice, Bob[0m");
    await expect(pending).resolves.toBe("There are 2 of a max of 20 players online: Alice, Bob");
  });

  it("resolves a 'list' command against Paper's single-bracket log format too (no thread name, different shape than Vanilla's)", async () => {
    // Real bug: Paper logs "[13:57:58 INFO]: ..." (one bracket, no thread
    // name) — different from Vanilla's "[HH:MM:SS] [Thread/LEVEL]: " tested
    // above. A fixed-prefix-strip regex tuned for Vanilla's shape left this
    // one untouched, and PlayerActivityTracker's naive first-colon split
    // then treated the entire raw line as a "player name" — briefly showing
    // a fake online player named after the garbled log line in production.
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const pending = session.sendCommand("list");
    emitLine(container, "[13:58:32 INFO]: There are 0 of a max of 20 players online: ");

    await expect(pending).resolves.toBe("There are 0 of a max of 20 players online: ");
  });

  it("never hides a matched line from the live feed (raw, prefix intact) even though the resolved value is prefix-stripped", async () => {
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const seen: string[] = [];
    session.onLine((line) => seen.push(line.text));
    const pending = session.sendCommand("list");
    emitLine(container, "[09:47:18] [Server thread/INFO]: There are 0 of a max of 20 players online: ");

    await expect(pending).resolves.toBe("There are 0 of a max of 20 players online: ");
    expect(seen).toEqual(["[09:47:18] [Server thread/INFO]: There are 0 of a max of 20 players online: "]);
  });

  it("falls back to quiet-window capture for any command other than list (nothing reads its return value in practice)", async () => {
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const pending = session.sendCommand("op Steve");
    emitLine(container, "Made Steve a server operator");
    await vi.advanceTimersByTimeAsync(400);

    await expect(pending).resolves.toBe("Made Steve a server operator");
  });

  it("serializes commands — a second command isn't written until the first settles", async () => {
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const first = session.sendCommand("list");
    const second = session.sendCommand("op Steve");
    expect(container.__stream.write).toHaveBeenCalledTimes(1);
    expect(container.__stream.write).toHaveBeenCalledWith("list\n");

    emitLine(container, "There are 0 of a max of 20 players online:");
    await first;

    expect(container.__stream.write).toHaveBeenCalledWith("op Steve\n");
    emitLine(container, "Made Steve a server operator");
    await vi.advanceTimersByTimeAsync(400);
    await expect(second).resolves.toBe("Made Steve a server operator");
  });

  it("strips embedded newlines from a command before writing (raw stdin has no packet framing to prevent injection)", async () => {
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    void session.sendCommand("say hello\nop Steve");
    expect(container.__stream.write).toHaveBeenCalledWith("say hello op Steve\n");
  });

  it("rejects a command that times out with no matching response", async () => {
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const pending = session.sendCommand("list", { timeoutMs: 1000 });
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("rejects every queued command immediately when the attach stream ends", async () => {
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const first = session.sendCommand("list");
    const second = session.sendCommand("op Steve");
    container.__stream.emit("close");

    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
  });

  it("fires onClose exactly once when the stream ends", async () => {
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const onClose = vi.fn();
    session.onClose(onClose);
    container.__stream.emit("close");
    container.__stream.emit("end");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close() rejects any pending command and stops delivering lines", async () => {
    const container = makeFakeContainer();
    const session = new AttachConsoleSession(container);
    await session.open();

    const pending = session.sendCommand("list");
    session.close();

    await expect(pending).rejects.toThrow();
    expect(session.isOpen).toBe(false);
  });

  describe("silent commands", () => {
    it("suppresses a silent command's echo and response from onLine — background polling shouldn't spam the console", async () => {
      const container = makeFakeContainer();
      const session = new AttachConsoleSession(container);
      await session.open();

      const seen: string[] = [];
      session.onLine((line) => seen.push(line.text));

      const pending = session.sendCommand("list", { silent: true });
      emitLine(container, "list"); // the pty's own echo of what was written
      emitLine(container, "[13:58:32 INFO]: There are 0 of a max of 20 players online: ");

      await expect(pending).resolves.toBe("There are 0 of a max of 20 players online: ");
      expect(seen).toEqual([]);
    });

    it("still resolves the caller's promise normally even though the console never sees it", async () => {
      const container = makeFakeContainer();
      const session = new AttachConsoleSession(container);
      await session.open();

      const pending = session.sendCommand("op Steve", { silent: true });
      emitLine(container, "Made Steve a server operator");
      await vi.advanceTimersByTimeAsync(400);

      await expect(pending).resolves.toBe("Made Steve a server operator");
    });

    it("a non-silent command queued right after a silent one is still fully visible", async () => {
      const container = makeFakeContainer();
      const session = new AttachConsoleSession(container);
      await session.open();

      const seen: string[] = [];
      session.onLine((line) => seen.push(line.text));

      const silent = session.sendCommand("list", { silent: true });
      emitLine(container, "[13:58:32 INFO]: There are 0 of a max of 20 players online: ");
      await silent;

      const visible = session.sendCommand("say hi"); // e.g. a user-typed console command
      emitLine(container, "[Not Secure] [Server] hi");
      await vi.advanceTimersByTimeAsync(400);
      await visible;

      expect(seen).toEqual(["[Not Secure] [Server] hi"]);
    });
  });
});
