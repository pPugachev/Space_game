# AGENTS.md — Asteroid Blaster

## Project

Single-package Node.js (ESM) game: Socket.IO server + Canvas 2D web client.
No build step, no transpiler, no native modules. Pure JS everywhere.

## Commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Run server | `npm start` → `http://localhost:3000` |
| Dev mode (auto-restart) | `npm run dev` |
| E2E test | `npm test` → spawns own server on `:3199` with temp DB |
| Docker | `docker compose up --build -d` |

No lint, typecheck, or formatter is configured. Run `npm test` to verify changes.

## Работа по задачам (PLAN.md)

**`PLAN.md`** — единственный источник задач. Пользователь не объясняет, что
делать: достаточно сказать «следуй плану» или назвать пункт. Правила:

1. **Определи следующую задачу**: открой `PLAN.md`, найди таблицу
   «Порядок реализации» и выбери первую строку с меткой ⬜ (не начата),
   следуя колонке «Влияет» (задачи с зависимостями идут после указанных).
2. **Изучи раздел задачи** в PLAN.md: чеклист из шагов, списки файлов
   («Файлы: …»), уточнения в блоке «Решённые уточнения».
   Число/безопасность: не трогай то, что не относится к задаче.
3. **После завершения** каждого чекбокса раздела — отметь его как `[x]`
   прямо в PLAN.md. В таблице «Порядок реализации» смени статус ⬜ → ✅.
4. **Если пользователь сузил/изменил scope** задачи — отрази это в
   чеклисте PLAN.md (отметь части, которые пропустил с пометкой «по решению»),
   чтобы следующие сессии видели актуальное состояние.
5. **CHANGELOG обязателен** (см. раздел ниже): bullet в формате
   «что изменилось для игрока/игры», на русском, одна строка.
6. **`npm test` перед финализацией** для логики/серверных изменений.
7. Статусы в PLAN.md: ⬜ не начата · 🚧 в работе · 🔧 готова к проверке · ✅ выполнена. Если берёшь
   задачу в работу — на время сессии отметь её как 🚧, по завершении — ✅.
   Статус 🔧 — код написан, нужно визуально проверить в браузере перед ✅.
   В таблице «Порядок реализации» рядом со статусом 🔧 указывай конкретный
   текст: что именно проверить и какой ожидаемый результат (в колонке или
   примечании).
8. **Визуальная проверка UI обязательна** — после реализации любой фичи,
   затрагиваейшей клиент (рендер, ввод, экраны, HUD и т.д.), явно попроси
   пользователя проверить конкретный функционал в браузере. Перечисли, что
   именно нужно посмотреть и какие ожидаемые результаты. Не считай задачу
   закрытой, пока пользователь не подтвердит визуальную работоспособность.

## Changelog (mandatory)

After **any** change that adds, fixes, or tunes a feature (gameplay, balance, UI,
rendering, server, tests, config, etc.), record it in **`CHANGELOG.md`**.

- Add a concise bullet under the current or new dated `## YYYY-MM-DD` section
  (use today's date; create the heading if it doesn't exist).
- The log must cover **all** features and improvements regardless of author —
  including work by other people or other sessions.
- Bullets should describe the user-visible or behavioral effect, in Russian,
  one line each.
- Run `npm test` for logic/server changes before finalizing; update the
  changelog for the verified change as the last step.

## Architecture

```
src/server.js      — entry point: HTTP + Socket.IO + static file serving
src/events.js      — socket event handlers (auth, matchmaking, game)
src/rooms.js       — room management by code
src/matchmaking.js — random-pair queue
src/db.js          — JSON file storage (no SQLite despite .env.example comment)
src/game/          — authoritative server simulation (~30 Hz tick)
  manager.js       — attaches/destroys game sessions per room
  session.js       — single match simulation
shared/            — shared code loaded by both server AND browser
  balance.js       — all game balance (HP, prices, thresholds) — edit here to tune gameplay
  world.js         — shared simulation helpers
public/            — browser client (served as static files)
  index.html
  js/main.js       — client entry
  js/net.js        — Socket.IO client
  js/render.js     — Canvas 2D rendering
  js/input.js      — input handling
  js/multi.js      — multiplayer UI
  js/local.js      — local/solo mode
```

## Key conventions

- **ESM only** — `"type": "module"` in package.json. Use `import`, never `require`.
- **`config.js`** (root) reads env via `dotenv/config`. All tunables flow through it.
- **`shared/` is dual-context** — files here run on both Node.js and in the browser. No Node-specific APIs (`fs`, `path`, etc.) in shared code.
- **`shared/balance.js`** is the single source of truth for game tuning. Changing it affects both server simulation and client UI without rebuild.
- **Static serving**: server serves `public/` and also exposes `shared/` at `/shared/` URL path.
- **No TypeScript**, no JSX, no CSS preprocessors.

## E2E test

`npm test` runs `test/e2e.mjs` which:
1. Spawns a fresh server on port **3199** with a temp DB directory.
2. Connects two Socket.IO clients, runs auth → matchmaking → gameplay → score submission.
3. Cleans up server process and temp files automatically.
4. **No external services required** — fully self-contained.
5. Requires `socket.io-client` (devDependency), which is not installed in Docker (prod only).

## Gotchas

- **Single-process only** — matchmaking and rooms live in memory. Scaling to multiple replicas breaks pairing.
- **DB is a JSON file** (despite `.env.example` saying "SQLite"). Config key is `DB_PATH`.
- **`DB_PATH` in Docker** defaults to `/app/data/server.db.json` and is backed by a Docker volume.
- **Docker build** uses `--omit=dev`, so `socket.io-client` is absent in the container. E2E tests cannot run inside Docker.
- **Free hosting platforms** put instances to sleep; first request after idle has a cold-start delay.
