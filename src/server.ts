// The iranketab MCP server: tool definitions shared by the stdio entry point
// (index.ts) and the HTTP one (api/mcp.ts).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UpstreamError } from "./http.js";
import { book, comments, listing, NotFoundError, search, type ListingKind } from "./iranketab.js";
import type { Edition } from "./parse.js";
import { faFold } from "./text.js";

export const VERSION = "0.2.0";

/** A fresh server per call: cheap, and required by the stateless HTTP transport. */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: "iranketab-mcp", version: VERSION },
    {
      instructions: [
        "Read-only access to iranketab.ir, an Iranian bookstore. All prices are in Toman (1 Toman = 10 Rial).",
        "A book (work) usually has several editions: different translators, publishers and formats, each with its own price, stock and rating.",
        "Flow: search_books -> book_details (summary + editions) -> book_editions to compare translations -> book_comments for reader opinions.",
        "Ids from any tool (book_id or edition_id) work in every book_* tool.",
        "Stock: in_stock = iranketab's own warehouse (fastest), publisher_stock = ordered from the publisher (slower), out_of_stock.",
        "The cheapest edition is often abridged or simplified (compare `pages` across editions) - say so before recommending it.",
        "Prices and stock change constantly - always give the user the url to confirm.",
      ].join("\n"),
    },
  );

  const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: true } as const;

  type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

  // One place for output shape and error mapping: tools return data, never throw.
  async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
    } catch (err) {
      const message =
        err instanceof NotFoundError || err instanceof UpstreamError
          ? err.message
          : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
      return { content: [{ type: "text", text: message }], isError: true };
    }
  }

  const id = z.number().int().positive();
  const limit = (def: number, max: number) =>
    z.number().int().min(1).max(max).default(def).describe(`How many to return (default ${def}, max ${max})`);
  const page = z.number().int().min(1).default(1).describe("1-based page number");

  const names = (ps: { name: string }[]) => ps.map((p) => p.name).join("، ") || null;

  /** A one-line-per-edition view for summaries; book_editions returns the full record. */
  const compactEdition = (e: Edition) => ({
    edition_id: e.edition_id,
    translators: names(e.translators),
    publisher: e.publisher?.name ?? null,
    price_toman: e.price_toman,
    discount_percent: e.discount_percent,
    stock: e.stock,
    rating_stars: e.rating_stars,
    rating_count: e.rating_count,
    format: e.format,
    pages: e.pages,
  });

  const available = (e: Edition) => e.stock !== "out_of_stock" && e.price_toman !== null;

  // ---------- search ----------

  server.registerTool(
    "search_books",
    {
      title: "Search books",
      description:
        "Search iranketab.ir for books by title, author or keyword (Persian or English). Returns works with their author line and the edition ids the search matched. Search cards carry no price - call book_details for prices, translators and stock. The site caps search at 100 hits.",
      inputSchema: {
        query: z.string().min(1).describe("e.g. `جنایت و مکافات`, `داستایفسکی`, `the catcher in the rye`"),
        sort: z.enum(["relevance", "best_selling", "popular", "newest"]).default("relevance"),
        limit: limit(10, 30),
      },
      annotations: { title: "Search books", ...READ_ONLY },
    },
    ({ query, sort, limit }) =>
      run(async () => {
        const r = await search(query, "book", sort);
        return {
          query,
          total_hits_capped_at_100: r.total_shown,
          count: Math.min(limit, r.books.length),
          books: r.books.slice(0, limit),
          ...(r.books.length === 0 ? { hint: "No books matched. Try fewer words, the Persian title, or find_author_publisher_or_tag." } : {}),
        };
      }),
  );

  server.registerTool(
    "find_author_publisher_or_tag",
    {
      title: "Find author, translator, publisher or category",
      description:
        "Resolve a name to its iranketab id: kind=person for authors AND translators, kind=publisher for publishers, kind=tag for categories/genres (e.g. `ادبیات روسیه`, `فلسفی`). Feed the id into person_books, publisher_books or browse_tag.",
      inputSchema: {
        query: z.string().min(1),
        kind: z.enum(["person", "publisher", "tag"]),
        limit: limit(10, 30),
      },
      annotations: { title: "Find author, publisher or tag", ...READ_ONLY },
    },
    ({ query, kind, limit }) =>
      run(async () => {
        const r = await search(query, kind);
        const bucket = kind === "person" ? r.people : kind === "publisher" ? r.publishers : r.tags;
        return { query, kind, results: bucket.slice(0, limit) };
      }),
  );

  // ---------- one book ----------

  server.registerTool(
    "book_details",
    {
      title: "Book details",
      description:
        "Everything about one book (work): description, highlights, categories, a vote-weighted rating across all editions, and an editions summary - how many translations/publishers exist, how many are buyable, the cheapest available and the most-rated edition - plus a compact list of editions. Use book_editions for full per-edition data and filters.",
      inputSchema: {
        id: id.describe("book_id or edition_id (from search_books, listings or similar_books)"),
        include_description: z.boolean().default(true).describe("Set false to save context"),
        editions_limit: limit(10, 50).describe("How many compact editions to list (default 10, max 50)"),
      },
      annotations: { title: "Book details", ...READ_ONLY },
    },
    ({ id, include_description, editions_limit }) =>
      run(async () => {
        const b = await book(id);
        const buyable = b.editions.filter(available);
        const cheapest = [...buyable].sort((x, y) => x.price_toman! - y.price_toman!)[0];
        const mostRated = [...b.editions].sort((x, y) => y.rating_count - x.rating_count)[0];
        const prices = buyable.map((e) => e.price_toman!);
        return {
          book_id: b.book_id,
          title: b.title,
          url: b.url,
          authors: names(b.editions[0]?.authors ?? []),
          english_title: b.editions.find((e) => e.english_title)?.english_title ?? null,
          rating_stars: b.rating_stars,
          rating_count: b.rating_count,
          ...(include_description
            ? { description: b.description, highlights: b.highlights, about_author: b.about_author }
            : {}),
          tags: b.tags,
          editions_summary: {
            total: b.editions.length,
            in_stock: b.editions.filter((e) => e.stock === "in_stock").length,
            publisher_stock: b.editions.filter((e) => e.stock === "publisher_stock").length,
            out_of_stock: b.editions.filter((e) => e.stock === "out_of_stock").length,
            translators: [...new Set(b.editions.flatMap((e) => e.translators.map((t) => t.name)))].length,
            available_price_range_toman: prices.length ? [Math.min(...prices), Math.max(...prices)] : null,
            cheapest_available: cheapest ? compactEdition(cheapest) : null,
            most_rated: mostRated && mostRated.rating_count > 0 ? compactEdition(mostRated) : null,
          },
          editions: b.editions.slice(0, editions_limit).map(compactEdition),
          editions_truncated: b.editions.length > editions_limit,
          similar_count: b.similar.length,
        };
      }),
  );

  server.registerTool(
    "book_editions",
    {
      title: "Compare editions and translations",
      description:
        "All editions of one book with full data per edition: translators and publisher (with ids), price and discount in Toman, stock state, earliest delivery, rating, ISBN, format (قطع), cover (نوع جلد), pages, publication year and print run (سری چاپ - a high number means a long-lived, popular edition). Answers 'which translation is best / cheapest / available?'.",
      inputSchema: {
        id: id.describe("book_id or edition_id"),
        only_available: z.boolean().default(false).describe("Hide out-of-stock editions"),
        translator: z.string().optional().describe("Only editions whose translator name contains this"),
        publisher: z.string().optional().describe("Only editions whose publisher name contains this"),
        sort: z
          .enum(["site", "cheapest", "rating", "newest", "print_run"])
          .default("site")
          .describe("site = iranketab's own order; rating puts well-voted editions first"),
        limit: limit(20, 50),
      },
      annotations: { title: "Compare editions", ...READ_ONLY },
    },
    ({ id, only_available, translator, publisher, sort, limit }) =>
      run(async () => {
        const b = await book(id);
        const has = (needle: string | undefined, hay: string[]) =>
          !needle || hay.some((h) => faFold(h).includes(faFold(needle)));
        let eds = b.editions.filter(
          (e) =>
            (!only_available || available(e)) &&
            has(translator, e.translators.map((t) => t.name)) &&
            has(publisher, e.publisher ? [e.publisher.name] : []),
        );
        const by: Record<typeof sort, ((a: Edition, b: Edition) => number) | null> = {
          site: null,
          cheapest: (a, b) => (a.price_toman ?? Infinity) - (b.price_toman ?? Infinity),
          // Stars alone would rank a 5.0 from 3 votes over 4.2 from 160; weight by votes.
          rating: (a, b) =>
            (b.rating_stars ?? 0) * Math.log1p(b.rating_count) - (a.rating_stars ?? 0) * Math.log1p(a.rating_count),
          newest: (a, b) => (b.year_solar ?? 0) - (a.year_solar ?? 0),
          print_run: (a, b) => (b.print_run ?? 0) - (a.print_run ?? 0),
        };
        if (by[sort]) eds = [...eds].sort(by[sort]!);
        return {
          book_id: b.book_id,
          title: b.title,
          url: b.url,
          total_editions: b.editions.length,
          matched: eds.length,
          editions: eds.slice(0, limit),
        };
      }),
  );

  server.registerTool(
    "book_comments",
    {
      title: "Reader comments",
      description:
        "Reader comments on a book, newest first, 20 per page. Each comment names the edition (publisher) it was left on, so opinions about a specific translation can be told apart. Pass edition_id to keep only comments on that edition (filters the fetched page).",
      inputSchema: {
        id: id.describe("book_id or edition_id"),
        page,
        edition_id: id.optional().describe("Only comments left on this edition"),
      },
      annotations: { title: "Reader comments", ...READ_ONLY },
    },
    ({ id, page, edition_id }) =>
      run(async () => {
        // Comments hang off the work id; an edition id must be resolved first.
        const b = await book(id);
        const r = await comments(b.book_id, page);
        const list = edition_id ? r.comments.filter((c) => c.edition_id === edition_id) : r.comments;
        return { book_id: b.book_id, title: b.title, ...r, comments: list, ...(edition_id ? { filtered_on_page: list.length } : {}) };
      }),
  );

  server.registerTool(
    "similar_books",
    {
      title: "Similar books",
      description: "Books iranketab recommends alongside a given book (its own 'related' shelf).",
      inputSchema: { id: id.describe("book_id or edition_id"), limit: limit(10, 30) },
      annotations: { title: "Similar books", ...READ_ONLY },
    },
    ({ id, limit }) =>
      run(async () => {
        const b = await book(id);
        return { book_id: b.book_id, title: b.title, similar: b.similar.slice(0, limit) };
      }),
  );

  // ---------- listings ----------

  const listingSchema = {
    sort: z.enum(["newest", "best_selling", "most_liked"]).default("best_selling"),
    page,
    limit: limit(20, 100),
  };

  const listingNote =
    "Entries are editions with price in Toman and discount. `no_current_offer: true` usually means out of stock - confirm with book_editions.";

  function registerListing(name: string, title: string, kind: ListingKind, idName: string, what: string) {
    server.registerTool(
      name,
      {
        title,
        description: `${what} ${listingNote}`,
        inputSchema: { [idName]: id.describe(`From find_author_publisher_or_tag or book_editions`), ...listingSchema },
        annotations: { title, ...READ_ONLY },
      },
      (args: Record<string, unknown>) =>
        run(() =>
          listing(
            kind,
            args[idName] as number,
            args.sort as "newest" | "best_selling" | "most_liked",
            args.page as number,
            args.limit as number,
          ),
        ),
    );
  }

  registerListing(
    "browse_tag",
    "Browse a category",
    "tag",
    "tag_id",
    "Books in one iranketab category/genre/list (e.g. 152 = Russian literature, 328 = bestsellers). Tag ids come from book_details tags or find_author_publisher_or_tag.",
  );
  registerListing(
    "person_books",
    "Books by an author or translator",
    "profile",
    "person_id",
    "Every edition an author wrote OR a translator translated (iranketab keeps both as one profile).",
  );
  registerListing(
    "publisher_books",
    "Books by a publisher",
    "brand",
    "publisher_id",
    "The catalogue of one publisher (انتشارات).",
  );

  return server;
}
