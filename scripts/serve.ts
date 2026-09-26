// Local HTTP server for the same handler Vercel runs: `npm run serve`, then
// point a client at http://localhost:3000/mcp.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { handleMcp, health } from "../src/web.ts";

const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // @ts-expect-error - required by Node's fetch for streamed request bodies
    duplex: "half",
  });
  const response =
    url.pathname === "/health" ? health()
    : url.pathname === "/mcp" ? await handleMcp(request)
    : new Response("not found", { status: 404 });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`iranketab-mcp on http://localhost:${port}/mcp`));
