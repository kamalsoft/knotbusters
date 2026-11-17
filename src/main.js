import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateLevel, Game, PALETTE, DIFFICULTY } from './levels.js';
import { ROPE_R } from './physics.js';
import { Sfx } from './audio.js';
import * as ui from './ui.js';

const SAVE = 'knotbusters.save';
const COST = { undo: 5, hint: 10, cut: 15, socket: 12 };
const COOLDOWN = { undo: 0, hint: 20000, cut: 30000, socket: 30000 };
const PIN_H = 0.35;
const SNAP = 0.7;

const save = load();
const sfx = new Sfx();
ui.setCoins(save.coins);
ui.bindMenu();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#f4efe6');
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 12, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x886644, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(6, 14, 8);
sun.castShadow = true;
scene.add(sun);

const board = new THREE.Mesh(
  new THREE.CylinderGeometry(9, 9.3, 0.6, 64),
  new THREE.MeshStandardMaterial({ color: 0xd9c4a0, roughness: 0.9 })
);
board.position.y = -0.3;
board.receiveShadow = true;
scene.add(board);

const socketGroup = new THREE.Group();
const pinGroup = new THREE.Group();
const ropeGroup = new THREE.Group();
const ringGroup = new THREE.Group();
scene.add(socketGroup, pinGroup, ropeGroup, ringGroup);

const socketMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.8 });
const lockMat = new THREE.MeshStandardMaterial({ color: 0x9a2a2a, roughness: 0.5, metalness: 0.4 });
const ringMat = new THREE.MeshBasicMaterial({ color: 0x3ad17a, transparent: true, opacity: 0.85 });
const hintMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9 });
const pinMat = new THREE.MeshStandardMaterial({ color: 0xbfc5cc, metalness: 0.8, roughness: 0.3 });
const fixedMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.25 });

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PIN_H);

let level = save.level;
let game = null;
let pinMeshes = new Map();
let socketMeshes = [];
let ropeMeshes = new Map();
let drag = null;
let cutMode = false;
let hintTimer = 0;
let frozen = false;
let started = false;
let lastT = performance.now();

function load() {
  const base = { level: 1, maxUnlocked: 1, coins: 30, cd: {}, diff: 1 };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(SAVE) || '{}') };
  } catch (e) {
    return base;
  }
}

function persist() {
  try {
    localStorage.setItem(SAVE, JSON.stringify({ level, maxUnlocked: save.maxUnlocked, coins: save.coins, cd: save.cd, diff: save.diff }));
  } catch (e) {
    ui.toast('Progress could not be saved');
  }
}

function buildBoard() {
  for (const m of socketMeshes) socketGroup.remove(m);
  for (const m of pinMeshes.values()) pinGroup.remove(m);
  for (const m of ropeMeshes.values()) ropeGroup.remove(m);
  socketMeshes = [];
  pinMeshes = new Map();
  ropeMeshes = new Map();
  game.sockets.forEach((s, i) => {
    const lock = s.lock && !game.lockFor(i)?.unlocked;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 32), lock ? lockMat : socketMat);
    m.position.set(s.x, 0.02, s.z);
    m.userData.socket = i;
    m.receiveShadow = true;
    socketGroup.add(m);
    socketMeshes.push(m);
  });
  for (const p of game.pins.values()) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 24), p.fixed ? fixedMat : pinMat);
    m.castShadow = true;
    m.userData.pin = p.id;
    pinGroup.add(m);
    pinMeshes.set(p.id, m);
    const s = game.sockets[p.socket];
    m.position.set(s.x, PIN_H, s.z);
  }
}

function rebuildRopes() {
  for (const m of ropeMeshes.values()) {
    ropeGroup.remove(m);
    m.geometry.dispose();
  }
  ropeMeshes = new Map();
  for (const [id, r] of game.world.ropes) {
    const pts = [];
    for (let i = 0; i < r.n; i++) pts.push(new THREE.Vector3(r.pos[i * 3], r.pos[i * 3 + 1], r.pos[i * 3 + 2]));
    const curve = new THREE.CatmullRomCurve3(pts);
    const color = game.ropes.get(id).color || PALETTE[0];
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, r.n * 2, ROPE_R, 10, false),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45 })
    );
    mesh.castShadow = true;
    mesh.userData.rope = id;
    ropeGroup.add(mesh);
    ropeMeshes.set(id, mesh);
  }
}

function syncPins() {
  for (const p of game.pins.values()) {
    const m = pinMeshes.get(p.id);
    if (!m || (drag && drag.id === p.id)) continue;
    const s = game.sockets[p.socket];
    m.position.set(s.x, PIN_H, s.z);
  }
}

function startLevel(n) {
  level = n;
  game = new Game(generateLevel(n, save.diff), { settle: false });
  started = false;
  buildBoard();
  rebuildRopes();
  ui.setLevel(n);
  persist();
  ui.toast(`Level ${n}`);
}

function unlockNext() {
  save.maxUnlocked = Math.max(save.maxUnlocked, level + 1);
}

function checkWin() {
  if (!game.isWon() || frozen) return;
  frozen = true;
  const reward = 10 + level;
  save.coins += reward;
  unlockNext();
  ui.setCoins(save.coins);
  persist();
  sfx.chime();
  ui.showWin(`Cleared in ${game.history.length} moves. +${reward} coins`, () => {
    frozen = false;
    startLevel(level + 1);
  });
}

function socketNear(x, z) {
  let best = -1;
  let bestD = SNAP;
  game.sockets.forEach((s, i) => {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function setRings(socket, valid) {
  ringGroup.clear();
  if (socket < 0) return;
  const s = game.sockets[socket];
  const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), ringMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(s.x, 0.05, s.z);
  if (!valid) m.material = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.85 });
  ringGroup.add(m);
}

function pickAt(ev, objects) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(objects, false)[0];
  return hit ? hit.object : null;
}

function groundPoint(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const out = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, out) ? out : null;
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || frozen) return;
  if (cutMode) {
    const obj = pickAt(ev, [...ropeMeshes.values()]);
    cutMode = false;
    if (obj && game.cut(obj.userData.rope)) {
      started = true;
      sfx.friction();
      rebuildRopes();
      checkWin();
    }
    return;
  }
  const pin = pickAt(ev, [...pinMeshes.values()]);
  if (!pin) return;
  const id = pin.userData.pin;
  const p = game.pins.get(id);
  if (p.fixed) {
    ui.toast('Bolted pin: cannot move');
    return;
  }
  drag = { id, from: p.socket };
  renderer.domElement.setPointerCapture(ev.pointerId);
  controls.enabled = false;
});

renderer.domElement.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const g = groundPoint(ev);
  if (!g) return;
  pinMeshes.get(drag.id).position.set(g.x, PIN_H, g.z);
  const target = socketNear(g.x, g.z);
  const valid = target >= 0 && game.canMove(drag.id, target);
  drag.target = target;
  setRings(target, valid);
});

renderer.domElement.addEventListener('pointerup', () => {
  if (!drag) return;
  const { id, target } = drag;
  drag = null;
  controls.enabled = true;
  ringGroup.clear();
  const opened = game.locks.filter((l) => l.unlocked).length;
  if (target >= 0 && game.movePin(id, target)) {
    started = true;
    sfx.clack();
    buildBoard();
    rebuildRopes();
    if (game.locks.filter((l) => l.unlocked).length > opened) {
      sfx.lock();
      ui.toast('Padlock opened');
    }
    checkWin();
  } else {
    syncPins();
    if (target >= 0) ui.toast(game.sockets[target].lock ? 'Padlocked socket' : 'Rope cannot reach there');
  }
});

document.querySelectorAll('[data-booster]').forEach((btn) => {
  btn.onclick = () => useBooster(btn.dataset.booster);
});

function cooldownLeft(name) {
  return Math.max(0, (save.cd[name] || 0) - Date.now());
}

function spend(name) {
  if (save.coins < COST[name]) {
    ui.toast('Not enough coins');
    return false;
  }
  if (cooldownLeft(name) > 0) {
    ui.toast('Booster recharging');
    return false;
  }
  save.coins -= COST[name];
  save.cd[name] = Date.now() + COOLDOWN[name];
  ui.setCoins(save.coins);
  persist();
  return true;
}

function useBooster(name) {
  if (frozen) return;
  if (name === 'undo') {
    if (!game.history.length) return ui.toast('Nothing to undo');
    if (!spend('undo')) return;
    game.undo();
    buildBoard();
    rebuildRopes();
  } else if (name === 'hint') {
    const mv = game.hint();
    if (!mv) return ui.toast('Try an extra socket');
    if (!spend('hint')) return;
    showHint(mv);
  } else if (name === 'cut') {
    if (!spend('cut')) return;
    cutMode = true;
    ui.toast('Tap a rope to cut it');
  } else if (name === 'socket') {
    if (!spend('socket')) return;
    game.addExtraSocket();
    buildBoard();
    ui.toast('Temporary socket added');
  }
}

function showHint(mv) {
  ringGroup.clear();
  const from = game.pins.get(mv.pin);
  const a = game.sockets[from.socket];
  const b = game.sockets[mv.to];
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.66, 40), hintMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(b.x, 0.06, b.z);
  const pinRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 32), hintMat);
  pinRing.rotation.x = -Math.PI / 2;
  pinRing.position.set(a.x, 0.06, a.z);
  ringGroup.add(ring, pinRing);
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => ringGroup.clear(), 3500);
  ui.toast(`Move the pin to the highlighted socket`);
}

document.getElementById('muteBtn').onclick = (e) => {
  e.target.textContent = sfx.toggleMute() ? 'Sound off' : 'Sound';
};

document.getElementById('menuBtn').onclick = () => {
  const pick = (diff) => {
    save.diff = diff;
    persist();
    ui.showLevelMenu(save.maxUnlocked, save.diff, DIFFICULTY.map((d) => d[0].toUpperCase() + d.slice(1)), (n) => { document.getElementById('menu').classList.add('hidden'); startLevel(n); }, pick);
  };
  pick(save.diff);
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function frame(t) {
  const dt = (t - lastT) / 1000;
  lastT = t;
  if (game) {
    if (started) game.world.advance(dt);
    syncPins();
    rebuildRopes();
    if (!frozen && game.world.ropes.size && game.isWon()) checkWin();
    for (const b of ['undo', 'hint', 'cut', 'socket']) ui.boosterLabel(b, cooldownLeft(b));
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

startLevel(level);
requestAnimationFrame(frame);
