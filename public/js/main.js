// Точка входа клиента: экраны, меню, звук, запуск режимов (соло/мультиплеер).
import { net, connect, api, getIdentity, saveNickname, isConnected } from './net.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import { startLocalGame, loadSoloModules, grantSoloModule } from './local.js';
import { startMultiGame } from './multi.js';
import { createHangar } from './hangar.js';
import { BALANCE } from '/shared/balance.js';

const $ = (id) => document.getElementById(id);
const els = {
  menuScreen: $('menuScreen'),
  gameScreen: $('gameScreen'),
  waitOverlay: $('waitOverlay'),
  waitTitle: $('waitTitle'),
  waitInfo: $('waitInfo'),
  waitCode: $('waitCode'),
  waitCancelBtn: $('waitCancelBtn'),
  overOverlay: $('overOverlay'),
  overImage: $('overImage'),
  overTitle: $('overTitle'),
  overReason: $('overReason'),
  overRows: $('overRows'),
  overRecord: $('overRecord'),
  overRank: $('overRank'),
  againBtn: $('againBtn'),
  toMenuBtn: $('toMenuBtn'),
  rankBtn: $('rankBtn'),
  rankOverlay: $('rankOverlay'),
  rankTabs: $('rankTabs'),
  rankSizes: $('rankSizes'),
  rankMeta: $('rankMeta'),
  rankList: $('rankList'),
  rankCloseBtn: $('rankCloseBtn'),
  hangarBtn: $('hangarBtn'),
  hangarBtnOver: $('hangarBtnOver'),
  hangarOverlay: $('hangarOverlay'),
  gameHint: $('gameHint'),
  announce: $('announce'),
  nickInput: $('nickInput'),
  connState: $('connState'),
  soloBtn: $('soloBtn'),
  findBtn: $('findBtn'),
  createBtn: $('createBtn'),
  joinCodeInput: $('joinCodeInput'),
  joinBtn: $('joinBtn'),
  menuError: $('menuError'),
  recordLine: $('recordLine'),
};

const canvas = $('gameCanvas');
const renderer = createRenderer(canvas);
const input = createInput(canvas, () => renderer.getView());

let current = null; // { mode: 'solo'|'multi', controller }
let selfId = null;
let overShown = false;
let lastMode = null;
let serverGodMode = false;
let serverConfigLoaded = false;
let playerStats = null;

// Единая точка обновления статистики аккаунта (Ангар/соло-матчи читают её отсюда)
function setStats(st) {
  if (st != null) playerStats = st;
  updateRecordLine(playerStats);
}

// god mode из .env / GOD_MODE=1 на сервере работает и в соло (страница отдаётся сервером)
async function loadServerConfig() {
  if (serverConfigLoaded) return;
  try {
    const r = await fetch('/config', { cache: 'no-store' });
    if (r.ok) {
      const c = await r.json();
      serverGodMode = !!(c && c.godMode);
    }
  } catch {}
  serverConfigLoaded = true;
}
loadServerConfig();

// ===================== ЗВУК (WebAudio, без файлов) =====================
let audioCtx = null;
let soundsThisWindow = 0;

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone({ type = 'sine', from = 440, to = from, dur = 0.1, vol = 0.1 }) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst({ dur = 0.35, vol = 0.25, cutoff = 900 }) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t0);
}

renderer.onFx((f, state) => {
  // глобальные оповещения об угрозах — без приглушения по расстоянию
  if (f.tp === 'warning') {
    if (f.k) {
      const def = BALANCE.bosses.types[f.k];
      showAnnounce('☠ БОСС ' + ((def ? def.name : f.k) + '').toUpperCase() + '!');
    } else if (f.z >= 3) showAnnounce(f.z===3?'☠ БОСС ДРЕДНОУТ!':f.z===4?'☠ БОСС ФАНТОМ!':'☠ БОСС ЛЕВИАФАН!');
    else showAnnounce(f.z === 2 ? '⚠ ВРАЖЕСКИЕ КОРАБЛИ!' : '⚠ СКОРОСТНЫЕ КОМЕТЫ!');
    if (f.k) {
      // В2: двойной низкий гудок перед появлением босса
      tone({ type: 'sawtooth', from: 110, to: 55, dur: 0.65, vol: 0.2 });
      setTimeout(() => tone({ type: 'sawtooth', from: 110, to: 55, dur: 0.65, vol: 0.2 }), 620);
    } else {
      tone({ type: 'sawtooth', from: 620, to: 330, dur: 0.42, vol: 0.12 });
      setTimeout(() => tone({ type: 'sawtooth', from: 620, to: 330, dur: 0.42, vol: 0.12 }), 500);
    }
    return;
  }
  // В1: смена фазы босса — глобальное объявление + сигнал
  if (f.tp === 'bossphase') {
    const def = (f.k && BALANCE.bosses.types[f.k]) || null;
    const name = def ? def.name : 'БОСС';
    showAnnounce('⚡ ' + name.toUpperCase() + ' — ФАЗА ' + f.z + '!');
    tone({ type: 'sawtooth', from: 190, to: 90, dur: 0.5, vol: 0.18 });
    setTimeout(() => tone({ type: 'sawtooth', from: 300, to: 140, dur: 0.6, vol: 0.18 }), 260);
    return;
  }
  // приглушение по расстоянию до своего корабля + защита от звукового шторма
  if (soundsThisWindow > 10) return;
  let vol = 1;
  if (state) {
    const me = state.ps.find((p) => p.i === selfId);
    if (me) {
      const d = Math.hypot(f.x - me.x, f.y - me.y);
      vol = Math.max(0, 1 - d / 1300);
      if (vol <= 0.02) return;
    }
  }
  soundsThisWindow++;
  setTimeout(() => { soundsThisWindow--; }, 120);

  switch (f.tp) {
    case 'shoot': tone({ type: 'square', from: 760, to: 190, dur: 0.06, vol: 0.05 * vol }); break;
    case 'hit': tone({ type: 'triangle', from: 220, to: 160, dur: 0.04, vol: 0.07 * vol }); break;
    case 'boom': noiseBurst({ dur: 0.3 + f.z * 0.08, vol: 0.16 * Math.min(f.z, 2.5) * vol, cutoff: 500 + 300 / f.z }); break;
    case 'coin': tone({ type: 'sine', from: 880, to: 1420, dur: 0.09, vol: 0.09 * vol }); break;
    case 'energy': tone({ type: 'sine', from: 720, to: 1180, dur: 0.1, vol: 0.08 * vol }); break;
    case 'spawn': tone({ type: 'sine', from: 280, to: 940, dur: 0.22, vol: 0.08 * vol }); break;
    case 'upgrade': tone({ type: 'sine', from: 620, to: 620, dur: 0.09, vol: 0.09 * vol }); tone({ type: 'sine', from: 930, to: 930, dur: 0.12, vol: 0.08 * vol }); break;
    case 'levelup': tone({ type: 'sine', from: 540, to: 1080, dur: 0.2, vol: 0.1 }); break;
    case 'shield': tone({ type: 'sine', from: 400, to: 800, dur: 0.18, vol: 0.09 * vol }); break;
    case 'laser': noiseBurst({ dur: 0.35, vol: 0.12*vol, cutoff: 2200 }); break;
    case 'mine': tone({ type: 'triangle', from: 180, to: 90, dur: 0.15, vol: 0.08*vol }); break;
  }
});
renderer.onCometWarn(() => {
  tone({ type: 'triangle', from: 1250, to: 950, dur: 0.1, vol: 0.07 });
});
document.addEventListener('pointerdown', ensureAudio, { once: true });

// ===================== ЭКРАНЫ =====================
function showMenu() {
  stopGame();
  els.gameScreen.classList.add('hidden');
  els.overOverlay.classList.add('hidden');
  els.waitOverlay.classList.add('hidden');
  els.rankOverlay.classList.add('hidden');
  els.menuScreen.classList.remove('hidden');
  input.setActive(false);
}

function showGame() {
  els.menuScreen.classList.add('hidden');
  els.waitOverlay.classList.add('hidden');
  els.overOverlay.classList.add('hidden');
  els.rankOverlay.classList.add('hidden');
  els.gameScreen.classList.remove('hidden');
  input.setActive(true);
}

function showWait(title, info, code = null) {
  els.waitTitle.textContent = title;
  els.waitInfo.textContent = info;
  if (code) {
    els.waitCode.textContent = code;
    els.waitCode.classList.remove('hidden');
  } else {
    els.waitCode.classList.add('hidden');
  }
  els.waitOverlay.classList.remove('hidden');
}

function hideWait() {
  els.waitOverlay.classList.add('hidden');
}

function fmtTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function showOver(results, mode) {
  overShown = true;
  input.setActive(false);
  const players = [...(results.players || [])].sort((a, b) => b.score - a.score);
  const won = results.winner != null && results.winner === selfId;
  if (mode === 'solo') {
    els.overImage.src = '/img/player/loose.webp';
    els.overImage.alt = 'Поражение';
    els.overImage.classList.remove('hidden');
  } else if (results.winner == null) {
    els.overImage.src = '/img/player/draw.webp';
    els.overImage.alt = 'Ничья';
    els.overImage.classList.remove('hidden');
  } else {
    els.overImage.src = won ? '/img/player/win.webp' : '/img/player/loose.webp';
    els.overImage.alt = won ? 'Победа' : 'Поражение';
    els.overImage.classList.remove('hidden');
  }
  els.overTitle.textContent =
    results.reason === 'time-up' ? 'Время вышло!' :
    results.winner ? 'Есть победитель!' : 'Ничья!';
  els.overReason.textContent =
    results.reason === 'time-up' ? 'Матч завершён по таймеру' : 'Все корабли уничтожены';

  els.overRows.innerHTML = players.map((p) => `
    <tr class="${p.playerId === results.winner ? 'winner' : ''}">
      <td>${escapeHtml(p.nickname)}</td>
      <td>${p.score}</td>
      <td>${p.kills}</td>
      <td>${p.coinsEarned}</td>
    </tr>`).join('');

  if (mode === 'solo' && players[0]) {
    els.overRecord.textContent = `Ваш результат: ${players[0].score} очков · время полёта ${fmtTime(players[0].timeMs ?? 0)}`;
  } else {
    els.overRecord.textContent = '';
  }
  els.overRank.classList.add('hidden');
  showResultRank(mode);
  els.overOverlay.classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function toast(msg, isError = false) {
  els.menuError.textContent = msg;
  els.menuError.style.color = isError ? 'var(--err)' : 'var(--ok)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.menuError.textContent = ''; }, 4000);
}

// ===================== РЕЙТИНГ (Е2) =====================
const RANK_LABELS = { solo: 'Solo по очкам', multi: 'Multi по очкам', coins: 'Монеты (банк)' };
let rankMode = 'solo';
let rankLimit = 10;
let rankLoading = false;

async function openRankOverlay() {
  if (!requireOnline()) return;
  els.rankOverlay.classList.remove('hidden');
  setRankTab(rankMode);
  setRankLimit(rankLimit);
  await loadTopRank();
}

function setRankTab(mode) {
  rankMode = mode;
  for (const btn of els.rankTabs.children) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  }
}

function setRankLimit(limit) {
  rankLimit = limit;
  for (const btn of els.rankSizes.children) {
    btn.classList.toggle('active', Number(btn.dataset.limit) === limit);
  }
}

function fmtRankNumber(n) {
  return Number(n).toLocaleString('ru-RU');
}

function buildRankRows(container, entries, selfId, startPos) {
  container.textContent = '';
  entries.forEach((r, j) => {
    const row = document.createElement('div');
    row.className = 'rank-row' + (r.playerId === selfId ? ' me' : '');
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = '#' + (startPos + j);
    const nick = document.createElement('span');
    nick.className = 'nick';
    nick.textContent = r.nickname || r.playerId;
    nick.title = r.nickname || r.playerId;
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = fmtRankNumber(r.score);
    row.append(pos, nick, score);
    container.append(row);
  });
}

async function loadTopRank() {
  if (rankLoading) return;
  rankLoading = true;
  els.rankList.textContent = '';
  els.rankMeta.textContent = 'Загрузка…';
  const res = await api.leaderboardTop(rankMode, rankLimit);
  rankLoading = false;
  if (res.error) {
    const div = document.createElement('div');
    div.className = 'rank-empty';
    div.textContent = res.message || 'Не удалось загрузить рейтинг';
    els.rankList.append(div);
    return;
  }
  const top = (res.data && res.data.top) || [];
  els.rankMeta.textContent = RANK_LABELS[rankMode] + (top.length ? ` · всего ${top.length}` : '');
  if (!top.length) {
    const div = document.createElement('div');
    div.className = 'rank-empty';
    div.textContent = 'Пока пусто — сыграйте матч, чтобы попасть в таблицу';
    els.rankList.append(div);
    return;
  }
  buildRankRows(els.rankList, top, getIdentity().playerId, 1);
}

// экран результатов: «Ваш ранг: #N» + до 5 строк (2 выше / я / 2 ниже)
async function showResultRank(mode) {
  const sec = mode === 'multi' ? 'multi' : 'solo';
  if (!isConnected()) return;
  const res = await api.leaderboardRank(sec);
  if (res.error || !res.data || res.data.rank == null) return;
  const d = res.data;
  const me = getIdentity().playerId;
  const title = document.createElement('div');
  title.className = 'rank-block-title';
  title.textContent = `Ваш ранг: #${d.rank} из ${d.total} · раздел «${RANK_LABELS[sec]}»`;
  els.overRank.innerHTML = '';
  els.overRank.append(title);
  const above = Math.min(2, d.rank - 1);
  buildRankRows(els.overRank, d.entries || [], me, d.rank - above);
  els.overRank.classList.remove('hidden');
}

// ===================== РЕЖИМЫ =====================
function stopGame() {
  if (current?.controller?.stop) current.controller.stop();
  current = null;
  overShown = false;
}

// ===================== ПОКУПКА АПГРЕЙДОВ =====================
const BUY_ERRORS = {
  'not-enough-coins': 'Не хватает монет',
  'max-level': 'Максимальный уровень',
  'match-over': 'Матч окончен',
  'not-found': 'Корабль уничтожен — покупка недоступна',
  'store-disabled': 'Апгрейды приобретаются в Ангаре, а не в бою',
};

let hintTimer = null;
function showGameHint(text) {
  els.gameHint.textContent = text;
  els.gameHint.classList.remove('hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => els.gameHint.classList.add('hidden'), 1600);
}

let announceTimer = null;
function showAnnounce(text) {
  els.announce.textContent = text;
  els.announce.classList.remove('hidden');
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => els.announce.classList.add('hidden'), 2600);
}

function onBuyResult(res) {
  if (res && res.error) showGameHint(BUY_ERRORS[res.error] || res.message || 'Не удалось купить');
}

async function tryBuy(track) {
  if (!current?.controller?.buy) return;
  const res = await current.controller.buy(track);
  onBuyResult(res);
}

async function startSolo() {
  await loadServerConfig();
  stopGame();
  lastMode = 'solo';
  selfId = 'you';
  showGame();
  renderer.resetFx();
  const st = playerStats || {};
  current = {
    mode: 'solo',
    controller: startLocalGame({
      renderer,
      input,
      nickname: els.nickInput.value.trim(),
      modules: (st.modules && st.modules.solo) || loadSoloModules(),
      hangar: (st.hangar && st.hangar.solo) || {},
      cosmetics: st.cosmetics || null,
      // Б2: solo-модули хранятся на сервере; офлайн — фолбэк в localStorage
      onModuleUnlock: async (key) => {
        if (!isConnected()) return grantSoloModule(key);
        const res = await api.moduleUnlock(key, 'solo');
        if (res.ok && res.data) setStats(res.data);
      },
      godMode: serverGodMode,
      onBuyResult,
      onOver: async (results) => {
        if (isConnected()) {
          const res = await api.submitSoloScore(
            results.players[0]?.score || 0,
            results.players[0]?.coinsEarned || 0
          );
          if (res.ok) setStats(res.data);
        }
        showOver(results, 'solo');
      },
    }),
  };
}

async function findMatch() {
  if (!requireOnline()) return;
  saveNick();
  showWait('Поиск соперника…', 'Ищем свободного пилота в очереди');
  const res = await api.findMatch(2);
  if (res.error) {
    hideWait();
    toast(res.message || 'Не удалось встать в очередь', true);
  }
}

async function createRoom() {
  if (!requireOnline()) return;
  saveNick();
  const res = await api.createRoom(2);
  if (res.error) {
    toast(res.message || 'Не удалось создать комнату', true);
    return;
  }
  showWait('Комната создана', 'Отправьте код сопернику — игра начнётся автоматически', res.data.code);
}

async function joinRoom() {
  if (!requireOnline()) return;
  saveNick();
  const code = els.joinCodeInput.value.trim().toUpperCase();
  if (!code) return;
  const res = await api.joinRoom(code);
  if (res.error) {
    toast({ 'room-not-found': 'Комната не найдена', 'room-full': 'Комната заполнена', 'room-unavailable': 'Комната недоступна' }[res.error] || res.message || 'Ошибка входа', true);
    return;
  }
  showWait('Вход в комнату ' + code, 'Ожидаем старта…');
}

function startMulti() {
  stopGame();
  lastMode = 'multi';
  selfId = getPlayerIdSafe();
  showGame();
  renderer.resetFx();
  current = {
    mode: 'multi',
    controller: startMultiGame({
      net,
      renderer,
      input,
      selfId,
      onBuyResult,
      onOver: () => {},
    }),
  };
}

function requireOnline() {
  if (!isConnected()) {
    toast('Нет соединения с сервером', true);
    return false;
  }
  return true;
}

function saveNick() {
  const nick = els.nickInput.value.trim();
  if (nick) saveNickname(nick);
}

function getPlayerIdSafe() {
  return getIdentity().playerId;
}

// ===================== СОБЫТИЯ СЕТИ =====================
net.on('net:connected', () => {
  els.connState.className = 'conn-state online';
  els.connState.innerHTML = '<span class="dot"></span>онлайн';
});

net.on('net:disconnected', () => {
  els.connState.className = 'conn-state offline';
  els.connState.innerHTML = '<span class="dot"></span>нет связи';
  if (current?.mode === 'multi' && !overShown) {
    toast('Соединение потеряно', true);
    showMenu();
  }
});

net.on('auth:ok', (data) => {
  if (data?.stats) setStats(data.stats);
});

net.on('matchmaking:queued', (d) => {
  els.waitInfo.textContent = `Вы в очереди · позиция ${d.position}`;
});

net.on('matchmaking:timeout', () => {
  if (els.waitOverlay.classList.contains('hidden')) return;
  hideWait();
  toast('Соперник не нашёлся — попробуйте ещё раз', true);
});

net.on('match:found', () => {
  els.waitInfo.textContent = 'Соперник найден! Запуск…';
});

net.on('game:start', () => {
  hideWait();
  startMulti();
});

net.on('room:update', (snap) => {
  if (!els.waitCode.classList.contains('hidden')) {
    els.waitInfo.textContent = `Игроков в комнате: ${snap.players.length} из ${snap.capacity} — ждём второго`;
  }
});

net.on('room:closed', (d) => {
  hideWait();
  if (overShown) return; // штатное завершение матча уже показано
  if (current?.mode === 'multi') {
    const reasons = {
      'player-left': 'Соперник покинул матч',
      'server-shutdown': 'Сервер остановлен',
    };
    toast(reasons[d.reason] || 'Матч прерван (' + d.reason + ')', d.reason !== 'ended');
    showMenu();
  }
});

net.on('game:over', (results) => {
  showOver(results, current?.mode);
  // комната закроется сама (room:closed придёт следом и будет проглочен)
});

// ===================== КНОПКИ =====================
els.soloBtn.addEventListener('click', () => startSolo());
els.findBtn.addEventListener('click', () => findMatch());
els.createBtn.addEventListener('click', () => createRoom());
els.joinBtn.addEventListener('click', () => joinRoom());
els.joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
els.nickInput.addEventListener('change', saveNick);

els.waitCancelBtn.addEventListener('click', () => {
  hideWait();
  api.cancelFind();
  api.leaveRoom();
});

els.toMenuBtn.addEventListener('click', () => showMenu());

els.againBtn.addEventListener('click', () => {
  if (lastMode === 'multi') findMatch();
  else startSolo();
});

// рейтинг (Е2)
els.rankBtn.addEventListener('click', () => openRankOverlay());
els.rankCloseBtn.addEventListener('click', () => els.rankOverlay.classList.add('hidden'));
els.rankTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.rank-tab');
  if (!tab) return;
  setRankTab(tab.dataset.mode);
  loadTopRank();
});
els.rankSizes.addEventListener('click', (e) => {
  const btn = e.target.closest('.rank-size');
  if (!btn) return;
  setRankLimit(Number(btn.dataset.limit));
  loadTopRank();
});

// Ангар (Б2): кнопки в меню и на экране результатов
const hangar = createHangar({
  api,
  getStats: () => playerStats,
  setStats,
  requireOnline,
  toast,
});
els.hangarBtn.addEventListener('click', () => hangar.open());
els.hangarBtnOver.addEventListener('click', () => hangar.open());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.hangarOverlay.classList.contains('hidden')) {
    els.hangarOverlay.classList.add('hidden');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.rankOverlay.classList.contains('hidden')) {
    els.rankOverlay.classList.add('hidden');
  }
});

// апгрейды из HUD
for (const btn of document.querySelectorAll('.upg-btn')) {
  btn.addEventListener('click', () => tryBuy(btn.dataset.track));
}

// клавиши покупки обрабатываются в игровых циклах (local/multi через input.consumeBuyKey)

function updateRecordLine(stats) {
  if (!stats) return;
  const parts = [];
  if (stats.bestScore != null) parts.push(`рекорд ${stats.bestScore}`);
  if (stats.played != null) parts.push(`матчей ${stats.played}`);
  if (stats.wins != null) parts.push(`побед ${stats.wins}`);
  els.recordLine.textContent = parts.join(' · ');
}

// ===================== СТАРТ =====================
const identity = getIdentity();
els.nickInput.value = identity.nickname || '';
connect();
showMenu();
