// Сетевой слой: socket.io-подключение, авторизация, очередь, комнаты, игровые события.
// Все входящие события пробрасываются в локальную шину on(event, fn).

const ID_KEY = 'ab_playerId';
const NICK_KEY = 'ab_nick';

function makeId() {
  return 'p-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function getIdentity() {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = makeId();
    localStorage.setItem(ID_KEY, id);
  }
  return { playerId: id, nickname: localStorage.getItem(NICK_KEY) || '' };
}

export function saveNickname(nick) {
  localStorage.setItem(NICK_KEY, nick);
}

class Emitter {
  constructor() { this.map = new Map(); }
  on(event, fn) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event).add(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    this.map.get(event)?.delete(fn);
  }
  emit(event, payload) {
    this.map.get(event)?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  }
}

export const net = new Emitter();

let socket = null;
export let connected = false;

function ack(payload) {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) return resolve({ error: 'offline', message: 'Нет соединения' });
    const t = setTimeout(() => resolve({ error: 'timeout', message: 'Сервер не ответил' }), 5000);
    socket.emit(payload.event, payload.data ?? {}, (res) => {
      clearTimeout(t);
      resolve(res ?? {});
    });
  });
}

export async function connect() {
  const identity = getIdentity();
  socket = io({ path: '/socket.io/' });

  socket.on('connect', () => {
    connected = true;
    net.emit('net:connected');
    socket.emit('auth', {
      playerId: identity.playerId,
      nickname: identity.nickname || undefined,
    });
  });

  socket.on('disconnect', () => {
    connected = false;
    net.emit('net:disconnected');
  });

  // пересылаем все серверные события в шину
  for (const ev of [
    'auth:ok',
    'matchmaking:queued', 'matchmaking:timeout', 'matchmaking:cancelled',
    'match:found',
    'room:created', 'room:update', 'room:player-left', 'room:closed',
    'room:message',
    'game:start', 'game:state', 'game:over',
    'error',
  ]) {
    socket.on(ev, (data) => net.emit(ev, data));
  }
}

export function isConnected() {
  return !!socket && socket.connected;
}

export function getPlayerId() {
  return getIdentity().playerId;
}

export const api = {
  findMatch: (capacity = 2) => ack({ event: 'matchmaking:find', data: { capacity } }),
  cancelFind: () => ack({ event: 'matchmaking:cancel' }),
  createRoom: (capacity = 2) => ack({ event: 'room:create', data: { capacity } }),
  joinRoom: (code) => ack({ event: 'room:join', data: { code } }),
  leaveRoom: () => ack({ event: 'room:leave' }),
  sendInput: (payload) => socket?.emit('game:input', payload),
  buyUpgrade: (track) => ack({ event: 'game:buy', data: { track } }),
  submitSoloScore: (score, coins = 0) => ack({ event: 'solo:submit', data: { score, coins } }),
  // модули (Б1): разблокировка/активация/усиление за монеты выбранного банка
  moduleUnlock: (key, mode = 'solo') => ack({ event: 'module:unlock', data: { key, mode } }),
  moduleSetActive: (key, active, mode = 'solo') => ack({ event: 'module:setActive', data: { key, mode, active } }),
  moduleUpgrade: (key, mode = 'solo') => ack({ event: 'module:upgrade', data: { key, mode } }),
  // Ангар (Б2): базовые характеристики и косметика за монеты банка режима
  hangarBuyStat: (key, mode = 'solo') => ack({ event: 'hangar:buyStat', data: { key, mode } }),
  cosmeticBuy: (key, mode = 'solo') => ack({ event: 'cosmetic:buy', data: { key, mode } }),
  cosmeticEquip: (key) => ack({ event: 'cosmetic:equip', data: { key } }),
  // карточки уровня rogue-like (А3): выбор «1 из 3» применяет сервер
  selectCard: (cardId) => ack({ event: 'card:select', data: { cardId } }),
  // рейтинги (Е2): разделы solo / multi / coins
  leaderboardRank: (mode = 'solo') => ack({ event: 'leaderboard:rank', data: { mode } }),
  leaderboardTop: (mode = 'solo', limit = 10) => ack({ event: 'leaderboard:top', data: { mode, limit } }),
};

// удобный фасад для модулей игры
net.api = api;
net.isConnected = isConnected;
