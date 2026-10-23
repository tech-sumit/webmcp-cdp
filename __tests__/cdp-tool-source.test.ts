import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock chrome-remote-interface before importing the module under test
vi.mock("chrome-remote-interface", () => {
  const mockClient = {
    Runtime: {
      enable: vi.fn().mockResolvedValue(undefined),
      addBinding: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(),
    },
    Page: {
      enable: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    },
    send: vi.fn(),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const CDP = vi.fn().mockResolvedValue(mockClient);
  CDP.List = vi.fn().mockResolvedValue([
    { id: "target1", type: "page", url: "https://example.com", title: "Example" },
  ]);

  return { default: CDP, __mockClient: mockClient };
});

import { CdpToolSource, fromCdpTool } from "../src/cdp-tool-source.js";

type Mock = ReturnType<typeof vi.fn>;
const { __mockClient: mockClient } = (await import("chrome-remote-interface")) as unknown as {
  __mockClient: {
    Runtime: { evaluate: Mock; addBinding: Mock };
    send: Mock;
    on: Mock;
  };
};

function handler<T>(event: string): (params: T) => void {
  const call = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === event);
  if (!call) throw new Error(`No handler registered for ${event}`);
  return call[1] as (params: T) => void;
}

const searchFlights = {
  name: "searchFlights",
  description: "Search for flights",
  inputSchema: '{"type":"object","properties":{"from":{"type":"string"}}}',
};

describe("CdpToolSource (page script fallback)", () => {
  let source: CdpToolSource;

  beforeEach(() => {
    vi.clearAllMocks();
    // No CDP WebMCP domain on this browser
    mockClient.send.mockRejectedValue(new Error("'WebMCP.enable' wasn't found"));
    mockClient.Runtime.evaluate.mockResolvedValue({
      result: {
        value: JSON.stringify({ mode: "document", tools: [searchFlights] }),
      },
    });
    source = new CdpToolSource();
  });

  it("should connect and discover tools via document.modelContext", async () => {
    await source.connect({ host: "localhost", port: 9222 });

    expect(source.isConnected()).toBe(true);
    expect(mockClient.Runtime.addBinding).toHaveBeenCalledWith({
      name: "__webmcpToolsChanged",
    });

    const tools = source.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("searchFlights");
    expect(tools[0].description).toBe("Search for flights");
    expect(tools[0].inputSchema).toBe(searchFlights.inputSchema);
  });

  it("should call a tool via document.modelContext.executeTool()", async () => {
    await source.connect();

    mockClient.Runtime.evaluate.mockResolvedValueOnce({
      result: { value: '{"flights":[]}' },
    });

    const result = await source.callTool("searchFlights", '{"from":"SFO"}');
    expect(result).toEqual([{ type: "text", text: '{"flights":[]}' }]);

    const expression = mockClient.Runtime.evaluate.mock.calls.at(-1)?.[0].expression as string;
    expect(expression).toContain("document.modelContext");
    expect(expression).toContain("executeTool(tool");
  });

  it("should use legacy modelContextTesting when that is all the page exposes", async () => {
    mockClient.Runtime.evaluate.mockResolvedValueOnce({
      result: { value: JSON.stringify({ mode: "testing", tools: [searchFlights] }) },
    });
    await source.connect();

    mockClient.Runtime.evaluate.mockResolvedValueOnce({ result: { value: "ok" } });
    await source.callTool("searchFlights", "{}");

    const expression = mockClient.Runtime.evaluate.mock.calls.at(-1)?.[0].expression as string;
    expect(expression).toContain("navigator.modelContextTesting.executeTool");
  });

  it("should surface rejected executions as errors", async () => {
    await source.connect();

    mockClient.Runtime.evaluate.mockResolvedValueOnce({
      result: {},
      exceptionDetails: { exception: { description: "NotFoundError: Tool not found" } },
    });

    await expect(source.callTool("searchFlights", "{}")).rejects.toThrow("NotFoundError");
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

    handler<{ name: string; payload: string }>("Runtime.bindingCalled")({
      name: "__webmcpToolsChanged",
      payload: JSON.stringify([
        { name: "newTool", description: "New", inputSchema: "{}" },
      ]),
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toHaveLength(1);
    expect(listener.mock.calls[0][0][0].name).toBe("newTool");
  });

  it("should disconnect and clean up", async () => {
    await source.connect();
    await source.disconnect();

    expect(source.isConnected()).toBe(false);
    expect(source.listTools()).toHaveLength(0);
  });
});

describe("CdpToolSource (CDP WebMCP domain)", () => {
  let source: CdpToolSource;

  const cdpTool = {
    name: "book_table",
    description: "Book a table",
    inputSchema: { type: "object", properties: { guests: { type: "number" } } },
    annotations: { readOnly: false, consequential: true },
    frameId: "frame1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.send.mockImplementation(async (method: string) => {
      if (method === "WebMCP.enable") {
        // Enabling the domain reports all currently registered tools
        queueMicrotask(() =>
          handler<{ tools: unknown[] }>("WebMCP.toolsAdded")({ tools: [cdpTool] }),
        );
        return {};
      }
      if (method === "WebMCP.invokeTool") return { invocationId: "inv1" };
      return {};
    });
    source = new CdpToolSource();
  });

  it("should discover tools from WebMCP.toolsAdded", async () => {
    await source.connect();
    await Promise.resolve();

    expect(mockClient.Runtime.addBinding).not.toHaveBeenCalled();
    const tools = source.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "book_table",
      frameId: "frame1",
      inputSchema: JSON.stringify(cdpTool.inputSchema),
      readOnlyHint: false,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
        consequentialHint: true,
        debugging: false,
      },
    });
  });

  it("should remove tools on WebMCP.toolsRemoved", async () => {
    await source.connect();
    await Promise.resolve();

    const listener = vi.fn();
    source.onToolsChanged(listener);
    handler<{ tools: unknown[] }>("WebMCP.toolsRemoved")({
      tools: [{ name: "book_table", frameId: "frame1" }],
    });

    expect(source.listTools()).toHaveLength(0);
    expect(listener).toHaveBeenCalledWith([]);
  });

  it("should invoke tools and resolve on WebMCP.toolResponded", async () => {
    await source.connect();
    await Promise.resolve();

    const pending = source.callTool("book_table", '{"guests":2}');
    await vi.waitFor(() =>
      expect(mockClient.send).toHaveBeenCalledWith("WebMCP.invokeTool", {
        frameId: "frame1",
        toolName: "book_table",
        input: { guests: 2 },
      }),
    );
    handler<unknown>("WebMCP.toolResponded")({
      invocationId: "inv1",
      status: "Completed",
      output: { confirmed: true },
    });

    await expect(pending).resolves.toEqual([{ type: "text", text: '{"confirmed":true}' }]);
  });

  it("should reject when the tool errors", async () => {
    await source.connect();
    await Promise.resolve();

    const pending = source.callTool("book_table", "{}");
    await vi.waitFor(() => expect(mockClient.send).toHaveBeenCalledWith("WebMCP.invokeTool", expect.anything()));
    handler<unknown>("WebMCP.toolResponded")({
      invocationId: "inv1",
      status: "Error",
      errorText: "Tool rejected",
    });

    await expect(pending).rejects.toThrow("Tool rejected");
  });

  it("should cancel the invocation when the signal aborts", async () => {
    await source.connect();
    await Promise.resolve();

    const controller = new AbortController();
    const pending = source.callTool("book_table", "{}", { signal: controller.signal });
    await vi.waitFor(() => expect(mockClient.send).toHaveBeenCalledWith("WebMCP.invokeTool", expect.anything()));

    controller.abort();
    expect(mockClient.send).toHaveBeenCalledWith("WebMCP.cancelInvocation", { invocationId: "inv1" });

    handler<unknown>("WebMCP.toolResponded")({ invocationId: "inv1", status: "Canceled" });
    await expect(pending).rejects.toThrow("canceled");
  });
});

describe("fromCdpTool", () => {
  it("should leave inputSchema empty and omit annotations when absent", () => {
    expect(fromCdpTool({ name: "t", description: "d", frameId: "f" })).toEqual({
      name: "t",
      description: "d",
      inputSchema: "",
      frameId: "f",
    });
  });
});
