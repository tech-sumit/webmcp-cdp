# @anthropic/webmcp-cdp

A standalone Node.js library for discovering and executing [WebMCP](https://github.com/nicholasgasior/nicholasgasior.github.io) tools in Chrome via the Chrome DevTools Protocol. Think "Playwright for WebMCP" — without Playwright.

## Requirements

Chrome launched with:

```bash
chrome --remote-debugging-port=9222 --enable-features=WebMCPTesting
```

## Installation

```bash
pnpm add @anthropic/webmcp-cdp
```

## Usage

```typescript
import { CdpToolSource } from "@anthropic/webmcp-cdp";

const source = new CdpToolSource();
await source.connect({ host: "localhost", port: 9222 });

// List all tools from all tabs
const tools = source.listTools();
console.log(tools);
// [{ name: "searchFlights", description: "...", inputSchema: "{...}" }]

// Execute a tool (args and result are JSON strings per WebMCP spec)
const result = await source.callTool("searchFlights", '{"from":"SFO","to":"JFK"}');
console.log(result);
// '{"flights":[...]}'

// Listen for tool changes
source.onToolsChanged((tools) => {
  console.log("Tools changed:", tools.length);
});

// Clean up
await source.disconnect();
```

## API

### `CdpToolSource`

Implements the `ToolSource` interface from `@anthropic/ai-inspector-types`.

| Method | Description |
|--------|-------------|
| `connect(config?)` | Connect to Chrome via CDP |
| `disconnect()` | Disconnect all sessions |
| `listTools()` | List all discovered tools |
| `callTool(name, args)` | Execute a tool |
| `onToolsChanged(cb)` | Register change listener |
| `isConnected()` | Check connection status |

### `TargetManager`

Internal class for managing multiple CDP targets (tabs).

## Development

```bash
pnpm install
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm build        # tsup -> dist/
```
