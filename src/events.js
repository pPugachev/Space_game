import { getPlayerStats, getModules, submitScore, upsertPlayer, unlockModule, setModuleActive, upgradeModule, getTopPlayers, getLeaderboard, isValidLeaderboardMode, getHangarStats, buyHangarStat, buyCosmetic, equipCosmetic } from './db.js';
import { BALANCE } from '../shared/balance.js';
import { moduleCost } from '../shared/world.js';

const MODULES = BALANCE.upgrades.modules || {};

const MIN_PLAYER_ID_LENGTH = 3;
const MAX_PLAYER_ID_LENGTH = 64;
const MAX_NICKNAME_LENGTH = 32;

export function registerHandlers(io, { db, config, roomManager, matchmaking, gameManager, logger }) {
  io.on('connection', (socket) => {
    socket.data.player = null;
    socket.data.roomId = null;

    const fail = (ack, code, message) => {
      if (typeof ack === 'function') ack({ error: code, message });
      else socket.emit('error', { code, message });
    };

    const requireAuth = (handler) => (payload, ack) => {
      if (!socket.data.player) return fail(ack, 'not-authorized', 'Call auth first');
      handler(payload, ack);
    };

    socket.on('auth', (payload = {}, ack) => {
      if (socket.data.player) {
        return fail(ack, 'already-authed', 'Socket is already authenticated');
      }
      const playerId =
        typeof payload.playerId === 'string' ? payload.playerId.trim() : '';
      let nickname =
        typeof payload.nickname === 'string' ? payload.nickname.trim() : '';
      if (
        !playerId ||
        playerId.length < MIN_PLAYER_ID_LENGTH ||
        playerId.length > MAX_PLAYER_ID_LENGTH
      ) {
        return fail(ack, 'invalid-player-id', 'playerId must be 3-64 characters');
      }
      if (!nickname) nickname = `Player ${playerId.slice(0, 6)}`;
      if (nickname.length > MAX_NICKNAME_LENGTH) {
        nickname = nickname.slice(0, MAX_NICKNAME_LENGTH);
      }

      upsertPlayer(db, playerId, nickname);
      socket.data.player = { playerId, nickname };
      const data = { player: socket.data.player, stats: getPlayerStats(db, playerId) };
      socket.emit('auth:ok', data);
      if (typeof ack === 'function') ack({ ok: true, data });
      logger.info(`auth ${playerId} (${nickname})`);
    });

    socket.on('matchmaking:find', requireAuth((payload = {}, ack) => {
      const res = matchmaking.findMatch(socket, { capacity: payload.capacity });
      if (res.error) return fail(ack, res.error, `Cannot join queue: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('matchmaking:cancel', requireAuth((payload, ack) => {
      matchmaking.cancelFind(socket.id);
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('room:create', requireAuth((payload = {}, ack) => {
      if (socket.data.roomId) return fail(ack, 'already-in-room', 'You are already in a room');
      const capacity = payload.capacity ?? config.defaultCapacity;
      if (
        !Number.isInteger(capacity) ||
        capacity < config.minCapacity ||
        capacity > config.maxCapacity
      ) {
        return fail(
          ack,
          'invalid-capacity',
          `Capacity must be ${config.minCapacity}-${config.maxCapacity}`
        );
      }
      const room = roomManager.createRoom({
        capacity,
        players: [{ socket, player: socket.data.player }],
        autoStart: false,
      });
      const data = { roomId: room.id, code: room.code, capacity };
      socket.emit('room:created', data);
      if (typeof ack === 'function') ack({ ok: true, data });
    }));

    socket.on('room:join', requireAuth((payload = {}, ack) => {
      const code =
        typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
      if (!code) return fail(ack, 'invalid-code', 'Missing room code');
      if (socket.data.roomId) return fail(ack, 'already-in-room', 'You are already in a room');
      const res = roomManager.joinByCode(code, socket, socket.data.player);
      if (res.error) return fail(ack, res.error, `Cannot join: ${res.error}`);
      if (typeof ack === 'function') {
        ack({ ok: true, data: { roomId: res.room.id, code: res.room.code } });
      }
    }));

    socket.on('room:leave', requireAuth((payload, ack) => {
      roomManager.leaveRoom(socket, 'left');
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('room:message', requireAuth((payload = {}, ack) => {
      const room = roomManager.rooms.get(socket.data.roomId);
      if (!room) return fail(ack, 'not-in-room', 'You are not in a room');
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text || text.length > config.maxMessageLength) {
        return fail(ack, 'invalid-message', 'Message is empty or too long');
      }
      io.to(room.id).emit('room:message', {
        roomId: room.id,
        from: socket.data.player.playerId,
        nickname: socket.data.player.nickname,
        text,
        at: Date.now(),
      });
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('game:echo', requireAuth((payload = {}, ack) => {
      const room = roomManager.rooms.get(socket.data.roomId);
      if (!room) return fail(ack, 'not-in-room', 'You are not in a room');
      io.to(room.id).emit('game:echo', {
        roomId: room.id,
        from: socket.data.player.playerId,
        payload: payload.payload,
        at: Date.now(),
      });
      if (typeof ack === 'function') ack({ ok: true });
    }));

    socket.on('game:end', requireAuth((payload = {}, ack) => {
      const room = roomManager.rooms.get(socket.data.roomId);
      if (!room) return fail(ack, 'not-in-room', 'You are not in a room');
      const res = roomManager.endGame(room, payload?.winner);
      if (res.error) return fail(ack, res.error, `Cannot end game: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true });
    }));

    // ввод игрока в мультиплеере: без ack (высокая частота), сервер применяет последний инпут
    socket.on('game:input', requireAuth((payload = {}) => {
      const session = gameManager?.get(socket.data.roomId);
      if (session) session.onInput(socket.data.player.playerId, payload);
    }));

    // покупка апгрейда бластера
    socket.on('game:buy', requireAuth((payload = {}, ack) => {
      const session = gameManager?.get(socket.data.roomId);
      if (!session) return fail(ack, 'no-session', 'No active game in this room');
      const res = session.buy(socket.data.player.playerId, payload.track);
      if (res.error) return fail(ack, res.error, `Cannot buy: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true, data: res });
    }));

    // выбор карточки уровня rogue-like (А3): клиент присылает id выбранной карточки,
    // сервер применяет её к игроку без списания экспы
    socket.on('card:select', requireAuth((payload = {}, ack) => {
      const session = gameManager?.get(socket.data.roomId);
      if (!session) return fail(ack, 'no-session', 'No active game in this room');
      const cardId = String(payload.cardId || '');
      const res = session.selectCards(socket.data.player.playerId, cardId);
      if (res.error) return fail(ack, res.error, res.message || `Cannot select card: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true });
    }));

    // рекорд одиночной игры (без комнаты)
    socket.on('solo:submit', requireAuth((payload = {}, ack) => {
      const score = Number(payload.score);
      if (!Number.isFinite(score) || score < 0 || score > 1e7) {
        return fail(ack, 'invalid-score', 'score must be a number 0..10 000 000');
      }
      const coins = Number(payload.coins);
      const coinsSafe = Number.isFinite(coins) && coins > 0
        ? Math.min(Math.floor(coins), 1_000_000)
        : 0;
      const stats = submitScore(db, socket.data.player.playerId, Math.floor(score), {
        mode: 'solo', coins: coinsSafe,
      });
      if (typeof ack === 'function') ack({ ok: true, data: stats });
    }));

    // --- модули (Б1): разблокировка → активация → усиление. Покупки в Ангаре. ---
    // mode: 'solo' | 'multi' — оплата из соответствующего банка монет.
    socket.on('module:unlock', requireAuth((payload = {}, ack) => {
      const key = String(payload.key || '');
      const mode = payload.mode === 'multi' ? 'multi' : 'solo';
      if (!MODULES[key]) return fail(ack, 'unknown-module', `Unknown module: '${key}'`);
      const cost = moduleCost(key, 'unlock') || 0;
      const res = unlockModule(db, socket.data.player.playerId, mode, key, cost);
      if (res.error) return fail(ack, res.error, `Cannot unlock module: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true, data: res.stats });
    }));

    socket.on('module:setActive', requireAuth((payload = {}, ack) => {
      const key = String(payload.key || '');
      const mode = payload.mode === 'multi' ? 'multi' : 'solo';
      if (!MODULES[key]) return fail(ack, 'unknown-module', `Unknown module: '${key}'`);
      const active = !!payload.active;
      const cost = active ? (moduleCost(key, 'activate') || 0) : 0;
      const res = setModuleActive(db, socket.data.player.playerId, mode, key, active, cost);
      if (res.error) return fail(ack, res.error, `Cannot set module: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true, data: res.stats });
    }));

    socket.on('module:upgrade', requireAuth((payload = {}, ack) => {
      const key = String(payload.key || '');
      const mode = payload.mode === 'multi' ? 'multi' : 'solo';
      if (!MODULES[key]) return fail(ack, 'unknown-module', `Unknown module: '${key}'`);
      const st = getModules(db, socket.data.player.playerId, mode);
      const level = st.levels[key] || 0;
      const cost = moduleCost(key, 'upgrade', level);
      if (cost == null) return fail(ack, 'max-level', 'Module is at max level');
      const res = upgradeModule(db, socket.data.player.playerId, mode, key, level, cost);
      if (res.error) return fail(ack, res.error, `Cannot upgrade module: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true, data: res.stats });
    }));

    // --- Ангар (Б2): базовые характеристики и косметика за монеты банка режима ---
    const HANGAR_STATS = BALANCE.hangar?.stats || [];
    const HANGAR_MAX = BALANCE.hangar?.maxLevel || 0;
    const HANGAR_COSMETICS = BALANCE.hangar?.cosmetics || [];

    socket.on('hangar:buyStat', requireAuth((payload = {}, ack) => {
      const key = String(payload.key || '');
      const mode = payload.mode === 'multi' ? 'multi' : 'solo';
      const def = HANGAR_STATS.find((s) => s.key === key);
      if (!def) return fail(ack, 'unknown-stat', `Unknown hangar stat: '${key}'`);
      const st = getHangarStats(db, socket.data.player.playerId, mode);
      const level = st[key] || 0;
      if (level >= HANGAR_MAX) return fail(ack, 'max-level', 'Stat is at max level');
      const cost = def.costs[level] ?? null;
      if (cost == null) return fail(ack, 'max-level', 'Stat is at max level');
      const res = buyHangarStat(db, socket.data.player.playerId, mode, key, cost);
      if (res.error) return fail(ack, res.error, `Cannot buy stat: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true, data: res.stats });
    }));

    socket.on('cosmetic:buy', requireAuth((payload = {}, ack) => {
      const key = String(payload.key || '');
      const mode = payload.mode === 'multi' ? 'multi' : 'solo';
      const def = HANGAR_COSMETICS.find((c) => c.key === key);
      if (!def) return fail(ack, 'unknown-cosmetic', `Unknown cosmetic: '${key}'`);
      const res = buyCosmetic(db, socket.data.player.playerId, key, mode, def.cost);
      if (res.error) return fail(ack, res.error, `Cannot buy cosmetic: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true, data: res.stats });
    }));

    socket.on('cosmetic:equip', requireAuth((payload = {}, ack) => {
      const key = String(payload.key || '');
      const def = HANGAR_COSMETICS.find((c) => c.key === key);
      if (!def) return fail(ack, 'unknown-cosmetic', `Unknown cosmetic: '${key}'`);
      const res = equipCosmetic(db, socket.data.player.playerId, key);
      if (res.error) return fail(ack, res.error, `Cannot equip cosmetic: ${res.error}`);
      if (typeof ack === 'function') ack({ ok: true, data: res.stats });
    }));

    // --- рейтинги (Е1): разделы solo / multi / coins.
    //     leaderboard:rank — позиция игрока + 4 соседних результата (2 выше/2 ниже);
    //     leaderboard:top  — топ-N игроков (топ-10 / топ-100 по limit). ---
    socket.on('leaderboard:rank', requireAuth((payload = {}, ack) => {
      const mode = String(payload.mode || 'solo').toLowerCase();
      if (!isValidLeaderboardMode(mode)) {
        return fail(ack, 'invalid-mode', `Unknown leaderboard mode: '${mode}'`);
      }
      const data = getLeaderboard(db, mode, socket.data.player.playerId);
      if (typeof ack === 'function') ack({ ok: true, data });
    }));

    socket.on('leaderboard:top', requireAuth((payload = {}, ack) => {
      const mode = String(payload.mode || 'solo').toLowerCase();
      if (!isValidLeaderboardMode(mode)) {
        return fail(ack, 'invalid-mode', `Unknown leaderboard mode: '${mode}'`);
      }
      const limit = payload.limit == null ? 10 : Math.floor(Number(payload.limit));
      if (!Number.isFinite(limit) || limit <= 0) {
        return fail(ack, 'invalid-limit', 'limit must be a positive number');
      }
      const data = { mode, top: getTopPlayers(db, mode, limit) };
      if (typeof ack === 'function') ack({ ok: true, data });
    }));

    socket.on('disconnect', () => {
      matchmaking.onDisconnect(socket.id);
      if (socket.data.roomId) roomManager.leaveRoom(socket, 'disconnect');
    });
  });
}