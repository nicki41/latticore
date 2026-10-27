import { describe, expect, it } from "vitest";
import type { Permission } from "@latticore/shared";
import { assertGrantable, type ActingUser } from "./roles.service.js";

function actingUser(isOwner: boolean, permissions: Permission[]): ActingUser {
  return { isOwner, permissions: new Set(permissions) };
}

describe("assertGrantable (privilege escalation guard)", () => {
  it("lets an Owner grant any permission, even ones not explicitly listed as held", () => {
    expect(() => assertGrantable(["settings.manage", "users.delete"], actingUser(true, []))).not.toThrow();
  });

  it("lets a non-owner grant permissions they themselves hold", () => {
    const acting = actingUser(false, ["servers.view", "servers.create"]);
    expect(() => assertGrantable(["servers.view"], acting)).not.toThrow();
  });

  it("blocks a non-owner from granting a permission they don't hold (the actual escalation path)", () => {
    // Regression test: an Admin (has roles.manage but not settings.manage,
    // per SYSTEM_ROLE_PERMISSIONS) must not be able to create/edit a
    // custom role that includes settings.manage and assign it to themselves.
    const admin = actingUser(false, ["roles.manage", "users.edit"]);
    expect(() => assertGrantable(["settings.manage"], admin)).toThrow(/don't have yourself/i);
  });

  it("reports every ungranted permission, not just the first", () => {
    const acting = actingUser(false, ["servers.view"]);
    try {
      assertGrantable(["servers.view", "settings.manage", "users.delete"], acting);
      throw new Error("expected assertGrantable to throw");
    } catch (err) {
      expect(String(err)).toMatch(/settings\.manage/);
      expect(String(err)).toMatch(/users\.delete/);
      expect(String(err)).not.toMatch(/servers\.view/);
    }
  });

  it("allows an empty permission list for anyone", () => {
    expect(() => assertGrantable([], actingUser(false, []))).not.toThrow();
  });
});
