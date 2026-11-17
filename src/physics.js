export const ROPE_R = 0.12;
export const TICK = 1 / 60;
const ITER = 10;
const GRAVITY = -9.8;
const DAMP = 0.98;
const MAX_MOVE = 0.25;
const CELL = 0.48;
const CONTACT = 2 * ROPE_R * 1.05;

export class RopeWorld {
  constructor() {
    this.anchors = new Map();
    this.ropes = new Map();
    this.acc = 0;
  }

  setAnchor(id, x, z) {
    this.anchors.set(id, { x, z });
  }

  addRope(id, aId, bId, length) {
    const A = this.anchors.get(aId);
    const B = this.anchors.get(bId);
    const n = Math.max(3, Math.round(length / 0.3) + 1);
    const seg = length / (n - 1);
    const rope = { id, aId, bId, length, n, seg, pos: new Float64Array(n * 3), prev: new Float64Array(n * 3) };
    this.ropes.set(id, rope);
    this.resetRope(rope);
    return rope;
  }

  resetRope(r) {
    const A = this.anchors.get(r.aId);
    const B = this.anchors.get(r.bId);
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const chord = Math.hypot(dx, dz);
    const sag = Math.sqrt(Math.max(0, (3 * chord * (r.length - chord)) / 8));
    const px = chord > 0 ? -dz / chord : 0;
    const pz = chord > 0 ? dx / chord : 0;
    for (let k = 0; k < r.n; k++) {
      const t = k / (r.n - 1);
      const bulge = 4 * sag * t * (1 - t);
      r.pos[k * 3] = A.x + dx * t + px * bulge;
      r.pos[k * 3 + 1] = ROPE_R;
      r.pos[k * 3 + 2] = A.z + dz * t + pz * bulge;
    }
    r.prev.set(r.pos);
  }

  removeRope(id) {
    this.ropes.delete(id);
  }

  pinEnds(rope) {
    const A = this.anchors.get(rope.aId);
    const B = this.anchors.get(rope.bId);
    const last = (rope.n - 1) * 3;
    rope.pos[0] = rope.prev[0] = A.x;
    rope.pos[1] = rope.prev[1] = ROPE_R;
    rope.pos[2] = rope.prev[2] = A.z;
    rope.pos[last] = rope.prev[last] = B.x;
    rope.pos[last + 1] = rope.prev[last + 1] = ROPE_R;
    rope.pos[last + 2] = rope.prev[last + 2] = B.z;
  }

  reach(aId, bId) {
    const A = this.anchors.get(aId);
    const B = this.anchors.get(bId);
    return Math.hypot(A.x - B.x, A.z - B.z);
  }

  snapshot() {
    const ropes = new Map();
    for (const [id, r] of this.ropes) ropes.set(id, { pos: Float64Array.from(r.pos), prev: Float64Array.from(r.prev) });
    return { anchors: new Map([...this.anchors].map(([k, v]) => [k, { ...v }])), ropes };
  }

  restore(snap) {
    this.anchors = new Map([...snap.anchors].map(([k, v]) => [k, { ...v }]));
    for (const [id, s] of snap.ropes) {
      const r = this.ropes.get(id);
      if (!r) continue;
      r.pos.set(s.pos);
      r.prev.set(s.prev);
    }
    for (const r of this.ropes.values()) this.pinEnds(r);
  }

  advance(seconds) {
    this.acc += Math.min(seconds, 0.1);
    while (this.acc >= TICK) {
      this.step();
      this.acc -= TICK;
    }
  }

  step() {
    for (const r of this.ropes.values()) {
      const p = r.pos;
      const q = r.prev;
      for (let i = 1; i < r.n - 1; i++) {
        const k = i * 3;
        for (let c = 0; c < 3; c++) {
          let v = (p[k + c] - q[k + c]) * DAMP;
          if (v > MAX_MOVE) v = MAX_MOVE;
          if (v < -MAX_MOVE) v = -MAX_MOVE;
          q[k + c] = p[k + c];
          p[k + c] += v;
        }
        p[k + 1] += GRAVITY * TICK * TICK;
      }
      this.pinEnds(r);
    }
    for (let it = 0; it < ITER; it++) {
      for (const r of this.ropes.values()) this.distance(r);
      for (const r of this.ropes.values()) this.floor(r);
      this.collide();
      for (let k = 0; k < 16; k++) for (const r of this.ropes.values()) this.distance(r);
      for (const r of this.ropes.values()) this.pinEnds(r);
    }
    for (const r of this.ropes.values()) {
      for (const v of r.pos) {
        if (!Number.isFinite(v)) {
          this.resetRope(r);
          break;
        }
      }
    }
  }

  distance(r) {
    const p = r.pos;
    for (let i = 0; i < r.n - 1; i++) {
      const a = i * 3;
      const b = a + 3;
      const dx = p[b] - p[a];
      const dy = p[b + 1] - p[a + 1];
      const dz = p[b + 2] - p[a + 2];
      const len = Math.hypot(dx, dy, dz) || 1e-9;
      const diff = (len - r.seg) / len;
      const wa = i === 0 ? 0 : 1;
      const wb = i + 1 === r.n - 1 ? 0 : 1;
      const ws = wa + wb;
      if (ws === 0) continue;
      const ka = (wa / ws) * diff;
      const kb = (wb / ws) * diff;
      p[a] += dx * ka; p[a + 1] += dy * ka; p[a + 2] += dz * ka;
      p[b] -= dx * kb; p[b + 1] -= dy * kb; p[b + 2] -= dz * kb;
    }
  }

  floor(r) {
    const p = r.pos;
    for (let i = 1; i < r.n - 1; i++) if (p[i * 3 + 1] < ROPE_R) p[i * 3 + 1] = ROPE_R;
  }

  segments() {
    const out = [];
    for (const r of this.ropes.values()) {
      for (let i = 0; i < r.n - 1; i++) out.push({ r, i });
    }
    return out;
  }

  collide() {
    const segs = this.segments();
    const grid = new Map();
    segs.forEach((s, idx) => {
      const p = s.r.pos;
      const a = s.i * 3;
      const b = a + 3;
      const x0 = Math.floor(Math.min(p[a], p[b]) / CELL);
      const x1 = Math.floor(Math.max(p[a], p[b]) / CELL);
      const z0 = Math.floor(Math.min(p[a + 2], p[b + 2]) / CELL);
      const z1 = Math.floor(Math.max(p[a + 2], p[b + 2]) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = `${cx},${cz}`;
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(idx);
        }
      }
    });
    const seen = new Set();
    for (const list of grid.values()) {
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const i = list[x];
          const j = list[y];
          const pairKey = i < j ? i * 100000 + j : j * 100000 + i;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          this.pairCollide(segs[i], segs[j]);
        }
      }
    }
  }

  pairCollide(s1, s2) {
    if (s1.r === s2.r && Math.abs(s1.i - s2.i) <= 1) return;
    const a1 = this.anchorIds(s1);
    const a2 = this.anchorIds(s2);
    if (a1.some((id) => a2.includes(id))) return;
    const p = s1.r.pos;
    const q = s2.r.pos;
    const o1 = s1.i * 3;
    const o2 = s2.i * 3;
    const c = closest(p, o1, o1 + 3, q, o2, o2 + 3);
    if (c.dist >= 2 * ROPE_R) return;
    let nx = c.x1 - c.x2;
    let ny = c.y1 - c.y2;
    let nz = c.z1 - c.z2;
    const d = Math.hypot(nx, ny, nz);
    if (d < 1e-9) {
      nx = 0; ny = 1; nz = 0;
    } else {
      nx /= d; ny /= d; nz /= d;
    }
    const pen = 2 * ROPE_R - c.dist;
    const half = pen * 0.5;
    const w1 = [1 - c.s, c.s];
    const w2 = [1 - c.t, c.t];
    const sum1 = w1[0] * w1[0] + w1[1] * w1[1];
    const sum2 = w2[0] * w2[0] + w2[1] * w2[1];
    this.push(s1.r, o1, w1, nx, ny, nz, half / sum1);
    this.push(s2.r, o2, w2, nx, ny, nz, -half / sum2);
  }

  push(r, o, w, nx, ny, nz, k) {
    const p = r.pos;
    const idx = [o, o + 3];
    for (let m = 0; m < 2; m++) {
      const node = idx[m] / 3;
      if (node === 0 || node === r.n - 1) continue;
      const s = w[m] * k;
      p[idx[m]] += nx * s;
      p[idx[m] + 1] += ny * s;
      p[idx[m] + 2] += nz * s;
    }
  }

  anchorIds(seg) {
    const out = [];
    if (seg.i === 0) out.push(seg.r.aId);
    if (seg.i + 1 === seg.r.n - 1) out.push(seg.r.bId);
    return out;
  }

  crossings() {
    const segs = this.segments();
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s1 = segs[i];
        const s2 = segs[j];
        if (s1.r === s2.r && Math.abs(s1.i - s2.i) <= 1) continue;
        const p = s1.r.pos;
        const q = s2.r.pos;
        const o1 = s1.i * 3;
        const o2 = s2.i * 3;
        if (!properXZ(p, o1, o1 + 3, q, o2, o2 + 3)) continue;
        const c = closest(p, o1, o1 + 3, q, o2, o2 + 3);
        if (c.dist > CONTACT) continue;
        out.push([s1.r.id, s2.r.id]);
      }
    }
    return out;
  }

  isTangled() {
    return this.crossings().length > 0;
  }

  isFree(ropeId) {
    return !this.crossings().some(([a, b]) => a === ropeId || b === ropeId);
  }

  maxSpeed() {
    let m = 0;
    for (const r of this.ropes.values()) {
      for (let i = 0; i < r.n; i++) {
        const k = i * 3;
        const dx = r.pos[k] - r.prev[k];
        const dy = r.pos[k + 1] - r.prev[k + 1];
        const dz = r.pos[k + 2] - r.prev[k + 2];
        m = Math.max(m, Math.hypot(dx, dy, dz));
      }
    }
    return m;
  }

  settle(maxTicks = 900) {
    let t = 0;
    while (t < maxTicks) {
      this.step();
      t++;
      if (this.maxSpeed() < 1e-3) break;
    }
    return t;
  }
}

function properXZ(p, a, b, q, c, d) {
  const o = (ax, az, bx, bz, cx, cz) => Math.sign((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  const o1 = o(p[a], p[a + 2], p[b], p[b + 2], q[c], q[c + 2]);
  const o2 = o(p[a], p[a + 2], p[b], p[b + 2], q[d], q[d + 2]);
  const o3 = o(q[c], q[c + 2], q[d], q[d + 2], p[a], p[a + 2]);
  const o4 = o(q[c], q[c + 2], q[d], q[d + 2], p[b], p[b + 2]);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function closest(p, a, b, q, c, d) {
  const d1x = p[b] - p[a], d1y = p[b + 1] - p[a + 1], d1z = p[b + 2] - p[a + 2];
  const d2x = q[d] - q[c], d2y = q[d + 1] - q[c + 1], d2z = q[d + 2] - q[c + 2];
  const rx = p[a] - q[c], ry = p[a + 1] - q[c + 1], rz = p[a + 2] - q[c + 2];
  const A = d1x * d1x + d1y * d1y + d1z * d1z;
  const E = d2x * d2x + d2y * d2y + d2z * d2z;
  const F = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (A <= 1e-12 && E <= 1e-12) {
    s = t = 0;
  } else if (A <= 1e-12) {
    t = clamp01(F / E);
  } else {
    const C = d1x * rx + d1y * ry + d1z * rz;
    if (E <= 1e-12) {
      s = clamp01(-C / A);
    } else {
      const B = d1x * d2x + d1y * d2y + d1z * d2z;
      const den = A * E - B * B;
      s = den > 1e-12 ? clamp01((B * F - C * E) / den) : 0;
      t = (B * s + F) / E;
      if (t < 0) { t = 0; s = clamp01(-C / A); }
      else if (t > 1) { t = 1; s = clamp01((B - C) / A); }
    }
  }
  const x1 = p[a] + d1x * s, y1 = p[a + 1] + d1y * s, z1 = p[a + 2] + d1z * s;
  const x2 = q[c] + d2x * t, y2 = q[c + 1] + d2y * t, z2 = q[c + 2] + d2z * t;
  return { s, t, x1, y1, z1, x2, y2, z2, dist: Math.hypot(x1 - x2, y1 - y2, z1 - z2) };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
