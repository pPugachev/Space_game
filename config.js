import 'dotenv/config';

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

// На бесплатных хостингах (Render/Railway/Koyeb/Fly) порт приходит в переменной PORT.
export const config = {
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  defaultCapacity: int(process.env.DEFAULT_CAPACITY, 2),
  minCapacity: int(process.env.MIN_CAPACITY, 2),
  maxCapacity: int(process.env.MAX_CAPACITY, 8),
  roomCodeLength: int(process.env.ROOM_CODE_LENGTH, 4),
  fillTimeoutMs: int(process.env.FILL_TIMEOUT_MS, 30000),
  queueTimeoutMs: int(process.env.QUEUE_TIMEOUT_MS, 60000),
  idleCloseMs: int(process.env.IDLE_CLOSE_MS, 15000),
  maxMessageLength: int(process.env.MAX_MESSAGE_LENGTH, 500),
  matchDurationMs: int(process.env.MATCH_DURATION_MS, 180000),
  gameTickMs: int(process.env.GAME_TICK_MS, 33),
  stateSendEveryTicks: int(process.env.STATE_SEND_EVERY_TICKS, 2),
  dbPath: process.env.DB_PATH || './data/server.db',
  logLevel: process.env.LOG_LEVEL || 'info',
  godMode: /^(1|true|yes|on)$/i.test(process.env.GOD_MODE || ''),
};
