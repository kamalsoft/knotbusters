---
name: knot-level-architect
description: Rules for generating Knot Busters levels by reverse scramble, scaling difficulty (rope count, slack, scramble length, special pins), and extracting hints from the recorded solution. Load before editing src/levels.js.
---

# Knot level architect

- Never sample random knots. Build the solved state first: sockets sit on a rim circle, and the chords between paired sockets form a non-crossing matching (random balanced parenthesis word over sorted socket indices).
- Each rope length is `chord * (1 + slack)`, with `slack` between 0.12 and 0.22.
- Scramble: apply `K` random legal pin moves to movable pins only, moving each to an empty non-lock socket. Each move must keep every attached rope within reach (`chord <= 0.97 * L`). Record `{pin, from, to}`.
- Solution = the scramble reversed, with each move as `{pin, to: from}` in reverse order. Store it on the level.
- Verify before shipping: build a fresh Game from the scrambled spec, settle, and require `tangled === true`. Then replay the solution with `movePin`, settle, and require `tangled === false`. On failure, retry with the next attempt seed, up to 40 attempts, then throw.
- Difficulty by level `L` (1-based, unbounded, seeded by `L`):
  - rope count `min(8, 2 + floor((L-1)/4))`
  - scramble moves `min(12, 2 + floor(L/2))`
  - fixed pins from L4 (one pin, excluded from scramble)
  - octopus hub from L7: merge two adjacent-in-order endpoints of different chords into one socket
  - key/lock from L10: one spare socket is locked until the key rope (rope 0) is free
- Campaign levels 1 to 20 use this same parameter curve, and levels 21+ continue it. Nothing is hand-authored.
- Hints: return the first misplaced pin whose solved socket is empty, as a `{pin, to}` move. If every misplaced pin's target is occupied (a cycle), return null and suggest the Extra Socket booster.
- Socket ids are indices into `sockets`. Pin ids are `p<socketIndex>` at generation time and never reused.
- Seeds are deterministic: `mulberry32(L * 7919 + attempt * 104729 + 17)`.
