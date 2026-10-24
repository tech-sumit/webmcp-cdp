# webmcp-cdp

Node.js library for WebMCP tool discovery/execution via Chrome DevTools Protocol.

## Key patterns
- Uses chrome-remote-interface (NOT Playwright) for CDP
- ToolSource interface from @tech-sumit/ai-inspector-types
- Tool discovery prefers the native CDP `WebMCP` domain: `WebMCP.enable` + `WebMCP.toolsAdded` / `WebMCP.toolsRemoved` (tools keyed by frameId + name).
- Tool execution in CDP mode: `WebMCP.invokeTool({frameId, toolName, input})` → wait for `WebMCP.toolResponded` with the same `invocationId`; aborting calls `WebMCP.cancelInvocation`.
- Fallback (no CDP domain): `Runtime.evaluate` of `document.modelContext.getTools()` / `executeTool(tool, inputObject)` with the `toolchange` event, then legacy `navigator.modelContextTesting` (removed in Chrome 152+).
- Fallback change detection uses `Runtime.addBinding("__webmcpToolsChanged")` + `Runtime.bindingCalled` event.
- `DiscoveredTool.inputSchema` stays a JSON string for compatibility; `WebMCPDiscoveredTool` adds `title`, `annotations`, `origin`, `frameId`.
- Multi-tab: iterate CDP.List() targets, attach to each page

## Architecture
- `CdpToolSource` — main class implementing ToolSource interface
- `TargetManager` — tracks multiple CDP targets (tabs) and their tools
- `ManagedTarget` — represents a single connected tab with its client and tools

## Testing
- Unit tests mock chrome-remote-interface via vi.mock()
- TargetManager tests are pure unit tests (no mocking needed)
- Integration tests require Chrome 149+ with --remote-debugging-port=9222 and WebMCP enabled (chrome://flags/#enable-webmcp-testing or --enable-features=WebMCPTesting,DevToolsWebMCPSupport)

## Build
- `pnpm build` — tsup -> ESM + CJS + .d.ts
- `pnpm test` — vitest
- `pnpm typecheck` — tsc --noEmit
