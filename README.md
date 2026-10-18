# Bookshelf

A 3D shelf of the books I'm reading and have read. Live on GitHub Pages.

## Adding a book

Add a file to `books/`, named after the book, e.g. `books/piranesi.md`. Copy `books/_template.md` to start.
Only `title` and `author` are needed; everything else is optional.

```
---
title: "Piranesi"
author: "Susanna Clarke"
isbn: 9781526622426        # optional; pins the exact edition and cover
status: reading            # reading or read
rating: 4.5                # out of 5, halves allowed
date: 2026-10-18           # started (reading) or finished (read)
best_for: "A rainy weekend"
verdict: "One line that sums it up."
---

The review itself. Separate paragraphs with a blank line.
```

Push it. GitHub Actions then:

1. looks the book up on Open Library, Google Books and Apple Books,
2. fills in pages, year, publisher, genre and ISBN if you left them out (it never overwrites what you wrote),
3. picks the sharpest cover that looks like a book cover and saves it to `covers/<name>.webp`,
4. rebuilds `data/books.json` and publishes the site.

It takes a minute or two. The bot commits the cover and details back to the repo, so pull before editing again.

### Fixing things by hand

| Field | What it does |
| --- | --- |
| `refresh_cover: true` | Fetch the cover again (e.g. after adding an ISBN) |
| Your own `covers/<name>.webp` | Use your own cover image; the bot leaves existing covers alone |
| `spine_color: "#c0392b"` | Override the spine colour picked from the cover |
| `spine_ink: light` / `dark` | Force light or dark spine text |
| `height_cm`, `thickness_cm` | Exact size (otherwise worked out from format and page count) |
| `format: hardback` / `paperback` | Sets the default height when there are no measurements |
| `draft: true` | Keep the book off the shelf |

## Running it locally

```
npm install
npm run build     # rebuild data/books.json
npm run serve     # open the printed address
```

## One-time setup

In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
