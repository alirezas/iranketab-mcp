// Web-standard HTTP entry point (Request -> Response): stateless Streamable HTTP
// on /mcp plus /health. Used by the Vercel function in api/ and by `npm run serve`.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, VERSION } from "./server.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

export function health(): Response {
  return withCors(Response.json({ ok: true, name: "iranketab-mcp", version: VERSION }));
}

export async function handleMcp(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
  // Stateless: no sessions, so there is no server-to-client stream to open (GET)
  // or session to end (DELETE).
  if (req.method !== "POST") {
    return withCors(
      Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this server is stateless, use POST." }, id: null },
        { status: 405, headers: { allow: "POST, OPTIONS" } },
      ),
    );
  }
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // One JSON body per call instead of an SSE stream: simpler for clients and
    // proxies, and nothing here streams progress.
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } finally {
    // The response body is already materialised in JSON mode, so closing is safe.
    void server.close();
  }
}
