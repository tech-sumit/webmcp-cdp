# webmcp-cdp

Node.js library for WebMCP tool discovery/execution via Chrome DevTools Protocol.

## Key patterns
- Uses chrome-remote-interface (NOT Playwright) for CDP
- ToolSource interface from @tech-sumit/ai-inspector-types
- Tool discovery: Runtime.evaluate -> modelContextTesting.listTools()
- Tool execution: Runtime.evaluate -> modelContextTesting.executeTool(name, args)
- Change detection: Runtime.addBinding + bindingCalled event
- All tool args/results are DOMString (JSON-encoded strings), per WebMCP spec
- Multi-tab: iterate CDP.List() targets, attach to each page

## Architecture
- `CdpToolSource` — main class implementing ToolSource interface
- `TargetManager` — tracks multiple CDP targets (tabs) and their tools
- `ManagedTarget` — represents a single connected tab with its client and tools

## Testing
- Unit tests mock chrome-remote-interface via vi.mock()
- TargetManager tests are pure unit tests (no mocking needed)
- Integration tests require Chrome with --remote-debugging-port=9222 --enable-features=WebMCPTesting

## Build
- `pnpm build` — tsup -> ESM + CJS + .d.ts
- `pnpm test` — vitest
- `pnpm typecheck` — tsc --noEmit
