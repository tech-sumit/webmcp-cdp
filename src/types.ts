import type { DiscoveredTool } from "@tech-sumit/ai-inspector-types";

/**
 * Tool annotations per the WebMCP spec's `ToolAnnotations` dictionary.
 * All hints default to `false` in the spec.
 */
export interface WebMCPToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
  debugging?: boolean;
  /** Chromium-only: declarative tool declared with the `toolautosubmit` attribute. */
  autosubmit?: boolean;
}

/**
 * A discovered tool, extending the shared `DiscoveredTool` with the fields
 * the current spec's `Tool` interface and the CDP `WebMCP.Tool`
 * type expose. All additions are optional, so it stays assignable to
 * `DiscoveredTool`.
 */
export interface WebMCPDiscoveredTool extends DiscoveredTool {
  /** Human-readable label (`Tool.title`). */
  title?: string;
  /** Full annotations (`Tool.annotations`). */
  annotations?: WebMCPToolAnnotations;
  /** Serialized origin of the registering document (`Tool.origin`). */
  origin?: string;
  /** JSON-stringified output JSON Schema (`Tool.outputSchema`), when provided. */
  outputSchema?: string;
  /**
   * CDP `WebMCP.ToolId`: identifies this exact registration. Newer Chromium
   * only; when set, execution targets it instead of the name.
   */
  toolId?: string;
  /** CDP frame that registered the tool. */
  frameId?: string;
  /** Set for declarative (form-based) tools discovered via CDP. */
  backendNodeId?: number;
}

/** Options for `CdpToolSource.callTool()`. */
export interface CallToolOptions {
  /** Aborting cancels the invocation (`WebMCP.cancelInvocation`). */
  signal?: AbortSignal;
}

/** Which mechanism a target uses for tool discovery/execution. */
export type DiscoveryMode = "cdp" | "document" | "testing" | "none";
