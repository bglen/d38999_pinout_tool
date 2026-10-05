/* D38999 pinout tool.
 *
 * Coordinates come from MIL-STD-1560C w/Change 3, which tabulates the front face
 * of the PIN insert; a socket insert's mating face is the mirror image, as is either
 * insert seen from the rear, so X is negated when exactly one of those applies. The main key/keyway is at +Y and does not rotate with the
 * insert (MIL-DTL-38999N figure 6 note 4). Minor keys rotate away from the main
 * key counter-clockwise on a receptacle and clockwise on a plug, as seen looking
 * at that connector's own mating face.
 */
'use strict';

const DATA = window.D38999_DATA;
const MM = 25.4;                       // MIL-STD-1560C tabulates inches
const SVGNS = 'http://www.w3.org/2000/svg';

const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2',
                 '#db2777', '#65a30d', '#ea580c', '#0d9488', '#9333ea', '#b91c1c',
                 '#4f46e5', '#ca8a04', '#be123c', '#047857'];

const COLOR = {
  shell: '#c9ced6', shellEdge: '#7c8592',
  bore: '#f2f4f7', insert: '#e7dccb', insertEdge: '#a3937a',
  pin: '#dfe4ea', pinEdge: '#69707a',
  text: '#1b1f24', sel: '#1d4ed8',
};

const state = {
  pn: '', decoded: null, arrKey: null, arr: null,
  pnOverride: '',              // part number shown on exports in place of the decoded one
  socket: false, rear: false, mirror: false, labels: 'id', filter: '',
  pins: Object.create(null),   // contact id -> {signal, color, group}
  groups: [],                  // {gid, name, color}
  sel: new Set(),
  nextGid: 1,
  view: null,                  // {x, y, w, h} in mm, SVG coordinates
};

/* ------------------------------------------------------------------ utils */

const $ = (sel) => document.querySelector(sel);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function el(tag, attrs, kids) {
  const node = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k]);
  for (const kid of kids || []) node.appendChild(kid);
  return node;
}

function html(tag, attrs, kids) {
  const node = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === 'text') node.textContent = attrs[k];
    else if (k === 'class') node.className = attrs[k];
    else if (k in node && k !== 'list') node[k] = attrs[k];
    else node.setAttribute(k, attrs[k]);
  }
  for (const kid of kids || []) node.appendChild(kid);
  return node;
}

function readable(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  const l = .2126 * f(n >> 16 & 255) + .7152 * f(n >> 8 & 255) + .0722 * f(n & 255);
  return l > .45 ? '#14171b' : '#ffffff';
}

function titleCase(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* ------------------------------------------------------- arrangement keys */

/* D38999 arrangements are keyed "16-35"; Glenair 806 ones "806:16-32", since the
   two catalogues reuse arrangement numbers for different layouts. */
const is806 = (key) => !!key && key.startsWith('806:');
const arrNumber = (key) => (is806(key) ? key.slice(4) : key);
const arrName = (key) => (is806(key) ? `Glenair 806 ${arrNumber(key)}` : key);

/* ---------------------------------------------------------------- decoding */

const PIN_RE = /^(\d{2})([A-Z]{2}-|[A-Z])([A-HJ])(\d{1,2})([A-Z])([A-Z])$/;

function decode(raw) {
  const pin = String(raw).toUpperCase().replace(/\s+/g, '').replace(/^D38999\/?/, '');
  const out = { pin, warnings: [] };
  const m = PIN_RE.exec(pin);
  if (!m) {
    out.error = 'Expected <slash sheet><class><shell code><arrangement><contact><polarization>, ' +
                'for example 24FA35SN. Two-letter classes need a trailing hyphen (24AA-A35SN).';
    return out;
  }
  const [, slash, clsRaw, shellCode, arrNo, contact, position] = m;
  const cls = clsRaw.replace(/-$/, '');
  const style = DATA.styles[String(Number(slash))];
  if (!style) { out.error = `/${slash} is not a MIL-DTL-38999 slash sheet in this data set.`; return out; }
  if (style.schema !== 'standard') {
    out.error = `/${slash} is a ${style.kind} (${style.mounting}); its part numbers do not use ` +
                'the standard shell/arrangement/contact format.';
    return out;
  }
  const klass = DATA.classes[cls];
  if (!klass) { out.error = `Class ${cls} is not in MIL-DTL-38999N table II.`; return out; }
  const style2 = DATA.contactStyles[contact];
  if (!style2) { out.error = `Contact style ${contact} is not in MIL-DTL-38999N 1.4.2.`; return out; }
  const shell = DATA.shellSizes[shellCode];

  Object.assign(out, {
    slash: Number(slash), style, cls, klass, shellCode, shell,
    contact, contactStyle: style2, position,
    arrangement: `${shell}-${Number(arrNo)}`,
  });

  if (style.shell_sizes.length && !style.shell_sizes.includes(shell))
    out.warnings.push(`/${slash} is not listed for shell size ${shell}.`);
  if (klass.hermetic !== style.hermetic)
    out.warnings.push(`Class ${cls} is ${klass.hermetic ? 'hermetic' : 'environment resisting'} ` +
                      `but /${slash} is ${style.hermetic ? 'hermetic' : 'environment resisting'}.`);
  if (style2.hermetic_only && !klass.hermetic)
    out.warnings.push(`Contact style ${contact} (${style2.description}) is offered on hermetic classes only.`);
  if (klass.notes) out.warnings.push(`Class ${cls}: ${klass.notes}.`);

  if (style.series === 'III') {
    const row = DATA.polarization.find((p) => p.sizes.includes(shell) && p.position === position);
    if (row) out.angles = row.angles;
    else out.warnings.push(`Polarization ${position} is not tabulated for shell size ${shell}.`);
  } else {
    out.warnings.push(`Series ${style.series} minor key angles are not tabulated in MIL-DTL-38999N ` +
                      'figure 6; only the main key position is drawn.');
  }

  const arr = DATA.arrangements[out.arrangement];
  if (!arr) {
    out.error = `Insert arrangement ${out.arrangement} is not in MIL-STD-1560C w/Change 3.`;
    return out;
  }
  out.arr = arr;
  if (arr.alias)
    out.warnings.push(`MIL-STD-1560C prints no coordinate table for ${out.arrangement}; ` +
                      `coordinates are taken from the identical arrangement ${arr.alias}.`);
  return out;
}

/* ------------------------------------------------- arrangement preparation */

function nearestNeighbour(pts) {
  return pts.map((p, i) => {
    let best = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(p.x - pts[j].x, p.y - pts[j].y);
      if (d < best) best = d;
    }
    return best === Infinity ? 1 : best;
  });
}

/* Contact circles are the socket cavity diameter, enlarged by at most this much
   so the ID labels stay legible; 1 would be true size. */
const CONTACT_SCALE = 1.3;

function contactRadii(pts, dia) {
  let s = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      s = Math.min(s, d / ((dia[i] + dia[j]) / 2));
    }
  s = Number.isFinite(s) ? clamp(s * 0.88, 1, CONTACT_SCALE) : CONTACT_SCALE;
  return dia.map((d) => (d / 2) * s);
}

/* MIL-STD-1560C designation order: capitals without I O Q, then lower case,
   then doubled capitals.  Numbers lead a purely numeric arrangement and follow
   the letters in a mixed one, which is how the standard continues its lists.
   Glenair 806 combination inserts list the numbered contacts first. */
const UPSEQ = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const LOSEQ = 'abcdefghijkmnpqrstuvwxyz';

function idRanker(ids, numbersFirst) {
  const anyAlpha = ids.some((id) => /[A-Za-z]/.test(id));
  return (id) => {
    if (/^\d+$/.test(id)) return (anyAlpha && !numbersFirst ? 4000 : 0) + Number(id);
    const c = id[0];
    const lower = c >= 'a' && c <= 'z';
    const seq = lower ? LOSEQ : UPSEQ;
    const off = seq.indexOf(c) >= 0 ? seq.indexOf(c) : 100 + c.charCodeAt(0);
    return (id.length > 1 ? 3000 : lower ? 2000 : 1000) + off;
  };
}

function prepare(arrKey, mirror) {
  const a = DATA.arrangements[arrKey];
  const sign = mirror ? -1 : 1;
  const rank = idRanker(a.contacts.map((c) => c[0]), a.family === '806');
  const ordered = a.contacts.slice().sort((p, q) => rank(p[0]) - rank(q[0]));
  const pts = ordered.map(([id, x, y, size]) => ({ id, size, x: sign * x * MM, y: -y * MM }));
  const dia = ordered.map(([, , , size]) => {
    const d = DATA.contactDims[size];
    return (d ? d.cavity : 0.035) * MM;
  });
  const r = contactRadii(pts, dia);
  pts.forEach((p, i) => { p.r = r[i]; p.i = i; });

  const nn = nearestNeighbour(pts);
  pts.forEach((p, i) => { p.nn = nn[i]; });
  const pitch = Math.min(...nn);

  const index = new Map(pts.map((p) => [p.id, p]));
  const reach = Math.max(...pts.map((p) => Math.hypot(p.x, p.y) + p.r));
  return { key: arrKey, meta: a, pts, index, pitch, reach, mirror };
}

/* ------------------------------------------------------------ shell layout */

/** Radial slot with parallel sides and a circular tip, centred on an SVG angle. */
function slotPath(angleRad, width, r0, r1) {
  const dx = Math.sin(angleRad), dy = -Math.cos(angleRad);      // SVG: +Y is down
  const px = -dy, py = dx;
  const h = Math.min(width / 2, r0 * 0.98);
  const a0 = Math.sqrt(Math.max(r0 * r0 - h * h, 0));
  const a1 = Math.sqrt(Math.max(r1 * r1 - h * h, 1e-6));
  const P = (a, s) => `${(dx * a + px * h * s).toFixed(4)},${(dy * a + py * h * s).toFixed(4)}`;
  return `M${P(a0, 1)}L${P(a1, 1)}A${r1},${r1} 0 0 0 ${P(a1, -1)}L${P(a0, -1)}` +
         `A${r0},${r0} 0 0 1 ${P(a0, 1)}Z`;
}

/**
 * Shell envelope for the mating-face view.  Minor key angles are measured from
 * the main key at +Y: counter-clockwise on a receptacle, clockwise on a plug
 * (MIL-DTL-38999N figure 6).
 */
function shellLayout(decoded, arr) {
  const shell = arr.meta.shell;
  const dims = arr.meta.family === '806' ? null : DATA.interface[String(shell)];
  const plug = !!decoded && decoded.style.kind === 'plug';
  const normal = DATA.polarization.find((p) => p.sizes.includes(shell) && p.position === 'N');
  const angles = decoded ? (decoded.angles || []) : ((normal && normal.angles) || []);
  const keys = [{ deg: 0, label: 'Main', width: null }].concat(
    angles.map((deg, i) => ({ deg, label: 'ABCD'[i], width: null })));

  if (!dims) {
    // MIL-DTL-38999N tabulates shell interface dimensions for odd (series I/III/IV)
    // shell sizes only; even sizes are series II and are drawn without a shell, as
    // are Glenair 806 inserts, whose shells are not in the data.
    const rIns = arr.reach * 1.14;
    return { plug, fallback: true, rIns, rBore: rIns, rShell: rIns * 1.08, rKey: rIns * 1.2,
             keys: [{ deg: 0, label: 'Main', width: rIns * 0.16 }], cw: plug };
  }
  const w = DATA.keyWidths;
  for (const k of keys) {
    const main = k.deg === 0;
    k.width = plug ? (main ? w.plug_main : w.plug_minor)
                   : (main ? w.receptacle_main : w.receptacle_minor);
  }
  const rIns = Math.max(dims.G / 2, arr.reach * 1.04);
  return plug
    ? { plug, rIns, rBore: dims.W / 2, rShell: dims.W / 2, rKey: dims.V / 2, keys, cw: true }
    : { plug, rIns, rBore: dims.H / 2, rShell: dims.F / 2, rKey: dims.J / 2, keys, cw: false };
}

/* ---------------------------------------------------------- group outlines */

/* A group outline reaches at most this fraction of the way to the nearest contact
   outside the group, so two neighbouring groups keep a clear gap. */
const GROUP_REACH = 0.36;
const GROUP_TINT = 0.25;               // fill strength over the insert face
const LINK_SPAN = 2.0;                 // longest link, in multiples of the local contact spacing

/**
 * Distance from (px, py) to the convex hull of two discs: a "capsule" whose ends
 * may have different radii.  Negative inside.
 */
function hullDistance(px, py, a, ra, b, rb) {
  const vx = b.x - a.x, vy = b.y - a.y, h = Math.hypot(vx, vy);
  const ux = vx / h, uy = vy / h;
  const along = (px - a.x) * ux + (py - a.y) * uy;
  const across = Math.abs((px - a.x) * uy - (py - a.y) * ux);
  const s = (ra - rb) / h, c = Math.sqrt(Math.max(0, 1 - s * s));
  const k = c * along - s * across;
  if (k < 0) return Math.hypot(across, along) - ra;
  if (k > c * h) return Math.hypot(across, along - h) - rb;
  return c * across + s * along - ra;
}

function segmentDistance(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

function insideTriangle(p, a, b, c) {
  const s = (u, v) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

/**
 * The band joining two discs, bounded by their outer common tangents, so its
 * straight sides meet both circles tangentially.  Null if one disc swallows the other.
 */
function tangentBand(a, ra, b, rb) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  const s = (ra - rb) / d;
  if (!(Math.abs(s) < 1)) return null;
  const ux = dx / d, uy = dy / d, c = Math.sqrt(1 - s * s);
  const side = (k) => {
    const mx = s * ux - k * c * uy, my = s * uy + k * c * ux;      // unit normal of the tangent
    return [[a.x + ra * mx, a.y + ra * my], [b.x + rb * mx, b.y + rb * my]];
  };
  const [p1, q1] = side(1), [p2, q2] = side(-1);
  return [p1, q1, q2, p2];
}

/**
 * Exact outline pieces for one group: a disc round each member, a tangent band for
 * each linked pair, and the triangle between any three mutually linked members.
 * Their union is the group's area, and it never covers a contact outside the group;
 * it may cross another group's area, as two crossing differential pairs do.
 *
 * Candidate links are the Gabriel graph of the group's own contacts, so a contact
 * outside the group does not by itself break a link: the band only has to clear it.
 * Links that fit at full width are taken first.  A link that only fits narrower is
 * taken when it joins pieces of the group that are otherwise apart, and the discs at
 * its ends shrink to its width so its sides stay tangent.
 */
function groupShapes(arr, members) {
  const inGroup = new Set(members);
  const others = arr.pts.filter((p) => !inGroup.has(p.i));
  const gap = 0.06 * arr.pitch;
  const minR = (i) => arr.pts[i].r + 0.03 * arr.pitch;
  const clears = (a, ra, b, rb) => others.every((o) => hullDistance(o.x, o.y, a, ra, b, rb) >= o.r + gap - 1e-9);

  const R = new Map();
  for (const i of members) {
    const p = arr.pts[i];
    let r = p.r + 0.2 * arr.pitch;
    for (const o of others) {
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      r = Math.min(r, GROUP_REACH * d, d - o.r - gap);
    }
    R.set(i, Math.max(r, minR(i)));
  }

  const full = [], narrow = [];
  for (let x = 0; x < members.length; x++)
    for (let y = x + 1; y < members.length; y++) {
      const i = members[x], j = members[y], a = arr.pts[i], b = arr.pts[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > LINK_SPAN * Math.max(a.nn, b.nn)) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r2 = (d * d) / 4;
      if (members.some((k) => k !== i && k !== j &&
          (arr.pts[k].x - mx) ** 2 + (arr.pts[k].y - my) ** 2 < r2 - 1e-9)) continue;
      if (clears(a, R.get(i), b, R.get(j))) { full.push([i, j]); continue; }
      // Widest band, of even width, that still clears every contact outside the group.
      let w = Infinity;
      for (const o of others) w = Math.min(w, segmentDistance(o, a, b) - o.r - gap);
      if (w >= Math.max(minR(i), minR(j))) narrow.push([i, j, w]);
    }

  const root = new Map(members.map((i) => [i, i]));
  const find = (i) => { while (root.get(i) !== i) i = root.get(i); return i; };
  const links = [];
  for (const [i, j] of full) { links.push([i, j]); root.set(find(i), find(j)); }
  narrow.sort((p, q) => q[2] - p[2]);
  for (const [i, j, w] of narrow) {
    if (find(i) === find(j)) continue;
    root.set(find(i), find(j));
    links.push([i, j]);
    R.set(i, Math.min(R.get(i), w));
    R.set(j, Math.min(R.get(j), w));
  }

  const key = (i, j) => (i < j ? i + ',' + j : j + ',' + i);
  const linked = new Set(links.map(([i, j]) => key(i, j)));
  const bands = [];
  for (const [i, j] of links) {
    const band = tangentBand(arr.pts[i], R.get(i), arr.pts[j], R.get(j));
    if (band) bands.push(band);
  }

  // Fill between three mutually linked members, unless a foreign contact sits inside.
  const tris = [];
  const nbrs = new Map(members.map((i) => [i, []]));
  for (const [i, j] of links) { nbrs.get(i).push(j); nbrs.get(j).push(i); }
  for (const [i, j] of links)
    for (const k of nbrs.get(i)) {
      if (k <= Math.max(i, j) || !linked.has(key(j, k))) continue;
      const [a, b, c] = [arr.pts[i], arr.pts[j], arr.pts[k]];
      if (others.some((o) => insideTriangle(o, a, b, c))) continue;
      tris.push([a, b, c].map((p) => [p.x, p.y]));
    }

  const discs = members.map((i) => ({ x: arr.pts[i].x, y: arr.pts[i].y, r: R.get(i) }));
  return { discs, bands, tris };
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((pa >> sh) & 255) * t + ((pb >> sh) & 255) * (1 - t));
  return '#' + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------- pin records */

/* Every contact starts as NC, drawn grey.  Naming one gives it a colour of its own. */
const NC = 'NC';
const isNC = (s) => !s || !s.trim() || s.trim().toUpperCase() === NC;

function pin(id) {
  return state.pins[id] || (state.pins[id] = { signal: NC, color: '', group: 0 });
}

/** Older saves used an empty signal for an unassigned contact. */
/* NC contacts belong to no group; older saves may have them in one. */
function normalizePins() {
  for (const id in state.pins)
    if (isNC(state.pins[id].signal)) Object.assign(state.pins[id], { signal: NC, group: 0 });
}

/** A contact's signal for printing: '' when it is NC or has no record yet. */
const signalText = (id) => (state.pins[id] && !isNC(state.pins[id].signal) ? state.pins[id].signal.trim() : '');

function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** A colour no group or contact is using: the palette first, then golden-angle hues. */
function uniqueColor() {
  const used = new Set(state.groups.map((g) => g.color.toLowerCase()));
  for (const id in state.pins) if (state.pins[id].color) used.add(state.pins[id].color.toLowerCase());
  const free = PALETTE.find((c) => !used.has(c));
  if (free) return free;
  for (let k = 0; ; k++) {
    const c = hslHex((k * 137.508 + 17) % 360, 65, 42 + (k % 3) * 7);
    if (!used.has(c)) return c;
  }
}

/** Live edit.  Naming an uncoloured contact gives it a unique colour; renaming keeps it. */
function setSignal(id, value) {
  const rec = pin(id);
  rec.signal = value;
  if (!isNC(value) && !rec.color) rec.color = uniqueColor();
  refreshRow(id);
  save();
  scheduleDiagram();
}

/**
 * End of an edit: a contact left blank or named NC goes back to NC, with the colour it
 * had before if it was already NC, and leaves its group.
 */
function commitSignal(id, before) {
  const rec = pin(id);
  if (!isNC(rec.signal)) return;
  rec.signal = NC;
  rec.color = isNC(before.signal) ? before.color : '';
  refreshRow(id);
  save();
  scheduleDiagram();
  if (rec.group) { rec.group = 0; renderAllSoon(); }
}

/* Re-render everything once the current edit settles (an Enter in the pin table moves
   focus first), then put the focus back in the pin row that had it. */
let renderAllTimer = 0;
function renderAllSoon() {
  clearTimeout(renderAllTimer);
  renderAllTimer = setTimeout(() => {
    const box = document.activeElement;
    const row = box && box.matches('#pins input[type=text]') && box.closest('tr').dataset.id;
    const whole = row && box.selectionStart === 0 && box.selectionEnd === box.value.length;
    renderAll();
    if (!row) return;
    const again = document.querySelector(`#pins tbody tr[data-id="${CSS.escape(row)}"] input[type=text]`);
    if (!again) return;
    again.focus();
    if (whole) again.select();
  });
}

function refreshRow(id) {
  const tr = document.querySelector(`#pins tbody tr[data-id="${CSS.escape(id)}"]`);
  if (!tr) return;
  const color = pinColor(id) || COLOR.pin;
  tr.querySelector('.dot').style.background = color;
  tr.querySelector('input[type=color]').value = color;
  const sig = tr.querySelector('input[type=text]');
  if (sig !== document.activeElement) sig.value = pin(id).signal;
}
function groupOf(id) {
  const g = state.pins[id] && state.pins[id].group;
  return g ? state.groups.find((x) => x.gid === g) : null;
}
function pinColor(id) {
  if (state.pins[id] && isNC(state.pins[id].signal)) return '';   // NC is grey, even mid-edit
  const g = groupOf(id);
  if (g) return g.color;
  return (state.pins[id] && state.pins[id].color) || '';
}
function pinsInGroup(gid) {
  return Object.keys(state.pins).filter((id) => state.pins[id].group === gid);
}

/* ------------------------------------------------------------- the diagram */

function renderDiagram() {
  const svg = $('#svg');
  svg.textContent = '';
  const arr = state.arr;
  $('#empty').hidden = !!arr;
  if (!arr) { svg.removeAttribute('viewBox'); closePop(true); return; }

  const L = shellLayout(state.decoded, arr);
  if (!state.view) fitView(L);
  const v = state.view;
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const unit = v.w / 100;                       // stroke scale that survives zoom
  const g = (cls) => el('g', { class: cls });

  /* shell body ---------------------------------------------------------- */
  const body = g('shell');
  if (L.plug) {
    body.appendChild(el('circle', { cx: 0, cy: 0, r: L.rShell, fill: COLOR.shell,
                                    stroke: COLOR.shellEdge, 'stroke-width': unit * .45 }));
  } else {
    body.appendChild(el('path', {
      d: `M${-L.rShell},0A${L.rShell},${L.rShell} 0 1 0 ${L.rShell},0A${L.rShell},${L.rShell} 0 1 0 ${-L.rShell},0Z` +
         `M${-L.rBore},0A${L.rBore},${L.rBore} 0 1 1 ${L.rBore},0A${L.rBore},${L.rBore} 0 1 1 ${-L.rBore},0Z`,
      'fill-rule': 'evenodd', fill: COLOR.shell, stroke: COLOR.shellEdge, 'stroke-width': unit * .45 }));
    body.appendChild(el('circle', { cx: 0, cy: 0, r: L.rBore, fill: COLOR.bore }));
  }
  svg.appendChild(body);

  /* keys / keyways ------------------------------------------------------ */
  const keys = g('keys');
  for (const k of L.keys) {
    // Seen from the rear, the minor keys run the other way round.
    const a = (L.cw !== state.rear ? 1 : -1) * k.deg * Math.PI / 180;
    const d = L.plug ? slotPath(a, k.width, L.rShell * 0.94, L.rKey)
                     : slotPath(a, k.width, L.rBore, L.rKey);
    const node = keys.appendChild(el('path', { d, fill: L.plug ? COLOR.shell : COLOR.bore,
                                               stroke: COLOR.shellEdge, 'stroke-width': unit * .45 }));
    node.appendChild(el('title', {})).textContent =
      k.deg === 0 ? 'Main key' : `Minor key ${k.label}, ${k.deg}°`;
  }
  svg.appendChild(keys);

  /* insert face --------------------------------------------------------- */
  svg.appendChild(el('circle', { cx: 0, cy: 0, r: L.rIns, fill: COLOR.insert,
                                 stroke: COLOR.insertEdge, 'stroke-width': unit * .4 }));

  /* group outlines ------------------------------------------------------ */
  // Each group is a union of discs, tangent bands and triangles.  Stroking every
  // piece and then covering it with an opaque tint leaves only the union's edge.
  // Groups are layered in list order, so where two cross, the later one lies on top.
  const sw = unit * .45;
  const pieces = (layer, s, attrs) => {
    const grp = layer.appendChild(el('g', attrs));
    for (const c of s.discs) grp.appendChild(el('circle', { cx: c.x, cy: c.y, r: c.r }));
    for (const poly of s.bands.concat(s.tris))
      grp.appendChild(el('polygon', { points: poly.map((q) => q.join(',')).join(' ') }));
  };
  for (const grp of state.groups) {
    const members = pinsInGroup(grp.gid).map((id) => arr.index.get(id)).filter(Boolean).map((p) => p.i);
    if (!members.length) continue;
    const s = groupShapes(arr, members);
    const layer = svg.appendChild(g('group'));
    pieces(layer, s, { fill: grp.color, stroke: grp.color, 'stroke-width': sw * 2, 'stroke-linejoin': 'round' });
    pieces(layer, s, { fill: mixHex(grp.color, COLOR.insert, GROUP_TINT) });
  }

  /* contacts ------------------------------------------------------------ */
  const layer = g('contacts');
  for (const p of arr.pts) {
    const rec = state.pins[p.id];
    const fill = pinColor(p.id) || COLOR.pin;
    const selected = state.sel.has(p.id);
    const node = el('g', { class: 'contact', 'data-id': p.id, style: 'cursor:pointer' });
    // Only uncoloured (NC grey) contacts get the thin grey edge; coloured ones stand on their fill.
    node.appendChild(el('circle', {
      cx: p.x, cy: p.y, r: p.r, fill,
      stroke: selected ? COLOR.sel : pinColor(p.id) ? 'none' : COLOR.pinEdge,
      'stroke-width': unit * (selected ? 1.1 : .35),
    }));
    const ink = readable(fill.startsWith('#') && fill.length === 7 ? fill : COLOR.pin);
    const named = rec && !isNC(rec.signal);
    const label = state.labels === 'signal' ? (named ? rec.signal : p.id)
                : state.labels === 'none' ? '' : p.id;
    if (label) {
      const size = Math.min(p.r * 1.05, (p.r * 2.9) / label.length);
      node.appendChild(el('text', {
        x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-family': 'ui-monospace, Consolas, monospace', 'font-size': size,
        'font-weight': 600, fill: ink, 'pointer-events': 'none',
      })).textContent = label;
    }
    if (state.labels === 'both' && named) {
      node.appendChild(el('text', {
        x: p.x, y: p.y + p.r + unit * 1.5, 'text-anchor': 'middle',
        'font-family': 'system-ui, sans-serif', 'font-size': Math.min(p.r * .85, unit * 2.2),
        fill: COLOR.text, 'pointer-events': 'none',
      })).textContent = rec.signal;
    }
    node.appendChild(el('title', {})).textContent =
      `${p.id}${rec && rec.signal ? ' — ' + rec.signal : ''} (size ${p.size || '?'})`;
    layer.appendChild(node);
  }
  svg.appendChild(layer);
  placePop();
}

function fitView(L) {
  const outer = Math.max(L.rShell, L.rKey) * 1.04 + 0.5;
  state.view = { x: -outer, y: -outer, w: outer * 2, h: outer * 2 };
}

/* ----------------------------------------------------------- decode panel */

function renderDecode() {
  const box = $('#decode'), banner = $('#banner');
  box.textContent = '';
  banner.textContent = '';
  banner.hidden = true;
  banner.className = 'banner';
  const d = state.decoded;
  const fact = (k, v) => box.appendChild(html('div', { class: 'fact' },
    [html('span', { text: k }), html('b', { text: v })]));
  const complement = (a) => a.groups.map((g) => `${g.count} × size ${g.size}` +
    (g.locations && !/^all/i.test(g.locations) ? ` (${g.locations})` : '')).join('; ');

  if (!d && is806(state.arrKey)) {
    const a = DATA.arrangements[state.arrKey];
    box.hidden = false;
    fact('Series', 'Glenair 806 Mil-Aero');
    fact('Arrangement', `${arrNumber(state.arrKey)} — ${a.count} contacts`);
    fact('Complement', complement(a));
    fact('Source', `Glenair 806 PCB layouts, PDF p ${a.pages.join(', ')}`);
    const notes = arrangementNotes(state.arrKey);
    if (notes.length) {
      banner.hidden = false;
      banner.appendChild(html('strong', { text: 'Notes' }));
      banner.appendChild(html('ul', {}, notes.map((w) => html('li', { text: w }))));
    }
    return;
  }
  if (!d) { box.hidden = true; return; }
  if (d.error) {
    box.hidden = true;
    banner.hidden = false;
    banner.className = 'banner error';
    banner.textContent = d.error;
    return;
  }
  box.hidden = false;
  const a = d.arr;
  fact('Series', `MIL-DTL-38999 Series ${d.style.series}`);
  fact('Sheet', `/${d.slash} — ${titleCase(d.style.kind)}, ${d.style.mounting}`);
  fact('Class', `${d.cls} — ${d.klass.material}, ${d.klass.finish}`);
  fact('Temp', `${d.klass.tmin} to ${d.klass.tmax} °C`);
  fact('Shell', `${d.shellCode} = size ${d.shell}`);
  fact('Arrangement', `${d.arrangement} — ${a.count} contacts`);
  fact('Contacts', `${d.contact} — ${d.contactStyle.gender}, ${d.contactStyle.description}`);
  fact('Polarization', d.position + (d.angles ? ` — ${d.angles.join('°, ')}°` : ''));
  const sizes = complement(a);
  if (sizes) fact('Complement', sizes);
  const rating = a.groups.map((g) => g.rating).filter(Boolean).join(' / ');
  if (rating) fact('Service rating', rating);
  fact('Source', `MIL-STD-1560C w/Ch 3, PDF p ${a.pages.join(', ')}`);

  const notes = d.warnings.concat(arrangementNotes(d.arrangement));
  if (notes.length) {
    banner.hidden = false;
    banner.appendChild(html('strong', { text: 'Notes' }));
    banner.appendChild(html('ul', {}, notes.map((w) => html('li', { text: w }))));
  }
}

/** Editorial corrections the data build applied to this arrangement's table. */
function arrangementNotes(key) {
  return (DATA.corrections || []).filter((c) => c.startsWith(key + ' '))
    .map((c) => 'Source correction — ' + c);
}

/* ----------------------------------------------------------- the pin table */

function renderTable() {
  const body = $('#pins tbody');
  body.textContent = '';
  if (!state.arr) return;
  const needle = state.filter.trim().toLowerCase();

  for (const p of state.arr.pts) {
    const rec = pin(p.id);
    if (needle && !(p.id.toLowerCase().includes(needle) ||
                    rec.signal.toLowerCase().includes(needle))) continue;
    const grp = groupOf(p.id);
    const tr = html('tr', { class: state.sel.has(p.id) ? 'sel' : '' });
    tr.dataset.id = p.id;

    const swatch = html('span', { class: 'dot' });
    swatch.style.background = pinColor(p.id) || COLOR.pin;
    const idCell = html('td', { class: 'c-id' }, [swatch]);
    idCell.appendChild(document.createTextNode(p.id));
    tr.appendChild(idCell);

    tr.appendChild(html('td', { class: 'c-size', text: p.size || '—' }));

    const sig = html('input', { type: 'text', value: rec.signal, placeholder: NC });
    let before = null;
    sig.addEventListener('focus', () => { before = { signal: rec.signal, color: rec.color }; });
    sig.addEventListener('input', () => setSignal(p.id, sig.value));
    sig.addEventListener('change', () => {
      commitSignal(p.id, before || { signal: NC, color: '' });
      sig.value = rec.signal;
      before = { signal: rec.signal, color: rec.color };
    });
    // Enter / Shift+Enter: move to the next / previous listed contact, wrapping at the
    // ends, with the text selected for overtyping.
    sig.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const to = e.shiftKey ? (tr.previousElementSibling || tr.parentElement.lastElementChild)
                            : (tr.nextElementSibling || tr.parentElement.firstElementChild);
      if (to === tr) { sig.select(); return; }
      selectPin(to.dataset.id, false, false);
      const next = to.querySelector('input[type=text]');
      next.focus();                     // blurs this box, which commits it
      next.select();
    });
    tr.appendChild(html('td', {}, [sig]));

    const col = html('input', { type: 'color', value: pinColor(p.id) || '#dfe4ea' });
    col.disabled = !!grp;
    col.title = grp ? `Colour follows group "${grp.name}"` : 'Contact colour';
    col.addEventListener('input', () => {
      rec.color = col.value;
      swatch.style.background = col.value;
      save(); scheduleDiagram();
    });
    tr.appendChild(html('td', { class: 'c-col' }, [col]));

    const sel = html('select', { class: 'c-grp' });
    sel.appendChild(html('option', { value: '0', text: '—' }));
    for (const g of state.groups) sel.appendChild(html('option', { value: String(g.gid), text: g.name }));
    sel.value = String(rec.group || 0);
    sel.addEventListener('change', () => { rec.group = Number(sel.value); save(); renderAll(); });
    tr.appendChild(html('td', { class: 'c-grp' }, [sel]));

    body.appendChild(tr);
  }
}

function renderGroups() {
  const box = $('#groups');
  box.textContent = '';
  for (const g of state.groups) {
    const row = html('div', { class: 'grp' });
    const col = html('input', { type: 'color', value: g.color });
    col.addEventListener('input', () => { g.color = col.value; save(); renderAll(); });
    const name = html('input', { type: 'text', value: g.name });
    name.addEventListener('input', () => { g.name = name.value; save(); renderTable(); syncGroupSelect(); });
    const count = html('span', { class: 'n', text: `${pinsInGroup(g.gid).length} pins` });
    const pick = html('button', { class: 'ghost sm', text: 'Select', type: 'button' });
    pick.addEventListener('click', () => {
      state.sel = new Set(pinsInGroup(g.gid));
      renderAll();
    });
    const del = html('button', { class: 'ghost sm', text: '✕', type: 'button', title: 'Delete group' });
    del.addEventListener('click', () => {
      for (const id of pinsInGroup(g.gid)) state.pins[id].group = 0;
      state.groups = state.groups.filter((x) => x.gid !== g.gid);
      save(); renderAll();
    });
    row.append(col, name, count, pick, del);
    box.appendChild(row);
  }
  syncGroupSelect();
}

function syncGroupSelect() {
  const sel = $('#add-to-group');
  const keep = sel.value;
  sel.textContent = '';
  sel.appendChild(html('option', { value: '', text: 'Add to…' }));
  for (const g of state.groups) sel.appendChild(html('option', { value: String(g.gid), text: g.name }));
  sel.value = keep;
}

/** A group needs two or more contacts, and regrouping an existing group exactly is a no-op. */
function canGroup(ids) {
  if (ids.size < 2) return false;
  const gids = new Set([...ids].map((id) => (state.pins[id] && state.pins[id].group) || 0));
  if (gids.size !== 1) return true;
  const [gid] = gids;
  return !gid || pinsInGroup(gid).length !== ids.size;
}

/** Groups left with fewer than two contacts dissolve; their contacts keep their own colours. */
function pruneGroups() {
  const small = state.groups.filter((g) => pinsInGroup(g.gid).length < 2);
  if (!small.length) return;
  for (const g of small) for (const id of pinsInGroup(g.gid)) state.pins[id].group = 0;
  state.groups = state.groups.filter((g) => !small.includes(g));
  save();
}

function renderSelection() {
  const n = state.sel.size;
  $('#sel-count').textContent = n ? `${n} selected` : '';
  $('#sel-actions').hidden = n === 0;
  const btn = $('#btn-group');
  btn.disabled = !canGroup(state.sel);
  btn.title = n < 2 ? 'Select two or more contacts to group them'
            : btn.disabled ? 'These contacts already form a group' : '';
  for (const tr of document.querySelectorAll('#pins tbody tr'))
    tr.classList.toggle('sel', state.sel.has(tr.dataset.id));
}

let diagramPending = false;
function scheduleDiagram() {
  if (diagramPending) return;
  diagramPending = true;
  requestAnimationFrame(() => { diagramPending = false; renderDiagram(); });
}

function renderAll() {
  pruneGroups();
  renderDiagram();
  renderTable();
  renderGroups();
  renderSelection();
}

/* -------------------------------------------------------------- selection */

function selectPin(id, additive, focusTable = true) {
  if (additive) {
    if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id);
  } else {
    state.sel = new Set([id]);
  }
  scheduleDiagram();
  renderSelection();
  const row = document.querySelector(`#pins tbody tr[data-id="${CSS.escape(id)}"]`);
  if (row) {
    row.scrollIntoView({ block: 'nearest' });
    if (!additive && focusTable) { const i = row.querySelector('input[type=text]'); if (i) i.focus(); }
  }
}

/* ------------------------------------------------ in-diagram signal popup */

const pop = { id: null, before: null };

function openPop(id) {
  if (pop.id) closePop(true);
  const rec = pin(id);
  pop.id = id;
  pop.before = { signal: rec.signal, color: rec.color };
  const input = $('#pop-signal');
  input.value = rec.signal;
  $('#pop').hidden = false;
  placePop();
  input.focus();
  input.select();
}

/** Keep the popup just below its contact, inside the stage, through pan and zoom. */
function placePop() {
  if (!pop.id || !state.arr) return;
  const p = state.arr.index.get(pop.id);
  const box = $('#stage').getBoundingClientRect(), v = state.view, node = $('#pop');
  const scale = Math.min(box.width / v.w, box.height / v.h);
  const sx = (box.width - v.w * scale) / 2 + (p.x - v.x) * scale;
  const sy = (box.height - v.h * scale) / 2 + (p.y - v.y) * scale;
  const r = p.r * scale, w = node.offsetWidth, h = node.offsetHeight;
  let top = sy + r + 8;
  if (top + h > box.height - 4) top = sy - r - 8 - h;        // no room below: go above
  node.style.left = `${clamp(sx - w / 2, 4, box.width - w - 4)}px`;
  node.style.top = `${clamp(top, 4, box.height - h - 4)}px`;
}

function closePop(keep) {
  if (!pop.id) return;
  const id = pop.id;
  pop.id = null;
  $('#pop').hidden = true;
  if (keep) { commitSignal(id, pop.before); return; }
  Object.assign(pin(id), pop.before);
  refreshRow(id);
  save();
  scheduleDiagram();
}

function wirePop() {
  const node = $('#pop'), input = $('#pop-signal');
  // The popup lives inside the stage; keep its clicks away from selection and panning.
  for (const t of ['pointerdown', 'wheel', 'contextmenu']) node.addEventListener(t, (e) => e.stopPropagation());
  input.addEventListener('input', () => setSignal(pop.id, input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closePop(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(false); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const pts = state.arr.pts, i = state.arr.index.get(pop.id).i;
      const next = pts[(i + (e.shiftKey ? pts.length - 1 : 1)) % pts.length].id;
      closePop(true);
      selectPin(next, false, false);
      openPop(next);
    }
  });
  // Clicking anywhere else keeps what was typed.
  document.addEventListener('pointerdown', (e) => {
    if (pop.id && !node.contains(e.target)) closePop(true);
  }, true);
}

function newGroup(ids) {
  const gid = state.nextGid++;
  const grp = { gid, name: `Group ${state.groups.length + 1}`, color: uniqueColor() };
  state.groups.push(grp);
  for (const id of ids) pin(id).group = gid;
  save(); renderAll();
}

/* ------------------------------------------------------ pan, zoom, marquee */

function stagePoint(ev) {
  const svg = $('#svg'), box = svg.getBoundingClientRect(), v = state.view;
  // preserveAspectRatio="xMidYMid meet": the viewBox is letterboxed inside the element.
  const scale = Math.min(box.width / v.w, box.height / v.h);
  const ox = (box.width - v.w * scale) / 2, oy = (box.height - v.h * scale) / 2;
  return { x: v.x + (ev.clientX - box.left - ox) / scale,
           y: v.y + (ev.clientY - box.top - oy) / scale, scale, box };
}

function wireStage() {
  const stage = $('#stage'), svg = $('#svg'), rubber = $('#rubber');
  let mode = null, start = null, startView = null, spaceDown = false;

  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) { spaceDown = true; e.preventDefault(); }
    if (e.key === 'Escape') { state.sel.clear(); scheduleDiagram(); renderSelection(); }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  stage.addEventListener('pointerdown', (e) => {
    if (!state.arr) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
    const p = stagePoint(e);
    if (e.button === 2 || e.button === 1 || spaceDown) {
      mode = 'pan';
      start = { cx: e.clientX, cy: e.clientY, scale: p.scale };
      startView = { ...state.view };
      stage.classList.add('panning');
      return;
    }
    const hit = e.target.closest('.contact');
    if (hit) {
      mode = 'click';
      start = { id: hit.dataset.id, additive: e.ctrlKey || e.metaKey || e.shiftKey };
      return;
    }
    mode = 'marquee';
    start = { cx: e.clientX, cy: e.clientY, additive: e.ctrlKey || e.metaKey || e.shiftKey };
    Object.assign(rubber.style, { left: '0px', top: '0px', width: '0px', height: '0px' });
    rubber.hidden = false;
  });

  stage.addEventListener('pointermove', (e) => {
    if (mode === 'pan') {
      state.view.x = startView.x - (e.clientX - start.cx) / start.scale;
      state.view.y = startView.y - (e.clientY - start.cy) / start.scale;
      scheduleDiagram();
    } else if (mode === 'marquee') {
      const box = stage.getBoundingClientRect();
      const x = Math.min(start.cx, e.clientX) - box.left, y = Math.min(start.cy, e.clientY) - box.top;
      Object.assign(rubber.style, {
        left: `${x}px`, top: `${y}px`,
        width: `${Math.abs(e.clientX - start.cx)}px`, height: `${Math.abs(e.clientY - start.cy)}px`,
      });
    }
  });

  stage.addEventListener('pointerup', (e) => {
    stage.classList.remove('panning');
    rubber.hidden = true;
    if (mode === 'click') {
      selectPin(start.id, start.additive, false);
      if (!start.additive) openPop(start.id);
    } else if (mode === 'marquee') {
      const moved = Math.hypot(e.clientX - start.cx, e.clientY - start.cy);
      if (moved < 4) {
        if (!start.additive) { state.sel.clear(); scheduleDiagram(); renderSelection(); }
      } else {
        const a = stagePoint({ clientX: Math.min(start.cx, e.clientX), clientY: Math.min(start.cy, e.clientY) });
        const b = stagePoint({ clientX: Math.max(start.cx, e.clientX), clientY: Math.max(start.cy, e.clientY) });
        if (!start.additive) state.sel.clear();
        for (const p of state.arr.pts)
          if (p.x >= a.x && p.x <= b.x && p.y >= a.y && p.y <= b.y) state.sel.add(p.id);
        scheduleDiagram(); renderSelection();
      }
    }
    mode = null;
  });

  stage.addEventListener('wheel', (e) => {
    if (!state.arr) return;
    e.preventDefault();
    const p = stagePoint(e);
    const k = Math.exp(e.deltaY * 0.0014);
    const v = state.view;
    const w = clamp(v.w * k, 2, 4000), h = w * (v.h / v.w);
    state.view = { x: p.x - (p.x - v.x) * (w / v.w), y: p.y - (p.y - v.y) * (h / v.h), w, h };
    scheduleDiagram();
  }, { passive: false });
}

/* ----------------------------------------------------------- persistence */

/* One working pinout, which follows the part number as it changes.  The browser keeps
   it so a reload picks up where you left off; Save/Load are for keeping copies. */
const STORE = 'd38999-pinout:current';

function project() {
  return {
    tool: 'd38999-pinout', version: 2, partNumber: state.pn, pnOverride: state.pnOverride, arrangement: state.arrKey,
    socket: state.socket, rear: state.rear, pins: state.pins, groups: state.groups, nextGid: state.nextGid,
  };
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { if (state.arrKey) localStorage.setItem(STORE, JSON.stringify(project())); }
    catch (err) { /* private mode or quota: the session still works */ }
  }, 250);
}

/** Open a saved project (a file or the browser's copy), replacing the working pinout. */
function applyProject(d) {
  let opened = false;
  const pn = d.partNumber || (d.arrangement && DATA.arrangements[d.arrangement] && partNumberFor(d.arrangement));
  if (pn) { $('#pn').value = pn; opened = submitPin({ fresh: true }); }
  else if (d.arrangement && DATA.arrangements[d.arrangement]) {
    $('#pn').value = '';
    $('#arr-pick').value = d.arrangement;
    opened = loadArrangement(d.arrangement, null, '', { fresh: true });
  }
  if (!opened) return false;
  state.pins = Object.assign(Object.create(null), d.pins || {});
  normalizePins();
  state.groups = d.groups || [];
  setOverride(d.pnOverride);
  state.nextGid = d.nextGid || Math.max(0, ...state.groups.map((g) => g.gid)) + 1;
  // Older files stored only `mirror`, which meant a socket insert seen from the mating face.
  const socket = typeof d.socket === 'boolean' ? d.socket : d.mirror;
  if (typeof socket === 'boolean') $('#opt-gender').value = socket ? 'socket' : 'pin';
  $('#opt-rear').checked = d.rear === true;
  applyView();
  save();
  renderAll();
  return true;
}

const hasData = (rec) => !!rec && (!isNC(rec.signal) || !!rec.color || !!rec.group);

/**
 * The working pins re-keyed onto another arrangement, contact for contact in
 * MIL-STD-1560C designation order (so A stays A, 1 stays 1, and A becomes 1 between
 * lettered and numbered inserts).  Asks first if contacts holding data would be lost;
 * false means the user declined.  Null when there is nothing to carry.
 */
function carryPins(arrKey) {
  if (!state.arr || arrKey === state.arrKey) return null;
  const from = state.arr.pts.map((p) => p.id);
  const to = prepare(arrKey, false).pts.map((p) => p.id);
  const lost = from.slice(to.length).filter((id) => hasData(state.pins[id]));
  if (lost.length) {
    const list = lost.slice(0, 24).map((id) => {
      const s = state.pins[id].signal;
      return isNC(s) ? id : `${id} (${s})`;
    }).join(', ') + (lost.length > 24 ? `, and ${lost.length - 24} more` : '');
    const ok = confirm(`Arrangement ${arrName(arrKey)} has ${to.length} contacts, ${from.length - to.length} fewer than ` +
                       `${arrName(state.arrKey)}.\n\nThe data on these ${lost.length} contact(s) will be deleted:\n${list}\n\n` +
                       'Continue?');
    if (!ok) return false;
  }
  const out = Object.create(null);
  from.forEach((id, k) => { if (k < to.length && state.pins[id]) out[to[k]] = state.pins[id]; });
  return out;
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = html('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* Exported image layout, in pixels.  Kept compact for placing on schematics. */
const EX = {
  diagram: 600, pad: 20, titleH: 92, gap: 36, colGap: 40,
  font: 36, row: 48, head: 60, headGap: 18, maxCols: 4,
  title: 40, sub: 24,
  sans: '"Segoe UI", system-ui, sans-serif',
  mono: 'Consolas, ui-monospace, monospace',
  ink: '#16191d', muted: '#6b7280', rule: '#d8dbe0',
};
const PNG_SCALE = 2;

/** Legend sections: each group in order, then ungrouped contacts that have a signal. */
/** Legend sections: the groups by name, then ungrouped signals, then every NC contact. */
function legendSections() {
  const pts = state.arr.pts;
  const nc = (p) => !state.pins[p.id] || isNC(state.pins[p.id].signal);
  const out = [];
  for (const g of state.groups) {
    const ids = pts.filter((p) => !nc(p) && state.pins[p.id].group === g.gid).map((p) => p.id);
    if (ids.length) out.push({ name: g.name.trim() || 'Group', color: g.color, ids });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const loose = pts.filter((p) => !nc(p) && !groupOf(p.id)).map((p) => p.id);
  if (loose.length) out.push({ name: out.length ? 'Ungrouped' : 'Signals', color: null, ids: loose });
  const unused = pts.filter(nc).map((p) => p.id);
  if (unused.length) out.push({ name: 'No Connect', color: null, ids: unused });
  return out;
}

/** Flow legend sections into columns; a section split across columns repeats its header. */
function layoutLegend(sections) {
  const items = [];
  for (const s of sections) {
    items.push({ head: true, s });
    for (const id of s.ids) items.push({ s, id });
  }
  const flow = (colH) => {
    const cols = [];
    let col = null, h = 0;
    const open = () => { col = []; cols.push(col); h = 0; };
    open();
    for (const it of items) {
      if (it.head) {
        // Start a group in a fresh column when it would fit there whole but not here;
        // a group too long for any column at least keeps its header with a first row.
        const whole = EX.head + it.s.ids.length * EX.row;
        const fitsHere = h + EX.headGap + whole <= colH, fitsAlone = whole <= colH;
        if (col.length && (fitsAlone ? !fitsHere : h + EX.headGap + EX.head + EX.row > colH)) open();
        if (col.length) h += EX.headGap;
        col.push({ ...it, y: h }); h += EX.head;
      } else {
        if (h + EX.row > colH) { open(); col.push({ head: true, s: it.s, cont: true, y: 0 }); h = EX.head; }
        col.push({ ...it, y: h }); h += EX.row;
      }
    }
    return cols;
  };
  // Columns a little taller than the drawing, or taller still if that keeps them to maxCols.
  let colH = Math.round(EX.diagram * 1.3), cols = flow(colH);
  while (cols.length > EX.maxCols) cols = flow(colH += EX.row);
  const height = Math.max(...cols.map((c) => {
    const last = c[c.length - 1];
    return last.y + (last.head ? EX.head : EX.row);
  }));
  return { cols, height };
}

let measureCtx = null;
function textWidth(text, font) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Standalone image: title, the drawing at the fitted view, and a legend by group. */
function exportSvg() {
  if (!state.arr) return null;
  const held = { sel: state.sel, view: state.view };
  state.sel = new Set();
  state.view = null;
  renderDiagram();
  const drawing = $('#svg').cloneNode(true);
  Object.assign(state, held);
  renderDiagram();

  drawing.removeAttribute('id');
  for (const t of drawing.querySelectorAll('.contact')) t.removeAttribute('style');
  for (const t of drawing.querySelectorAll('title')) t.remove();

  const sections = legendSections();
  const legend = sections.length ? layoutLegend(sections) : null;

  const dot = EX.font * 0.7, swatch = EX.font * 0.85;
  const idFont = `600 ${EX.font}px ${EX.mono}`, sigFont = `400 ${EX.font}px ${EX.sans}`;
  const headFont = `600 ${EX.font + 1}px ${EX.sans}`;
  const space = EX.font * 0.5;                   // gap between legend elements
  const idX = dot + space;
  let sigX = 0, colW = 0;
  if (legend) {
    const ids = sections.flatMap((s) => s.ids);
    sigX = idX + Math.max(...ids.map((id) => textWidth(id, idFont))) + space * 1.3;
    const sigW = Math.max(textWidth(NC, sigFont),
                          ...ids.map((id) => textWidth(signalText(id), sigFont)));
    const headW = Math.max(...sections.map((s) =>
      swatch + space + textWidth(`${s.name} (cont.)`, headFont)));
    colW = Math.ceil(Math.max(sigX + sigW, headW));
  }

  // Legend to the right of the drawing; whichever is shorter is centred on the other.
  const D = EX.diagram;
  const legendW = legend ? EX.gap + legend.cols.length * colW + (legend.cols.length - 1) * EX.colGap : 0;
  const bodyH = Math.max(D, legend ? legend.height : 0);
  const W = Math.ceil(EX.pad * 2 + D + legendW);
  const H = Math.ceil(EX.pad + EX.titleH + bodyH + EX.pad);

  const root = el('svg', { xmlns: SVGNS, width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  root.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }));
  const text = (parent, t, attrs) => {
    const node = parent.appendChild(el('text', { 'dominant-baseline': 'central', fill: EX.ink, ...attrs }));
    node.textContent = t;
    return node;
  };

  text(root, outputTitle(), { x: W / 2, y: EX.pad + EX.title / 2, 'text-anchor': 'middle',
                      'font-family': EX.sans, 'font-size': EX.title, 'font-weight': 600 });
  text(root, viewSide(), { x: W / 2, y: EX.pad + EX.title + EX.sub * 0.8, 'text-anchor': 'middle',
                           'font-family': EX.sans, 'font-size': EX.sub, fill: EX.muted });

  const top = EX.pad + EX.titleH;
  drawing.setAttribute('x', EX.pad);
  drawing.setAttribute('y', top + (bodyH - D) / 2);
  drawing.setAttribute('width', D);
  drawing.setAttribute('height', D);
  root.appendChild(drawing);

  if (legend) {
    const legendTop = top + (bodyH - legend.height) / 2;
    legend.cols.forEach((col, c) => {
      const x0 = EX.pad + D + EX.gap + c * (colW + EX.colGap);
      const g = root.appendChild(el('g', { transform: `translate(${x0},${legendTop})` }));
      for (const it of col) {
        if (it.head) {
          const cy = it.y + EX.head * 0.45;
          if (it.s.color)
            g.appendChild(el('rect', { x: 0, y: cy - swatch / 2, width: swatch, height: swatch,
                                       rx: swatch * 0.2, fill: it.s.color }));
          text(g, it.s.name + (it.cont ? ' (cont.)' : ''), {
            x: it.s.color ? swatch + space : 0, y: cy, 'font-family': EX.sans,
            'font-size': EX.font + 1, 'font-weight': 600 });
          const ry = it.y + EX.head * 0.92;
          g.appendChild(el('line', { x1: 0, x2: colW, y1: ry, y2: ry,
                                     stroke: it.s.color || EX.rule, 'stroke-width': EX.font / 12 }));
        } else {
          const cy = it.y + EX.row / 2;
          const signal = signalText(it.id);
          g.appendChild(el('circle', { cx: dot / 2, cy, r: dot / 2, fill: pinColor(it.id) || COLOR.pin,
                                       stroke: pinColor(it.id) ? 'none' : COLOR.pinEdge,
                                       'stroke-width': EX.font / 24 }));
          text(g, it.id, { x: idX, y: cy, 'font-family': EX.mono, 'font-size': EX.font, 'font-weight': 600 });
          text(g, signal || NC, { x: sigX, y: cy, 'font-family': EX.sans, 'font-size': EX.font,
                                   fill: signal ? EX.ink : EX.muted });
        }
      }
    });
  }
  return new XMLSerializer().serializeToString(root);
}

function exportPng() {
  const text = exportSvg();
  if (!text) return;
  const img = new Image();
  img.onload = () => {
    const c = html('canvas');
    c.width = img.width * PNG_SCALE;
    c.height = img.height * PNG_SCALE;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = html('a', { href: url, download: `${fileBase()}.png` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
}

/* The drawing's title is the decoded part number unless the user has overridden it,
   e.g. for another maker's connector with the same insert arrangement. */
const decodedTitle = () => (state.pn ? `D38999/${state.pn}`
  : is806(state.arrKey) ? `Glenair 806 arrangement ${arrNumber(state.arrKey)}`
  : `Insert arrangement ${state.arrKey}`);
const outputTitle = () => state.pnOverride || decodedTitle();

const fileBase = () => (state.pnOverride || (state.pn ? 'D38999-' + state.pn
  : is806(state.arrKey) ? arrName(state.arrKey) : 'arrangement-' + state.arrKey))
  .replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') + '-pinout';

function setOverride(value) {
  state.pnOverride = (value || '').trim();
  $('#pn-override').value = state.pnOverride;
}

/* ----------------------------------------------------------------- wiring */

/**
 * Switch to an arrangement, carrying the working pinout across unless `fresh`.
 * Returns false, changing nothing, if the user declines to lose pin data.
 */
function loadArrangement(arrKey, decoded, pnText, opts = {}) {
  closePop(true);
  const carried = opts.fresh ? null : carryPins(arrKey);
  if (carried === false) return false;
  state.arrKey = arrKey;
  state.decoded = decoded;
  state.pn = pnText || '';
  state.sel.clear();
  state.view = null;
  if (decoded && decoded.contactStyle) $('#opt-gender').value = decoded.contactStyle.gender === 'socket' ? 'socket' : 'pin';
  applyView();
  if (opts.fresh) { state.pins = Object.create(null); state.groups = []; state.nextGid = 1; setOverride(''); }
  else if (carried) state.pins = carried;
  $('#pn-override').placeholder = decodedTitle();
  renderDecode();
  renderAll();
  save();
  return true;
}

/* MIL-STD-1560C tabulates the pin insert's mating face.  A socket insert's mating face
   is its mirror image, and so is either insert seen from the rear (wire entry) side;
   a socket insert from the rear is therefore as tabulated. */
const mirrored = () => state.socket !== state.rear;

function applyView() {
  closePop(true);
  state.socket = $('#opt-gender').value === 'socket';
  state.rear = $('#opt-rear').checked;
  state.mirror = mirrored();
  if (state.arrKey) state.arr = prepare(state.arrKey, state.mirror);
  state.view = null;
  $('#view-note').textContent = viewNote();
}

const viewSide = () => (state.rear ? 'Viewed from rear (wire entry side)' : 'Viewed from mating face');

function viewNote() {
  const d = state.decoded;
  const who = d ? d.style.kind : 'connector';
  return `${state.socket ? 'Socket' : 'Pin'} insert, ${who} — ${viewSide().toLowerCase()}`;
}

/**
 * The part number for another arrangement, keeping the current slash sheet, class,
 * contact style and polarization (or /24, class F, N for a start from an arrangement).
 * Null for the even (Series II) shell sizes, which have no D38999 shell code.
 */
function partNumberFor(arrKey) {
  if (is806(arrKey)) return null;
  const [shell, no] = arrKey.split('-').map(Number);
  const code = Object.keys(DATA.shellSizes).find((c) => DATA.shellSizes[c] === shell);
  if (!code) return null;
  const d = state.decoded && !state.decoded.error ? state.decoded : null;
  const slash = d ? String(d.slash).padStart(2, '0') : '24';
  const cls = d ? d.cls + (d.cls.length > 1 ? '-' : '') : 'F';
  const contact = d ? d.contact : (state.socket ? 'S' : 'P');
  return `${slash}${cls}${code}${String(no).padStart(2, '0')}${contact}${d ? d.position : 'N'}`;
}

/** Decode the part number field and switch to it.  A bad part number leaves the work as it is. */
function submitPin(opts) {
  const value = $('#pn').value;
  if (!value.trim()) return false;
  const d = decode(value);
  $('#pn').value = d.pin;
  if (d.error) {
    const banner = $('#banner');
    banner.hidden = false;
    banner.className = 'banner error';
    banner.textContent = d.error;
    return false;
  }
  if (!loadArrangement(d.arrangement, d, d.pin, opts)) { $('#pn').value = state.pn; return false; }
  $('#arr-pick').value = d.arrangement;
  return true;
}

function init() {
  const pick = $('#arr-pick');
  // D38999 by shell size, then the Glenair 806 arrangements in one group.
  const order = (k) => [is806(k) ? 1 : 0, ...arrNumber(k).split('-').map((v) => parseInt(v, 10))];
  const keys = Object.keys(DATA.arrangements).sort((a, b) => {
    const p = order(a), q = order(b);
    return p[0] - q[0] || p[1] - q[1] || p[2] - q[2] || a.localeCompare(b);
  });
  let group = null, last = null;
  for (const k of keys) {
    const label = is806(k) ? 'Glenair 806' : `Shell ${DATA.arrangements[k].shell}`;
    if (label !== last) { group = html('optgroup', { label }); pick.appendChild(group); last = label; }
    group.appendChild(html('option', { value: k, text: `${arrNumber(k)} (${DATA.arrangements[k].count})` }));
  }
  pick.addEventListener('change', () => {
    if (!pick.value) return;
    const pn = partNumberFor(pick.value);
    if (pn) {
      $('#pn').value = pn;
      if (!submitPin()) pick.value = state.arrKey || '';
      return;
    }
    if (!loadArrangement(pick.value, null, '')) { pick.value = state.arrKey || ''; return; }
    $('#pn').value = '';
    if (is806(pick.value)) return;
    const banner = $('#banner');
    banner.hidden = false;
    banner.className = 'banner';
    banner.textContent = `Shell size ${pick.value.split('-')[0]} is a Series II size with no D38999 shell ` +
                         `code, so no part number exists for ${pick.value}; the drawing is labelled by arrangement.`;
  });

  $('#pn-form').addEventListener('submit', (e) => { e.preventDefault(); submitPin(); });
  $('#pn-override').addEventListener('input', (e) => { state.pnOverride = e.target.value.trim(); save(); });

  for (const id of ['#opt-gender', '#opt-rear'])
    $(id).addEventListener('change', () => { applyView(); renderDiagram(); save(); });
  $('#btn-clear').addEventListener('click', () => {
    if (!state.arrKey) return;
    if (!confirm('Clear every signal name, colour and group on this connector?')) return;
    closePop(false);
    state.pins = Object.create(null);
    state.groups = [];
    state.sel.clear();
    save(); renderAll();
  });
  $('#opt-labels').addEventListener('change', () => {
    state.labels = $('#opt-labels').value;
    renderDiagram();
  });
  $('#btn-fit').addEventListener('click', () => { state.view = null; renderDiagram(); });
  $('#filter').addEventListener('input', () => { state.filter = $('#filter').value; renderTable(); });

  $('#btn-group').addEventListener('click', () => { if (canGroup(state.sel)) newGroup(state.sel); });
  $('#add-to-group').addEventListener('change', (e) => {
    const gid = Number(e.target.value);
    if (!gid) return;
    for (const id of state.sel) pin(id).group = gid;
    e.target.value = '';
    save(); renderAll();
  });
  $('#btn-ungroup').addEventListener('click', () => {
    for (const id of state.sel) pin(id).group = 0;
    save(); renderAll();
  });
  $('#bulk-color').addEventListener('input', (e) => {
    for (const id of state.sel) { const r = pin(id); r.group = 0; r.color = e.target.value; }
    save(); renderAll();
  });
  $('#btn-bulk-signal').addEventListener('click', () => {
    const ids = [...state.sel];
    if (!ids.length) return;
    const base = prompt(`Signal name for ${ids.length} contact(s).\n` +
                        'Use # for an incrementing number, e.g. "CAN_H" or "ADDR#".', '');
    if (base === null) return;
    ids.forEach((id, i) => {
      const rec = pin(id), before = { signal: rec.signal, color: rec.color };
      setSignal(id, base.replace(/#/g, String(i + 1)));
      commitSignal(id, before);
    });
    save(); renderAll();
  });
  $('#btn-clear-sel').addEventListener('click', () => {
    state.sel.clear(); scheduleDiagram(); renderSelection();
  });

  $('#pins tbody').addEventListener('click', (e) => {
    const cell = e.target.closest('td.c-id');
    if (cell) selectPin(cell.parentElement.dataset.id, e.ctrlKey || e.metaKey || e.shiftKey);
  });

  $('#btn-svg').addEventListener('click', () => {
    const text = exportSvg();
    if (text) download(`${fileBase()}.svg`, 'image/svg+xml', text);
  });
  $('#btn-png').addEventListener('click', exportPng);
  $('#btn-save').addEventListener('click', () => {
    if (!state.arrKey) return;
    download(`${fileBase()}.json`, 'application/json', JSON.stringify(project(), null, 2));
  });
  $('#btn-load').addEventListener('click', () => $('#file-in').click());
  $('#file-in').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let opened = false;
    try { opened = applyProject(JSON.parse(await file.text())); } catch (err) { /* reported below */ }
    if (!opened) alert('That file is not a pinout project saved by this tool.');
    e.target.value = '';
  });

  wireStage();
  wirePop();
  addEventListener('resize', scheduleDiagram);

  // A ?pn= link opens that part number fresh; otherwise resume the last working pinout.
  const linked = new URLSearchParams(location.search).get('pn');
  let resumed = false;
  if (!linked) {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) resumed = applyProject(JSON.parse(raw));
    } catch (err) { /* nothing usable stored */ }
  }
  if (!resumed) {
    $('#pn').value = linked || '24FA35SN';
    submitPin({ fresh: true });
  }
}

init();
