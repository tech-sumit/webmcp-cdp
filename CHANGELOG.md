# Changelog

## 0.3.0 (2026-10-23)

Aligns with the October 2026 WebMCP draft and Chromium, which removed `navigator.modelContextTesting` in Chrome 152.

### Features

- **Native CDP `WebMCP` domain**: Discovery uses `WebMCP.enable` with `WebMCP.toolsAdded` / `WebMCP.toolsRemoved`; execution uses `WebMCP.invokeTool` and resolves on the matching `WebMCP.toolResponded` event. Tools from iframes are tracked by `frameId`
- **Cancellation**: `callTool(name, args, { signal })` sends `WebMCP.cancelInvocation` when the signal aborts
- **`document.modelContext` fallback**: When the CDP domain is unavailable, discovery uses `document.modelContext.getTools()` plus the `toolchange` event and execution uses `executeTool(registeredTool, inputObject)`. The legacy `navigator.modelContextTesting` path remains for Chrome ≤151
- **Richer tool metadata**: New `WebMCPDiscoveredTool` type (a superset of `DiscoveredTool`) with `title`, full `annotations` (`readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging`, plus Chromium's `autosubmit`), `origin`, `frameId` and `backendNodeId`
- `fromCdpTool()` helper exported to map CDP `WebMCP.Tool` objects

### Spec alignment

- `listTools()` from `navigator.modelContextTesting` and the string-based `executeTool(name, json)` are gone from both the spec and Chrome; the spec's `executeTool()` takes a `RegisteredTool` and an input object
- `readOnlyHint` is still surfaced at the top level for existing consumers, now derived from `annotations`


## 0.2.0 (2026-03-04)

### Features

- **`readOnlyHint` in tool discovery**: The CDP discovery script now extracts `readOnlyHint` from each tool returned by `listTools()`, matching the spec's formalized tool definition struct where `readOnlyHint` is a top-level field
- **Updated `DiscoveredTool` type**: Consumes `@tech-sumit/ai-inspector-types@^0.4.0` which includes optional `readOnlyHint` on `DiscoveredTool`
- **Page navigation re-discovery**: Tools are now automatically re-discovered after top-level `Page.frameNavigated` events — old tools are cleared immediately and the discovery script is re-injected into the new page context
- **Extracted discovery script**: Discovery logic factored into a static `DISCOVERY_SCRIPT` constant, eliminating duplication between initial attach and navigation re-discovery
- **Re-export `ToolCallResultContent`**: Convenience re-export from `@tech-sumit/ai-inspector-types`

### Breaking changes

- **`callTool()` return type**: Changed from `Promise<string | null>` to `Promise<ToolCallResultContent[]>` to align with updated `ToolSource` interface — text results are now wrapped in `[{ type: "text", text: value }]`

### Spec alignment

- Discovery script maps tools to include `readOnlyHint` when the browser exposes it, so downstream consumers (MCP server, extension) can forward the hint to agents

### Bug fixes

- **Stale tools after navigation**: Previously tools persisted from the old page context after navigating to a new URL; now `Page.frameNavigated` clears old tools and re-runs discovery
- **Lost bindings after navigation**: `__webmcpToolsChanged` binding is re-added after frame navigation since the old JS context (and its bindings) are destroyed

## 0.1.0 (2026-02-17)

### Features

- **CdpToolSource**: Discover and execute WebMCP tools via Chrome DevTools Protocol
  - Connects to Chrome instances with `--remote-debugging-port` and `--enable-features=WebMCPTesting`
  - Tool discovery via `Runtime.evaluate` on `navigator.modelContextTesting.listTools()`
  - Tool execution via `Runtime.evaluate` with `awaitPromise: true` on `modelContextTesting.executeTool()`
  - Change detection via `Runtime.addBinding` + `registerToolsChangedCallback()`
- **TargetManager**: Multi-tab tool tracking, each tab maintains its own tool set
- Implements `ToolSource` interface from `@tech-sumit/ai-inspector-types`

### Bug fixes

- Handle `Runtime.evaluate` errors: check `exceptionDetails` field and throw descriptive error instead of silently returning `null`
- Use `.bind()` for CDP options to work around `chrome-remote-interface` type strictness
