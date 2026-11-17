---
name: pbd-rope-physics
description: Rules for the Knot Busters rope simulation (PBD distance constraints, capsule collision, anchor locks, crossing-number tangle detection, dt clamping). Load before editing src/physics.js or any rope/anchor logic.
---

# PBD rope physics

- Fixed step only: `TICK = 1/60`. `advance(seconds)` clamps input to 0.1 s and runs whole ticks from an accumulator. Never pass render dt straight into `step`.
- Each rope is `n` nodes. Node 0 and node n-1 are anchors (inverse mass 0). Interior nodes have inverse mass 1.
- Verlet integration with damping 0.98 and gravity -9.8 on `y`. Clamp per-node displacement to `0.25` per tick.
- Constraints per tick, `ITER = 10`:
  1. Segment distance to the rope's own `seg = L / (n-1)`, weighted by inverse mass.
  2. Floor: `y >= ROPE_R`.
  3. Capsule collision between segments with `2R` minimum separation. Use a uniform hash grid, `cell = 0.48`, built each iteration. Skip pairs that share an anchor node. Skip adjacent segments of the same rope.
  4. Collision normal is `(c1 - c2)/|c1 - c2|`, falling back to `(0,1,0)` on degenerate contact so crossings lift rather than slide through.
- After collision, run 16 extra distance passes per iteration. Measured worst segment error with a single post-collision pass was about 40%; with 16 passes, two crossing ropes moving at 0.1 units/tick stay at 2.6% and a single self-colliding rope at 0.5%. The ±5% tolerance needs this.
- Anchors are moved by the caller in small interpolated steps, at most 0.1 units per tick. The game's `movePin` uses 32 frames. Teleporting an anchor is forbidden: it injects energy and causes spurious stacking.
- Reach: a rope may only be extended to `chord <= 0.97 * L`. Enforce this in the game layer before moving an anchor. Never let the solver clamp it silently.
- Tangle (crossing number): two segments are crossed when (a) their XZ projections properly intersect (orientation test, shared endpoints excluded), and (b) their 3D closest distance is `<= 2R * 1.05`. Bridges above `2R*1.05` do not count. Same-rope non-adjacent segments count too.
- `tangled = crossings().length > 0`. A rope is free when no crossing involves its id.
- Rest detection: `settle(maxTicks = 900)` stops when the max per-node speed is below `1e-3`.
- NaN guard: after each tick, if any coordinate is non-finite, `resetRope` rebuilds that rope from its anchors.
- Undo uses `snapshot()` / `restore()` of all node arrays and anchor positions. Do not re-simulate backwards.
- Keep the physics module DOM-free so `tests/verify.mjs` can import it under Node.
