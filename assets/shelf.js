// Bookshelf: renders data/books.json as an angled 3D row of books.
(async () => {
const BOOKS = await fetch('data/books.json', { cache: 'no-cache' }).then(r => r.json());
const PX = 12;          // px per cm
const ANGLE = -36;      // each book turned so its cover faces right
const CS = Math.cos(ANGLE*Math.PI/180), SN = Math.abs(Math.sin(ANGLE*Math.PI/180));
const SHOW = 0.26;      // share of each cover left visible before the next book
const GAP = 1.5;        // px between books (avoids z-fighting)
const TILT = 11;        // degrees
const stage = document.getElementById('stage');
const scene = document.getElementById('scene');
document.getElementById('count').textContent = BOOKS.length;

// lay out along X; spine faces +Z (the camera side), cover faces +X
const steps = BOOKS.map(b => b.t * PX * CS + SHOW * b.w * PX * SN);
const last = BOOKS[BOOKS.length - 1];
const total = steps.slice(0, -1).reduce((a, b) => a + b, 0) + last.t * PX * CS + last.w * PX * SN;
let x = -total / 2;
const els = BOOKS.map((b, i) => {
  const T = b.t * PX, H = b.h * PX, W = b.w * PX;
  const el = document.createElement('div');
  el.className = 'book';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${b.title} by ${b.author}`);
  el.style.width = T + 'px';
  el.style.height = H + 'px';
  el.innerHTML = `
    <div class="face floor" style="width:${T + 6}px;height:${W}px;transform:translate3d(-3px,${H}px,${-W}px) rotateX(90deg)"></div>
    <div class="face cover" style="width:${W}px;height:${H}px;left:${T}px;background-image:url('${b.cover}');transform:rotateY(90deg)"></div>
    <div class="face top" style="width:${T}px;height:${W}px;transform:translateZ(${-W}px) rotateX(90deg)"></div>
    <div class="face spine ${b.ink}" style="width:${T}px;height:${H}px;background:${b.color}"><span>${b.title}</span></div>`;
  stage.appendChild(el);
  const item = { el, x, H, T, W, b };
  x += steps[i];
  return item;
});

// uniform title size: fit the thinnest spine, cap at 18px
const minT = Math.min(...els.map(e => e.T));
scene.style.setProperty('--fs', Math.min(18, Math.round(minT * 0.62)) + 'px');

const tf = (x, y, z, ry, rz, k) => `translate3d(${x}px,${y}px,${z}px) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${k})`;
function place(active = -1) {
  els.forEach((e, i) => {
    let dx = e.x, rot = 0;
    if (active >= 0) {
      const a = els[active];
      const room = a.H * Math.sin(TILT * Math.PI / 180) * CS + 6;
      if (i < active) dx -= room;                 // books behind make room
      if (i === active) rot = -TILT;               // lean back on its rear edge
    }
    e.el.style.transform = tf(dx, 0, 0, ANGLE, rot, 1);
  });
}
place();

let current = -1, openIdx = -1, landTimer = 0, quietFocus = false;
els.forEach((e, i) => {
  e.el.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse' && openIdx < 0 && !busy) { current = i; place(i); } });
  e.el.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse' && openIdx < 0) { current = -1; place(); } });
  e.el.addEventListener('pointermove', ev => { if (ev.pointerType === 'mouse' && openIdx < 0 && !busy && current !== i) { current = i; place(i); } });
  e.el.addEventListener('focus', () => { if (openIdx < 0 && !quietFocus) { current = i; place(i); } });
  e.el.addEventListener('blur', () => { if (openIdx < 0) { current = -1; place(); } });
  e.el.addEventListener('click', ev => { if (Date.now() - touchAt < 800 || ev.pointerType === 'touch' || ev.pointerType === 'pen') return; openBook(i); });
  e.el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openBook(i); } });
});

const $ = id => document.getElementById(id);
const detail = $('detail'), slot = $('slot'), slotImg = $('slotImg'), panel = $('panel'), backBtn = $('back');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function fill(b) {
  detail.style.setProperty('--swatch', b.color);
  slot.style.setProperty('--ar', (b.w / b.h).toFixed(4));
  slotImg.src = b.cover;
  slotImg.alt = `Cover of ${b.title}`;
  $('dAuthor').textContent = b.author;
  $('dTitle').textContent = b.title;
  const r = b.rating || 0;
  const status = b.status === 'reading'
    ? `<span class="chip reading">Reading now</span><span>Started ${fmtDate(b.date)}</span>`
    : `<span class="chip">Read</span><span>Finished ${fmtDate(b.date)}</span>`;
  $('dMeta').innerHTML = (r ? `<span class="stars" role="img" aria-label="${r} out of 5 stars">&#9733;&#9733;&#9733;&#9733;&#9733;<span style="width:${r / 5 * 100}%">&#9733;&#9733;&#9733;&#9733;&#9733;</span></span><span class="score">${r}/5</span>` : '') + status;
  $('dVerdict').textContent = b.verdict;
  $('dReview').innerHTML = b.review.map(p => `<p>${esc(p)}</p>`).join('');
  const facts = [['Genre', b.genre], ['Pages', b.pages], ['Published', b.year], ['Publisher', b.publisher], ['Best for', b.bestFor]].filter(f => f[1]);
  $('dPlaceholder').hidden = !b.placeholder;
  $('dFacts').innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
}

// ---------- 3D maths: build each frame as a matrix so the path is fully controlled ----------
const RAD = Math.PI / 180;
const mul = (A, B) => { const C = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += A[k * 4 + r] * B[c * 4 + k]; C[c * 4 + r] = s; } return C; };
const Tm = (x, y, z) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
const Ry = a => { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; };
const Rz = a => { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]; };
const Sm = k => [k,0,0,0, 0,k,0,0, 0,0,k,0, 0,0,0,1];
const css = M => `matrix3d(${M.map(v => +v.toFixed(5)).join(',')})`;
const apply = (M, p) => [0, 1, 2].map(r => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = t => Math.min(1, Math.max(0, t));
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 4);
const easeInOutQ = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const seg = (t, a, b, f) => f(clamp01((t - a) / (b - a)));

// the book pivots around the centre of its cover's bottom edge, so it never swings its edge at the camera
const pivotOf = e => [e.T, 0, -e.W / 2];
const poseMatrix = (e, P, ry, rz, k) => { const p = pivotOf(e); return mul(mul(mul(mul(Tm(P[0], P[1], P[2]), Ry(ry)), Rz(rz)), Sm(k)), Tm(-p[0], -p[1], -p[2])); };
function shelfPose(e, rz = 0) { const M = mul(mul(Tm(e.x, 0, 0), Ry(ANGLE)), Rz(rz)); return { P: apply(M, pivotOf(e)), ry: ANGLE, rz, k: 1 }; }
function slotPose(e) {
  const R = slot.getBoundingClientRect(), S = scene.getBoundingClientRect();
  const ox = S.left + S.width / 2 + pan, oy = S.top + floorY;
  const k = R.height / (e.H * scaleS);
  const x = (R.left - ox) / scaleS, y = (R.bottom - oy) / scaleS;
  const M = mul(mul(Tm(x, y, -e.T * k), Ry(-90)), Sm(k));     // cover lands flat at depth 0
  return { P: apply(M, pivotOf(e)), ry: -90, rz: 0, k };
}
// Opening happens in two moves, like taking a real book off a shelf:
// 1) pull it straight out of the row towards you (it stays correctly between its neighbours),
// 2) once it is clear of the row, it moves onto its own layer above the shelf, the shelf fades as one,
//    and the book turns to face you while gliding and growing into place.
const stage2 = document.getElementById('stage2');
const PULL_DUR = 280, TURN_DUR = 520;
function pullPose(e) {
  const d = e.W + 14 * PX / 12, lift = 10;               // slide out by its full depth so it clears both neighbours
  const M = mul(mul(Tm(e.x, 0, 0), Ry(ANGLE)), Tm(0, -lift, d));
  return { P: apply(M, pivotOf(e)), ry: ANGLE, rz: 0, k: 1 };
}
function frames(e, A, B, opt = {}) {
  const out = [], N = opt.n || 32;
  const [r0, r1] = opt.rot || [0, 1];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const pt = easeOut(t), kt = easeOut(t), rt = seg(t, r0, r1, easeOut);
    const arc = opt.arc ? Math.sin(Math.PI * pt) * opt.arc : 0;
    const P = [lerp(A.P[0], B.P[0], pt), lerp(A.P[1], B.P[1], pt) - arc, lerp(A.P[2], B.P[2], pt)];
    const k = Math.exp(lerp(Math.log(A.k), Math.log(B.k), kt));
    out.push({ transform: css(poseMatrix(e, P, lerp(A.ry, B.ry, rt), lerp(A.rz, B.rz, rt), k)) });
  }
  return out;
}
const poseCss = (e, p) => css(poseMatrix(e, p.P, p.ry, p.rz, p.k));
let anim = null;
function run(e, list, dur, done) {
  if (anim) { anim.cancel(); anim = null; }
  e.el.style.transition = 'none';
  e.el.style.transform = list[list.length - 1].transform;
  if (reduced) { done(); return; }
  anim = e.el.animate(list, { duration: dur, easing: 'linear' });
  anim.onfinish = () => { anim = null; done(); };
}
function toLayer(e, layerStage, transform) {           // move the book between layers without a visible jump
  e.el.style.transition = 'none';
  e.el.style.transform = transform;
  layerStage.appendChild(e.el);
}

function showLanded(i) {
  const e = els[i];
  fill(e.b);
  slot.classList.add('snap', 'show');      // flat cover appears in exactly the same spot, no fade
  e.el.classList.add('landed');
  requestAnimationFrame(() => requestAnimationFrame(() => slot.classList.remove('snap')));
  panel.classList.add('show');
  pager.textContent = `${i + 1} of ${els.length}`;
}

function openBook(i) {
  if (openIdx >= 0 || busy) return;
  busy = true;
  const e = els[i];
  const startRz = current === i ? -TILT : 0;
  openIdx = i; current = -1;
  els.forEach((x, j) => { if (j !== i) x.el.style.transform = tf(x.x, 0, 0, ANGLE, 0, 1); });
  els.forEach((x, j) => x.el.classList.toggle('fade', j !== i));
  e.el.classList.add('lifted');
  const pulled = pullPose(e);
  run(e, frames(e, shelfPose(e, startRz), pulled, { n: 20 }), PULL_DUR, () => {
    // clear of the row: hand over to the top layer, fade the shelf, turn and glide
    toLayer(e, stage2, poseCss(e, pulled));
    fill(e.b);
    pager.textContent = `${i + 1} of ${els.length}`;
    detail.scrollTop = 0;
    document.body.classList.add('open');
    scene.classList.add('lifting');
    detail.setAttribute('aria-hidden', 'false');
    const target = slotPose(e);
    setTimeout(() => panel.classList.add('show'), reduced ? 0 : TURN_DUR * .45);
    run(e, frames(e, pulled, target, { rot: [0, .7], arc: 14 }), TURN_DUR, () => {
      showLanded(i); busy = false; backBtn.focus({ preventScroll: true });
    });
  });
}

function closeBook() {
  if (openIdx < 0 || busy) return;
  busy = true;
  const i = openIdx, e = els[i];
  detail.scrollTop = 0;
  const from = slotPose(e), pulled = pullPose(e);
  e.el.classList.remove('landed');
  slot.classList.add('snap'); slot.classList.remove('show');
  requestAnimationFrame(() => requestAnimationFrame(() => slot.classList.remove('snap')));
  panel.classList.remove('show');
  document.body.classList.remove('open');
  scene.classList.remove('lifting');
  detail.setAttribute('aria-hidden', 'true');
  openIdx = -1;
  run(e, frames(e, from, pulled, { rot: [0, .8], arc: 14 }), TURN_DUR, () => {
    // back in front of its gap: return to the shelf layer and slide home
    toLayer(e, stage, poseCss(e, pulled));
    els.forEach(x => x.el.classList.remove('fade'));
    run(e, frames(e, pulled, shelfPose(e), { n: 20 }), PULL_DUR, () => {
      e.el.classList.remove('lifted');
      e.el.style.transform = tf(e.x, 0, 0, ANGLE, 0, 1);
      e.el.offsetWidth;                  // commit the resting pose before transitions come back
      e.el.style.transition = '';
      busy = false;
      quietFocus = true;                 // keyboard focus returns without tilting the book
      e.el.focus({ preventScroll: true });
      quietFocus = false;
    });
  });
}

// previous / next while open: swap the flat cover and text; the next book takes the top layer
function step(dir) {
  if (openIdx < 0 || busy) return;
  const from = openIdx, to = (from + dir + els.length) % els.length;
  busy = true;
  detail.classList.add(dir > 0 ? 'out-left' : 'out-right');
  setTimeout(() => {
    const a = els[from], b = els[to];
    a.el.classList.remove('landed', 'lifted');
    a.el.classList.add('fade');
    toLayer(a, stage, tf(a.x, 0, 0, ANGLE, 0, 1));
    b.el.classList.remove('fade');
    b.el.classList.add('lifted', 'landed');
    openIdx = to;
    detail.scrollTop = 0;
    showLanded(to);
    toLayer(b, stage2, poseCss(b, slotPose(b)));
    detail.classList.remove('out-left', 'out-right');
    detail.classList.add(dir > 0 ? 'in-right' : 'in-left');
    requestAnimationFrame(() => requestAnimationFrame(() => { detail.classList.remove('in-right', 'in-left'); }));
    setTimeout(() => { busy = false; }, 320);
  }, 220);
}

let busy = false;
const pager = $('pager');
backBtn.addEventListener('click', closeBook);
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
addEventListener('keydown', ev => {
  if (openIdx < 0) return;
  if (ev.key === 'Escape') closeBook();
  if (ev.key === 'ArrowRight') step(1);
  if (ev.key === 'ArrowLeft') step(-1);
});
detail.addEventListener('click', ev => { if (ev.target === detail || ev.target.classList.contains('detail-inner')) closeBook(); });
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;


// ---------- touch: drag to tilt the book under your finger, swipe or hold at an edge to travel ----------
const minH = Math.min(...els.map(e => e.H));
function bookAt(x) {
  const S = scene.getBoundingClientRect();
  const y = S.top + floorY - minH * scaleS * 0.45;        // a line every book crosses
  const hit = document.elementFromPoint(x, y);
  const el = hit && hit.closest ? hit.closest('.book') : null;
  return els.findIndex(e => e.el === el);
}
function scrubTo(x) { const i = bookAt(x); if (i !== current) { current = i; place(i); } }
let g = null, flingRaf = 0, edgeRaf = 0, releaseT = 0;
function edgeLoop() {
  if (!g) return;
  if (canPan) {
    const S = scene.getBoundingClientRect(), zone = Math.min(64, S.width * .16);
    let v = 0;
    if (g.x < S.left + zone) v = (S.left + zone - g.x) / zone * 9;
    else if (g.x > S.right - zone) v = -(g.x - (S.right - zone)) / zone * 9;
    if (v) { setPan(pan + v); scrubTo(g.x); }
  }
  edgeRaf = requestAnimationFrame(edgeLoop);
}
function fling(v) {
  cancelAnimationFrame(flingRaf);
  stage.classList.add('dragging');
  let last = performance.now();
  const tick = now => {
    const dt = Math.min(32, now - last); last = now;
    setPan(pan + v * dt);
    v *= Math.pow(.94, dt / 16);
    if (Math.abs(v) > .02 && pan > panLo && pan < panHi) flingRaf = requestAnimationFrame(tick);
    else stage.classList.remove('dragging');
  };
  flingRaf = requestAnimationFrame(tick);
}
scene.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' || openIdx >= 0 || busy) return;
  touchAt = Date.now();
  cancelAnimationFrame(flingRaf); clearTimeout(releaseT);
  const now = performance.now();
  g = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, moved: false, vx: 0, lx: ev.clientX, lt: now };
  try { scene.setPointerCapture(ev.pointerId); } catch (_) {}
  stage.classList.add('dragging');
  scrubTo(ev.clientX);
  edgeRaf = requestAnimationFrame(edgeLoop);
});
scene.addEventListener('pointermove', ev => {
  if (!g || ev.pointerId !== g.id) return;
  const now = performance.now();
  if (!g.moved && Math.abs(ev.clientX - g.x0) > 8) g.moved = true;
  const dt = now - g.lt;
  if (dt > 0) g.vx = .7 * ((ev.clientX - g.lx) / dt) + .3 * g.vx;
  g.lx = ev.clientX; g.lt = now; g.x = ev.clientX;
  scrubTo(g.x);
});
function endGesture(ev, cancelled) {
  if (!g || ev.pointerId !== g.id) return;
  const was = g; g = null; touchAt = Date.now();
  cancelAnimationFrame(edgeRaf);
  stage.classList.remove('dragging');
  if (cancelled) { current = -1; place(); return; }
  if (!was.moved) {                                    // a tap opens the book under the finger
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const el = hit && hit.closest ? hit.closest('.book') : null;
    const i = els.findIndex(e => e.el === el);
    if (i >= 0) { current = i; openBook(i); return; }
  } else if (canPan && Math.abs(was.vx) > .35 && performance.now() - was.lt < 80) {
    fling(was.vx);                                     // a quick swipe keeps the shelf moving
  }
  releaseT = setTimeout(() => { if (!g && openIdx < 0) { current = -1; place(); } }, 450);
}
scene.addEventListener('pointerup', ev => endGesture(ev, false));
scene.addEventListener('pointercancel', ev => endGesture(ev, true));
let wheelT = 0;                                        // trackpads can scroll a long shelf sideways too
scene.addEventListener('wheel', ev => {
  if (!canPan || openIdx >= 0) return;
  ev.preventDefault();                                 // over a long shelf, either scroll direction travels along it
  const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
  stage.classList.add('dragging');
  setPan(pan - d);
  clearTimeout(wheelT); wheelT = setTimeout(() => stage.classList.remove('dragging'), 140);
}, { passive: false });


// mouse: click and drag a long shelf sideways (a plain click still opens a book)
let md = null;
scene.addEventListener('pointerdown', ev => {
  if (ev.pointerType !== 'mouse' || ev.button !== 0 || !canPan || openIdx >= 0 || busy) return;
  cancelAnimationFrame(flingRaf);
  md = { id: ev.pointerId, x0: ev.clientX, p0: pan, moved: false, lx: ev.clientX, lt: performance.now(), vx: 0 };
});
addEventListener('pointermove', ev => {
  if (!md || ev.pointerId !== md.id) return;
  const dx = ev.clientX - md.x0, now = performance.now();
  if (!md.moved && Math.abs(dx) > 6) {
    md.moved = true;
    try { scene.setPointerCapture(ev.pointerId); } catch (_) {}
    stage.classList.add('dragging'); scene.classList.add('grabbing');
  }
  if (md.moved) {
    const dt = now - md.lt;
    if (dt > 0) md.vx = .7 * ((ev.clientX - md.lx) / dt) + .3 * md.vx;
    md.lx = ev.clientX; md.lt = now;
    setPan(md.p0 + dx);
  }
});
addEventListener('pointerup', ev => {
  if (!md || ev.pointerId !== md.id) return;
  const m = md; md = null;
  scene.classList.remove('grabbing');
  if (!m.moved) return;
  touchAt = Date.now();                                // swallow the click that ends a drag
  if (Math.abs(m.vx) > .35 && performance.now() - m.lt < 80) fling(m.vx); else stage.classList.remove('dragging');
});

// scale the whole row to fit narrow screens
let MIN_S = 0.72;           // smallest the shelf may shrink; on wider screens it stays near full size and scrolls instead
let pan = 0, panLo = 0, panHi = 0, canPan = false, touchAt = 0, measured = false;
function setPan(v) { pan = Math.max(panLo, Math.min(panHi, v)); scene.style.setProperty('--pan', pan + 'px'); }
// measure what the row actually covers on screen, so it centres when it fits and pans edge to edge when it doesn't
function measurePan() {
  const keep = stage.classList.contains('dragging');
  stage.classList.add('dragging');
  scene.style.setProperty('--pan', '0px');
  let L = Infinity, R = -Infinity;
  els.forEach(e => e.el.querySelectorAll('.spine,.cover').forEach(f => { const r = f.getBoundingClientRect(); if (r.width) { L = Math.min(L, r.left); R = Math.max(R, r.right); } }));
  const S = scene.getBoundingClientRect(), m = 12;
  if (R - L + 2 * m <= S.width) { canPan = false; panLo = panHi = (S.left + S.width / 2) - (L + R) / 2; }
  else { canPan = true; panHi = (S.left + m) - L; panLo = (S.right - m) - R; }
  scene.classList.toggle('overflow', canPan);
  setPan(measured ? pan : (panLo + panHi) / 2);
  measured = true;
  if (!keep) requestAnimationFrame(() => stage.classList.remove('dragging'));
}
const maxH = Math.max(...els.map(e => e.H));
let scaleS = 1, floorY = 0;
function fit() {
  const avail = scene.clientWidth;
  MIN_S = avail > 760 ? 0.92 : 0.72;
  const fitS = Math.min(1, avail / (total + 60));
  const s = Math.max(fitS, Math.min(1, MIN_S));          // never shrink past legible; overflow becomes swipeable
  scaleS = s; floorY = Math.round((maxH + 40) * s);
  scene.style.setProperty("--s", s);
  scene.style.setProperty('--scene-h', Math.round((maxH + 110) * s) + 'px');
  scene.style.setProperty('--floor-y', Math.round((maxH + 40) * s) + 'px');
  if (openIdx < 0) measurePan();
}
fit();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (openIdx < 0) measurePan(); });
addEventListener('resize', () => { fit(); if (openIdx >= 0 && !busy) { const e = els[openIdx]; e.el.style.transform = poseCss(e, slotPose(e)); } });
})();
