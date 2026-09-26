# iranketab-mcp

Read-only MCP server for [iranketab.ir](https://www.iranketab.ir): search books, **compare translations and editions**, prices in Toman, stock, ratings and reader comments. No key needed.

Modelled on [digikala-mcp](https://github.com/mmdju/digikala-mcp). Not affiliated with iranketab.

## Connect

```bash
npm install && npm run build
claude mcp add iranketab -- node "$PWD/dist/index.js"
```

Any stdio MCP client works the same way (`command: node`, `args: [".../dist/index.js"]`).

Then ask: "which translation of Crime and Punishment is best rated and in stock?", "cheapest White Nights that isn't abridged", "what did Soroush Habibi translate?", "bestsellers in Russian literature".

## Tools

| Tool | What it answers |
|---|---|
| `search_books` | Title / author / keyword to works (no prices on search cards) |
| `find_author_publisher_or_tag` | Name to id for a person (author **or** translator), publisher, or category |
| `book_details` | One work: description, tags, vote-weighted rating, editions summary (cheapest available, most rated, price range) |
| `book_editions` | Every edition: translator, publisher, price, discount, stock, delivery, rating, ISBN, format, pages, year, print run. Filter by translator/publisher, sort by price/rating/newest/print run |
| `book_comments` | Reader comments, 20 per page, each tagged with the edition it was left on |
| `similar_books` | iranketab's related shelf |
| `browse_tag` | A category's editions with prices (sort newest / best_selling / most_liked) |
| `person_books` | Everything an author wrote or a translator translated |
| `publisher_books` | A publisher's catalogue |

All tools carry `readOnlyHint`. Every `book_*` tool accepts a work id **or** an edition id.

## How it works

```
agent --stdio--> iranketab-mcp --HTTPS, 1 req / 500ms--> www.iranketab.ir
```

iranketab has no public API. Two sources are used:

- **HTML pages**, parsed with `node-html-parser`:
  - `/result/{term}?t=کتاب&s=N` for search
  - `/book/{id}` for a book (one *work*, N *editions* as `div#p-{editionId}` plus a details popup)
- **The site's own ListView JSON**:
  - `/comment/list` for comments
  - `/tag/filter`, `/profile/filter`, `/brand/filter` for listings

Details that matter:

- **Prices are Toman** on the page and in listing JSON. The JSON-LD `Offer` is Rial (`IRR`) and is not used.
- **The JSON-LD rating belongs to a single edition** (White Nights: 3.5 from 27 votes, while its most-read edition has 4.17 from 163). The work rating here is the vote-weighted mean across editions, and edition ratings from under 3 votes are reported as `null`.
- **Stock** has three states: `in_stock` (iranketab's warehouse), `publisher_stock` (ordered from the publisher, slower) and `out_of_stock`.
- **Listing entries are editions.** `/book/{editionId}` redirects to the work.
- **Unknown book ids return HTTP 200** with an empty page (a soft 404). This is detected as "no JSON-LD and no editions".
- **Parse JSON-LD with `rawText`**, not `text`: `text` decodes `&#xA;` into control characters that `JSON.parse` rejects.
- **Politeness:**
  - requests are serialised 500ms apart
  - failures are retried with jittered backoff (up to 3 tries, honouring `retry-after`)
  - responses are cached for 5 minutes, so details → editions → comments on one book costs one page fetch

## Develop

```bash
npm test        # offline parser tests against saved pages in test/fixtures
npm run smoke   # live end-to-end: spawns the server, calls all 9 tools
npm run dev     # run from source
```

When the site changes markup, `npm run smoke` goes red. Re-save a fixture and `npm test` shows which field broke.
