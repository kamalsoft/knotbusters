import { RopeWorld } from './physics.js';

export const PALETTE = ['#ff5a5f', '#ffb400', '#2ec4b6', '#7b61ff', '#3a86ff', '#ff7bd5', '#8ac926', '#ff8c42'];
const REACH = 0.97;
const MAX_ATTEMPTS = 40;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DIFFICULTY = ['easy', 'normal', 'hard'];
const DIFF_SCRAMBLE = [0.6, 1, 1.5];

export function levelParams(L, diff = 1) {
  return {
    ropes: Math.min(8, Math.max(2, 2 + Math.floor((L - 1) / 4) + (diff - 1))),
    slack: 0.12 + Math.min(0.1, L * 0.002) + (1 - diff) * 0.04,
    spare: 2,
    scramble: Math.min(12, Math.round((2 + Math.floor(L / 2)) * DIFF_SCRAMBLE[diff])),
    fixed: L >= 4 ? 1 : 0,
    hub: L >= 7,
    lock: L >= 10,
  };
}

function nonCrossingMatching(n, rnd) {
  const pairs = [];
  const stack = [];
  let open = n;
  let close = n;
  let idx = 0;
  while (open + close > 0) {
    const canClose = stack.length > 0;
    if (canClose && (open === 0 || rnd() < 0.5)) {
      pairs.push([stack.pop(), idx]);
      close--;
    } else {
      stack.push(idx);
      open--;
    }
    idx++;
  }
  return pairs;
}

export function generateLevel(L, diff = 1) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const spec = buildCandidate(L, attempt, diff);
    if (verifyLevel(spec)) return spec;
  }
  throw new Error(`level ${L}: no verified layout in ${MAX_ATTEMPTS} attempts`);
}

export function buildCandidate(L, attempt, diff = 1) {
  const rnd = mulberry32(L * 7919 + attempt * 104729 + diff * 1000003 + 17);
  const P = levelParams(L, diff);
  const S = 2 * P.ropes + P.spare;
  const radius = Math.max(3, S * 0.42);
  const sockets = [];
  for (let i = 0; i < S; i++) {
    const th = (i / S) * Math.PI * 2;
    sockets.push({ x: radius * Math.cos(th), z: radius * Math.sin(th), lock: false });
  }
  const order = [...Array(S).keys()].sort(() => rnd() - 0.5).slice(0, 2 * P.ropes).sort((a, b) => a - b);
  const chords = nonCrossingMatching(P.ropes, rnd).map(([a, b]) => [order[a], order[b]]);
  const endpointAt = new Map();

  if (P.hub && chords.length >= 2) {
    for (let p = 0; p + 1 < order.length; p++) {
      const ci = chords.findIndex((c) => c.includes(order[p]));
      const cj = chords.findIndex((c) => c.includes(order[p + 1]));
      if (ci !== cj && ci >= 0 && cj >= 0) {
        const keep = order[p];
        const drop = order[p + 1];
        chords[cj] = chords[cj].map((s) => (s === drop ? keep : s));
        break;
      }
    }
  }

  const used = new Set(chords.flat());
  const freeSockets = [...Array(S).keys()].filter((i) => !used.has(i));
  let lockSocket = null;
  if (P.lock && freeSockets.length) {
    lockSocket = freeSockets[freeSockets.length - 1];
    sockets[lockSocket].lock = true;
  }

  const pins = new Map();
  const ropes = chords.map(([a, b], k) => {
    for (const s of [a, b]) if (!pins.has(s)) pins.set(s, { id: `p${s}`, socket: s, fixed: false });
    const A = sockets[a];
    const B = sockets[b];
    return {
      id: `r${k}`,
      a: `p${a}`,
      b: `p${b}`,
      len: Math.max(Math.hypot(A.x - B.x, A.z - B.z) * (1 + P.slack), radius * 2),
      color: PALETTE[k % PALETTE.length],
    };
  });

  const movable = [...pins.values()];
  for (let f = 0; f < P.fixed && movable.length; f++) {
    const i = Math.floor(rnd() * movable.length);
    movable[i].fixed = true;
    movable.splice(i, 1);
  }
  const spec = {
    id: L,
    sockets,
    pins: [...pins.values()],
    ropes,
    locks: lockSocket === null ? [] : [{ socket: lockSocket, keyRope: 'r0' }],
    solution: [],
  };

  const scrambleMoves = [];
  const game = new Game(spec, { settle: false });
  const cap = 60;
  for (let k = 0; k < cap; k++) {
    if (k >= P.scramble && chordsCross(game)) break;
    const cands = [...game.pins.values()].filter((p) => !p.fixed);
    for (let tries = 0; tries < 25; tries++) {
      const pin = cands[Math.floor(rnd() * cands.length)];
      const free = sockets.map((_, i) => i).filter((i) => !game.occupied(i) && !sockets[i].lock);
      const to = free[Math.floor(rnd() * free.length)];
      if (to !== undefined && game.reachOK(pin.id, to)) {
        scrambleMoves.push({ pin: pin.id, from: pin.socket, to });
        game.placePin(pin.id, to);
        break;
      }
    }
  }
  for (const p of spec.pins) p.socket = game.pins.get(p.id).socket;
  spec.solution = scrambleMoves.reverse().map((m) => ({ pin: m.pin, to: m.from }));
  return spec;
}

export function chordsCross(game) {
  const chords = [...game.ropes.values()].map((r) => [game.pins.get(r.a).socket, game.pins.get(r.b).socket]);
  const pt = (s) => game.sockets[s];
  const orient = (a, b, c) => Math.sign((pt(b).x - pt(a).x) * (pt(c).z - pt(a).z) - (pt(b).z - pt(a).z) * (pt(c).x - pt(a).x));
  for (let i = 0; i < chords.length; i++) {
    for (let j = i + 1; j < chords.length; j++) {
      const [a, b] = chords[i];
      const [c, d] = chords[j];
      if (new Set([a, b, c, d]).size < 4) continue;
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return true;
    }
  }
  return false;
}

function verifyLevel(spec) {
  const g = new Game(spec);
  if (!g.isTangled()) return false;
  for (const mv of spec.solution) {
    if (!g.movePin(mv.pin, mv.to)) return false;
  }
  return g.isWon();
}

export class Game {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.world = new RopeWorld();
    this.pins = new Map();
    this.ropes = new Map();
    this.locks = spec.locks.map((l) => ({ ...l, unlocked: false }));
    this.sockets = spec.sockets.map((s) => ({ ...s }));
    this.history = [];
    for (const p of spec.pins) {
      this.pins.set(p.id, { id: p.id, socket: p.socket, fixed: p.fixed });
      const s = this.sockets[p.socket];
      this.world.setAnchor(p.id, s.x, s.z);
    }
    for (const r of spec.ropes) {
      this.ropes.set(r.id, { ...r, cut: false });
      this.world.addRope(r.id, r.a, r.b, r.len);
    }
    if (opts.settle !== false) this.world.settle(1200);
    this.refreshLocks();
  }

  occupied(socket) {
    for (const p of this.pins.values()) if (p.socket === socket) return true;
    return false;
  }

  placePin(id, socket) {
    const p = this.pins.get(id);
    p.socket = socket;
    const s = this.sockets[socket];
    this.world.setAnchor(id, s.x, s.z);
    for (const r of this.ropes.values()) if (!r.cut && (r.a === id || r.b === id)) this.world.pinEnds(this.world.ropes.get(r.id));
  }

  ropesOf(pinId) {
    return [...this.ropes.values()].filter((r) => !r.cut && (r.a === pinId || r.b === pinId));
  }

  reachOK(pinId, socket) {
    const s = this.sockets[socket];
    for (const r of this.ropesOf(pinId)) {
      const other = r.a === pinId ? r.b : r.a;
      const o = this.world.anchors.get(other);
      if (Math.hypot(s.x - o.x, s.z - o.z) > r.len * REACH) return false;
    }
    return true;
  }

  canMove(pinId, socket) {
    const p = this.pins.get(pinId);
    if (!p || p.fixed || p.socket === socket) return false;
    if (socket < 0 || socket >= this.sockets.length) return false;
    if (this.occupied(socket)) return false;
    const s = this.sockets[socket];
    if (s.lock && !this.lockFor(socket).unlocked) return false;
    return this.reachOK(pinId, socket);
  }

  lockFor(socket) {
    return this.locks.find((l) => l.socket === socket);
  }

  movePin(pinId, socket, frames = 32) {
    if (!this.canMove(pinId, socket)) return false;
    const snap = this.world.snapshot();
    const p = this.pins.get(pinId);
    const from = p.socket;
    const a = this.sockets[from];
    const b = this.sockets[socket];
    for (let f = 1; f <= frames; f++) {
      const t = f / frames;
      this.world.setAnchor(pinId, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      for (const r of this.ropes.values()) if (!r.cut && (r.a === pinId || r.b === pinId)) this.world.pinEnds(this.world.ropes.get(r.id));
      this.world.step();
    }
    p.socket = socket;
    this.world.setAnchor(pinId, b.x, b.z);
    this.world.settle(900);
    this.history.push({ pin: pinId, from, to: socket, snap });
    this.afterChange();
    return true;
  }

  undo() {
    const h = this.history.pop();
    if (!h) return false;
    this.world.restore(h.snap);
    this.pins.get(h.pin).socket = h.from;
    this.refreshLocks();
    this.afterChange();
    return true;
  }

  cut(ropeId) {
    const r = this.ropes.get(ropeId);
    if (!r || r.cut) return false;
    r.cut = true;
    this.world.removeRope(ropeId);
    this.world.settle(600);
    this.afterChange();
    return true;
  }

  addExtraSocket() {
    const sockets = this.sockets;
    const n = sockets.length;
    const radius = Math.max(...sockets.map((s) => Math.hypot(s.x, s.z)));
    const angle = (i) => (i / n) * Math.PI * 2;
    let best = 0;
    let bestGap = -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const gap = Math.abs(angle(j) - angle(i) + (j === 0 ? Math.PI * 2 : 0));
      const mid = (angle(i) + gap / 2);
      const x = radius * Math.cos(mid);
      const z = radius * Math.sin(mid);
      const clear = sockets.every((s) => Math.hypot(s.x - x, s.z - z) > 0.5);
      if (clear && gap > bestGap) {
        bestGap = gap;
        best = mid;
      }
    }
    const x = radius * Math.cos(best);
    const z = radius * Math.sin(best);
    sockets.push({ x, z, lock: false, temp: true });
    return sockets.length - 1;
  }

  hint() {
    const sol = this.spec.solution;
    const current = new Map([...this.pins.values()].map((p) => [p.id, p.socket]));
    for (const mv of sol) {
      if (current.get(mv.pin) === mv.to) continue;
      if (this.canMove(mv.pin, mv.to)) return mv;
    }
    return null;
  }

  refreshLocks() {
    for (const l of this.locks) {
      if (!l.unlocked && this.world.isFree(l.keyRope)) l.unlocked = true;
    }
  }

  isTangled() {
    return this.world.isTangled();
  }

  isWon() {
    return !this.world.isTangled();
  }

  afterChange() {
    this.refreshLocks();
  }
}
