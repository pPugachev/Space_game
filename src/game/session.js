// Игровая сессия мультиплеера: серверный тик-луп поверх общей симуляции.
import { createWorld, stepWorld, snapshotOf, buyUpgrade, selectCard } from '../../shared/world.js';
import { getModules, getHangarStats, getCosmetics, unlockModule } from '../db.js';

function clamp01(v) {
  return Math.max(-1, Math.min(1, Number(v)));
}

export class GameSession {
  constructor({ room, io, config, logger, db }) {
    this.roomId = room.id;
    this.code = room.code;
    this.io = io;
    this.logger = logger;
    this.db = db || null;
    this.tickMs = Math.max(16, config.gameTickMs || 33);
    this.sendEveryTicks = Math.max(1, config.stateSendEveryTicks || 2);

    const playerIds = [];
    const nicknames = {};
    const modulesByPlayer = {};
    const hangarByPlayer = {};
    const cosmeticsByPlayer = {};
    for (const p of room.players.values()) {
      playerIds.push(p.playerId);
      nicknames[p.playerId] = p.nickname;
      // состояние модулей режима multi из аккаунта (Б1) и базовые характеристики (Б2)
      if (db) {
        modulesByPlayer[p.playerId] = getModules(db, p.playerId, 'multi');
        hangarByPlayer[p.playerId] = getHangarStats(db, p.playerId, 'multi');
        cosmeticsByPlayer[p.playerId] = getCosmetics(db, p.playerId);
      }
    }
    this.world = createWorld({
      playerIds,
      nicknames,
      durationMs: config.matchDurationMs,
      seed: Date.now() ^ (Math.random() * 0xffffffff),
      modulesByPlayer,
      hangarByPlayer,
      cosmeticsByPlayer,
      godMode: config.godMode,
    });
    // модуль «Ракеты» разблокируется с Фантома в аккаунте (Б1). С появлением
    // Ангара (Б2) разблокировка больше не активирует модуль автоматически —
    // активация покупается в Ангаре за монеты банка режима.
    this.world.onModuleUnlock = (playerId, key) => {
      if (!this.db) return;
      unlockModule(this.db, playerId, 'multi', key, 0);
    };
    this.inputs = {};
    this.tickCount = 0;
    this.finished = false;
    // вызывается при естественном завершении матча
    this.onOver = null;

    this.timer = setInterval(() => this._tick(), this.tickMs);
    this._broadcast(); // первый снапшот сразу, чтобы клиент не ждал
    logger.info(`Game session started room=${this.code} players=${playerIds.length}`);
  }

  onInput(playerId, payload = {}) {
    if (!this.world.players.some((p) => p.id === playerId)) return;
    const aim = Number(payload.aim);
    this.inputs[playerId] = {
      mx: clamp01(payload.mx) || 0,
      my: clamp01(payload.my) || 0,
      aim: Number.isFinite(aim) ? aim : undefined,
      shoot: !!payload.shoot,
      mis: !!payload.mis,
      laser: !!payload.laser,
      mine: !!payload.mine,
    };
  }

  buy(playerId, track) {
    const res = buyUpgrade(this.world, playerId, track);
    if (res.ok) this._broadcast();
    return res;
  }

  // А3: игрок выбрал карточку уровня — сервер применяет её без списания экспы
  selectCards(playerId, cardId) {
    const res = selectCard(this.world, playerId, cardId);
    if (res.ok) this._broadcast();
    return res;
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _tick() {
    stepWorld(this.world, this.tickMs / 1000, this.inputs);
    this.tickCount++;

    if (this.world.status === 'over') {
      if (!this.finished) {
        this.finished = true;
        this._broadcast();
        this._finish();
      }
      return;
    }
    if (this.tickCount % this.sendEveryTicks === 0) this._broadcast();
  }

  _finish() {
    const players = [...this.world.players].sort((a, b) => b.score - a.score);
    const winner = players.length && players[0].score > (players[1]?.score ?? -1)
      ? players[0].id
      : null; // ничья или пусто
    const results = {
      reason: this.world.timeLeftMs != null && this.world.timeLeftMs <= 0 ? 'time-up' : 'all-dead',
      winner,
      players: players.map((p) => ({
        playerId: p.id,
        nickname: p.nick,
        score: p.score,
        kills: p.kills,
        deaths: p.deaths,
        coinsEarned: p.coins,
      })),
    };
    this.destroy();
    this.logger.info(
      `Game session over room=${this.code} reason=${results.reason} winner=${winner ?? 'tie'}`
    );
    if (this.onOver) this.onOver(results);
  }

  _broadcast() {
    this.io.to(this.roomId).emit('game:state', snapshotOf(this.world));
  }
}
