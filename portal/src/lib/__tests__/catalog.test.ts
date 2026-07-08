jest.mock("@composio/core", () => ({ Composio: class {} }));

import { CATALOG, filterCatalog, type CatalogApp } from "@/lib/integrations/catalog";
import { SUPPORTED_TOOLKITS } from "@/lib/composio";

describe("CATALOG", () => {
  it("has the five live Google apps", () => {
    const live = CATALOG.filter((a) => a.availability === "live").map((a) => a.slug).sort();
    expect(live).toEqual(["gmail", "googlecalendar", "googledocs", "googledrive", "googlesheets"]);
  });
  it("every live app is a connectable toolkit; no coming-soon app is", () => {
    for (const a of CATALOG) {
      if (a.availability === "live") expect(SUPPORTED_TOOLKITS).toContain(a.slug);
      else expect(SUPPORTED_TOOLKITS).not.toContain(a.slug);
    }
  });
  it("lists notion and slack as coming soon", () => {
    const cs = CATALOG.filter((a) => a.availability === "coming_soon").map((a) => a.slug);
    expect(cs).toEqual(expect.arrayContaining(["notion", "slack"]));
  });
});

describe("filterCatalog", () => {
  const apps: CatalogApp[] = [
    { slug: "gmail", name: "Gmail", description: "email", category: "Email", availability: "live" },
    { slug: "slack", name: "Slack", description: "chat", category: "Comms", availability: "coming_soon" },
  ];
  it("returns all with empty query + All", () => {
    expect(filterCatalog(apps, "", "All")).toHaveLength(2);
  });
  it("matches by name case-insensitively", () => {
    expect(filterCatalog(apps, "GMAIL", "All").map((a) => a.slug)).toEqual(["gmail"]);
  });
  it("matches by description", () => {
    expect(filterCatalog(apps, "chat", "All").map((a) => a.slug)).toEqual(["slack"]);
  });
  it("filters by category", () => {
    expect(filterCatalog(apps, "", "Comms").map((a) => a.slug)).toEqual(["slack"]);
  });
  it("combines query and category", () => {
    expect(filterCatalog(apps, "gmail", "Comms")).toHaveLength(0);
  });
});
