// End-to-end check against the live site: spawns the server over stdio with the
// official MCP client and calls every tool once. `npm run smoke`.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts"] }));

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " - " + detail : ""}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0]?.text ?? "";
  if (res.isError) return { __error: text };
  return JSON.parse(text);
}

const tools = (await client.listTools()).tools;
check("tools/list", tools.length === 9, tools.map((t) => t.name).join(", "));
check("all read-only", tools.every((t) => t.annotations?.readOnlyHint === true));

const s = await call("search_books", { query: "جنایت و مکافات", limit: 5 });
check("search_books finds works", s.books?.length > 0, s.books?.map((b: { title: string }) => b.title).join(" | "));
const workId = s.books?.[0]?.book_id;

const d = await call("book_details", { id: workId, include_description: false, editions_limit: 3 });
check("book_details has editions", d.editions_summary?.total > 1, `${d.title}: ${d.editions_summary?.total} editions, ${d.editions_summary?.translators} translators`);
check("cheapest is Toman-sized", d.editions_summary?.cheapest_available?.price_toman > 10_000, JSON.stringify(d.editions_summary?.cheapest_available));

const e = await call("book_editions", { id: workId, only_available: true, sort: "rating", limit: 3 });
check("book_editions sorted by rating", e.editions?.length > 0, e.editions?.map((x: { publisher: { name: string }; rating_stars: number; rating_count: number }) => `${x.publisher?.name} ${x.rating_stars}/${x.rating_count}`).join(" | "));
const ed = e.editions?.[0];
check("edition has ISBN + translator", !!ed?.isbn && ed?.translators?.length > 0, `${ed?.isbn} ${ed?.translators?.[0]?.name}`);

const viaEdition = await call("book_details", { id: ed?.edition_id, include_description: false, editions_limit: 1 });
check("edition id resolves to its work", viaEdition.book_id === workId, `${ed?.edition_id} -> ${viaEdition.book_id}`);

const c = await call("book_comments", { id: workId });
check("book_comments", c.comments?.length > 0, `${c.total_comments} total, first: ${c.comments?.[0]?.text?.slice(0, 40)}`);
const far = await call("book_comments", { id: workId, page: 9999 });
check("far comment page flagged", far.page_clamped === true || far.comments?.length === 0, `page=${far.page} clamped=${far.page_clamped}`);

const sim = await call("similar_books", { id: workId, limit: 3 });
check("similar_books", sim.similar?.length > 0, sim.similar?.map((x: { title: string }) => x.title).join(" | "));

const who = await call("find_author_publisher_or_tag", { query: "سروش حبیبی", kind: "person" });
check("find person", who.results?.[0]?.id > 0, JSON.stringify(who.results?.[0]));
const pb = await call("person_books", { person_id: who.results?.[0]?.id, limit: 3 });
check("person_books", pb.items?.length > 0, `${pb.total_items} items, e.g. ${pb.items?.[0]?.title} ${pb.items?.[0]?.price_toman}`);

const pub = await call("find_author_publisher_or_tag", { query: "نشر چشمه", kind: "publisher" });
check("find publisher", pub.results?.[0]?.id > 0, JSON.stringify(pub.results?.[0]));
const pubBooks = await call("publisher_books", { publisher_id: pub.results?.[0]?.id, sort: "newest", limit: 3 });
check("publisher_books", pubBooks.items?.length > 0, `${pubBooks.total_items} items`);

const tag = await call("browse_tag", { tag_id: 152, limit: 3 });
check("browse_tag", tag.items?.length > 0, `${tag.total_items} items, e.g. ${tag.items?.[0]?.title}`);

const miss = await call("book_details", { id: 99999999 });
check("unknown id is a clear error", typeof miss.__error === "string" && miss.__error.includes("No book"), miss.__error);

await client.close();
console.log(`\nSMOKE ${failed ? "FAILED" : "OK"} (${failed} failed)`);
process.exitCode = failed ? 1 : 0;
