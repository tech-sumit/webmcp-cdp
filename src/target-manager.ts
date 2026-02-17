import type CDP from "chrome-remote-interface";
import type { DiscoveredTool } from "@anthropic/ai-inspector-types";

export interface ManagedTarget {
  id: string;
  url: string;
  title: string;
  client: CDP.Client;
  tools: DiscoveredTool[];
}

/**
 * Manages CDP targets (tabs) and their associated tools.
 * Handles multi-tab discovery, tracking which tools belong to which tab.
 */
export class TargetManager {
  private targets = new Map<string, ManagedTarget>();

  add(target: ManagedTarget): void {
    this.targets.set(target.id, target);
  }

  remove(id: string): ManagedTarget | undefined {
    const target = this.targets.get(id);
    this.targets.delete(id);
    return target;
  }

  get(id: string): ManagedTarget | undefined {
    return this.targets.get(id);
  }

  updateTools(id: string, tools: DiscoveredTool[]): void {
    const target = this.targets.get(id);
    if (target) {
      target.tools = tools;
    }
  }

  /** Get all tools from all connected targets. */
  allTools(): DiscoveredTool[] {
    const tools: DiscoveredTool[] = [];
    for (const target of this.targets.values()) {
      tools.push(...target.tools);
    }
    return tools;
  }

  /** Find which target owns a tool by name. */
  findTargetForTool(name: string): ManagedTarget | undefined {
    for (const target of this.targets.values()) {
      if (target.tools.some((t) => t.name === name)) {
        return target;
      }
    }
    return undefined;
  }

  /** Get all target IDs. */
  ids(): string[] {
    return Array.from(this.targets.keys());
  }

  /** Disconnect all clients and clear state. */
  async disconnectAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];
    for (const target of this.targets.values()) {
      closePromises.push(target.client.close());
    }
    await Promise.allSettled(closePromises);
    this.targets.clear();
  }
}
