// Small helpers shared by the scripts: read and write the book Markdown files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BOOKS_DIR = path.join(ROOT, 'books');
export const COVERS_DIR = path.join(ROOT, 'covers');

// Frontmatter is simple `key: value` lines. Quoted values are JSON strings; numbers and true/false are typed.
function parseValue(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function readBook(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const data = {};
  const order = [];
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i < 1 || line.trim().startsWith('#')) continue;
      const key = line.slice(0, i).trim();
      data[key] = parseValue(line.slice(i + 1));
      order.push(key);
    }
  }
  const body = (m ? m[2] : text).trim();
  return { file, slug: path.basename(file, '.md'), data, order, body };
}

const fmt = v => typeof v === 'string' ? (/^[\w.-]+$/.test(v) && !/^(true|false|-?\d+(\.\d+)?)$/.test(v) ? v : JSON.stringify(v)) : String(v);

export function writeBook(book) {
  const keys = [...book.order, ...Object.keys(book.data).filter(k => !book.order.includes(k))];
  const lines = keys.filter(k => book.data[k] !== undefined && book.data[k] !== '').map(k => `${k}: ${fmt(book.data[k])}`);
  fs.writeFileSync(book.file, `---\n${lines.join('\n')}\n---\n\n${book.body}\n`);
}

export function listBooks() {
  return fs.readdirSync(BOOKS_DIR).filter(f => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
    .map(f => readBook(path.join(BOOKS_DIR, f)));
}

export const coverPath = slug => path.join(COVERS_DIR, `${slug}.webp`);
