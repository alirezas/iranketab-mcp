// iranketab.ir endpoints. Two kinds of source:
// - HTML pages (search, book) parsed in parse.ts
// - the site's own ListView JSON (comments, tag/person/publisher listings)

import { get, getJson, UpstreamError } from "./http.js";
import { parseBookPage, parseSearch, type BookPage } from "./parse.js";
import { clean, faFold, truncate } from "./text.js";

export class NotFoundError extends Error {}

// ---------- search ----------

export type SearchKind = "book" | "person" | "publisher" | "tag";
export type SearchSort = "relevance" | "best_selling" | "popular" | "newest";

const SEARCH_TYPE: Record<SearchKind, string> = {
  book: "کتاب",
  person: "پروفایل",
  publisher: "ناشر",
  tag: "دسته بندی",
};
const SEARCH_SORT: Record<SearchSort, number> = { relevance: 0, best_selling: 1, popular: 2, newest: 3 };

export async function search(query: string, kind: SearchKind, sort: SearchSort = "relevance") {
  // The site's own search box turns spaces into dashes in the path.
  const term = encodeURIComponent(faFold(query).replace(/ /g, "-"));
  const { body } = await get(`/result/${term}?t=${encodeURIComponent(SEARCH_TYPE[kind])}&s=${SEARCH_SORT[sort]}`);
  return parseSearch(body);
}

// ---------- book page ----------

/** Accepts a work id or an edition id - edition ids redirect to their work. */
export async function book(id: number): Promise<BookPage> {
  const { body, url } = await get(`/book/${id}`);
  const page = parseBookPage(body, url);
  if (!page) throw new NotFoundError(`No book with id ${id} on iranketab.ir. Get ids from search_books.`);
  return page;
}

// ---------- comments ----------

interface RawComment {
  id: number;
  text: string;
  likeCount: number;
  persianInsertDate: number;
  titleUser: string | null;
  brand: string | null;
  selectedProductName: string | null;
  selectedProductId: number | null;
  replyComments?: RawComment[];
}

interface CommentList {
  pageSize: number;
  pageIndex: number;
  totalItems: number;
  items: RawComment[];
}

const solarDate = (n: number) => {
  const s = String(n);
  return s.length === 8 ? `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6)}` : s;
};

const shapeComment = (c: RawComment): Record<string, unknown> => ({
  id: c.id,
  date_solar: solarDate(c.persianInsertDate),
  user: clean(c.titleUser) || null,
  text: truncate(clean(c.text), 800),
  likes: c.likeCount,
  edition_id: c.selectedProductId,
  edition_publisher: clean(c.brand) || null,
  ...(c.replyComments?.length ? { replies: c.replyComments.map(shapeComment) } : {}),
});

export async function comments(bookId: number, page: number) {
  const data = await getJson<CommentList>(`/comment/list?Type=Product&EntityId=${bookId}&lvc-page=${page}`);
  return {
    total_comments: data.totalItems,
    page: data.pageIndex,
    page_size: data.pageSize,
    // Clamped pages come back as page 1 - say so instead of repeating page 1.
    page_clamped: data.pageIndex !== page,
    has_more: data.pageIndex * data.pageSize < data.totalItems,
    comments: data.items.map(shapeComment),
  };
}

// ---------- tag / person / publisher listings ----------

export type ListingKind = "tag" | "profile" | "brand";
export type ListingSort = "newest" | "best_selling" | "most_liked";

const LISTING_SORT: Record<ListingSort, string> = { newest: "", best_selling: "MostSale", most_liked: "MostLiked" };

interface RawListing {
  pageSize: number | string;
  pageIndex: number | string;
  totalItems: number | string;
  isSuccess?: boolean;
  items: {
    id: number;
    name: string;
    englishName: string | null;
    price: number | null;
    priceOffer: number | null;
    discount: number | null;
    flag: string | null;
    link: string;
    fullName: string | null;
  }[];
}

export async function listing(kind: ListingKind, id: number, sort: ListingSort, page: number, limit: number) {
  const qs = new URLSearchParams({ Id: String(id), page: String(page), pagesize: String(limit) });
  if (LISTING_SORT[sort]) qs.set("sort", LISTING_SORT[sort]);
  const data = await getJson<RawListing>(`/${kind}/filter?${qs}`);
  if (data.isSuccess === false) throw new UpstreamError(`iranketab.ir refused the ${kind} listing for id ${id}.`);
  const total = Number(data.totalItems);
  if (!total && page === 1) throw new NotFoundError(`Nothing listed under ${kind} id ${id} - check the id.`);
  return {
    total_items: total,
    page: Number(data.pageIndex),
    items: data.items.map((it) => ({
      // Listing entries are editions; /book/{edition_id} redirects to the work.
      edition_id: it.id,
      title: clean(it.name),
      english_title: clean(it.englishName) || null,
      author: clean(it.fullName) || null,
      price_toman: it.priceOffer ?? it.price,
      price_before_toman: it.priceOffer != null && it.price !== it.priceOffer ? it.price : null,
      discount_percent: it.discount ?? 0,
      // No current offer price: in every spot check this was an out-of-stock
      // edition, but that is not guaranteed - book_editions has the real state.
      no_current_offer: it.priceOffer == null,
      special_offer: it.flag === "SpecialOffer",
      url: `https://www.iranketab.ir/book/${it.id}`,
    })),
  };
}
