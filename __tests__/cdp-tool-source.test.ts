import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chrome-remote-interface before importing the module under test
vi.mock("chrome-remote-interface", () => {
  const mockClient = {
    Runtime: {
      enable: vi.fn().mockResolvedValue(undefined),
      addBinding: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        result: {
          value: JSON.stringify([
            {
              name: "searchFlights",
              description: "Search for flights",
              inputSchema: '{"type":"object","properties":{"from":{"type":"string"}}}',
            },
          ]),
        },
      }),
    },
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const CDP = vi.fn().mockResolvedValue(mockClient);
  CDP.List = vi.fn().mockResolvedValue([
    { id: "target1", type: "page", url: "https://example.com", title: "Example" },
  ]);

  return { default: CDP, __mockClient: mockClient };
});

import { CdpToolSource } from "../src/cdp-tool-source.js";

describe("CdpToolSource", () => {
  let source: CdpToolSource;

  beforeEach(() => {
    vi.clearAllMocks();
    source = new CdpToolSource();
  });

  it("should connect and discover tools", async () => {
    await source.connect({ host: "localhost", port: 9222 });

    expect(source.isConnected()).toBe(true);

    const tools = source.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("searchFlights");
    expect(tools[0].description).toBe("Search for flights");
    expect(tools[0].inputSchema).toBe(
      '{"type":"object","properties":{"from":{"type":"string"}}}',
    );
  });

  it("should call a tool by name", async () => {
    await source.connect();

    const { __mockClient } = await import("chrome-remote-interface") as unknown as {
      __mockClient: { Runtime: { evaluate: ReturnType<typeof vi.fn> } };
    };

    __mockClient.Runtime.evaluate.mockResolvedValueOnce({
      result: { value: '{"flights":[]}' },
    });

    const result = await source.callTool(
      "searchFlights",
      '{"from":"SFO"}',
    );
    expect(result).toEqual([{ type: "text", text: '{"flights":[]}' }]);
  });

  it("should throw when calling unknown tool", async () => {
    await source.connect();

    await expect(
      source.callTool("nonexistent", "{}"),
    ).rejects.toThrow('Tool "nonexistent" not found');
  });

  it("should notify listeners on tool changes", async () => {
    await source.connect();

    const listener = vi.fn();
    source.onToolsChanged(listener);

    // Simulate a bindingCalled event
    const { __mockClient } = await import("chrome-remote-interface") as unknown as {
      __mockClient: { on: ReturnType<typeof vi.fn> };
    };

    const bindingHandler = __mockClient.on.mock.calls.find(
      (c: unknown[]) => c[0] === "Runtime.bindingCalled",
    )?.[1] as ((params: { name: string; payload: string }) => void) | undefined;

    if (bindingHandler) {
      bindingHandler({
        name: "__webmcpToolsChanged",
        payload: JSON.stringify([
          { name: "newTool", description: "New", inputSchema: "{}" },
        ]),
      });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0]).toHaveLength(1);
      expect(listener.mock.calls[0][0][0].name).toBe("newTool");
    }
  });

  it("should disconnect and clean up", async () => {
    await source.connect();
    await source.disconnect();

    expect(source.isConnected()).toBe(false);
    expect(source.listTools()).toHaveLength(0);
  });
});
