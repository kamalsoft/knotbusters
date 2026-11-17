const $ = (id) => document.getElementById(id);

export function setLevel(n) {
  $('lvl').textContent = n;
}

export function setCoins(n) {
  $('coinCount').textContent = n;
}

let toastTimer = 0;
export function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

export function boosterLabel(name, cdLeft) {
  const btn = document.querySelector(`[data-booster="${name}"]`);
  const base = { undo: 'Undo', hint: 'Hint', cut: 'Scissors', socket: 'Socket' }[name];
  btn.innerHTML = cdLeft > 0 ? `${base}<span class="cd">${Math.ceil(cdLeft / 1000)}s</span>` : base;
  btn.disabled = cdLeft > 0;
}

export function showLevelMenu(maxUnlocked, diff, names, onPick, onDiff) {
  const row = $('diffRow');
  row.innerHTML = '';
  names.forEach((name, i) => {
    const b = document.createElement('button');
    b.textContent = name;
    if (i === diff) b.classList.add('on');
    b.onclick = () => onDiff(i);
    row.appendChild(b);
  });
  const grid = $('levelGrid');
  grid.innerHTML = '';
  const top = Math.max(maxUnlocked, 20);
  for (let n = 1; n <= top; n++) {
    const b = document.createElement('button');
    b.textContent = n;
    if (n > maxUnlocked) b.classList.add('locked');
    b.disabled = n > maxUnlocked;
    b.onclick = () => {
      $('menu').classList.add('hidden');
      onPick(n);
    };
    grid.appendChild(b);
  }
  $('menu').classList.remove('hidden');
}

export function showWin(text, onNext) {
  $('winText').textContent = text;
  $('nextBtn').onclick = () => {
    $('win').classList.add('hidden');
    onNext();
  };
  $('win').classList.remove('hidden');
}

export function bindMenu() {
  $('closeMenu').onclick = () => $('menu').classList.add('hidden');
}

export const show = (id) => $(id).classList.remove('hidden');
export const hide = (id) => $(id).classList.add('hidden');
