import { describe, it, expect, beforeEach } from "vitest";
import { TargetManager } from "../src/target-manager.js";
import type { ManagedTarget } from "../src/target-manager.js";

function makeMockTarget(
  id: string,
  tools: Array<{ name: string; description: string; inputSchema: string }> = [],
): ManagedTarget {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    client: { close: async () => {} } as unknown as ManagedTarget["client"],
    tools,
  };
}

describe("TargetManager", () => {
  let manager: TargetManager;

  beforeEach(() => {
    manager = new TargetManager();
  });

  it("should add and retrieve targets", () => {
    const target = makeMockTarget("tab1");
    manager.add(target);
    expect(manager.get("tab1")).toBe(target);
  });

  it("should remove targets", () => {
    const target = makeMockTarget("tab1");
    manager.add(target);
    const removed = manager.remove("tab1");
    expect(removed).toBe(target);
    expect(manager.get("tab1")).toBeUndefined();
  });

  it("should aggregate tools from all targets", () => {
    manager.add(
      makeMockTarget("tab1", [
        { name: "tool1", description: "d1", inputSchema: "{}" },
      ]),
    );
    manager.add(
      makeMockTarget("tab2", [
        { name: "tool2", description: "d2", inputSchema: "{}" },
        { name: "tool3", description: "d3", inputSchema: "{}" },
      ]),
    );

    const allTools = manager.allTools();
    expect(allTools).toHaveLength(3);
    expect(allTools.map((t) => t.name)).toEqual(["tool1", "tool2", "tool3"]);
  });

  it("should find target for a tool by name", () => {
    manager.add(
      makeMockTarget("tab1", [
        { name: "searchFlights", description: "Search", inputSchema: "{}" },
      ]),
    );
    manager.add(
      makeMockTarget("tab2", [
        { name: "bookHotel", description: "Book", inputSchema: "{}" },
      ]),
    );

    const target = manager.findTargetForTool("bookHotel");
    expect(target?.id).toBe("tab2");
  });

  it("should return undefined for unknown tool", () => {
    expect(manager.findTargetForTool("nonexistent")).toBeUndefined();
  });

  it("should update tools for a target", () => {
    manager.add(makeMockTarget("tab1", []));
    manager.updateTools("tab1", [
      { name: "newTool", description: "New", inputSchema: "{}" },
    ]);
    expect(manager.allTools()).toHaveLength(1);
    expect(manager.allTools()[0].name).toBe("newTool");
  });

  it("should list all target IDs", () => {
    manager.add(makeMockTarget("a"));
    manager.add(makeMockTarget("b"));
    expect(manager.ids().sort()).toEqual(["a", "b"]);
  });

  it("should disconnect all targets", async () => {
    let closedCount = 0;
    const mockClient = { close: async () => { closedCount++; } };
    manager.add({ ...makeMockTarget("t1"), client: mockClient as unknown as ManagedTarget["client"] });
    manager.add({ ...makeMockTarget("t2"), client: mockClient as unknown as ManagedTarget["client"] });

    await manager.disconnectAll();
    expect(closedCount).toBe(2);
    expect(manager.ids()).toHaveLength(0);
  });
});
