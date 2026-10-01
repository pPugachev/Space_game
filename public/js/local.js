// Одиночный режим: мир живёт прямо в браузере, без сервера.
import { createWorld, stepWorld, snapshotOf, buyUpgrade, selectCard } from '/shared/world.js';
import { showCardPicker, hideCardPicker } from './cards.js';

// Solo-модули храним в localStorage (в Ангаре Б2 они будут и на сервере).
const SOLO_MODULES_KEY = 'ab_modules_solo';

export function loadSoloModules() {
  try {
    const raw = localStorage.getItem(SOLO_MODULES_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      return {
        unlocked: obj.unlocked || {},
        active: obj.active || {},
        levels: obj.levels || {},
      };
    }
  } catch {}
  return { unlocked: {}, active: {}, levels: {} };
}

// Новый модуль получен с босса (Фантом → ракеты): разблокируем и активируем.
export function grantSoloModule(key) {
  const st = loadSoloModules();
  st.unlocked[key] = true;
  st.active[key] = true;
  if (st.levels[key] == null) st.levels[key] = 0;
  try { localStorage.setItem(SOLO_MODULES_KEY, JSON.stringify(st)); } catch {}
  return st;
}

export function startLocalGame({ renderer, input, nickname, onOver, onBuyResult, modules, hangar = {}, cosmetics = null, onModuleUnlock, godMode = false }) {
  hideCardPicker();
  const urlGodMode = /[?&]godMode=1(?=&|$)/.test(location.search);
  const world = createWorld({
    playerIds: ['you'],
    nicknames: { you: nickname || 'Пилот' },
    durationMs: null, // бесконечно, пока живы
    seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
    modulesByPlayer: { you: modules },
    hangarByPlayer: { you: hangar },        // Б2: уровни базовых характеристик
    cosmeticsByPlayer: { you: { equipped: (cosmetics && cosmetics.equipped) || 'default' } },
    godMode: godMode || urlGodMode,
  });
  // убийство Фантома разблокирует модуль «Ракеты»: в онлайне — через сервер
  // (Б2: solo-модули на сервере), офлайн — в localStorage
  world.onModuleUnlock = (playerId, key) => {
    if (key !== 'rockets') return;
    if (onModuleUnlock) onModuleUnlock(key);
    else grantSoloModule('rockets');
  };

  let raf = null;
  let last = null;
  let acc = 0;
  const STEP = 1 / 60;
  let finished = false;
  let pickerBusy = false;

  // А3: после шага симуляции проверяем, появились ли карточки уровня
  function checkCards() {
    const pending = world.pendingCards && world.pendingCards.you;
    if (pending && pending.length && !pickerBusy) {
      pickerBusy = true;
      showCardPicker(pending, (cardId) => {
        selectCard(world, 'you', cardId);
        pickerBusy = false;
      });
    }
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (last == null) last = ts;
    acc += Math.min((ts - last) / 1000, 0.25);
    last = ts;

    const buyTrack = input.consumeBuyKey();
    if (buyTrack) {
      const res = buyUpgrade(world, 'you', buyTrack);
      if (onBuyResult) onBuyResult(res);
    }

    // лазер/мины — по одному срабатыванию на нажатие
    let pendingLaser=false, pendingMine=false;
    if (input.wantsLaser()) { pendingLaser = input.consumeLaser(); }
    if (input.wantsMine()) { pendingMine = input.consumeMine(); }
    while (acc >= STEP && !finished) {
      if (pickerBusy) { acc = 0; break; }
      acc -= STEP;
      const me = world.players[0];
      const move = input.getMove();
      stepWorld(world, STEP, {
        you: {
          mx: move.mx,
          my: move.my,
          aim: me.alive ? input.getAim(me.x, me.y) : undefined,
          shoot: me.alive ? input.isShooting() : false,
          mis: me.alive ? input.wantsMissile() : false,
          laser: me.alive ? pendingLaser : false,
          mine: me.alive ? pendingMine : false,
        },
      });
      pendingLaser=false; pendingMine=false;
      checkCards();
      if (pickerBusy) { acc = 0; break; }
      if (world.status === 'over') {
        finished = true;
        break;
      }
    }

    const snap = snapshotOf(world);
    renderer.setState(snap);
    renderer.updateHud(snap, 'you', { solo: true });
    if (finished) {
      stop();
      const p = world.players[0];
      onOver({
        reason: 'all-dead',
        players: [{
          playerId: 'you',
          nickname: p.nick,
          score: p.score,
          kills: p.kills,
          deaths: p.deaths,
          coinsEarned: p.coins,
          timeMs: Math.round(world.t),
        }],
      });
      return;
    }
  }

  raf = requestAnimationFrame(frame);

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    hideCardPicker();
  }

  return {
    buy: (track) => {
      if (!finished) return buyUpgrade(world, 'you', track);
      return { error: 'match-over' };
    },
    stop,
  };
}
