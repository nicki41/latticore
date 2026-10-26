import { describe, expect, it, vi } from "vitest";
import { createFeaturedCollectionLoader } from "./modrinth.featured.js";

function project(id: string) {
  return { id, slug: id.toLowerCase(), title: `Project ${id}`, description: "d", icon_url: null, downloads: 1, loaders: ["paper", "velocity"], game_versions: ["26.3"] };
}

describe("createFeaturedCollectionLoader", () => {
  it("keeps the collection's order and drops projects Modrinth doesn't return (unlisted/draft)", async () => {
    const client = {
      getCollection: vi.fn(async () => ({ id: "C1", name: "UniversalAdmin", description: "desc", icon_url: "icon", status: "listed", user: "U1", projects: ["B", "HIDDEN", "A"] })),
      getProjects: vi.fn(async () => [project("A"), project("B")]),
      getUsername: vi.fn(async () => "nicki."),
    };
    const featured = await createFeaturedCollectionLoader(client as never, "C1")();

    expect(featured).toMatchObject({ id: "C1", name: "UniversalAdmin", author: "nicki.", url: "https://modrinth.com/collection/C1" });
    expect(featured!.projects.map((p) => p.id)).toEqual(["B", "A"]);
    expect(featured!.projects[0]).toMatchObject({ slug: "b", loaders: ["paper", "velocity"], gameVersions: ["26.3"] });
  });

  it("returns null instead of throwing when Modrinth is unreachable", async () => {
    const client = { getCollection: vi.fn(async () => Promise.reject(new Error("offline"))), getProjects: vi.fn(), getUsername: vi.fn() };
    await expect(createFeaturedCollectionLoader(client as never, "C1")()).resolves.toBeNull();
  });
});
