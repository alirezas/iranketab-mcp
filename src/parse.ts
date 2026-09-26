// HTML -> plain objects. Everything here is pure (string in, data out) so it
// can be tested against saved pages in test/fixtures without the network.
//
// Layout notes (verified against live pages, 2026-09):
// - A book page is one *work* (/book/{id}) holding N *editions*: one per
//   translation / publisher / format. Each edition is `div#p-{editionId}` with a
//   sibling `#product_details_popup_{editionId}` that carries label/value rows.
// - Edition ids are the `#pts=` fragment on search links and the `data-id` of
//   cart buttons. Prices in `strong.toman` / `data-price` are Toman; the JSON-LD
//   Offer is Rial (priceCurrency IRR).
// - Search (/result/{term}) returns server-rendered cards with no prices.

import { parse, type HTMLElement } from "node-html-parser";
import { BASE } from "./http.js";
import { clean, num, truncate } from "./text.js";

export interface PersonRef {
  id: number;
  name: string;
}

export type StockState = "in_stock" | "publisher_stock" | "out_of_stock";

export interface Edition {
  edition_id: number;
  title: string;
  english_title: string | null;
  authors: PersonRef[];
  translators: PersonRef[];
  publisher: PersonRef | null;
  price_toman: number | null;
  price_before_toman: number | null;
  discount_percent: number;
  stock: StockState;
  stock_note: string | null;
  earliest_delivery: string | null;
  rating_stars: number | null;
  rating_count: number;
  isbn: string | null;
  format: string | null;
  cover: string | null;
  pages: number | null;
  year_solar: number | null;
  year_gregorian: number | null;
  print_run: number | null;
  special_offer: boolean;
  url: string;
}

export interface BookPage {
  book_id: number;
  title: string;
  url: string;
  rating_stars: number | null;
  rating_count: number;
  description: string | null;
  highlights: string[];
  about_author: string | null;
  tags: { id: number; title: string }[];
  editions: Edition[];
  similar: { book_id: number; title: string; subtitle: string | null; url: string }[];
}

export interface SearchCard {
  book_id: number;
  edition_ids: number[];
  title: string;
  subtitle: string | null;
  authors: string | null;
  url: string;
}

export interface EntityCard {
  id: number;
  name: string;
  url: string;
}

const idFromHref = (href: string | undefined, kind: string): number | null => {
  const m = href?.match(new RegExp(`/${kind}/(\\d+)`));
  return m ? Number(m[1]) : null;
};

const absolute = (href: string) => (href.startsWith("http") ? href : BASE + href.split("#")[0]);

function personRefs(scope: HTMLElement): PersonRef[] {
  return scope
    .querySelectorAll('a[href^="/profile/"]')
    .map((a) => ({ id: idFromHref(a.getAttribute("href"), "profile"), name: clean(a.text) }))
    .filter((p): p is PersonRef => p.id !== null && p.name !== "");
}

/**
 * Label/value rows: `<div><span class="text-default">شابک:</span><span>978…</span></div>`.
 * Returns the row element per label so callers can read links or plain text.
 */
function labelledRows(scope: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  for (const span of scope.querySelectorAll("span.text-default")) {
    const label = clean(span.text);
    if (!label.endsWith(":")) continue;
    const key = label.slice(0, -1).trim();
    if (!rows.has(key)) rows.set(key, span.parentNode as HTMLElement);
  }
  return rows;
}

function rowText(rows: Map<string, HTMLElement>, label: string): string | null {
  const row = rows.get(label);
  if (!row) return null;
  const labelSpan = row.querySelector("span.text-default");
  const text = clean(row.text.replace(labelSpan ? labelSpan.text : "", ""));
  return text || null;
}

function parseStock(scope: HTMLElement): { stock: StockState; note: string | null } {
  if (scope.querySelector("[data-product-reminder]") || /ناموجود/.test(scope.text)) {
    return { stock: "out_of_stock", note: "ناموجود" };
  }
  const note = scope
    .querySelectorAll("div.text-center")
    .map((d) => clean(d.text))
    .find((t) => t.includes("موجود"));
  if (note?.includes("انبار نشر")) return { stock: "publisher_stock", note };
  return { stock: "in_stock", note: note ?? null };
}

function parseEdition(root: HTMLElement, card: HTMLElement, editionId: number, bookUrl: string): Edition {
  // The popup is the cleanest source; the card is the fallback and holds rating.
  const popup = root.querySelector(`#product_details_popup_${editionId}`) ?? card;
  const rows = labelledRows(popup);

  const title = clean(
    (popup.querySelector("h4") ?? card.querySelector('h2[itemprop="name"]'))?.text,
  ).replace(/^کتاب\s+/, "");
  const english = clean(
    (popup.querySelector("h4")?.nextElementSibling ?? card.querySelector("div.ltr.text-end"))?.text,
  );

  const pubLink = popup.querySelector('a[href^="/publisher/"]');
  const publisher = pubLink
    ? { id: idFromHref(pubLink.getAttribute("href"), "publisher")!, name: clean(pubLink.text) }
    : null;

  const acts = card.querySelector(".wrapper-product-acts") ?? popup.querySelector(".wrapper-product-acts");
  const shown = num(popup.querySelector("strong.toman")?.text ?? card.querySelector("strong.toman")?.text);
  const price = shown ?? num(acts?.getAttribute("data-price"));
  const before = num(popup.querySelector("s.price")?.text ?? card.querySelector("s.price")?.text);
  const discountText = [...popup.querySelectorAll("div.bg-danger"), ...card.querySelectorAll("div.bg-danger")]
    .map((d) => clean(d.text))
    .find((t) => /[٪%]/.test(t));

  const ratingValue = num(card.querySelector("span.text-warning")?.text);
  const ratingCount = num(card.querySelector("span.digit")?.text) ?? 0;

  // Stock and delivery are rendered in both the desktop card and the popup.
  const stockScope = popup.querySelector(".popup-footer") ?? card;
  const { stock, note } = parseStock(stockScope);
  const delivery = clean(
    [...stockScope.querySelectorAll("span"), ...card.querySelectorAll("span")]
      .find((s) => clean(s.text).startsWith("زودترین زمان ارسال"))
      ?.nextElementSibling?.text,
  );

  return {
    edition_id: editionId,
    title,
    english_title: english || null,
    authors: rows.get("نویسنده") ? personRefs(rows.get("نویسنده")!) : [],
    translators: rows.get("مترجم") ? personRefs(rows.get("مترجم")!) : [],
    publisher,
    price_toman: price,
    price_before_toman: before && price && before > price ? before : null,
    discount_percent: num(discountText) ?? 0,
    stock,
    stock_note: note,
    earliest_delivery: stock === "out_of_stock" ? null : delivery || null,
    // A rating from a handful of votes is noise, not a verdict.
    rating_stars: ratingValue !== null && ratingCount >= 3 ? ratingValue : null,
    rating_count: ratingCount,
    isbn: rowText(rows, "شابک"),
    format: rowText(rows, "قطع"),
    cover: rowText(rows, "نوع جلد"),
    pages: num(rowText(rows, "تعداد صفحه")),
    year_solar: num(rowText(rows, "سال انتشار شمسی")),
    year_gregorian: num(rowText(rows, "سال انتشار میلادی")),
    print_run: num(rowText(rows, "سری چاپ")),
    special_offer: /پیشنهاد ویژه/.test(card.text),
    url: `${bookUrl}#pts=${editionId}`,
  };
}

interface LdProduct {
  "@type"?: string;
  name?: string;
  sku?: number | string;
}

function ldProduct(root: HTMLElement): LdProduct | null {
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      // rawText, not text: text decodes entities like &#xA; into raw control
      // characters, which JSON.parse rejects inside string literals.
      const data = JSON.parse(s.rawText) as LdProduct | LdProduct[];
      const found = (Array.isArray(data) ? data : [data]).find((d) => d["@type"] === "Product");
      if (found) return found;
    } catch {
      // Malformed block - ignore, others may still parse.
    }
  }
  return null;
}

/** Returns null for the site's soft 404 (HTTP 200, no product data). */
export function parseBookPage(html: string, finalUrl: string): BookPage | null {
  const root = parse(html);
  const ld = ldProduct(root);
  const bookId = idFromHref(finalUrl, "book") ?? (ld?.sku ? Number(ld.sku) : null);
  const url = absolute(new URL(finalUrl).pathname);
  const editions = root
    .querySelectorAll("div[id^=p-]")
    .filter((d) => /^p-\d+$/.test(d.id))
    .map((d) => parseEdition(root, d, Number(d.id.slice(2)), url));
  if (!bookId || (!ld && editions.length === 0)) return null;

  const about = root.querySelector("#section_about");
  const aboutBlocks = about?.querySelectorAll(".card") ?? [];
  const description = clean(aboutBlocks[0]?.querySelector("div.text-sm")?.text);
  const authorBio = clean(aboutBlocks[1]?.querySelector(".text-justify")?.text);
  const highlights = (about?.querySelectorAll("ul li") ?? []).map((li) => clean(li.text)).filter(Boolean);

  const tags = (root.querySelector("#section_categories")?.querySelectorAll('a[href^="/tag/"]') ?? [])
    .map((a) => ({ id: idFromHref(a.getAttribute("href"), "tag"), title: clean(a.text) }))
    .filter((t): t is { id: number; title: string } => t.id !== null);

  const similar = (root.querySelector("#section_related")?.querySelectorAll("a.product-card-simple") ?? [])
    .map((a) => ({
      book_id: Number(a.getAttribute("data-entity-id")),
      title: clean(a.getAttribute("title") ?? a.querySelector("h5")?.text),
      subtitle: clean(a.querySelector("h6")?.text) || null,
      url: absolute(a.getAttribute("href") ?? ""),
    }))
    .filter((s) => s.book_id > 0);

  // The JSON-LD aggregateRating belongs to one edition only (3.5 from 27 votes on
  // White Nights while its most-read edition sits at 4.17 from 163), so the
  // work's rating is the vote-weighted mean of the editions that have one.
  const rated = editions.filter((e) => e.rating_stars !== null);
  const ratedVotes = rated.reduce((n, e) => n + e.rating_count, 0);
  const rating = ratedVotes
    ? Math.round((rated.reduce((s, e) => s + e.rating_stars! * e.rating_count, 0) / ratedVotes) * 100) / 100
    : null;

  return {
    book_id: bookId,
    title: clean(ld?.name) || clean(root.querySelector("h1")?.text).replace(/^کتاب\s+/, ""),
    url,
    rating_stars: rating,
    rating_count: editions.reduce((n, e) => n + e.rating_count, 0),
    description: description ? truncate(description, 1500) : null,
    highlights,
    about_author: authorBio ? truncate(authorBio, 600) : null,
    tags,
    editions,
    similar,
  };
}

/** Search result page. Book cards are grouped by work; `#pts=` ids are kept per work. */
export function parseSearch(html: string): { books: SearchCard[]; people: EntityCard[]; publishers: EntityCard[]; tags: EntityCard[]; total_shown: number | null } {
  const root = parse(html);
  const page = root.querySelector("#page_search") ?? root;
  const total = num(page.text.match(/([\d۰-۹]+)\s*مورد/)?.[1]);

  const books = new Map<number, SearchCard>();
  const people: EntityCard[] = [];
  const publishers: EntityCard[] = [];
  const tags: EntityCard[] = [];

  for (const a of page.querySelectorAll("a.card")) {
    const href = a.getAttribute("href") ?? "";
    const title = clean(a.querySelector(".text-primary")?.text);
    if (href.startsWith("/book/")) {
      const id = idFromHref(href, "book");
      if (!id) continue;
      const pts = num(href.match(/pts=(\d+)/)?.[1]);
      const existing = books.get(id);
      if (existing) {
        if (pts && !existing.edition_ids.includes(pts)) existing.edition_ids.push(pts);
        continue;
      }
      books.set(id, {
        book_id: id,
        edition_ids: pts ? [pts] : [],
        title,
        subtitle: clean(a.querySelector(".text-xs")?.text) || null,
        authors: clean(a.querySelector(".text-sm")?.text) || null,
        url: absolute(href),
      });
    } else {
      for (const [kind, bucket] of [["profile", people], ["publisher", publishers], ["tag", tags]] as const) {
        const id = idFromHref(href, kind);
        if (id && !bucket.some((e) => e.id === id)) bucket.push({ id, name: title, url: absolute(href) });
      }
    }
  }
  return { books: [...books.values()], people, publishers, tags, total_shown: total };
}
