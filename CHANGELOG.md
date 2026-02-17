# Changelog

## 0.2.0 (2026-02-17)

### Features

- **Page navigation re-discovery**: Tools are now automatically re-discovered after top-level `Page.frameNavigated` events — old tools are cleared immediately and the discovery script is re-injected into the new page context
- **Extracted discovery script**: Discovery logic factored into a static `DISCOVERY_SCRIPT` constant, eliminating duplication between initial attach and navigation re-discovery
- **Re-export `ToolCallResultContent`**: Convenience re-export from `@tech-sumit/ai-inspector-types`

### Breaking changes

- **`callTool()` return type**: Changed from `Promise<string | null>` to `Promise<ToolCallResultContent[]>` to align with updated `ToolSource` interface — text results are now wrapped in `[{ type: "text", text: value }]`

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
