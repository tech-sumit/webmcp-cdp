# Changelog

## 0.1.0 (2026-02-17)

### Features

- **CdpToolSource**: Discover and execute WebMCP tools via Chrome DevTools Protocol
  - Connects to Chrome instances with `--remote-debugging-port` and `--enable-features=WebMCPTesting`
  - Tool discovery via `Runtime.evaluate` on `navigator.modelContextTesting.listTools()`
  - Tool execution via `Runtime.evaluate` with `awaitPromise: true` on `modelContextTesting.executeTool()`
  - Change detection via `Runtime.addBinding` + `registerToolsChangedCallback()`
- **TargetManager**: Multi-tab tool tracking, each tab maintains its own tool set
- Implements `ToolSource` interface from `@anthropic/ai-inspector-types`

### Bug fixes

- Handle `Runtime.evaluate` errors: check `exceptionDetails` field and throw descriptive error instead of silently returning `null`
- Use `.bind()` for CDP options to work around `chrome-remote-interface` type strictness
