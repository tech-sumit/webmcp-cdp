# @tech-sumit/webmcp-cdp

A standalone Node.js library for discovering and executing WebMCP tools in Chrome via the Chrome DevTools Protocol. Think "Playwright for WebMCP" — without Playwright.

## Requirements

Chrome 149+ launched with remote debugging and WebMCP enabled:

```bash
chrome --remote-debugging-port=9222 --enable-features=WebMCPTesting,DevToolsWebMCPSupport
```

(For local development you can instead enable `chrome://flags/#enable-webmcp-testing`.)

## How it works

| Browser support | Discovery | Execution |
|---|---|---|
| CDP `WebMCP` domain (current Chrome) | `WebMCP.enable` → `WebMCP.toolsAdded` / `toolsRemoved` | `WebMCP.invokeTool` → `WebMCP.toolResponded`, cancel with `WebMCP.cancelInvocation` |
| No CDP domain, spec API | `document.modelContext.getTools()` + `toolchange` event | `document.modelContext.executeTool(tool, input)` |
| Legacy Chrome (≤151) | `navigator.modelContextTesting.listTools()` | `navigator.modelContextTesting.executeTool(name, json)` |

The best available mechanism is chosen per tab automatically.

## Installation

```bash
pnpm add @tech-sumit/webmcp-cdp
```

## Usage

```typescript
import { CdpToolSource } from "@tech-sumit/webmcp-cdp";

const source = new CdpToolSource();
await source.connect({ host: "localhost", port: 9222 });

// List all tools from all tabs
const tools = source.listTools();
console.log(tools);
// [{ name: "searchFlights", title: "Search flights", description: "...", inputSchema: "{...}",
//    annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false, debugging: false },
//    frameId: "..." }]

// Execute a tool (args are a JSON-encoded object; the result is the JSON string the tool produced)
const result = await source.callTool("searchFlights", '{"from":"SFO","to":"JFK"}');
console.log(result);
// [{ type: "text", text: '{"flights":[...]}' }]

// Cancel a long-running invocation
const controller = new AbortController();
source.callTool("bookFlight", "{}", { signal: controller.signal });
controller.abort();

// Listen for tool changes
source.onToolsChanged((tools) => {
  console.log("Tools changed:", tools.length);
});

// Clean up
await source.disconnect();
```

## API

### `CdpToolSource`

Implements the `ToolSource` interface from `@tech-sumit/ai-inspector-types`.

| Method | Description |
|--------|-------------|
| `connect(config?)` | Connect to Chrome via CDP |
| `disconnect()` | Disconnect all sessions |
| `listTools()` | List all discovered tools |
| `callTool(name, args, { signal }?)` | Execute a tool; aborting `signal` cancels it |
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
