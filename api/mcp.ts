// Vercel Function: POST /mcp (rewritten from /api/mcp in vercel.json).
import { handleMcp } from "../src/web.js";

export const POST = handleMcp;
export const GET = handleMcp;
export const DELETE = handleMcp;
export const OPTIONS = handleMcp;
