import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAndVerify } from "./download.js";

const ALLOWED = new Set(["trusted.example"]);

afterEach(() => vi.restoreAllMocks());

describe("downloadAndVerify", () => {
  it("follows redirects that stay on allowlisted hosts and verifies the final body", async () => {
    const body = Buffer.from("jar bytes");
    const sha256 = crypto.createHash("sha256").update(body).digest("hex");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://trusted.example/real.jar" } }))
      .mockResolvedValueOnce(new Response(body));

    await expect(downloadAndVerify("https://trusted.example/a.jar", ALLOWED, { sha256 })).resolves.toEqual(body);
  });

  it("refuses a redirect to a host outside the allowlist, before fetching it", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "http://169.254.169.254/latest/meta-data" } }));

    await expect(downloadAndVerify("https://trusted.example/a.jar", ALLOWED)).rejects.toThrow(/untrusted host/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a body whose hash doesn't match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("tampered"));
    await expect(downloadAndVerify("https://trusted.example/a.jar", ALLOWED, { sha256: "0".repeat(64) })).rejects.toThrow(/integrity/);
  });
});
