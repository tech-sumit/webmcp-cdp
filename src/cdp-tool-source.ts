import CDP from "chrome-remote-interface";
import type {
  ToolSource,
  ToolSourceConfig,
  DiscoveredTool,
} from "@tech-sumit/ai-inspector-types";
import { TargetManager } from "./target-manager.js";

// chrome-remote-interface types are imperfect; use module-level type alias
type CDPClient = CDP.Client;

/**
 * A ToolSource that discovers and executes WebMCP tools via Chrome DevTools Protocol.
 *
 * Uses `chrome-remote-interface` to connect to Chrome instances with
 * `--remote-debugging-port` and `--enable-features=WebMCPTesting`.
 *
 * Tool discovery uses `navigator.modelContextTesting.listTools()` via
 * `Runtime.evaluate`. Change detection uses `Runtime.addBinding` to receive
 * callbacks when tools are added/removed.
 *
 * This mirrors the approach used by the Model Context Tool Inspector extension
 * (projects/webmcp/sources/model-context-tool-inspector/content.js).
 */
export class CdpToolSource implements ToolSource {
  private targetManager = new TargetManager();
  private changeListeners = new Set<(tools: DiscoveredTool[]) => void>();
  private connected = false;
  private config: { host: string; port: number } = { host: "localhost", port: 9222 };

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

  private async attachToTarget(target: CDP.Target): Promise<void> {
    const client: CDPClient = await CDP({ target } as CDP.Options);
    await client.Runtime.enable();

    // Set up binding for tool change notifications.
    // When the page calls __webmcpToolsChanged(payload), the
    // Runtime.bindingCalled event fires with the payload string.
    await client.Runtime.addBinding({ name: "__webmcpToolsChanged" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).on(
      "Runtime.bindingCalled",
      (params: { name: string; payload: string }) => {
        if (params.name === "__webmcpToolsChanged") {
          try {
            const tools: DiscoveredTool[] = JSON.parse(params.payload);
            this.targetManager.updateTools(target.id, tools);
            this.notifyChange();
          } catch {
            // Ignore malformed payloads
          }
        }
      },
    );

    // Initial tool discovery — same pattern as model-context-tool-inspector.
    // Registers a change callback so future tool changes trigger the binding.
    const { result } = await client.Runtime.evaluate({
      expression: `(() => {
        const mct = navigator.modelContextTesting;
        if (!mct) return JSON.stringify([]);
        mct.registerToolsChangedCallback(() => {
          __webmcpToolsChanged(JSON.stringify(mct.listTools()));
        });
        return JSON.stringify(mct.listTools());
      })()`,
      returnByValue: true,
    });

    let tools: DiscoveredTool[] = [];
    try {
      tools = JSON.parse(result.value as string);
    } catch {
      // Page may not have modelContextTesting available
    }

    this.targetManager.add({
      id: target.id,
      url: target.url,
      title: target.title,
      client,
      tools,
    });
  }

  listTools(): DiscoveredTool[] {
    return this.targetManager.allTools();
  }

  /**
   * Execute a tool by name.
   *
   * Finds the target that owns the tool and calls
   * `navigator.modelContextTesting.executeTool(name, inputArguments)`.
   *
   * @param name - Tool name
   * @param inputArguments - JSON-encoded input (DOMString per WebMCP spec)
   * @returns JSON-encoded result, or null for cross-document navigation
   */
  async callTool(
    name: string,
    inputArguments: string,
  ): Promise<string | null> {
    const target = this.targetManager.findTargetForTool(name);
    if (!target) {
      throw new Error(
        `Tool "${name}" not found in any connected tab. ` +
          `Available tools: ${this.listTools().map((t) => t.name).join(", ") || "(none)"}`,
      );
    }

    const response = await target.client.Runtime.evaluate({
      expression: `navigator.modelContextTesting.executeTool(${JSON.stringify(name)}, ${JSON.stringify(inputArguments)})`,
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

    return (response.result.value as string) ?? null;
  }

  onToolsChanged(cb: (tools: DiscoveredTool[]) => void): void {
    this.changeListeners.add(cb);
  }

  async disconnect(): Promise<void> {
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
