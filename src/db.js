// Хранилище игроков и матчей на JSON-файле.
// Без нативных модулей — образ собирается на любом base image
// (node:XX-alpine включительно, Python/node-gyp не нужны).
// API совместим с прежней SQLite-версией: createDb / upsertPlayer /
// getPlayerStats / submitScore / saveMatch, у дескриптора есть .close().
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAX_MATCHES = 1000; // храним последние матчи, чтобы файл не рос бесконечно

export function createDb(dbPath) {
  const file = path.resolve(dbPath);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = {
    kind: 'json',
    path: file,
    data: { players: {}, matches: [], matchPlayers: [] },
  };
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      db.data.players = parsed.players && typeof parsed.players === 'object' ? parsed.players : {};
      db.data.matches = Array.isArray(parsed.matches) ? parsed.matches : [];
      db.data.matchPlayers = Array.isArray(parsed.matchPlayers) ? parsed.matchPlayers : [];
    } catch {
      // повреждённый файл — начинаем с пустого хранилища
    }
  }
  // атомарная запись: сначала во временный файл, затем переименование
  db.flush = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(db.data));
    renameSync(tmp, file);
  };
  db.close = () => db.flush();
  return db;
}

export function upsertPlayer(db, playerId, nickname) {
  const now = Date.now();
  const p = db.data.players[playerId];
  if (!p) {
    db.data.players[playerId] = {
      nickname, createdAt: now, lastSeenAt: now,
      bestScore: 0, coinsSolo: 0, coinsMulti: 0,
      bestScoreSolo: 0, bestScoreMulti: 0,
      moduleState: {}, // { solo: {...}, multi: {...} } — состояние модулей (см. раздел «модули»)
      hangarStats: {}, // { solo: { speed: 2, ... }, multi: {...} } — уровни базовых характеристик (Б2)
      cosmetics: null, // { owned: [...], equipped: 'default' } — косметика на аккаунт (Б2)
    };
  } else {
    p.nickname = nickname;
    p.lastSeenAt = now;
    if (p.coinsSolo == null) p.coinsSolo = 0;
    if (p.coinsMulti == null) p.coinsMulti = 0;
    if (p.moduleState == null) p.moduleState = {};
    if (p.hangarStats == null) p.hangarStats = {};
    if (p.cosmetics == null || typeof p.cosmetics !== 'object') {
      p.cosmetics = { owned: ['default'], equipped: 'default' };
    } else {
      if (!Array.isArray(p.cosmetics.owned) || !p.cosmetics.owned.length) p.cosmetics.owned = ['default'];
      if (typeof p.cosmetics.equipped !== 'string') p.cosmetics.equipped = 'default';
    }
    // миграция старых профилей на раздельные рекорды режимов (Е1)
    if (p.bestScoreSolo == null) p.bestScoreSolo = p.bestScore || 0;
    if (p.bestScoreMulti == null) p.bestScoreMulti = 0;
  }
  db.flush();
}

export function getPlayerStats(db, playerId) {
  let played = 0;
  let wins = 0;
  for (const mp of db.data.matchPlayers) {
    if (mp.playerId !== playerId) continue;
    played++;
    if (mp.isWinner) wins++;
  }
  const p = db.data.players[playerId];
  const modules = p ? { solo: getModules(db, playerId, 'solo'), multi: getModules(db, playerId, 'multi') } : null;
  return {
    played, wins,
    bestScore: p?.bestScore ?? 0,
    bestScoreSolo: p?.bestScoreSolo ?? p?.bestScore ?? 0,
    bestScoreMulti: p?.bestScoreMulti ?? 0,
    coinsSolo: p?.coinsSolo ?? 0,
    coinsMulti: p?.coinsMulti ?? 0,
    modules,
    hangar: p ? { solo: getHangarStats(db, playerId, 'solo'), multi: getHangarStats(db, playerId, 'multi') } : null,
    cosmetics: p ? getCosmetics(db, playerId) : null,
  };
}

export function addCoins(db, playerId, mode, amount) {
  const p = db.data.players[playerId];
  if (!p || !Number.isFinite(amount) || amount <= 0) return;
  const key = mode === 'multi' ? 'coinsMulti' : 'coinsSolo';
  p[key] = (p[key] || 0) + Math.floor(amount);
  p.lastSeenAt = Date.now();
  db.flush();
}

// --- модули (Б1): состояние разблокировки/активации/уровня, раздельно solo/multi ---

function modeKey(mode) {
  return mode === 'multi' ? 'multi' : 'solo';
}

function ensureModuleState(p, mode) {
  const mk = modeKey(mode);
  if (p.moduleState == null) p.moduleState = {};
  const st = p.moduleState[mk] || (p.moduleState[mk] = {});
  if (st.unlocked == null) st.unlocked = {};
  if (st.active == null) st.active = {};
  if (st.levels == null) st.levels = {};
  return st;
}

export function getModules(db, playerId, mode) {
  const p = db.data.players[playerId];
  if (!p) return { unlocked: {}, active: {}, levels: {} };
  const st = ensureModuleState(p, mode);
  return { unlocked: st.unlocked, active: st.active, levels: st.levels };
}

// Разблокировка модуля (за монеты режима или бесплатно с босса, cost=0).
// Возвращает { ok:true, stats } или { error }.
export function unlockModule(db, playerId, mode, key, cost = 0) {
  const p = db.data.players[playerId];
  if (!p) return { error: 'not-found' };
  const coinKey = modeKey(mode) === 'multi' ? 'coinsMulti' : 'coinsSolo';
  const st = ensureModuleState(p, mode);
  if (st.unlocked[key]) return { error: 'already-unlocked' };
  if (p[coinKey] < cost) return { error: 'not-enough-coins' };
  p[coinKey] -= cost;
  st.unlocked[key] = true;
  p.lastSeenAt = Date.now();
  db.flush();
  return { ok: true, stats: getPlayerStats(db, playerId) };
}

// Активация/деактивация модуля. Активируется только разблокированный.
export function setModuleActive(db, playerId, mode, key, active, cost = 0) {
  const p = db.data.players[playerId];
  if (!p) return { error: 'not-found' };
  const coinKey = modeKey(mode) === 'multi' ? 'coinsMulti' : 'coinsSolo';
  const st = ensureModuleState(p, mode);
  if (active && !st.unlocked[key]) return { error: 'not-unlocked' };
  if (active && st.active[key]) return { error: 'already-active' };
  if (active && cost > 0 && p[coinKey] < cost) return { error: 'not-enough-coins' };
  if (active && cost > 0) p[coinKey] -= cost;
  st.active[key] = !!active;
  p.lastSeenAt = Date.now();
  db.flush();
  return { ok: true, stats: getPlayerStats(db, playerId) };
}

// Уровень модуля (уже активный). level = текущий уровень (0..max).
export function upgradeModule(db, playerId, mode, key, level, cost) {
  const p = db.data.players[playerId];
  if (!p) return { error: 'not-found' };
  const coinKey = modeKey(mode) === 'multi' ? 'coinsMulti' : 'coinsSolo';
  const st = ensureModuleState(p, mode);
  if (!st.unlocked[key]) return { error: 'not-unlocked' };
  if (p[coinKey] < cost) return { error: 'not-enough-coins' };
  p[coinKey] -= cost;
  st.levels[key] = (st.levels[key] || 0) + 1;
  p.lastSeenAt = Date.now();
  db.flush();
  return { ok: true, level: st.levels[key], stats: getPlayerStats(db, playerId) };
}

// --- Ангар (Б2): базовые характеристики — уровни по режиму, покупаются за монеты банка ---

function ensureHangarStats(p, mode) {
  const mk = modeKey(mode);
  if (p.hangarStats == null) p.hangarStats = {};
  return p.hangarStats[mk] || (p.hangarStats[mk] = {});
}

export function getHangarStats(db, playerId, mode) {
  const p = db.data.players[playerId];
  if (!p) return {};
  if (p.hangarStats == null) p.hangarStats = {};
  return { ...(p.hangarStats[modeKey(mode)] || {}) };
}

// Покупка (улучшение) базовой характеристики: level = текущий уровень, cost — цена
// следующего (вычисляется в events.js из BALANCE). Возвращает { ok, level, stats }.
export function buyHangarStat(db, playerId, mode, key, cost) {
  const p = db.data.players[playerId];
  if (!p) return { error: 'not-found' };
  const coinKey = modeKey(mode) === 'multi' ? 'coinsMulti' : 'coinsSolo';
  const st = ensureHangarStats(p, mode);
  if (p[coinKey] < cost) return { error: 'not-enough-coins' };
  p[coinKey] -= cost;
  st[key] = (st[key] || 0) + 1;
  p.lastSeenAt = Date.now();
  db.flush();
  return { ok: true, level: st[key], stats: getPlayerStats(db, playerId) };
}

// --- Косметика (Б2): аккаунт-уровень; покупка разовая за монеты выбранного банка ---

export function getCosmetics(db, playerId) {
  const p = db.data.players[playerId];
  if (!p) return { owned: ['default'], equipped: 'default' };
  if (p.cosmetics == null || typeof p.cosmetics !== 'object') {
    p.cosmetics = { owned: ['default'], equipped: 'default' };
  }
  return { owned: [...(p.cosmetics.owned || ['default'])], equipped: p.cosmetics.equipped || 'default' };
}

// Покупка косметики: cost — цена (в монетах банка mode). Возвращает { ok, stats }.
export function buyCosmetic(db, playerId, key, mode, cost) {
  const p = db.data.players[playerId];
  if (!p) return { error: 'not-found' };
  const coinKey = modeKey(mode) === 'multi' ? 'coinsMulti' : 'coinsSolo';
  const cos = getCosmetics(db, playerId);
  if (cos.owned.includes(key)) return { error: 'already-owned' };
  if (p[coinKey] < cost) return { error: 'not-enough-coins' };
  p[coinKey] -= cost;
  cos.owned.push(key);
  p.cosmetics = cos;
  p.lastSeenAt = Date.now();
  db.flush();
  return { ok: true, stats: getPlayerStats(db, playerId) };
}

// Экипировка косметики (должна быть куплена). Возвращает { ok, stats }.
export function equipCosmetic(db, playerId, key) {
  const p = db.data.players[playerId];
  if (!p) return { error: 'not-found' };
  const cos = getCosmetics(db, playerId);
  if (!cos.owned.includes(key)) return { error: 'not-owned' };
  if (cos.equipped === key) return { error: 'already-equipped' };
  cos.equipped = key;
  p.cosmetics = cos;
  p.lastSeenAt = Date.now();
  db.flush();
  return { ok: true, stats: getPlayerStats(db, playerId) };
}

// Сохраняет рекорд режима (solo/multi) и возвращает обновлённую статистику.
// Рекорды разделены по режимам (bestScoreSolo/bestScoreMulti); агрегированный
// bestScore всегда равен лучшему из них (обратная совместимость).
export function submitScore(db, playerId, score, { mode = 'solo', coins = 0 } = {}) {
  const p = db.data.players[playerId];
  if (p) {
    const field = mode === 'multi' ? 'bestScoreMulti' : 'bestScoreSolo';
    p[field] = Math.max(p[field] || 0, score);
    p.bestScore = Math.max(p.bestScore || 0, p[field]);
    if (Number.isFinite(coins) && coins > 0) {
      addCoins(db, playerId, mode, coins); // flush внутри
    } else {
      p.lastSeenAt = Date.now();
      db.flush();
    }
  }
  return getPlayerStats(db, playerId);
}

// --- рейтинги (Е1): разделы «Solo по очкам», «Multi по очкам», «Coins по банку» -------------

export const LEADERBOARD_MODES = ['solo', 'multi', 'coins'];

export function isValidLeaderboardMode(mode) {
  return LEADERBOARD_MODES.includes(mode);
}

// Значение игрока в разделе рейтинга.
//   solo  — лучший результат одиночного режима,
//   multi — лучший результат мультиплеера,
//   coins — суммарный банк монет (solo+multi).
function leaderboardScore(p, mode) {
  if (mode === 'multi') return p.bestScoreMulti ?? p.bestScore ?? 0;
  if (mode === 'coins') return (p.coinsSolo || 0) + (p.coinsMulti || 0);
  return p.bestScoreSolo ?? p.bestScore ?? 0;
}

function leaderboardRows(db, mode) {
  return Object.entries(db.data.players)
    .map(([playerId, p]) => ({
      playerId,
      nickname: p.nickname || playerId,
      score: leaderboardScore(p, mode),
    }))
    // детерминированный порядок: по очкам убыв., при равенстве — кто раньше создан выше
    .sort((a, b) => {
      const ps = db.data.players[a.playerId];
      const qs = db.data.players[b.playerId];
      return b.score - a.score || (ps.createdAt - qs.createdAt) || a.playerId.localeCompare(b.playerId);
    });
}

// Топ-N игроков раздела (топ-10 / топ-100; limit зажимается в 1..100).
export function getTopPlayers(db, mode, limit = 10) {
  const n = Math.max(1, Math.min(100, Math.floor(limit) || 10));
  return leaderboardRows(db, mode).slice(0, n);
}

// Позиция игрока в разделе + 4 соседних результата (2 выше / 2 ниже; строки короче у краёв).
export function getLeaderboard(db, mode, playerId) {
  const rows = leaderboardRows(db, mode);
  const total = rows.length;
  const idx = rows.findIndex((r) => r.playerId === playerId);
  if (idx === -1) return { rank: null, total, entries: [] };
  const from = Math.max(0, idx - 2);
  const to = Math.min(total, idx + 3);
  return { rank: idx + 1, total, entries: rows.slice(from, to) };
}

export function saveMatch(db, { id, roomCode, capacity, players, winner, createdAt, endedAt }) {
  db.data.matches.push({ id, roomCode, capacity, players, winner, createdAt, endedAt });
  if (db.data.matches.length > MAX_MATCHES) {
    db.data.matches.splice(0, db.data.matches.length - MAX_MATCHES);
  }
  for (const p of players) {
    db.data.matchPlayers.push({
      matchId: id,
      playerId: p.playerId,
      nickname: p.nickname,
      isWinner: p.playerId === winner,
    });
  }
  db.flush();
}
