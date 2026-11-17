import assert from 'node:assert/strict';
import { generateLevel, Game, mulberry32 } from '../src/levels.js';
import { RopeWorld, TICK } from '../src/physics.js';

const results = [];
function test(name, fn) {
  const t = Date.now();
  try {
    fn();
    results.push({ name, ok: true, ms: Date.now() - t });
  } catch (e) {
    results.push({ name, ok: false, err: e.message, ms: Date.now() - t });
  }
}

test('physics stability: 1000 ticks of extreme in-reach pin displacement', () => {
  const rnd = mulberry32(42);
  const w = new RopeWorld();
  w.setAnchor('a', -3, -3); w.setAnchor('b', 3, 3);
  w.setAnchor('c', 3, -3); w.setAnchor('d', -3, 3);
  w.addRope('r0', 'a', 'b', 9);
  w.addRope('r1', 'c', 'd', 9);
  const tgt = { a: [-3, -3], c: [3, -3] };
  for (let t = 0; t < 1000; t++) {
    if (t % 120 === 0) {
      for (const [id, other] of [['a', 'b'], ['c', 'd']]) {
        const o = w.anchors.get(other);
        const ang = rnd() * Math.PI * 2;
        const dist = 8.7 * rnd();
        tgt[id] = [o.x + Math.cos(ang) * dist, o.z + Math.sin(ang) * dist];
      }
    }
    for (const id of ['a', 'c']) {
      const p = w.anchors.get(id);
      const dx = tgt[id][0] - p.x;
      const dz = tgt[id][1] - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const s = Math.min(0.1, d);
      w.setAnchor(id, p.x + (dx / d) * s, p.z + (dz / d) * s);
    }
    w.step();
    for (const r of w.ropes.values()) {
      for (const v of r.pos) assert.ok(Number.isFinite(v), `NaN at tick ${t}`);
      for (let i = 0; i < r.n - 1; i++) {
        const a = i * 3, b = a + 3;
        const len = Math.hypot(r.pos[b] - r.pos[a], r.pos[b + 1] - r.pos[a + 1], r.pos[b + 2] - r.pos[a + 2]);
        assert.ok(Math.abs(len - r.seg) / r.seg <= 0.05, `segment ${len} vs ${r.seg} at tick ${t}`);
      }
    }
  }
});

test('solvability: levels 1-50 start tangled and the recorded solution untangles them', () => {
  for (let L = 1; L <= 50; L++) {
    const spec = generateLevel(L);
    const g = new Game(spec, { settle: false });
    assert.equal(g.isTangled(), true, `level ${L} initial state should be tangled`);
    for (const mv of spec.solution) assert.equal(g.movePin(mv.pin, mv.to), true, `level ${L} move ${JSON.stringify(mv)} rejected`);
    g.world.settle(1200);
    assert.equal(g.isTangled(), false, `level ${L} still tangled after solution`);
  }
});

test('difficulty tiers: easy and hard levels 1-5 also verify and untangle', () => {
  for (const diff of [0, 2]) {
    for (let L = 1; L <= 5; L++) {
      const spec = generateLevel(L, diff);
      const g = new Game(spec, { settle: false });
      assert.equal(g.isTangled(), true, `diff  level  initial`);
      for (const mv of spec.solution) assert.equal(g.movePin(mv.pin, mv.to), true);
      g.world.settle(1200);
      assert.equal(g.isTangled(), false, `diff  level  solved`);
    }
  }
});

test('fixed pin is immovable', () => {
  const spec = generateLevel(4);
  const g = new Game(spec, { settle: false });
  const fixed = [...g.pins.values()].find((p) => p.fixed);
  assert.ok(fixed, 'level 4 has a fixed pin');
  const target = g.sockets.findIndex((_, i) => !g.occupied(i) && !g.sockets[i].lock);
  assert.equal(g.movePin(fixed.id, target), false);
  assert.equal(g.pins.get(fixed.id).socket, fixed.socket);
});

test('octopus hub moves all attached strands together', () => {
  const spec = generateLevel(7);
  const count = new Map();
  for (const r of spec.ropes) for (const p of [r.a, r.b]) count.set(p, (count.get(p) || 0) + 1);
  const hub = [...count].find(([, n]) => n >= 2);
  assert.ok(hub, 'level 7 has a hub');
  const g = new Game(spec, { settle: false });
  const free = g.sockets.findIndex((_, i) => !g.occupied(i) && !g.sockets[i].lock && g.reachOK(hub[0], i));
  assert.ok(free >= 0, 'a reachable free socket exists');
  assert.equal(g.movePin(hub[0], free), true);
  const s = g.sockets[free];
  for (const r of g.ropes.values()) {
    if (r.a !== hub[0] && r.b !== hub[0]) continue;
    const ep = r.a === hub[0] ? 0 : (g.world.ropes.get(r.id).n - 1);
    const pos = g.world.ropes.get(r.id).pos;
    assert.ok(Math.hypot(pos[ep * 3] - s.x, pos[ep * 3 + 2] - s.z) < 1e-6, `strand ${r.id} endpoint did not follow hub`);
  }
});

test('key-lock unlocks when the key rope is free', () => {
  const spec = generateLevel(10);
  const g = new Game(spec, { settle: false });
  assert.equal(g.locks[0].unlocked, g.world.isFree('r0'));
  for (const mv of spec.solution) g.movePin(mv.pin, mv.to);
  assert.equal(g.isWon(), true);
  assert.equal(g.locks[0].unlocked, true, 'lock should open once the board is untangled');
});

test('undo restores socket, anchor geometry and tangle state', () => {
  const spec = generateLevel(3);
  const g = new Game(spec, { settle: false });
  const before = { socket: new Map([...g.pins.values()].map((p) => [p.id, p.socket])), tangled: g.isTangled(), pos: g.world.snapshot() };
  const mv = spec.solution[0];
  assert.equal(g.movePin(mv.pin, mv.to), true);
  assert.equal(g.undo(), true);
  for (const [id, s] of before.socket) assert.equal(g.pins.get(id).socket, s);
  assert.equal(g.isTangled(), before.tangled);
  for (const [id, a] of before.pos.anchors) {
    assert.equal(g.world.anchors.get(id).x, a.x);
    assert.equal(g.world.anchors.get(id).z, a.z);
  }
});

test('cutting a rope recalculates the win state', () => {
  const g = new Game(generateLevel(5));
  assert.equal(g.isWon(), false);
  const [[a]] = g.world.crossings();
  const before = g.world.crossings().length;
  assert.equal(g.cut(a), true);
  assert.equal(g.isWon(), !g.world.isTangled());
  assert.ok(g.world.crossings().length <= before);
  for (const r of [...g.ropes.keys()]) g.cut(r);
  assert.equal(g.isWon(), true, 'no ropes left means nothing is tangled');
});

test('hint returns a legal move that the solution would make', () => {
  const spec = generateLevel(6);
  const g = new Game(spec, { settle: false });
  const mv = g.hint();
  assert.ok(mv, 'hint available');
  assert.equal(g.canMove(mv.pin, mv.to), true);
});

test('dt clamp: a large frame delta advances at most 0.1 s of ticks', () => {
  const w = new RopeWorld();
  w.setAnchor('a', 0, 0); w.setAnchor('b', 2, 0);
  w.addRope('r', 'a', 'b', 2.5);
  let n = 0;
  const orig = w.step.bind(w);
  w.step = () => { n++; orig(); };
  w.advance(5);
  assert.ok(n <= Math.ceil(0.1 / TICK) + 1, `ran ${n} ticks`);
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`PASS ${r.name} (${r.ms} ms)`);
  else {
    failed++;
    console.log(`FAIL ${r.name}: ${r.err}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
