export { CdpToolSource, fromCdpTool } from "./cdp-tool-source.js";
export { TargetManager } from "./target-manager.js";
export type { ManagedTarget } from "./target-manager.js";
export type {
  CallToolOptions,
  DiscoveryMode,
  WebMCPDiscoveredTool,
  WebMCPToolAnnotations,
} from "./types.js";

// Re-export key types for convenience
export type {
  ToolCallResultContent,
  ToolSource,
  ToolSourceConfig,
  DiscoveredTool,
} from "@tech-sumit/ai-inspector-types";
