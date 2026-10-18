// Builds data/books.json from books/*.md and covers/*.webp.
// Works out each book's size and spine colour so the shelf can draw it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { ROOT, listBooks, coverPath } from './lib.mjs';

const DEFAULT_HEIGHT = { hardback: 24, paperback: 19.8, 'mass-market': 17.8 };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const hex = ({ r, g, b }) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

// most common colour on the cover: quantise to 4 bits per channel and take the biggest bucket
async function dominantColour(file) {
  const { data } = await sharp(file).resize(80, 120, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 3) {
    const key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(key, b);
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  return hex({ r: top.r / top.n, g: top.g / top.n, b: top.b / top.n });
}

const paragraphs = body => body.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
const iso = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v) : '');

const out = [];
for (const book of listBooks()) {
  const d = book.data;
  if (d.draft === true) continue;
  const cover = coverPath(book.slug);
  if (!fs.existsSync(cover)) { console.warn(`skip ${book.slug}: no cover yet`); continue; }
  const meta = await sharp(cover).metadata();
  const color = d.spine_color || await dominantColour(cover);
  const h = Number(d.height_cm) || DEFAULT_HEIGHT[d.format] || 21;
  const pages = Number(d.pages) || 0;
  const t = Number(d.thickness_cm) || (pages ? Math.min(6, Math.max(1.2, pages * 0.0068 + 0.25)) : 2.2);
  out.push({
    slug: book.slug,
    title: d.title || book.slug,
    author: d.author || '',
    color,
    ink: d.spine_ink || (luminance(color) > 0.35 ? 'dark' : 'light'),
    h, t: Math.round(t * 100) / 100,
    w: Math.round(h * meta.width / meta.height * 100) / 100,
    cover: `covers/${book.slug}.webp?v=${crypto.createHash('md5').update(fs.readFileSync(cover)).digest('hex').slice(0, 8)}`,
    status: d.status || 'read',
    date: iso(d.date),
    rating: Number(d.rating) || 0,
    genre: d.genre || '', pages: pages || '', year: d.year || '', publisher: d.publisher || '',
    bestFor: d.best_for || '', verdict: d.verdict || '',
    review: paragraphs(book.body),
    placeholder: d.placeholder === true,
  });
}
// oldest on the left, newest on the right; books in progress go last
out.sort((a, b) => (a.status === 'reading') - (b.status === 'reading') || a.date.localeCompare(b.date));
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'books.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`books.json: ${out.length} books`);
