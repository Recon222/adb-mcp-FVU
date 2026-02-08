# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

adb-mcp (Adobe MCP) enables AI control of Adobe Creative Cloud applications (Photoshop, Premiere Pro, InDesign, After Effects, Illustrator) via the Model Context Protocol (MCP). It is a proof-of-concept by Mike Chambers.

## Architecture

Three-tier communication pipeline:

```
AI/LLM (Claude Desktop)  ←stdio/MCP→  MCP Server (Python)  ←Socket.IO→  Proxy (Node.js :3001)  ←Socket.IO→  Adobe Plugin (UXP/CEP)
```

- **MCP Servers** (`mcp/`): Python scripts using FastMCP. One per Adobe app. Define MCP tools and translate them into command packets sent via Socket.IO to the proxy. `core.py` and `socket_client.py` provide shared command creation and blocking send/receive.
- **Proxy Server** (`adb-proxy-socket/proxy.js`): Node.js Express + Socket.IO server on port 3001. Routes command packets between MCP servers and Adobe plugins using application-based client registration and sender ID correlation.
- **UXP Plugins** (`uxp/ps/`, `uxp/pr/`, `uxp/id/`): Modern Adobe plugins for Photoshop, Premiere Pro, InDesign. Connect to proxy as Socket.IO clients. Commands routed through `commands/index.js` to feature-specific modules.
- **CEP Plugins** (`cep/com.mikechambers.ae/`, `cep/com.mikechambers.ai/`): Legacy plugins for After Effects and Illustrator using ExtendScript.

## Key Design Patterns

- **Command Pattern**: All operations are `{action, options}` objects created by `core.createCommand()`, sent via `socket_client.send_message_blocking()` (20s timeout), and dispatched by `parseAndRouteCommand()` in the plugin.
- **Module-based command routing**: UXP commands are grouped by feature area (layers, selection, filters, adjustment_layers, layer_styles, core) and aggregated in `commands/index.js`.
- **MCP Resources**: Instructions for the AI are served via `config://get_instructions` resource in each MCP server.
- **Every response includes document state**: Layer info and selection state are returned with each command response so the AI can track context.

## Application Maturity

| App | Plugin Type | MCP Server Lines | Maturity |
|-----|------------|-------------------|----------|
| Photoshop | UXP | ~1640 (ps-mcp.py) | Most comprehensive - layers, text, selections, filters, adjustments, generative AI, styles |
| Premiere Pro | UXP | ~900 (pr-mcp.py) | Solid - projects, sequences, clips, transitions, effects |
| InDesign | UXP | ~140 (id-mcp.py) | Basic - document creation with layout |
| After Effects | CEP | ~130 (ae-mcp.py) | Minimal - exposes raw ExtendScript execution |
| Illustrator | CEP | ~270 (ai-mcp.py) | Basic - document ops, PNG export, ExtendScript |

## Running the System

```bash
# 1. Start proxy server
node adb-proxy-socket/proxy.js

# 2. Load plugin in Adobe app via UXP Developer Tool (UXP) or symlink (CEP)
# 3. Connect plugin to proxy from the plugin panel
# 4. MCP server is invoked by the AI client (e.g., Claude Desktop) via stdio
```

## Building the Proxy

```bash
cd adb-proxy-socket
npm install
npm run build    # Uses pkg to create standalone executables for macOS/Windows
```

## Installing MCP Servers

From the `mcp/` directory, using `uv`:

```bash
uv run mcp install --with fonttools --with python-socketio --with mcp --with requests --with websocket-client --with numpy ps-mcp.py
```

Replace `ps-mcp.py` with the target app's MCP server. Some servers need additional deps (e.g., `pillow` for pr-mcp.py and id-mcp.py).

## Python Tooling

Configured in `mcp/pyproject.toml`:
- **black** (line-length 88), **isort**, **mypy**, **pytest** — configured but no tests exist yet.

## Important Files

- `mcp/socket_client.py` — Shared Socket.IO client with `send_message_blocking()` and `configure()`.
- `mcp/core.py` — `createCommand()` and `sendCommand()` used by all MCP servers.
- `mcp/fonts.py` — Cross-platform font enumeration using fontTools (PostScript names).
- `uxp/ps/commands/utils.js` — Color parsing, layer lookup, enum conversions, batch execute wrapper.
- `adb-proxy-socket/proxy.js` — 50MB buffer limit for image data transfer.

## Adding New Functionality

1. Add a `@mcp.tool()` function in the relevant MCP server (e.g., `mcp/ps-mcp.py`).
2. Add a command handler in the plugin's `commands/` directory (e.g., `uxp/ps/commands/layers.js`).
3. Register the handler in `commands/index.js` `commandHandlers` map.
4. No build step needed — reload the plugin via UXP Developer Tool.

## Conventions

- MCP tool functions call `core.sendCommand(action, options)` which wraps and sends via socket_client.
- Command handler functions in UXP plugins receive `(options)` and return result objects.
- Photoshop operations use `executeAsModal()` wrapper from `utils.js` for batch play.
- Font names must be PostScript names (handled by `fonts.py`).
- Image data is transferred as base64-encoded JPEG via MCP Image objects.
