import CDP from "chrome-remote-interface";
import type {
  ToolSource,
  ToolSourceConfig,
  ToolCallResultContent,
} from "@tech-sumit/ai-inspector-types";
import { TargetManager } from "./target-manager.js";
import type {
  CallToolOptions,
  DiscoveryMode,
  WebMCPDiscoveredTool,
  WebMCPToolAnnotations,
} from "./types.js";

// chrome-remote-interface types are imperfect; use module-level type alias
type CDPClient = CDP.Client;

/** `WebMCP.Tool` from the experimental CDP WebMCP domain. */
interface CdpWebMCPTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnly?: boolean;
    untrustedContent?: boolean;
    consequential?: boolean;
    debugging?: boolean;
    autosubmit?: boolean;
  };
  frameId: string;
  backendNodeId?: number;
}

/** `WebMCP.toolResponded` event parameters. */
interface CdpToolResponded {
  invocationId: string;
  status: "Completed" | "Canceled" | "Error";
  output?: unknown;
  errorText?: string;
  exception?: { description?: string };
}

interface PendingInvocation {
  resolve: (value: string) => void;
  reject: (err: Error) => void;
}

/** Map a CDP `WebMCP.Tool` to a discovered tool. */
export function fromCdpTool(t: CdpWebMCPTool): WebMCPDiscoveredTool {
  const a = t.annotations;
  const annotations: WebMCPToolAnnotations | undefined = a
    ? {
        readOnlyHint: a.readOnly ?? false,
        untrustedContentHint: a.untrustedContent ?? false,
        consequentialHint: a.consequential ?? false,
        debugging: a.debugging ?? false,
        ...(a.autosubmit != null && { autosubmit: a.autosubmit }),
      }
    : undefined;
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ? JSON.stringify(t.inputSchema) : "",
    frameId: t.frameId,
    ...(t.backendNodeId != null && { backendNodeId: t.backendNodeId }),
    ...(annotations && { annotations, readOnlyHint: annotations.readOnlyHint }),
  };
}

/** Stringify a tool result the same way `ModelContext.executeTool()` does. */
function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output ?? null);
}

/**
 * A ToolSource that discovers and executes WebMCP tools via Chrome DevTools Protocol.
 *
 * Uses `chrome-remote-interface` to connect to Chrome instances with
 * `--remote-debugging-port`.
 *
 * Discovery prefers Chromium's native CDP `WebMCP` domain (`WebMCP.enable`,
 * `toolsAdded`/`toolsRemoved`, `invokeTool`/`toolResponded`). When the
 * domain is unavailable it falls back to page script via `Runtime.evaluate`:
 * the spec's `document.modelContext.getTools()`/`executeTool()` with the
 * `toolchange` event, or the legacy `navigator.modelContextTesting` API on
 * older Chrome builds.
 */
export class CdpToolSource implements ToolSource {
  private targetManager = new TargetManager();
  private changeListeners = new Set<(tools: WebMCPDiscoveredTool[]) => void>();
  private connected = false;
  private config: { host: string; port: number } = { host: "localhost", port: 9222 };
  /** Native-mode tools per target, keyed by `${frameId}\u0000${name}`. */
  private cdpTools = new Map<string, Map<string, WebMCPDiscoveredTool>>();
  private pendingInvocations = new Map<string, PendingInvocation>();
  /** `toolResponded` events that arrived before `invokeTool` returned. */
  private earlyResponses = new Map<string, CdpToolResponded>();

  async connect(config: ToolSourceConfig = {}): Promise<void> {
    this.config = {
      host: config.host ?? "localhost",
      port: config.port ?? 9222,
    };

    const targets = await CDP.List(this.config);
    const pages = targets.filter(
      (t) => t.type === "page",
    );

    if (pages.length === 0) {
      throw new Error(
        `No page targets found at ${this.config.host}:${this.config.port}. Ensure Chrome is running ` +
          `with --remote-debugging-port=${this.config.port} and has at least one tab open.`,
      );
    }

    for (const target of pages) {
      await this.attachToTarget(target);
    }

    this.connected = true;
  }

  /**
   * The fallback discovery script injected into each page context.
   * Subscribes to tool changes so they trigger the `__webmcpToolsChanged`
   * binding, and resolves to `{ mode, tools }` as a JSON string.
   */
  static readonly DISCOVERY_SCRIPT = `(async () => {
    const mc = document.modelContext;
    if (mc && typeof mc.getTools === "function") {
      const mapTool = (t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema === undefined ? "" : JSON.stringify(t.inputSchema),
        ...(t.title ? { title: t.title } : {}),
        ...(t.origin ? { origin: t.origin } : {}),
        ...(t.annotations ? { annotations: t.annotations, readOnlyHint: !!t.annotations.readOnlyHint } : {}),
      });
      const list = async () => (await mc.getTools()).map(mapTool);
      if (!window.__webmcpCdpSubscribed) {
        window.__webmcpCdpSubscribed = true;
        mc.addEventListener("toolchange", async () => {
          __webmcpToolsChanged(JSON.stringify(await list()));
        });
      }
      return JSON.stringify({ mode: "document", tools: await list() });
    }
    const mct = navigator.modelContextTesting;
    if (mct) {
      const mapTool = (t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.readOnlyHint != null ? { readOnlyHint: t.readOnlyHint } : {}),
      });
      mct.registerToolsChangedCallback(() => {
        __webmcpToolsChanged(JSON.stringify(mct.listTools().map(mapTool)));
      });
      return JSON.stringify({ mode: "testing", tools: mct.listTools().map(mapTool) });
    }
    return JSON.stringify({ mode: "none", tools: [] });
  })()`;

  /** Build the fallback execution expression for a page. */
  static executeScript(mode: DiscoveryMode, name: string, inputArguments: string): string {
    if (mode === "testing") {
      return `navigator.modelContextTesting.executeTool(${JSON.stringify(name)}, ${JSON.stringify(inputArguments)})`;
    }
    return `(async () => {
      const mc = document.modelContext;
      const tool = (await mc.getTools()).find((t) => t.name === ${JSON.stringify(name)});
      if (!tool) throw new DOMException("Tool not found", "NotFoundError");
      return mc.executeTool(tool, JSON.parse(${JSON.stringify(inputArguments)}));
    })()`;
  }

  /** Try to enable the native CDP WebMCP domain. Returns false if unsupported. */
  private async enableCdpDomain(client: CDPClient, targetId: string): Promise<boolean> {
    const tools = new Map<string, WebMCPDiscoveredTool>();
    this.cdpTools.set(targetId, tools);
    const sync = () => {
      this.targetManager.updateTools(targetId, Array.from(tools.values()));
      this.notifyChange();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    c.on("WebMCP.toolsAdded", (params: { tools: CdpWebMCPTool[] }) => {
      for (const t of params.tools) {
        tools.set(`${t.frameId}\u0000${t.name}`, fromCdpTool(t));
      }
      sync();
    });
    c.on("WebMCP.toolsRemoved", (params: { tools: Array<{ name: string; frameId: string }> }) => {
      for (const t of params.tools) {
        tools.delete(`${t.frameId}\u0000${t.name}`);
      }
      sync();
    });
    c.on("WebMCP.toolResponded", (params: CdpToolResponded) => {
      this.settleInvocation(params);
    });

    try {
      await c.send("WebMCP.enable");
      return true;
    } catch {
      this.cdpTools.delete(targetId);
      return false;
    }
  }

  private settleInvocation(params: CdpToolResponded): void {
    const pending = this.pendingInvocations.get(params.invocationId);
    if (!pending) {
      this.earlyResponses.set(params.invocationId, params);
      return;
    }
    this.pendingInvocations.delete(params.invocationId);
    if (params.status === "Completed") {
      pending.resolve(stringifyOutput(params.output));
    } else if (params.status === "Canceled") {
      pending.reject(new Error(params.errorText ?? "Tool invocation was canceled"));
    } else {
      pending.reject(
        new Error(
          params.exception?.description ?? params.errorText ?? "Tool execution failed",
        ),
      );
    }
  }

  /** Run the fallback discovery script and return its result. */
  private async runDiscovery(
    client: CDPClient,
  ): Promise<{ mode: DiscoveryMode; tools: WebMCPDiscoveredTool[] }> {
    try {
      const { result } = await client.Runtime.evaluate({
        expression: CdpToolSource.DISCOVERY_SCRIPT,
        awaitPromise: true,
        returnByValue: true,
      });
      const parsed = JSON.parse(result.value as string) as {
        mode: DiscoveryMode;
        tools: WebMCPDiscoveredTool[];
      };
      return { mode: parsed.mode ?? "none", tools: parsed.tools ?? [] };
    } catch {
      // Page may not expose WebMCP
      return { mode: "none", tools: [] };
    }
  }

  private async attachToTarget(target: CDP.Target): Promise<void> {
    const client: CDPClient = await CDP({ target } as CDP.Options);
    await client.Runtime.enable();
    await client.Page.enable();

    this.targetManager.add({
      id: target.id,
      url: target.url,
      title: target.title,
      client,
      tools: [],
      mode: "none",
    });

    if (await this.enableCdpDomain(client, target.id)) {
      const managed = this.targetManager.get(target.id);
      if (managed) managed.mode = "cdp";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).on(
        "Page.frameNavigated",
        (params: { frame: { id: string; parentId?: string } }) => {
          // Drop tools of the navigated frame; the new document re-registers
          // and arrives via WebMCP.toolsAdded.
          const tools = this.cdpTools.get(target.id);
          if (!tools) return;
          for (const [key, tool] of tools) {
            if (!params.frame.parentId || tool.frameId === params.frame.id) {
              tools.delete(key);
            }
          }
          this.targetManager.updateTools(target.id, Array.from(tools.values()));
          this.notifyChange();
        },
      );
      return;
    }

    // Fallback: page script discovery.
    // When the page calls __webmcpToolsChanged(payload), the
    // Runtime.bindingCalled event fires with the payload string.
    await client.Runtime.addBinding({ name: "__webmcpToolsChanged" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).on(
      "Runtime.bindingCalled",
      (params: { name: string; payload: string }) => {
        if (params.name === "__webmcpToolsChanged") {
          try {
            const tools: WebMCPDiscoveredTool[] = JSON.parse(params.payload);
            this.targetManager.updateTools(target.id, tools);
            this.notifyChange();
          } catch {
            // Ignore malformed payloads
          }
        }
      },
    );

    // Re-discover tools after every navigation (the old JS context is destroyed).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).on(
      "Page.frameNavigated",
      async (params: { frame: { parentId?: string } }) => {
        // Only handle top-level frame navigations
        if (params.frame.parentId) return;

        // Clear tools immediately — old page context is gone
        this.targetManager.updateTools(target.id, []);
        this.notifyChange();

        // Wait briefly for the new page to load and register tools
        await new Promise((r) => setTimeout(r, 1000));

        // Re-add the binding (it was lost with the old context)
        try {
          await client.Runtime.addBinding({ name: "__webmcpToolsChanged" });
        } catch {
          // Binding may already exist if Chrome persists it
        }

        // Re-run discovery in the new page context
        const { mode, tools } = await this.runDiscovery(client);
        const managed = this.targetManager.get(target.id);
        if (managed) managed.mode = mode;
        this.targetManager.updateTools(target.id, tools);
        this.notifyChange();
      },
    );

    // Initial tool discovery
    const { mode, tools } = await this.runDiscovery(client);
    const managed = this.targetManager.get(target.id);
    if (managed) managed.mode = mode;
    this.targetManager.updateTools(target.id, tools);
  }

  listTools(): WebMCPDiscoveredTool[] {
    return this.targetManager.allTools();
  }

  /**
   * Execute a tool by name.
   *
   * With the CDP WebMCP domain this calls `WebMCP.invokeTool` and waits for
   * the matching `WebMCP.toolResponded` event. Otherwise it evaluates
   * `document.modelContext.executeTool()` (or the legacy
   * `navigator.modelContextTesting.executeTool()`) in the page.
   *
   * @param name - Tool name
   * @param inputArguments - JSON-encoded input object
   * @param options - Optional `signal` to cancel the invocation
   * @returns Array of content blocks (text results from WebMCP tool execution)
   */
  async callTool(
    name: string,
    inputArguments: string,
    options: CallToolOptions = {},
  ): Promise<ToolCallResultContent[]> {
    const target = this.targetManager.findTargetForTool(name);
    if (!target) {
      throw new Error(
        `Tool "${name}" not found in any connected tab. ` +
          `Available tools: ${this.listTools().map((t) => t.name).join(", ") || "(none)"}`,
      );
    }

    if (target.mode === "cdp") {
      const tool = target.tools.find((t) => t.name === name);
      const text = await this.invokeViaCdp(
        target.client,
        tool?.frameId ?? "",
        name,
        inputArguments,
        options.signal,
      );
      return [{ type: "text", text }];
    }

    options.signal?.throwIfAborted();
    const response = await target.client.Runtime.evaluate({
      expression: CdpToolSource.executeScript(target.mode ?? "document", name, inputArguments),
      awaitPromise: true,
      returnByValue: true,
    });

    // Runtime.evaluate returns exceptionDetails when the expression or promise rejects
    const exceptionDetails = (response as unknown as Record<string, unknown>).exceptionDetails as
      | { text?: string; exception?: { description?: string } }
      | undefined;
    if (exceptionDetails) {
      const msg =
        exceptionDetails.exception?.description ??
        exceptionDetails.text ??
        "Tool execution failed";
      throw new Error(msg);
    }

    const value = (response.result.value as string) ?? null;
    return [{ type: "text", text: value ?? "null" }];
  }

  private async invokeViaCdp(
    client: CDPClient,
    frameId: string,
    toolName: string,
    inputArguments: string,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    let input: unknown;
    try {
      input = inputArguments ? JSON.parse(inputArguments) : {};
    } catch {
      throw new Error("Tool input must be a JSON-encoded object");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    const { invocationId } = (await c.send("WebMCP.invokeTool", {
      frameId,
      toolName,
      input: input ?? {},
    })) as { invocationId: string };

    const result = new Promise<string>((resolve, reject) => {
      this.pendingInvocations.set(invocationId, { resolve, reject });
    });

    const early = this.earlyResponses.get(invocationId);
    if (early) {
      this.earlyResponses.delete(invocationId);
      this.settleInvocation(early);
    }

    if (signal) {
      const onAbort = () => {
        c.send("WebMCP.cancelInvocation", { invocationId }).catch(() => {
          // Invocation may already have completed
        });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      result.finally(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
    }

    return result;
  }

  onToolsChanged(cb: (tools: WebMCPDiscoveredTool[]) => void): void {
    this.changeListeners.add(cb);
  }

  async disconnect(): Promise<void> {
    for (const pending of this.pendingInvocations.values()) {
      pending.reject(new Error("Disconnected"));
    }
    this.pendingInvocations.clear();
    this.earlyResponses.clear();
    this.cdpTools.clear();
    await this.targetManager.disconnectAll();
    this.changeListeners.clear();
    this.connected = false;
  }

  /** Whether the source is currently connected. */
  isConnected(): boolean {
    return this.connected;
  }

  private notifyChange(): void {
    const tools = this.listTools();
    for (const cb of this.changeListeners) {
      cb(tools);
    }
  }
}
