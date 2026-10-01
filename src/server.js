// Точка входа «Asteroid Blaster» — автономный игровой сервер + веб-клиент.
// Подходит для деплоя в Docker на бесплатные хостинги (Render/Railway/Koyeb/Fly).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { config } from '../config.js';
import { createLogger } from './utils.js';
import { createDb } from './db.js';
import { RoomManager } from './rooms.js';
import { MatchmakingQueue } from './matchmaking.js';
import { GameManager } from './game/manager.js';
import { registerHandlers } from './events.js';

const logger = createLogger(config.logLevel);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.resolve(rootDir, 'public');
const sharedDir = path.resolve(rootDir, 'shared');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const startedAt = Date.now();
const httpServer = createServer();
httpServer.on('request', async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/socket.io/')) return;

    // health-check для хостингов и Docker HEALTHCHECK
    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000) }));
    }

    // публичные настройки для браузерного клиента (например, god mode из .env)
    if (pathname === '/config') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ godMode: config.godMode }));
    }

    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const baseDir = relative.startsWith('shared/') ? sharedDir : publicDir;
    const cleanRelative = relative.startsWith('shared/') ? relative.slice('shared/'.length) : relative;
    const filePath = path.resolve(baseDir, cleanRelative);
    if (!filePath.startsWith(baseDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const db = createDb(config.dbPath);
const roomManager = new RoomManager({ io, db, config, logger });
const matchmaking = new MatchmakingQueue({ io, roomManager, config, logger });
const gameManager = new GameManager({ io, config, logger, db });

// комната стартовала → поднимаем серверную симуляцию; закрылась → гасим сессию
roomManager.events.on('room-started', (room) => gameManager.attach(room, roomManager));
roomManager.events.on('room-closed', (room) => gameManager.destroy(room.id));

registerHandlers(io, { db, config, roomManager, matchmaking, gameManager, logger });

httpServer.listen(config.port, config.host, () => {
  logger.info(`Asteroid Blaster server listening on ${config.host}:${config.port}`);
  logger.info(`Database: ${config.dbPath}`);
});

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  matchmaking.shutdown();
  gameManager.shutdown();
  roomManager.shutdown();
  db.close();
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
