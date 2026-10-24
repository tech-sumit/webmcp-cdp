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
 * the current spec's `RegisteredTool` dictionary and the CDP `WebMCP.Tool`
 * type expose. All additions are optional, so it stays assignable to
 * `DiscoveredTool`.
 */
export interface WebMCPDiscoveredTool extends DiscoveredTool {
  /** Human-readable label (`RegisteredTool.title`). */
  title?: string;
  /** Full annotations (`RegisteredTool.annotations`). */
  annotations?: WebMCPToolAnnotations;
  /** Serialized origin of the registering document (`RegisteredTool.origin`). */
  origin?: string;
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
