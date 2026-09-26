// Polite HTTP client for iranketab.ir: one request at a time, spaced out,
// retried with jittered backoff, and cached briefly so repeated tool calls
// (details -> editions -> comments on the same book) cost one upstream hit.

export const BASE = "https://www.iranketab.ir";

const USER_AGENT =
  "iranketab-mcp/0.1 (+https://github.com/alirezas/iranketab-mcp; read-only MCP server; polite: 1 req / 500ms)";
const MIN_GAP_MS = 500;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 200;
const TIMEOUT_MS = 20_000;
const MAX_TRIES = 3;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const cache = new Map<string, { at: number; body: string }>();
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serialises every upstream call and keeps MIN_GAP_MS between them.
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastAt = Date.now();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

async function fetchOnce(url: string, accept: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept, "accept-language": "fa-IR,fa;q=0.9" },
      redirect: "follow",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface Fetched {
  body: string;
  /** Final URL after redirects (e.g. /book/1045 -> /book/1045-white-nights). */
  url: string;
}

export async function get(pathOrUrl: string, kind: "html" | "json" = "html"): Promise<Fetched> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : BASE + pathOrUrl;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return JSON.parse(hit.body) as Fetched;

  const accept = kind === "json" ? "application/json" : "text/html,application/xhtml+xml";
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const res = await paced(() => fetchOnce(url, accept));
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        lastErr = new UpstreamError(`iranketab.ir answered HTTP ${res.status}`, res.status);
        if (attempt < MAX_TRIES) {
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
          await sleep(Math.min(backoff, 15_000) + Math.random() * 500);
          continue;
        }
        break;
      }
      if (!res.ok) throw new UpstreamError(`iranketab.ir answered HTTP ${res.status} for ${url}`, res.status);
      const out: Fetched = { body: await res.text(), url: res.url || url };
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(url, { at: Date.now(), body: JSON.stringify(out) });
      return out;
    } catch (err) {
      if (err instanceof UpstreamError && err.status && err.status < 500 && err.status !== 429) throw err;
      lastErr = err;
      if (attempt < MAX_TRIES) await sleep(1000 * 2 ** attempt + Math.random() * 500);
    }
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new UpstreamError(`iranketab.ir is not answering right now (${reason}). Retry in a minute.`);
}

export async function getJson<T>(path: string): Promise<T> {
  const { body } = await get(path, "json");
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new UpstreamError(`Expected JSON from ${path} but got something else - the site may have changed.`);
  }
}
