// Fills in missing details and finds the best cover for any book that doesn't have one yet.
// Runs in GitHub Actions (it needs open internet). For each books/<slug>.md without covers/<slug>.webp:
//   1. look the book up on Open Library, Google Books and Apple Books
//   2. fill in isbn, pages, year, publisher and genre if they're missing (never overwrites what you wrote)
//   3. download every candidate cover, keep the sharpest one that looks like a book cover
//   4. trim, resize and save it as covers/<slug>.webp
// Set `refresh_cover: true` in a book's frontmatter to fetch its cover again.
import fs from 'node:fs';
import sharp from 'sharp';
import { listBooks, writeBook, coverPath } from './lib.mjs';

const UA = 'IndyBookshelf/1.0 (personal reading shelf)';
async function get(url, type = 'json', ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    return type === 'json' ? await res.json() : Buffer.from(await res.arrayBuffer());
  } catch { return null; } finally { clearTimeout(timer); }
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for']);
const words = s => norm(s).split(' ').filter(w => w && !STOP.has(w));
function titleMatch(want, got) {
  const a = words(want), b = new Set(words(String(got).split(/[:(]/)[0]));
  if (!a.length) return 0;
  return a.filter(w => b.has(w)).length / a.length;
}
function authorMatch(want, got) {
  if (!want) return true;
  const surnames = norm(want).split(/ and | & |,/).map(n => n.trim().split(' ').pop()).filter(Boolean);
  const g = norm(Array.isArray(got) ? got.join(' ') : got);
  return surnames.some(s => g.includes(s));
}
const isbn13 = ids => (ids || []).map(String).find(i => /^97[89]\d{10}$/.test(i.replace(/-/g, '')));

async function openLibrary(d) {
  const q = new URLSearchParams({ title: d.title, limit: '10', fields: 'key,title,author_name,isbn,cover_i,cover_edition_key,number_of_pages_median,first_publish_year,publisher,subject' });
  if (d.author) q.set('author', d.author);
  const res = await get(`https://openlibrary.org/search.json?${q}`);
  const doc = (res?.docs || []).find(x => titleMatch(d.title, x.title) >= .6 && authorMatch(d.author, x.author_name));
  if (!doc) return { covers: [] };
  const covers = [];
  if (d.isbn) covers.push({ src: 'openlibrary-isbn', url: `https://covers.openlibrary.org/b/isbn/${d.isbn}-L.jpg?default=false`, weight: 1.15 });
  if (doc.cover_i) covers.push({ src: 'openlibrary', url: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false`, weight: .9 });
  return {
    covers,
    meta: { pages: doc.number_of_pages_median, year: doc.first_publish_year, isbn: isbn13(doc.isbn) },
  };
}

async function googleBooks(d) {
  const q = d.isbn ? `isbn:${d.isbn}` : `intitle:${d.title}${d.author ? `+inauthor:${d.author.split(/&|,| and /)[0].trim()}` : ''}`;
  const res = await get(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books`);
  const items = (res?.items || []).filter(it => titleMatch(d.title, it.volumeInfo?.title) >= .6 && authorMatch(d.author, it.volumeInfo?.authors));
  // prefer the edition from the publisher you named, if any
  const pick = items.find(it => d.publisher && norm(it.volumeInfo.publisher).includes(norm(d.publisher).split(' ')[0])) || items[0];
  if (!pick) return { covers: [] };
  const v = pick.volumeInfo;
  const covers = v.imageLinks ? [{ src: 'google', url: `https://books.google.com/books/content?id=${pick.id}&printsec=frontcover&img=1&zoom=0&edge=none&fife=w1600`, weight: .8 }] : [];
  const detail = await get(`https://www.googleapis.com/books/v1/volumes/${pick.id}`);
  const dims = detail?.volumeInfo?.dimensions;
  const cm = s => (s ? parseFloat(s) : undefined);
  return {
    covers,
    meta: {
      pages: v.pageCount, year: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) : undefined,
      publisher: v.publisher, isbn: isbn13((v.industryIdentifiers || []).map(i => i.identifier)),
      genre: (v.categories || [])[0]?.split('/').pop().trim(),
      height_cm: cm(dims?.height), thickness_cm: cm(dims?.thickness),
    },
  };
}

async function appleBooks(d) {
  const term = `${d.title} ${d.author || ''}`.trim();
  const res = await get(`https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'ebook', limit: '10', country: 'gb' })}`);
  const hit = (res?.results || []).find(r => titleMatch(d.title, r.trackName) >= .6 && authorMatch(d.author, r.artistName));
  if (!hit?.artworkUrl100) return { covers: [] };
  return { covers: [{ src: 'apple', url: hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1600x1600bb.'), weight: 1 }] };
}

// download a candidate and score it: taller is better, and it must be shaped like a book cover
async function score(c) {
  const buf = await get(c.url, 'buffer', 20000);
  if (!buf || buf.length < 4000) return null;
  try {
    const img = sharp(buf).trim({ threshold: 18 });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    const aspect = info.width / info.height;
    if (info.height < 300 || aspect < .5 || aspect > .9) return null;
    return { ...c, buf: data, width: info.width, height: info.height, score: Math.min(info.height, 1600) * c.weight };
  } catch { return null; }
}

let changed = 0;
for (const book of listBooks()) {
  const d = book.data;
  const cover = coverPath(book.slug);
  const needCover = !fs.existsSync(cover) || d.refresh_cover === true;
  const needMeta = ['pages', 'year', 'publisher', 'genre'].some(k => d[k] === undefined || d[k] === '');
  if (!needCover && !needMeta) continue;
  if (!d.title) { console.warn(`${book.slug}: no title, skipping`); continue; }
  console.log(`\n${book.slug}: looking up "${d.title}"${d.author ? ` by ${d.author}` : ''}`);

  const [ol, gb, ap] = await Promise.all([openLibrary(d), googleBooks(d), appleBooks(d)]);
  for (const [k, v] of Object.entries({ ...ol.meta, ...gb.meta, isbn: d.isbn || gb.meta?.isbn || ol.meta?.isbn })) {
    if (v !== undefined && v !== null && v !== '' && (d[k] === undefined || d[k] === '')) { d[k] = v; console.log(`  ${k}: ${v}`); }
  }

  if (needCover) {
    const candidates = (await Promise.all([...ol.covers, ...gb.covers, ...ap.covers].map(score))).filter(Boolean).sort((a, b) => b.score - a.score);
    candidates.forEach(c => console.log(`  candidate ${c.src}: ${c.width}x${c.height}`));
    const best = candidates[0];
    if (best) {
      await sharp(best.buf).resize({ height: Math.min(1200, best.height) }).webp({ quality: 84 }).toFile(cover);
      d.cover_source = best.src;
      delete d.refresh_cover;
      console.log(`  saved cover from ${best.src}`);
    } else {
      console.warn(`  no usable cover found. Add one by hand as covers/${book.slug}.webp`);
    }
  }
  writeBook(book);
  changed++;
}
console.log(`\nenrich: updated ${changed} book(s)`);
