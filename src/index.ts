#!/usr/bin/env node
// iranketab-mcp over stdio, for local clients (Claude Code, Claude Desktop, Cursor).

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

await createServer().connect(new StdioServerTransport());
