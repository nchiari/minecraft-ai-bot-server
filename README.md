# MC AI Bot Server

A customizable MCP server for controlling Minecraft Bedrock Edition and Minecraft Education Edition through the Minecraft WebSocket interface.

It is based on `Mming-Lab/minecraft-bedrock-education-mcp` and uses `tutinoko2048/SocketBE` for the Minecraft WebSocket integration.

## Features

- MCP tools for player, block, world, camera, system, wiki, sequence, and building operations
- Minecraft WebSocket connection through SocketBE
- Optional local HTTP control API for simple automation wrappers
- Quiet startup behavior: the Minecraft Education Agent is not spawned automatically
- English server startup and in-game connection messages

## Requirements

- Node.js 16 or newer
- Minecraft Bedrock Edition or Minecraft Education Edition
- A world with cheats enabled
- An MCP-compatible client, such as Codex, Claude Code, or another client that can run local MCP servers

## Install

```bash
git clone https://github.com/nchiari/minecraft-ai-bot-server.git
cd minecraft-ai-bot-server
npm install
npm run build
```

## Run

```bash
npm start
```

By default the WebSocket server listens on port `8001`.

To use a different port:

```bash
node dist/server.js --port=8002
```

To also enable the local HTTP API:

```bash
node dist/server.js --port=8001 --http-port=3001
```

HTTP endpoints:

- `GET /status`
- `POST /message`
- `POST /command`

## Connect From Minecraft

Open a world with cheats enabled, then run this in Minecraft chat:

```mcfunction
/connect localhost:8001/ws
```

If the server is running on another device, replace `localhost` with that device's LAN IP address.

## MCP Client Configuration

Add this server to any MCP-compatible client, such as Codex, Claude Code, or another client that can run local MCP servers, using a command similar to:

```json
{
  "mcpServers": {
    "mc-ai-bot": {
      "command": "node",
      "args": ["C:/path/to/mc-ai-bot-server/dist/server.js"]
    }
  }
}
```

Use the absolute path for your own machine.

## Available Tools

Core tools:

- `player` - Player management
- `blocks` - Block placement, fill, and query operations
- `world` - Time, weather, messages, commands, and world info
- `camera` - Camera and cinematic controls
- `system` - Scoreboard and screen display operations
- `minecraft_wiki` - Minecraft Wiki search
- `sequence` - Multi-tool sequence execution

Building tools:

- `build_cube`
- `build_sphere`
- `build_cylinder`
- `build_line`
- `build_torus`
- `build_helix`
- `build_ellipsoid`
- `build_paraboloid`
- `build_hyperboloid`
- `build_bezier`
- `build_rotate`
- `build_transform`

The original `agent` tool is disabled in this version so the Minecraft Education Agent does not appear automatically.

## Credits

This project is based on:

- [Mming-Lab/minecraft-bedrock-education-mcp](https://github.com/Mming-Lab/minecraft-bedrock-education-mcp)
- [tutinoko2048/SocketBE](https://github.com/tutinoko2048/SocketBE)
- [Model Context Protocol](https://modelcontextprotocol.io)

Original projects retain their respective copyrights and licenses.

## License

This project is distributed under the MIT License. See [LICENSE](LICENSE).
