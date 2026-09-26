// Offline parser tests against pages saved from iranketab.ir (2026-09-26).
// If the site's markup changes, re-save a fixture and these show what broke.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseBookPage, parseSearch } from "../src/parse.ts";
import { faFold, num } from "../src/text.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const whiteNights = parseBookPage(fixture("book-1045.html"), "https://www.iranketab.ir/book/1045-white-nights")!;

test("book page: work-level fields", () => {
  assert.equal(whiteNights.book_id, 1045);
  assert.equal(whiteNights.title, "شب‌های روشن");
  assert.equal(whiteNights.url, "https://www.iranketab.ir/book/1045-white-nights");
  assert.ok(whiteNights.description?.startsWith("کتاب شب های روشن"));
  assert.ok(whiteNights.tags.some((t) => t.id === 152 && t.title === "ادبیات روسیه"));
  assert.ok(whiteNights.similar.length > 0);
});

test("book page: rating is vote-weighted across editions, not the JSON-LD edition", () => {
  // JSON-LD says 3.5 / 27 votes; the page's editions add up to far more votes.
  assert.ok(whiteNights.rating_count > 250);
  assert.ok(whiteNights.rating_stars! > 3.5 && whiteNights.rating_stars! < 4.2);
});

test("book page: every edition is parsed with its own translator, publisher and price", () => {
  assert.equal(whiteNights.editions.length, 24);
  const habibi = whiteNights.editions.find((e) => e.edition_id === 2405)!;
  assert.deepEqual(habibi.translators, [{ id: 192, name: "سروش حبیبی" }]);
  assert.deepEqual(habibi.authors, [{ id: 1059, name: "فئودور داستایفسکی" }]);
  assert.deepEqual(habibi.publisher, { id: 57, name: "ماهی" });
  assert.equal(habibi.price_toman, 142500);
  assert.equal(habibi.price_before_toman, 190000);
  assert.equal(habibi.discount_percent, 25);
  assert.equal(habibi.stock, "in_stock");
  assert.equal(habibi.rating_stars, 4.17);
  assert.equal(habibi.rating_count, 163);
  assert.equal(habibi.isbn, "978-9642090839");
  assert.equal(habibi.format, "جیبی");
  assert.equal(habibi.cover, "شومیز");
  assert.equal(habibi.pages, 112);
  assert.equal(habibi.year_solar, 1405);
  assert.equal(habibi.print_run, 195);
  assert.equal(habibi.special_offer, true);
  assert.equal(habibi.url, "https://www.iranketab.ir/book/1045-white-nights#pts=2405");
});

test("book page: the three stock states", () => {
  const byId = (id: number) => whiteNights.editions.find((e) => e.edition_id === id)!;
  assert.equal(byId(137698).stock, "publisher_stock");
  const out = byId(152174);
  assert.equal(out.stock, "out_of_stock");
  assert.equal(out.price_toman, 178000);
  assert.equal(out.price_before_toman, null);
  assert.equal(out.earliest_delivery, null);
});

test("book page: ratings from under 3 votes are withheld, count kept", () => {
  const few = whiteNights.editions.find((e) => e.edition_id === 179433)!;
  assert.equal(few.rating_stars, null);
  assert.equal(few.rating_count, 1);
});

test("book page: JSON-LD with entity-encoded newlines still parses", () => {
  const b = parseBookPage(fixture("book-190156-entity-in-jsonld.html"), "https://www.iranketab.ir/book/190156-a-raw-youth");
  assert.ok(b);
  assert.equal(b.book_id, 190156);
  assert.ok(b.editions.length >= 1);
});

test("book page: soft 404 returns null", () => {
  assert.equal(parseBookPage("<html><body>not found</body></html>", "https://www.iranketab.ir/book/99999999"), null);
});

test("search: works are grouped and edition ids collected", () => {
  const r = parseSearch(fixture("search-crime-books.html"));
  const crime = r.books.find((b) => b.book_id === 849)!;
  assert.ok(crime.edition_ids.length > 1, "several editions of Crime and Punishment matched");
  assert.equal(new Set(r.books.map((b) => b.book_id)).size, r.books.length, "no duplicate works");
});

test("search: mixed results split by kind", () => {
  const r = parseSearch(fixture("search-dostoevsky.html"));
  assert.equal(r.total_shown, 100);
  assert.ok(r.books.length > 10);
  assert.deepEqual(r.people[0], { id: 1059, name: "فئودور داستایفسکی", url: "https://www.iranketab.ir/profile/1059-fyodor-dostoevsky" });
});

test("text helpers", () => {
  assert.equal(num("٪25"), 25);
  assert.equal(num("۱۴۲,۵۰۰"), 142500);
  assert.equal(num("bad"), null);
  assert.equal(faFold("  كتاب  علي "), "کتاب علی");
});
