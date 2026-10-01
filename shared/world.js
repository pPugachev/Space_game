// Ядро симуляции «Asteroid Blaster». Один и тот же код крутится на сервере
// (мультиплеер) и в браузере (одиночный режим). Только чистая логика,
// без Node/browser API — файл совместим с обоими окружениями.

import { BALANCE } from './balance.js';

const B = BALANCE;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand(rng, min, max) {
  return min + rng() * (max - min);
}

function randInt(rng, min, max) {
  return Math.floor(rand(rng, min, max + 1));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

const EMPTY_INPUT = Object.freeze({ mx: 0, my: 0, aim: undefined, shoot: false, mis:false, laser:false, mine:false });

// Кэш собранных характеристик врага по виду. База — B.enemies (обычный охотник),
// вид из enemyKinds переопределяет поля (hp, радиус, поведение, дроп и т.д.).
const ENEMY_STATS_CACHE = {};

// Статистика врага. kind 'enemy' → чистые B.enemies; остальные → слияние поверх.
function enemyStats(kind) {
  const kd = (kind && B.enemyKinds[kind]) || null;
  if (!kd) return B.enemies;
  if (!ENEMY_STATS_CACHE[kind]) ENEMY_STATS_CACHE[kind] = Object.assign({}, B.enemies, kd);
  return ENEMY_STATS_CACHE[kind];
}

// Характеристики модуля для конкретного уровня. Для ракет: макс.боезапас,
// урон взрыва и шанс дропа растут с каждым уровнем (BALANCE.upgrades.modules).
export function moduleStats(key, level) {
  const def = B.upgrades.modules[key];
  if (!def || !def.perLevel) return null;
  const lvl = Math.max(0, Math.min(level || 0, def.maxLevel || 0));
  const s = {};
  for (const k of Object.keys(def.base || {})) s[k] = def.base[k];
  for (const k of Object.keys(def.perLevel)) s[k] += def.perLevel[k] * lvl;
  return s;
}

// Цена действия над модулем. action: 'unlock' | 'activate' | 'upgrade'
// Для upgrade: nextLevel = текущий уровень (0..maxLevel-1), цена следующего шага.
export function moduleCost(key, action, nextLevel) {
  const def = B.upgrades.modules[key];
  if (!def) return null;
  if (action === 'unlock') return def.unlockCost;
  if (action === 'activate') return def.activateCost;
  if (action === 'upgrade') {
    if (nextLevel >= def.maxLevel) return null; // максимальный уровень
    return def.upgradeCosts[nextLevel] ?? null;
  }
  return null;
}

// Б2: коэффициент базовой характеристики Ангара по уровню. level — число купленных
// уровней (0..max); результат — накопленный коэффициент лестницы coefs (1/3/5/10/15%).
export function hangarCoef(key, level) {
  const def = (B.hangar?.stats || []).find((s) => s.key === key);
  if (!def) return 0;
  const lvl = Math.max(0, Math.min(level || 0, def.coefs.length));
  return lvl >= 1 ? def.coefs[lvl - 1] : 0;
}

export function createWorld({
  playerIds,
  nicknames = {},
  durationMs = B.matchDurationMs,
  seed = 1,
  modulesByPlayer = {},
  hangarByPlayer = {},    // Б2: уровни базовых характеристик Ангара (по режиму)
  cosmeticsByPlayer = {}, // Б2: ключ косметики игрока ({ playerId: { equipped } })
  godMode = false,
}) {
  const world = {
    rng: mulberry32(seed),
    godMode,
    t: 0, // время симуляции, мс
    durationMs: durationMs == null ? null : durationMs,
    timeLeftMs: durationMs == null ? null : durationMs,
    status: 'running',
    waveIndex: 0,
    wavePhase: 'spawning',
    waveTimer: 0,
    waveSpawns: {},
    waveBossKeys: [],        // боссы текущей волны: пока они живы — следующая волна не идёт
    pendingComets: [],
    nextPendingCometId: 1,
    pendingBosses: [],      // В2: боссы, которых ещё надо ввести (после warnMs)
    nextPendingBossId: 1,
    nextAsteroidId: 1,
    nextBulletId: 1,
    nextCoinId: 1,
    nextEnergyId: 1,
    nextFxId: 1,
    players: [],
    asteroids: [],
    bullets: [],
    coins: [],
    energySpheres: [],
    enemies: [],
    missiles: [],
    missilePacks: [],
    fx: [],
    bosses: [],
    crystals: [],
    mines: [],
    lasers: [],
    bossLasers: [],
    nextEnemyId: 1,
    nextMissileId: 1,
    nextMissilePackId: 1,
    nextBossId: 1,
    nextCrystalId: 1,
    nextMineId: 1,
    nextLaserId: 1,
    nextBossLaserId: 1,
    nextPowerupId: 1,
    nextAbilityPackId: 1,
    powerups: [],
    abilityPacks: [],
    bossSpawnedKeys: {},
    bossesFought: 0,
    nebulaActive: false,
    pendingCards: {}, // playerId → 3 случайные карточки при росте уровня (А3)
  };
  let i = 0;
  for (const id of playerIds) {
    // состояние модулей режима из аккаунта (Б1): если модуль активен — патроны
    // падают с врагов, мощность зависит от уровня.
    const mods = (modulesByPlayer && modulesByPlayer[id]) || {};
    const rocketActive = !!(mods.active && mods.active.rockets);
    const rocketLvl = (mods.levels && mods.levels.rockets) || 0;
    const rocketStats = moduleStats('rockets', rocketActive ? rocketLvl : 0);
    world.players.push({
      id,
      nick: nicknames[id] || id,
      slot: i++,
      x: B.world.width / 2 + (i % 2 === 1 ? -140 : 140),
      y: B.world.height / 2,
      vx: 0,
      vy: 0,
      a: i % 2 === 1 ? Math.PI / 2 : -Math.PI / 2,
      alive: true,
      out: false, // потерял все жизни
      lives: B.ship.lives,
      coins: 0, // монеты, собранные в матче (в конце матча уходят в банк режима)
      energy: 0, // матчевый ресурс-прогресс (экспа), накапливается и не тратится
      exp: 0, // всего накоплено экспы (энергии) за матч
      level: 1, // текущий уровень rogue-like
      score: 0,
      kills: 0,
      deaths: 0,
      dmgLvl: 0,
      rateLvl: 0,
      cooldownAt: 0,
      respawnAt: 0,
      invulnUntil: B.ship.invulnMs, // неуязвимость на старте
      missiles: 0, // боезапас самонаводящихся ракет
      hasMissiles: rocketActive, // модуль «Ракеты»: активен только если включён в аккаунте
      missileMaxAmmo: rocketStats.maxAmmo,
      missileBlastDamage: rocketStats.blastDamage,
      missileDropChance: rocketStats.dropChance,
      missileCdAt: 0,
      // способности от боссов
      hasArmor: false,
      armorCharges: 0,
      hasLaser: false,
      laserCharges: 0,
      laserMaxCharges: 0,
      laserActiveUntil: 0,
      laserCdUntil: 0,
      laserTickAt: 0,
      hasMines: false,
      mineStock: 0,
      mineCdUntil: 0,
      // временные пауэр-апы с комет/врагов
      rapidFireUntil: 0,
      shieldUntil: 0,
      // карточки (А3): бонусы уровня rogue-like
      speedBonus: 0,           // +15% к максимальной скорости за карточку «Скорость»
      energyMagnetBonus: 0,    // +30% к радиусу магнита экспы за карточку «Магнит»
      // Ангар (Б2): пассивные коэффициенты базовых характеристик (1%→3%→5%→10%→15%)
      hg: {
        speed: hangarCoef('speed', (hangarByPlayer[id] || {}).speed),
        magnet: hangarCoef('magnet', (hangarByPlayer[id] || {}).magnet),
        damage: hangarCoef('damage', (hangarByPlayer[id] || {}).damage),
        firerate: hangarCoef('firerate', (hangarByPlayer[id] || {}).firerate),
      },
      cos: (cosmeticsByPlayer[id] && cosmeticsByPlayer[id].equipped) || 'default',
    });
  }
  const w0 = B.waves.list && B.waves.list[0];
  if (w0) startWave(world, w0);
  return world;
}

export function bulletDamage(p) {
  return (1 + p.dmgLvl * B.upgrades.damage.dmgPerLevel) * (1 + (p.hg && p.hg.damage || 0));
}

export function fireCooldownMs(p, now) {
  let cd = B.ship.fireCooldownMs * Math.pow(B.upgrades.firerate.cooldownFactor, p.rateLvl);
  cd *= 1 - (p.hg && p.hg.firerate || 0); // Ангар (Б2): скорострельность
  if (now != null && now < p.rapidFireUntil) cd *= B.powerups.types.rapidFire.cooldownFactor;
  return cd;
}

export function upgradeCost(track, level) {
  const def = B.upgrades[track];
  if (!def) return null;
  return def.costs[level] ?? null; // null = максимальный уровень
}

// A1: монеты больше нельзя тратить внутри матча — покупки перенесены в Ангар
// (между матчами). В бою улучшения будут выдаваться бесплатными карточками при
// достижении уровня (rogue-like, задача А3), поэтому функция отключена.
export function buyUpgrade() {
  return { error: 'store-disabled', message: 'Апгрейды покупаются в Ангаре, а не в бою' };
}

// --- Rogue-like карточки (А3): экспа накапливается, при достижении порога —
// уровень ↑ и бесплатный выбор «1 из 3». Энергия при этом не списывается. ---

// Порог (накопленной энергии) для перехода на уровень `level` (1-индексный).
export function expThreshold(level) {
  if (!Number.isFinite(level) || level <= 1) return B.exp.baseThreshold;
  return Math.round(B.exp.baseThreshold * Math.pow(B.exp.multiplier, level - 1));
}

// Карточки, которые игрок ещё может применить (жизнь/броня на максимуме не предлагаются).
function availableCards(player) {
  return B.cards.pool.filter((c) => {
    if (c.id === 'life' && player.lives >= B.upgrades.life.maxLives) return false;
    if (c.id === 'armor' && player.hasArmor && (player.armorCharges || 0) >= B.abilities.armor.maxCharges) return false;
    return true;
  });
}

// N случайных карточек из пула (перетасовка Файера–Йетса, общий сид solo/multi).
export function pickRandomCards(rng, player, count = 3) {
  const pool = availableCards(player);
  if (!pool.length) return [];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (pool.length >= count) return pool.slice(0, count);
  const res = pool.slice();
  let k = 0;
  while (res.length < count) { res.push(pool[k % pool.length]); k++; }
  return res;
}

// Применяет эффект карточки к игроку. Возвращает true при успехе.
export function applyCard(player, cardId) {
  switch (cardId) {
    case 'damage':
      player.dmgLvl++;
      return true;
    case 'firerate':
      player.rateLvl++;
      return true;
    case 'life':
      if (player.lives >= B.upgrades.life.maxLives) return false;
      player.lives++;
      return true;
    case 'speed':
      player.speedBonus = (player.speedBonus || 0) + 0.15;
      return true;
    case 'magnet':
      player.energyMagnetBonus = (player.energyMagnetBonus || 0) + 0.3;
      return true;
    case 'armor':
      if (!player.hasArmor) player.hasArmor = true;
      player.armorCharges = Math.min((player.armorCharges || 0) + 2, B.abilities.armor.maxCharges);
      return true;
    default:
      return false;
  }
}

// Выбор карточки в бою: solo применяет локально, multi — через сервер (card:select).
// При успехе карточка применена, и запись pending пропадает из мира.
export function selectCard(world, playerId, cardId) {
  const pending = world.pendingCards[playerId];
  if (!pending || !pending.length) return { error: 'no-cards', message: 'Нет карточек для выбора' };
  const player = world.players.find((p) => p.id === playerId);
  if (!player) return { error: 'not-found', message: 'Корабль не найден' };
  if (!pending.some((c) => c.id === cardId)) return { error: 'invalid-card', message: 'Неизвестная карточка' };
  if (!applyCard(player, cardId)) return { error: 'cannot-apply', message: 'Карточку нельзя применить' };
  delete world.pendingCards[playerId];
  return { ok: true };
}

function addFx(world, type, x, y, size = 1, extra) {
  world.fx.push({ id: world.nextFxId++, type, x, y, size, bornAt: world.t, ...(extra || {}) });
  if (world.fx.length > 48) world.fx.splice(0, world.fx.length - 48);
}

function spawnBullet(world, p) {
  const nose = B.ship.radius + 6;
  world.bullets.push({
    id: world.nextBulletId++,
    x: p.x + Math.cos(p.a) * nose,
    y: p.y + Math.sin(p.a) * nose,
    vx: Math.cos(p.a) * B.bullet.speed + p.vx * 0.35,
    vy: Math.sin(p.a) * B.bullet.speed + p.vy * 0.35,
    a: p.a,
    owner: p.id,
    born: world.t,
  });
  addFx(world, 'shoot', p.x + Math.cos(p.a) * nose, p.y + Math.sin(p.a) * nose, 1);
}

function asteroidDef(type) {
  return B.asteroid[type];
}

function pickAsteroidType(world, composition) {
  const c = composition || { small: 1, medium: 0, large: 0 };
  const total = (c.small || 0) + (c.medium || 0) + (c.large || 0);
  let r = world.rng() * total;
  for (const key of ['small', 'medium', 'large']) {
    r -= c[key] || 0;
    if (r <= 0) return key;
  }
  return 'small';
}

function spawnAsteroid(world, type, atX, atY, speedScale = 1) {
  const def = asteroidDef(type);
  const w = B.world.width;
  const h = B.world.height;
  let x = atX;
  let y = atY;
  if (x == null || y == null) {
    // спавн на случайной кромке, подальше от живых кораблей
    for (let attempt = 0; attempt < 8; attempt++) {
      const side = randInt(world.rng, 0, 3);
      const m = 60;
      if (side === 0) { x = rand(world.rng, 0, w); y = -m; }
      else if (side === 1) { x = w + m; y = rand(world.rng, 0, h); }
      else if (side === 2) { x = rand(world.rng, 0, w); y = h + m; }
      else { x = -m; y = rand(world.rng, 0, h); }
      const tooClose = world.players.some(
        (p) => !p.out && p.alive && Math.hypot(p.x - x, p.y - y) < 220
      );
      if (!tooClose) break;
    }
  }
  const rMax = def.radiusMax;
  // направление внутрь поля с разбросом
  const tx = rand(world.rng, w * 0.2, w * 0.8);
  const ty = rand(world.rng, h * 0.2, h * 0.8);
  const ang = Math.atan2(ty - y, tx - x) + rand(world.rng, -0.5, 0.5);
  const sp = rand(world.rng, def.speedMin, def.speedMax) * speedScale;
  const asteroid = {
    id: world.nextAsteroidId++,
    type,
    x,
    y,
    vx: Math.cos(ang) * sp,
    vy: Math.sin(ang) * sp,
    r: rand(world.rng, def.radiusMin, def.radiusMax),
    hp: def.hp,
    maxHp: def.hp,
    rot: rand(world.rng, 0, Math.PI * 2),
    rotSpeed: rand(world.rng, -1.4, 1.4),
    shapeSeed: randInt(world.rng, 1, 1e9),
  };
  // спутник для туманности после 2 босса
  if (world.nebulaActive && type !== 'comet' && world.rng() < B.nebula.satelliteChance) {
    const N = B.nebula;
    asteroid.sat = {
      ang: rand(world.rng, 0, Math.PI*2),
      dist: rand(world.rng, N.satelliteDistMin, N.satelliteDistMax) + asteroid.r*0.35,
      r: Math.max(5, asteroid.r * N.satelliteSizeFactor * rand(world.rng,0.8,1.15)),
      rot: rand(world.rng,0,Math.PI*2),
      rotSpeed: rand(world.rng,-2,2),
      speed: rand(world.rng, N.orbitSpeedMin, N.orbitSpeedMax) * (world.rng()<0.5?1:-1),
      seed: randInt(world.rng,1,1e9),
    };
  }
  world.asteroids.push(asteroid);
}

function spawnCoinBurst(world, x, y, count) {
  for (let i = 0; i < count; i++) {
    const ang = world.rng() * Math.PI * 2;
    const sp = rand(world.rng, 40, 170);
    world.coins.push({
      id: world.nextCoinId++,
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      born: world.t,
    });
  }
}

// Энергетические сферы (экспа): физически ведут себя как монеты — разлетаются,
// притягиваются магнитом, подбираются при касании. Но добавляют energy, а не coins.
function spawnEnergyBurst(world, x, y, count) {
  for (let i = 0; i < count; i++) {
    const ang = world.rng() * Math.PI * 2;
    const sp = rand(world.rng, 40, 170);
    world.energySpheres.push({
      id: world.nextEnergyId++,
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      born: world.t,
    });
  }
}

function spawnPowerup(world, x, y) {
  const types = Object.keys(B.powerups.types);
  const tp = types[Math.floor(world.rng() * types.length)];
  const ang = world.rng() * Math.PI * 2;
  const sp = rand(world.rng, 30, 100);
  world.powerups.push({
    id: world.nextPowerupId++,
    tp,
    x, y,
    vx: Math.cos(ang) * sp,
    vy: Math.sin(ang) * sp,
    born: world.t,
  });
}

function destroyAsteroid(world, a, owner) {
  const def = asteroidDef(a.type);
  if (owner) {
    owner.score += def.score;
    owner.kills++;
  }
  const coins = randInt(world.rng, def.coinsMin, def.coinsMax);
  if (coins > 0) spawnCoinBurst(world, a.x, a.y, coins);
  const energy = randInt(world.rng, def.energyMin, def.energyMax);
  if (energy > 0) spawnEnergyBurst(world, a.x, a.y, energy);
  if (a.type === 'comet' && world.rng() < B.powerups.cometChance) {
    spawnPowerup(world, a.x, a.y);
  }
  addFx(world, 'boom', a.x, a.y, a.maxHp >= 10 ? 3 : a.maxHp >= 5 ? 2 : 1);
  a.dead = true;

  const A = B.asteroid;
  if (a.type === 'large' && A.splitLargeIntoMediums > 0) {
    for (let i = 0; i < A.splitLargeIntoMediums; i++) {
      spawnAsteroid(world, 'medium', a.x, a.y, 1.05);
    }
  } else if (a.type === 'medium' && A.splitMediumIntoSmalls > 0) {
    for (let i = 0; i < A.splitMediumIntoSmalls; i++) {
      spawnAsteroid(world, 'small', a.x, a.y, 1.1);
    }
  }
}

function grantAbility(world, p, kind) {
  if (kind === 'armor') {
    const A = B.abilities.armor;
    if (!p.hasArmor) {
      p.hasArmor = true;
      p.armorCharges = A.charges;
      addFx(world, 'upgrade', p.x, p.y, 2);
      return true;
    }
    if (p.armorCharges < A.maxCharges) {
      p.armorCharges = Math.min(A.maxCharges, p.armorCharges + 1);
      addFx(world, 'upgrade', p.x, p.y, 1);
      return true;
    }
    return false;
  }
  if (kind === 'laser') {
    const A = B.abilities.laser;
    if (!p.hasLaser) {
      p.hasLaser = true;
      p.laserCharges = A.charges;
      p.laserMaxCharges = A.maxCharges;
      p.laserCdUntil = 0;
      p.laserActiveUntil = 0;
      addFx(world, 'upgrade', p.x, p.y, 2);
      return true;
    }
    if (p.laserCharges < p.laserMaxCharges) {
      p.laserCharges = Math.min(p.laserMaxCharges, p.laserCharges + 1);
      addFx(world, 'upgrade', p.x, p.y, 1);
      return true;
    }
    return false;
  }
  if (kind === 'mines') {
    const A = B.abilities.mines;
    if (!p.hasMines) {
      p.hasMines = true;
      p.mineStock = A.max;
      p.mineCdUntil = 0;
      addFx(world, 'upgrade', p.x, p.y, 2);
      return true;
    }
    if (p.mineStock < A.maxStock) {
      p.mineStock = Math.min(A.maxStock, p.mineStock + A.dropPack);
      addFx(world, 'upgrade', p.x, p.y, 1);
      return true;
    }
    return false;
  }
  if (kind === 'missiles') {
    // модуль «Ракеты» с Фантома: разблокирует модуль и пополняет боезапас
    const maxAmmo = p.missileMaxAmmo || B.missile.maxAmmo;
    const gained = Math.min(maxAmmo, p.missiles + B.missile.pack) - p.missiles;
    if (gained > 0 || !p.hasMissiles) {
      p.hasMissiles = true;
      p.missiles += Math.max(0, gained);
      addFx(world, 'upgrade', p.x, p.y, 2);
      return true;
    }
    return false;
  }
  return false;
}

// Патроны для ракет: выпадают с врагов/боссов, пока модуль «Ракеты» активен у убившего.
function spawnMissilePack(world, x, y) {
  const ang = world.rng() * Math.PI * 2;
  const sp = rand(world.rng, 40, 140);
  world.missilePacks.push({
    id: world.nextMissilePackId++,
    x,
    y,
    vx: Math.cos(ang) * sp,
    vy: Math.sin(ang) * sp,
    born: world.t,
  });
}

// Заряды способностей (броня/лазер/мины): выпадают с врагов, пополняют запас.
function spawnAbilityPack(world, x, y, kind) {
  const ang = world.rng() * Math.PI * 2;
  const sp = rand(world.rng, 40, 140);
  world.abilityPacks.push({
    id: world.nextAbilityPackId++,
    kind,
    x, y,
    vx: Math.cos(ang) * sp,
    vy: Math.sin(ang) * sp,
    born: world.t,
  });
}

// Попытка дропнуть заряд способности (броня/лазер/мины) с врага/босса.
function tryDropAbilityPack(world, x, y, owner) {
  if (!owner) return;
  for (const kind of ['armor', 'laser', 'mines']) {
    const has = kind === 'armor' ? owner.hasArmor : kind === 'laser' ? owner.hasLaser : owner.hasMines;
    if (!has) continue;
    const A = B.abilities[kind];
    const cur = kind === 'armor' ? owner.armorCharges : kind === 'laser' ? owner.laserCharges : owner.mineStock;
    const max = kind === 'armor' ? A.maxCharges : kind === 'laser' ? A.maxCharges : A.maxStock;
    if (cur >= max) continue;
    if (world.rng() < A.dropChance) {
      spawnAbilityPack(world, x, y, kind);
      return;
    }
  }
}

function spawnCrystal(world, x, y, kind, ability) {
  const C = B.crystals;
  const ang = world.rng() * Math.PI * 2;
  const sp = rand(world.rng, 30, 90);
  world.crystals.push({
    id: world.nextCrystalId++,
    x, y,
    vx: Math.cos(ang) * sp,
    vy: Math.sin(ang) * sp,
    kind, // 'coins' | 'ability'
    ability: ability || null,
    born: world.t,
  });
}

function shipHit(world, p, now) {
  // god mode — контрольные прогоны для быстрой проверки фич (GOD_MODE=1)
  if (world.godMode) return;
  // временный щит от пауэр-апа
  if (now < p.shieldUntil) {
    addFx(world, 'shield', p.x, p.y, 1.2);
    return;
  }
  // броня от босса поглощает урон без потери жизни
  if (p.hasArmor && p.armorCharges > 0) {
    p.armorCharges--;
    p.invulnUntil = now + 800; // короткая неуязвимость чтобы не заспамить
    addFx(world, 'shield', p.x, p.y, 1.4);
    return;
  }
  p.lives--;
  p.deaths++;
  p.alive = false;
  addFx(world, 'boom', p.x, p.y, 2.4);

  if (B.ship.dropCoinsOnDeath && p.coins > 0) {
    const drop = Math.floor(p.coins / 2);
    if (drop > 0) {
      p.coins -= drop;
      spawnCoinBurst(world, p.x, p.y, drop);
    }
  }

  if (p.lives <= 0) {
    p.out = true;
  } else {
    p.respawnAt = now + B.ship.respawnMs;
  }
}

function respawnShip(world, p) {
  const w = B.world.width;
  const h = B.world.height;
  let best = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    const x = rand(world.rng, 90, w - 90);
    const y = rand(world.rng, 90, h - 90);
    let ok = true;
    for (const a of world.asteroids) {
      if (Math.hypot(a.x - x, a.y - y) < a.r + 150) { ok = false; break; }
    }
    if (ok) {
      for (const o of world.players) {
        if (o !== p && o.alive && !o.out && Math.hypot(o.x - x, o.y - y) < 130) { ok = false; break; }
      }
    }
    if (ok) { best = { x, y }; break; }
    if (!best) best = { x, y }; // запасной вариант — последняя попытка
  }
  p.x = best.x;
  p.y = best.y;
  p.vx = 0;
  p.vy = 0;
  p.alive = true;
  p.invulnUntil = world.t + B.ship.invulnMs;
  addFx(world, 'spawn', p.x, p.y, 1);
}

function wrap(v, max, margin) {
  if (v < -margin) return max + margin;
  if (v > max + margin) return -margin;
  return v;
}

// --- спавн в свободных квадрантах (враги и боссы не появляются в секторе игрока) ---

// Квадрант точки: 0=слева-сверху, 1=справа-сверху, 2=слева-снизу, 3=справа-снизу
function quadrantOf(x, y) {
  const hw = B.world.width / 2;
  const hh = B.world.height / 2;
  return (x < hw ? 0 : 1) | (y < hh ? 0 : 2);
}

// Квадранты всех живых кораблей (в мультиплеере — обоих игроков)
function occupiedQuadrants(world) {
  const occ = new Set();
  for (const p of world.players) {
    if (p.out) continue;
    occ.add(quadrantOf(p.x, p.y));
  }
  return occ;
}

// Ребро-точка на кромке заданного квадранта (вне границы арены)
function edgePointOfQuadrant(world, q, margin) {
  const w = B.world.width;
  const h = B.world.height;
  const hw = w / 2;
  const hh = h / 2;
  const left = q === 0 || q === 2;
  const top = q === 0 || q === 1;
  // выбираем сторону, выходящую за границу именно в этом квадранте
  const sides = [];
  if (top) sides.push(() => ({ x: rand(world.rng, 0, hw), y: -margin }));
  else sides.push(() => ({ x: rand(world.rng, 0, hw), y: h + margin }));
  if (left) sides.push(() => ({ x: -margin, y: rand(world.rng, 0, hh) }));
  else sides.push(() => ({ x: w + margin, y: rand(world.rng, 0, hh) }));
  return sides[randInt(world.rng, 0, sides.length - 1)]();
}

// Случайное ребро из свободных квадрантов; если все заняты — где угодно
function safeSpawnEdge(world, margin = 60) {
  const occ = occupiedQuadrants(world);
  const free = [];
  for (let q = 0; q < 4; q++) if (!occ.has(q)) free.push(q);
  const pool = free.length ? free : [0, 1, 2, 3];
  return edgePointOfQuadrant(world, pool[randInt(world.rng, 0, pool.length - 1)], margin);
}

// --- кометы: быстрые «снаряды», летящие насквозь ---

function edgePoint(world) {
  const w = B.world.width;
  const h = B.world.height;
  const side = randInt(world.rng, 0, 3);
  const m = 60;
  if (side === 0) return { x: rand(world.rng, 0, w), y: -m };
  if (side === 1) return { x: w + m, y: rand(world.rng, 0, h) };
  if (side === 2) return { x: rand(world.rng, 0, w), y: h + m };
  return { x: -m, y: rand(world.rng, 0, h) };
}

// Точка, в которой путь кометы (луч из точки at по вектору скорости)
// впервые пересекает границу арены — там рисуем предупреждающую стрелку.
function edgeEntryPoint(at, vx, vy) {
  const w = B.world.width;
  const h = B.world.height;
  const cands = [];
  if (vx !== 0) {
    for (const X of [0, w]) {
      const t = (X - at.x) / vx;
      if (t >= 0) {
        const y = at.y + t * vy;
        if (y >= 0 && y <= h) cands.push({ t, x: X, y });
      }
    }
  }
  if (vy !== 0) {
    for (const Y of [0, h]) {
      const t = (Y - at.y) / vy;
      if (t >= 0) {
        const x = at.x + t * vx;
        if (x >= 0 && x <= w) cands.push({ t, x, y: Y });
      }
    }
  }
  cands.sort((a, b) => a.t - b.t);
  return cands.length ? cands[0] : { x: at.x, y: at.y };
}

function makeComet(world, x, y, vx, vy, r, rot) {
  const def = asteroidDef('comet');
  const ang = Math.atan2(vy, vx);
  world.asteroids.push({
    id: world.nextAsteroidId++,
    type: 'comet',
    x,
    y,
    vx,
    vy,
    r,
    hp: def.hp,
    maxHp: def.hp,
    rot: rot != null ? rot : ang, // ориентирована по полёту
    rotSpeed: rand(world.rng, -3, 3),
    shapeSeed: randInt(world.rng, 1, 1e9),
    entered: false, // станет true, когда комета войдёт в поле
  });
}

// множественные кометы: 2-3 рядом летят параллельно, с боковым и продольным смещением
function planMultipleComets(world, at, ang, sp, plan) {
  const def = asteroidDef('comet');
  const count = randInt(world.rng, 2, 3);
  const perp = ang + Math.PI / 2;
  // чем больше комет в группе, тем медленнее полёт
  const baseSp = sp * rand(world.rng, 0.9, 1.1) * (1 - (count - 2) * 0.18);
  const vx = Math.cos(ang) * baseSp;
  const vy = Math.sin(ang) * baseSp;
  for (let k = 0; k < count; k++) {
    const lat = (k - (count - 1) / 2) * rand(world.rng, 20, 40);
    const lead = rand(world.rng, -40, 40); // вперёд/назад вдоль курса
    plan.push({
      x: at.x + Math.cos(perp) * lat + Math.cos(ang) * lead,
      y: at.y + Math.sin(perp) * lat + Math.sin(ang) * lead,
      vx,
      vy,
      r: rand(world.rng, def.radiusMin, def.radiusMax),
    });
  }
}

// айсберг: 1 большая комета и за ней 1-3 маленьких
function planIceberg(world, at, ang, sp, plan) {
  const def = asteroidDef('comet');
  const perp = ang + Math.PI / 2;
  const smallCount = randInt(world.rng, 1, 3);
  const total = 1 + smallCount; // большая + маленькие
  // чем больше комет в группе, тем медленнее полёт
  const baseSp = sp * rand(world.rng, 0.85, 1.0) * (1 - (total - 1) * 0.15);
  const vx = Math.cos(ang) * baseSp;
  const vy = Math.sin(ang) * baseSp;
  const bigR = rand(world.rng, def.radiusMax + 6, def.radiusMax + 12);
  plan.push({ x: at.x, y: at.y, vx, vy, r: bigR });
  for (let k = 0; k < smallCount; k++) {
    const trail = rand(world.rng, 26, 55) * (k + 1); // позади большой
    const lat = rand(world.rng, -26, 26);
    plan.push({
      x: at.x - Math.cos(ang) * trail + Math.cos(perp) * lat,
      y: at.y - Math.sin(ang) * trail + Math.sin(perp) * lat,
      vx,
      vy,
      r: rand(world.rng, def.radiusMin * 0.7, def.radiusMin),
    });
  }
}

function spawnComet(world) {
  const def = asteroidDef('comet');
  const w = B.world.width;
  const h = B.world.height;
  const at = edgePoint(world);
  const tx = rand(world.rng, w * 0.15, w * 0.85);
  const ty = rand(world.rng, h * 0.15, h * 0.85);
  const ang = Math.atan2(ty - at.y, tx - at.x);
  const sp = rand(world.rng, def.speedMin, def.speedMax);
  const vx = Math.cos(ang) * sp;
  const vy = Math.sin(ang) * sp;

  // случайный вариант: одинарная / множественные / айсберг
  const plan = [];
  const roll = world.rng();
  if (roll < 0.35) {
    planMultipleComets(world, at, ang, sp, plan); // 35% — группа 2-3
  } else if (roll < 0.6) {
    planIceberg(world, at, ang, sp, plan);        // 25% — айсберг (1 б + 1-3 м)
  } else {
    plan.push({ x: at.x, y: at.y, vx, vy, r: rand(world.rng, def.radiusMin, def.radiusMax) }); // 40% — одинарная
  }

  // отсроченный спавн: сначала предупреждающая стрелка на краю поля,
  // сама комета появится через spawnWarnMs
  const first = plan[0];
  const entry = edgeEntryPoint({ x: first.x, y: first.y }, first.vx, first.vy);
  world.pendingComets.push({
    id: world.nextPendingCometId++,
    at: world.t + def.spawnWarnMs,
    x: entry.x,
    y: entry.y,
    vx: first.vx,
    vy: first.vy,
    r: first.r,
    plan,
  });
}

// --- вражеские корабли: охотник (enemy), бронированный (armored),
// очередной стрелок (burst), орбитальный (orbital) ---

function spawnEnemyOfKind(world, kind) {
  const st = enemyStats(kind);
  const w = B.world.width;
  const h = B.world.height;
  let x = w / 2;
  let y = -60;
  for (let attempt = 0; attempt < 10; attempt++) {
    const at = safeSpawnEdge(world, 60);
    x = at.x;
    y = at.y;
    const tooClose = world.players.some(
      (p) => !p.out && p.alive && Math.hypot(p.x - x, p.y - y) < 260
    );
    if (!tooClose) break;
  }
  const e = {
    id: 'en' + world.nextEnemyId++,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    a: Math.atan2(h / 2 - y, w / 2 - x),
    r: st.radius,
    hp: st.hp,
    maxHp: st.hp,
    fireCdAt: world.t + 1200,
    strafe: world.rng() < 0.5 ? 1 : -1,
  };
  if (kind === 'armored') {
    e.armor = st.armorHp;
    e.maxArmor = st.armorHp;
  } else if (kind === 'burst') {
    e.burstLeft = 0;          // пуль осталось в текущей очереди
    e.burstNextAt = 0;        // таймер следующей пули очереди
    e.burstCdUntil = world.t + 800; // пауза между очередями
    e.powLvl = 0;             // усиление подобранными монетами
  } else if (kind === 'orbital') {
    e.orbA = world.rng() * Math.PI * 2; // текущий угол орбиты
    e.orbDir = world.rng() < 0.5 ? 1 : -1; // направление облёта
    e.orbitR = rand(world.rng, st.orbitRMin, st.orbitRMax);
  }
  world.enemies.push(e);
}

function spawnEnemy(world) {
  spawnEnemyOfKind(world, 'enemy');
}

// Реестр видов противников, спавнящихся в волнах. Ключ должен совпадать с ключом
// в BALANCE.enemyKinds. Каждый вид — это { spawn(world, cfg), countAlive(world) }.
// При добавлении нового вида противника: добавьте сюда обработчик по его ключу,
// а параметры по умолчанию — в shared/balance.js (enemyKinds).
const SPAWNERS = {
  asteroid: {
    spawn(world, cfg) { spawnAsteroid(world, pickAsteroidType(world, cfg.composition)); },
    countAlive(world) { return world.asteroids.reduce((n, a) => n + (a.type !== 'comet' ? 1 : 0), 0); },
  },
  comet: {
    spawn(world) { spawnComet(world); },
    countAlive(world) {
      return world.asteroids.reduce((n, a) => n + (a.type === 'comet' ? 1 : 0), 0) +
        (world.pendingComets ? world.pendingComets.length : 0);
    },
  },
  enemy: {
    spawn(world) { spawnEnemy(world); },
    countAlive(world) { return world.enemies.length; },
  },
  armored: {
    spawn(world) { spawnEnemyOfKind(world, 'armored'); },
    countAlive(world) { return world.enemies.reduce((n, e) => n + (e.kind === 'armored' ? 1 : 0), 0); },
  },
  burst: {
    spawn(world) { spawnEnemyOfKind(world, 'burst'); },
    countAlive(world) { return world.enemies.reduce((n, e) => n + (e.kind === 'burst' ? 1 : 0), 0); },
  },
  orbital: {
    spawn(world) { spawnEnemyOfKind(world, 'orbital'); },
    countAlive(world) { return world.enemies.reduce((n, e) => n + (e.kind === 'orbital' ? 1 : 0), 0); },
  },
};

export function killEnemy(world, e, owner) {
  e.dead = true;
  const st = enemyStats(e.kind);
  if (owner) {
    owner.score += st.score;
    owner.kills++;
  }
  spawnCoinBurst(world, e.x, e.y, randInt(world.rng, st.coinsMin, st.coinsMax));
  const eEnergy = randInt(world.rng, st.energyMin, st.energyMax);
  if (eEnergy > 0) spawnEnergyBurst(world, e.x, e.y, eEnergy);
  // патроны для ракет: только когда у убившего активен модуль (Б1) и боезапас не полон.
  // Шанс дропа и потолок боезапаса зависят от уровня модуля.
  const M = B.missile;
  if (owner && owner.hasMissiles) {
    const maxAmmo = owner.missileMaxAmmo || M.maxAmmo;
    const dropChance = owner.missileDropChance != null ? owner.missileDropChance : M.dropChance;
    if (owner.missiles < maxAmmo && world.rng() < dropChance) {
      spawnMissilePack(world, e.x, e.y);
    }
  }
  // заряды способностей: выпадают с врагов, если способность разблокирована (Б3)
  tryDropAbilityPack(world, e.x, e.y, owner);
  if (world.rng() < B.powerups.enemyChance) {
    spawnPowerup(world, e.x, e.y);
  }
  addFx(world, 'boom', e.x, e.y, 2.6);
}

// Урон по врагу: бронированный (В4) сначала тратит броню (+100% HP), затем HP.
function damageEnemy(world, e, dmg, owner) {
  if (e.dead || dmg <= 0) return;
  if (e.kind === 'armored' && e.armor > 0) {
    const abs = Math.min(e.armor, dmg);
    e.armor -= abs;
    dmg -= abs;
    if (e.armor <= 0) {
      addFx(world, 'boom', e.x, e.y, 1.2);
    }
  }
  if (dmg > 0) e.hp -= dmg;
  if (e.hp <= 0) killEnemy(world, e, owner);
  else addFx(world, 'hit', e.x, e.y, 1);
}

// Урон боссу: сначала по броне (если щит активен), потом по HP.
// В1: переходы фаз по снижению HP (пороги из def.phasesAt), накопительно.
function damageBoss(world, boss, dmg, owner) {
  if (boss.dead || dmg <= 0) return;
  const def = bossDef(boss.key);
  if (boss.armor > 0) {
    const abs = Math.min(boss.armor, dmg);
    boss.armor -= abs;
    dmg -= abs;
    if (boss.armor <= 0) addFx(world, 'boom', boss.x, boss.y, 1.3);
  }
  if (dmg > 0) boss.hp -= dmg;
  // смена фаз по падению HP; для вручную созданных боссов (тесты/старые миры)
  // с phaseFwdAt работаем как с единственным порогом фазы 2
  const maxPhase = Math.max(
    def.maxPhase || def.phaseCount || 1,
    (boss.phaseFwdAt || boss.nextPhaseAt) ? 2 : 1
  );
  let nextAt = boss.nextPhaseAt != null ? boss.nextPhaseAt : (boss.phaseFwdAt || 0);
  let changed = false;
  while (boss.phase < maxPhase && boss.hp <= nextAt) {
    boss.phase++;
    changed = true;
    nextAt = bossNextPhaseAt(def, boss.phase);
  }
  boss.nextPhaseAt = nextAt;
  boss.phaseFwdAt = nextAt;
  if (changed) onBossPhaseUp(world, boss);
  if (boss.hp <= 0) destroyBoss(world, boss, owner);
  else addFx(world, 'hit', boss.x, boss.y, 1);
}

// В1: событие смены фазы — визуал/звук на клиенте + активация способностей босса.
function onBossPhaseUp(world, boss) {
  const def = bossDef(boss.key);
  addFx(world, 'boom', boss.x, boss.y, 2.2);
  addFx(world, 'bossphase', boss.x, boss.y, boss.phase, { k: boss.key });
  // щит (броня) появляется с определённой фазы — выставляем полную полосу
  if (def.armorHp && (def.armorFromPhase || 1) <= boss.phase && !boss.armorGranted) {
    boss.armorGranted = true;
    boss.armor = def.armorHp;
    boss.maxArmor = def.armorHp;
    addFx(world, 'shield', boss.x, boss.y, 1.8);
  }
  // фазовые таймеры запускаются при вхождении в нужную фазу
  if (def.teleportFrom && def.teleportFrom <= boss.phase && boss.tpAt == null) {
    boss.tpAt = world.t + (def.teleportIntervalMs || 3200);
  }
  if (def.cloneFrom && def.cloneFrom <= boss.phase && boss.cloneAt == null) {
    boss.cloneAt = world.t + ((def.clone && def.clone.intervalMs) || 4000);
  }
  if (def.laserFrom && def.laserFrom <= boss.phase && boss.laserAt == null) {
    boss.laserAt = world.t + def.laser.intervalMs;
  }
  if (bossBaseKey(boss.key) === 'leviathan') {
    boss.spinA = rand(world.rng, 0, Math.PI * 2);
  }
}

// Ближайшая монета в радиусе (для врагов-сборщиков монет, В4)
function nearestCoin(world, e, radius) {
  let best = null;
  let bd = radius;
  for (const c of world.coins) {
    const d = Math.hypot(c.x - e.x, c.y - e.y);
    if (d <= bd) { bd = d; best = c; }
  }
  return best;
}

// Выстрел вражеского корабля по текущему направлению.
function enemyFireBullet(world, e, st, now) {
  const nose = e.r + 6;
  world.bullets.push({
    id: world.nextBulletId++,
    x: e.x + Math.cos(e.a) * nose,
    y: e.y + Math.sin(e.a) * nose,
    vx: Math.cos(e.a) * st.bulletSpeed,
    vy: Math.sin(e.a) * st.bulletSpeed,
    a: e.a,
    owner: null,
    enemy: true,
    born: world.t,
  });
  addFx(world, 'shoot', e.x + Math.cos(e.a) * nose, e.y + Math.sin(e.a) * nose, 1);
}

// Стрельба по виду врага: очередной стрелок (В4) — очередь по 0.1с с паузой 2с,
// обычные/бронированные — одиночные выстрелы; орбитальный не стреляет.
function maybeFireEnemy(world, e, st, now) {
  if (e.kind === 'orbital') return;
  if (e.kind === 'burst') {
    const shots = st.burstShots + e.powLvl; // монета → +выстрел в очереди
    const speed = st.bulletSpeed * (1 + e.powLvl * st.powSpeed);
    if (e.burstLeft > 0) {
      if (now >= e.burstNextAt) {
        const old = st.bulletSpeed;
        st.bulletSpeed = speed;
        enemyFireBullet(world, e, st, now);
        st.bulletSpeed = old;
        e.burstLeft--;
        if (e.burstLeft > 0) e.burstNextAt = now + st.shotIntervalMs;
        else e.burstCdUntil = now + st.burstCooldownMs;
      }
      return;
    }
    if (now >= e.burstCdUntil) {
      e.burstLeft = shots;
      e.burstNextAt = now;
    }
    return;
  }
  if (now >= e.fireCdAt) {
    e.fireCdAt = now + st.fireCooldownMs * rand(world.rng, 0.75, 1.3);
    enemyFireBullet(world, e, st, now);
  }
}

function updateEnemies(world, dt, now) {
  const w = B.world.width;
  const h = B.world.height;
  for (const e of world.enemies) {
    const st = enemyStats(e.kind);
    // цель — ближайший живой игрок
    let target = null;
    let bd = Infinity;
    for (const p of world.players) {
      if (!p.alive || p.out) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < bd) { bd = d; target = p; }
    }
    let ax = 0;
    let ay = 0;

    if (e.kind === 'orbital') {
      // --- орбитальный: кружит вокруг цели на дистанции, не стреляет ---
      if (target) {
        const angToT = Math.atan2(target.y - e.y, target.x - e.x);
        const dist = Math.hypot(target.x - e.x, target.y - e.y) || 1;
        // радиальная составляющая: держим радиус орбиты
        const drift = Math.max(-1.6, Math.min(1.6, (dist - e.orbitR) / 130));
        ax += Math.cos(angToT) * drift;
        ay += Math.sin(angToT) * drift;
        // тангенциальная составляющая: облёт по орбите
        const tan = angToT + (Math.PI / 2) * e.orbDir;
        ax += Math.cos(tan) * 1.5;
        ay += Math.sin(tan) * 1.5;
        // разворачиваемся «носом» к игроку (угроза тарана)
        const want = angToT;
        let da = (want - e.a) % (Math.PI * 2);
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        const turn = st.turnRate * dt;
        e.a += Math.max(-turn, Math.min(turn, da));
      }
    } else {
      // --- охотник / бронированный / очередной стрелок: погоня с огнём ---
      let preferMin = st.preferredDistMin;
      let preferMax = st.preferredDistMax;
      let shoot = true;
      let coin = null;
      if (e.kind === 'armored') {
        const armorPct = e.maxArmor ? e.armor / e.maxArmor : 0;
        if (armorPct < st.armorResupplyPct) {
          // броня критична: прекращаем огонь и уходим за монетой
          shoot = false;
          coin = nearestCoin(world, e, st.coinSeekR);
          if (!coin) {
            preferMin = st.preferredDistMax * 1.7;
            preferMax = st.preferredDistMax * 2.0;
          }
        } else if (armorPct < st.armorResupplyPct + 0.2) {
          // броня подорвана: держимся на дальних дистанциях
          preferMin *= 1.3;
          preferMax *= 1.4;
        }
      }
      const steer = coin || target;
      if (steer && bd < st.engageDistMax * 1.6) {
        const nx = (steer.x - e.x) / (bd || 1);
        const ny = (steer.y - e.y) / (bd || 1);
        if (coin) {
          ax += nx;
          ay += ny;
        } else if (bd > preferMax) { ax = nx; ay = ny; }
        else if (bd < preferMin) { ax = -nx; ay = -ny; }
        else { ax = -ny * e.strafe; ay = nx * e.strafe; }

        if (shoot) {
          // прицел с опережением по скорости цели
          const lead = bd / st.bulletSpeed;
          const want = Math.atan2(
            target.y + target.vy * lead - e.y,
            target.x + target.vx * lead - e.x
          );
          let da = (want - e.a) % (Math.PI * 2);
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          const turn = st.turnRate * dt;
          e.a += Math.max(-turn, Math.min(turn, da));

          if (Math.abs(da) < 0.18 && bd < st.engageDistMax && target) {
            maybeFireEnemy(world, e, st, now);
          }
        }
      }
    }

    // --- уворот от астероидов и комет (орбитальный их ломает, а не уворачивается) ---
    if (e.kind !== 'orbital') {
      let keepTarget = true;
      let dodgeX = 0;
      let dodgeY = 0;
      const lookAhead = st.maxSpeed * 0.5 + 40; // смотрим вперёд по ходу движения
      for (const a of world.asteroids) {
        if (a.dead) continue;
        const dx = a.x - e.x;
        const dy = a.y - e.y;
        const dist = Math.hypot(dx, dy);
        const danger = a.r + e.r + lookAhead;
        if (dist < danger && dist > 0.001) {
          // уворачиваемся перпендикулярно направлению на астероид
          const push = (1 - dist / danger) * 1.6;
          dodgeX -= (dx / dist) * push;
          dodgeY -= (dy / dist) * push;
          if (dist < a.r + e.r + 30) keepTarget = false;
        }
      }
      if (dodgeX !== 0 || dodgeY !== 0) {
        ax += dodgeX;
        ay += dodgeY;
      } else if (!keepTarget) {
        ax = 0; ay = 0;
      }
    }

    e.vx += ax * st.accel * dt;
    e.vy += ay * st.accel * dt;
    const damp = Math.exp(-2 * dt);
    e.vx *= damp;
    e.vy *= damp;
    const sp = Math.hypot(e.vx, e.vy);
    if (sp > st.maxSpeed) { e.vx *= st.maxSpeed / sp; e.vy *= st.maxSpeed / sp; }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    // не даём врагу улететь далеко за поле
    e.x = Math.max(-80, Math.min(w + 80, e.x));
    e.y = Math.max(-80, Math.min(h + 80, e.y));
  }
  world.enemies = world.enemies.filter((en) => !en.dead);
}

// --- боссы ---
function bossDef(key) { return B.bosses.types[key]; }

// Базовый ключ для вариантов босса: 'dreadnought+'/'dreadnought++' → 'dreadnought'
function bossBaseKey(key) { return String(key).replace(/\++$/, ''); }

// Порог следующей фазы босса (0 = больше переходов нет).
function bossNextPhaseAt(def, phase) {
  const ths = def.phasesAt && def.phasesAt.length ? def.phasesAt
    : (def.phaseAtHpPct ? [def.phaseAtHpPct] : []);
  const i = phase - (def.startPhase || 1);
  return ths.length && i < ths.length ? ths[i] * def.hp : 0;
}

// В2: «гудок-волна» — радиально выталкивает игрока и объекты от точки появления
// босса (x, y); действует сразу после появления предупреждения, до фактического
// спавна. Сила затухает по расстоянию; тяжёлые объекты смещаются меньше.
export function forcePush(world, x, y, radius, strength) {
  const push = (dx, dy, mass) => {
    const d = Math.hypot(dx, dy);
    if (d >= radius || d < 0.01) return null;
    const fall = 1 - d / radius;
    return { nx: (dx / d) * strength * fall / mass, ny: (dy / d) * strength * fall / mass };
  };
  const applyTo = (o, mass) => {
    const p = push(o.x - x, o.y - y, mass);
    if (!p) return;
    o.vx += p.nx;
    o.vy += p.ny;
  };
  for (const pl of world.players) {
    if (pl.out || !pl.alive) continue;
    applyTo(pl, 1.1);
  }
  for (const a of world.asteroids) {
    if (a.dead) continue;
    applyTo(a, a.type === 'comet' ? 2.2 : 1.4);
  }
  for (const e of world.enemies) {
    if (e.dead) continue;
    applyTo(e, 1.4);
  }
  for (const c of world.coins) applyTo(c, 0.8);
}

// Ребро-точка на кромке стороны входа босса — там рисуем серию мигающих значков.
function warnEdgePoint(world, side) {
  const w = B.world.width;
  const h = B.world.height;
  if (side === 0) return { x: w / 2, y: 42 };
  if (side === 1) return { x: w - 42, y: h / 2 };
  if (side === 2) return { x: w / 2, y: h - 42 };
  return { x: 42, y: h / 2 };
}

function spawnBoss(world, key) {
  const def = bossDef(key);
  if (!def) return;
  const w = B.world.width;
  const h = B.world.height;
  const margin = 100;
  // определяем занятые квадранты игроками и выбираем свободную сторону
  const occ = occupiedQuadrants(world);
  const freeSides = [];
  if (!occ.has(0) && !occ.has(1)) freeSides.push(0); // сверху свободно
  if (!occ.has(1) && !occ.has(3)) freeSides.push(1); // справа свободно
  if (!occ.has(2) && !occ.has(3)) freeSides.push(2); // снизу свободно
  if (!occ.has(0) && !occ.has(2)) freeSides.push(3); // слева свободно
  const side = freeSides.length
    ? freeSides[Math.floor(world.rng() * freeSides.length)]
    : Math.floor(world.rng() * 4);
  let x, y;
  if (side === 0) { x = rand(world.rng, 0, w); y = -margin; }
  else if (side === 1) { x = w + margin; y = rand(world.rng, 0, h); }
  else if (side === 2) { x = rand(world.rng, 0, w); y = h + margin; }
  else { x = -margin; y = rand(world.rng, 0, h); }
  const a = Math.atan2(h / 2 - y, w / 2 - x);
  // В2: ставим босса в очередь появления с задержкой warnMs; сразу гудок-волна
  // выталкивает игрока и объекты от точки входа, плюс серия мигающих значков.
  const warnMs = B.bosses.warnMs || 2000;
  const ept = warnEdgePoint(world, side);
  forcePush(world, x, y, B.bosses.hornRadius || 520, B.bosses.hornStrength || 460);
  addFx(world, 'warning', ept.x, ept.y, 3, { k: key, side });
  world.pendingBosses.push({
    id: world.nextPendingBossId++,
    key,
    side,
    x,
    y,
    a,
    at: world.t + warnMs,
    warnX: ept.x,
    warnY: ept.y,
  });
}

// Фактический ввод босса на арену (после warnMs) — выделено из spawnBoss для В2.
function enterBoss(world, pb) {
  const def = bossDef(pb.key);
  if (!def) return;
  const { x, y, a, side, key } = pb;
  const startPhase = def.startPhase || 1;
  const maxPhase = def.maxPhase || def.phaseCount || 1;
  const nextPhaseAt = bossNextPhaseAt(def, startPhase);
  // броня появляется только с определённой фазы (у базовых боссов щита нет)
  const armor = (def.armorHp && (def.armorFromPhase || 1) <= startPhase) ? def.armorHp : 0;
  world.bosses.push({
    id: 'bo'+ world.nextBossId++,
    key,
    x, y, vx:0, vy:0, a,
    hp: def.hp, maxHp: def.hp,
    armor, maxArmor: armor,
    armorGranted: armor > 0,
    phase: startPhase, maxPhase,
    nextPhaseAt, phaseFwdAt: nextPhaseAt,
    burstLeft: 0, burstNextAt: 0,
    fireCdAt: world.t + 900,
    mineCdAt: world.t + (def.mineIntervalMs || 5000),
    tpAt: (def.teleportFrom || 99) <= startPhase ? world.t + (def.teleportIntervalMs || 3200) : null,
    cloneAt: (def.cloneFrom || 99) <= startPhase ? world.t + ((def.clone && def.clone.intervalMs) || 4000) : null,
    spinA: rand(world.rng, 0, Math.PI * 2),
    laserAt: (def.laserFrom || 99) <= startPhase && def.laser ? world.t + def.laser.intervalMs : null,
    born: world.t,
  });
  if (!world.bossSpawnedKeys[key]) {
    world.bossSpawnedKeys[key] = true;
    world.bossesFought++;
  }
  addFx(world, 'spawn', x, y, 3);
}

// Клон Фантома (фаза 3 у phantom++): ослабленный призрак с ограниченным временем жизни.
function spawnPhantomClone(world, boss) {
  const def = bossDef('phantom');
  const cfg = bossDef(boss.key).clone || {};
  const ang = world.rng() * Math.PI * 2;
  const dist = rand(world.rng, 190, 330);
  const hp = def.hp * (cfg.hpFactor || 0.4);
  world.bosses.push({
    id: 'bo' + world.nextBossId++,
    key: 'phantom',
    clone: true,
    x: boss.x + Math.cos(ang) * dist,
    y: boss.y + Math.sin(ang) * dist,
    vx: 0, vy: 0,
    a: rand(world.rng, 0, Math.PI * 2),
    hp, maxHp: hp,
    armor: 0, maxArmor: 0,
    phase: 1, maxPhase: 1, nextPhaseAt: 0, phaseFwdAt: 0,
    r: def.radius * (cfg.radiusFactor || 0.7),
    burstLeft: 0, burstNextAt: 0,
    fireCdAt: world.t + 700,
    mineCdAt: null,    // клон не кидает мины
    tpAt: null,        // и не телепортируется
    cloneAt: null,
    spinA: 0, laserAt: null,
    expiry: world.t + (cfg.lifeMs || 12000),
    born: world.t,
  });
  addFx(world, 'spawn', boss.x, boss.y, 2);
}

// Начало волны: сбрасываем счётчики спавна и выпускаем боссов из конфигурации волны
function startWave(world, wave) {
  world.wavePhase = 'spawning';
  world.waveTimer = wave.durationMs;
  world.waveSpawns = {};
  world.waveBossKeys = (wave.bosses || []).slice();
  for (const key of (wave.bosses || [])) {
    spawnBoss(world, key);
  }
}

// Волна с боссом тормозит очередь: следующая волна не начинается, пока все боссы
// текущей волны (включая ещё не введённых) не будут побеждены. Клоны босса не
// считаются: их убийство не обязательно для перехода к следующей волне.
function waveBossAlive(world) {
  const keys = world.waveBossKeys || [];
  if (!keys.length) return false;
  for (const pb of (world.pendingBosses || [])) {
    if (keys.includes(pb.key)) return true;
  }
  for (const b of (world.bosses || [])) {
    if (b.dead || b.clone) continue;
    if (keys.includes(b.key)) return true;
  }
  return false;
}

function destroyBoss(world, boss, owner) {
  boss.dead=true;
  // клон фантома не даёт наград, очков и дропа — только взрыв
  if (boss.clone) {
    addFx(world,'boom', boss.x, boss.y, 2.8);
    return;
  }
  const def = bossDef(boss.key);
  if (owner) { owner.score += def.scoreReward; owner.kills += 3; }
  else {
    // если босса добил не игрок — очки лидеру
    let best=null; for(const p of world.players) if(!best||p.score>best.score) best=p;
    if(best) best.score += Math.floor(def.scoreReward*0.5);
  }
  addFx(world,'boom', boss.x, boss.y, 4.2);
  // модуль «Ракеты»: убийство Фантома разблокирует его в аккаунте (Б1).
  // Сессия (сервер/локаль) через world.onModuleUnlock сохраняет состояние.
  if (boss.key === 'phantom' && owner && typeof world.onModuleUnlock === 'function') {
    world.onModuleUnlock(owner.id, 'rockets');
  }
  // дроп: кристалл монет 1000 + кристалл способности/модуля
  const ang = world.rng()*Math.PI*2;
  spawnCrystal(world, boss.x + Math.cos(ang)*30, boss.y + Math.sin(ang)*30, 'coins');
  // выбор способности: фантом гарантированно даёт модуль «Ракеты» (Q4),
  // иначе рандом из неполученных. С боссов тоже падают патроны, если модуль активен.
  const pool = ['armor','laser','mines'];
  let choice = pool[Math.floor(world.rng()*pool.length)];
  if (boss.key==='phantom' && owner) choice='missiles';
  else if (owner) {
    const need = pool.filter(k=> (k==='armor'&&!owner.hasArmor)||(k==='laser'&&!owner.hasLaser)||(k==='mines'&&!owner.hasMines));
    if (need.length) choice = need[Math.floor(world.rng()*need.length)];
  }
  const M = B.missile;
  if (owner && owner.hasMissiles) {
    const maxAmmo = owner.missileMaxAmmo || M.maxAmmo;
    const dropChance = owner.missileDropChance != null ? owner.missileDropChance : M.dropChance;
    if (owner.missiles < maxAmmo && world.rng() < dropChance) {
      spawnMissilePack(world, boss.x + 30, boss.y + 30);
    }
  }
  const ang2 = ang+Math.PI;
  spawnCrystal(world, boss.x + Math.cos(ang2)*30, boss.y + Math.sin(ang2)*30, 'ability', choice);
  // заряды способностей с босса (Б3)
  tryDropAbilityPack(world, boss.x, boss.y, owner);
}

// В3: выстрел дредноута — веер из 3 пуль
function fireDreadVolley(world, b, def) {
  for (let k = -1; k <= 1; k++) {
    const ang = b.a + k * def.spread;
    world.bullets.push({ id: world.nextBulletId++, x: b.x + Math.cos(ang) * (def.radius + 6), y: b.y + Math.sin(ang) * (def.radius + 6), vx: Math.cos(ang) * def.bulletSpeed, vy: Math.sin(ang) * def.bulletSpeed, a: ang, enemy: true, born: world.t });
  }
  addFx(world, 'shoot', b.x + Math.cos(b.a) * (def.radius + 6), b.y + Math.sin(b.a) * (def.radius + 6), 2);
}

function updateBosses(world, dt, now) {
  const w = B.world.width, h = B.world.height;
  for(const b of world.bosses){
    if(b.dead) continue;
    const def=bossDef(b.key);
    const base=bossBaseKey(b.key);
    // клоны живут ограниченное время
    if (b.expiry && now >= b.expiry) { b.dead=true; addFx(world,'boom', b.x, b.y, 2.4); continue; }
    // фазовые способности (накопительно) — В1
    const ph = b.phase || 1;
    const hasBurst = !!def.burst && (def.burstFrom || 2) <= ph;
    const hasArmor = (def.armorHp || 0) > 0 && (def.armorFromPhase || 1) <= ph;
    const hasMines = !!b.mineCdAt && (def.mineFrom || 1) <= ph && !b.clone;
    const hasTp = b.tpAt != null && (def.teleportFrom || 99) <= ph && !b.clone;
    const hasClone = b.cloneAt != null && (def.cloneFrom || 99) <= ph && !b.clone;
    const hasSpiral = !!def.spiral && (def.spiralFrom || 99) <= ph;
    const hasLaser = b.laserAt != null && (def.laserFrom || 99) <= ph;
    // цель ближайший живой игрок
    let target=null, bd=Infinity;
    for(const p of world.players){ if(!p.alive||p.out) continue; const d=Math.hypot(p.x-b.x,p.y-b.y); if(d<bd){bd=d; target=p;} }
    let ax=0, ay=0;
    if(target){
      const nx=(target.x-b.x)/(bd||1), ny=(target.y-b.y)/(bd||1);
      // В1: телепорт фантома — исчезает и возникает на противоположной стороне
      if (hasTp && now >= b.tpAt) {
        b.tpAt = now + (def.teleportIntervalMs || 3200) * rand(world.rng, 0.85, 1.2);
        const toT = Math.atan2(target.y - b.y, target.x - b.x);
        const ang = toT + Math.PI + rand(world.rng, -0.7, 0.7);
        const dist = def.teleportDist || 420;
        let nx2 = b.x + Math.cos(ang) * dist;
        let ny2 = b.y + Math.sin(ang) * dist;
        nx2 = Math.max(60, Math.min(w - 60, nx2));
        ny2 = Math.max(60, Math.min(h - 60, ny2));
        addFx(world, 'boom', b.x, b.y, 1.4);
        addFx(world, 'mine', b.x, b.y, 1);
        b.x = nx2; b.y = ny2; b.vx = 0; b.vy = 0;
        addFx(world, 'boom', b.x, b.y, 1.4);
      }
      if(base==='phantom'){
        if(bd>320) {ax=nx; ay=ny;} else if(bd<210){ax=-nx; ay=-ny;} else {ax=-ny; ay=nx;}
      } else if(base==='leviathan'){
        if(bd>380){ax=nx*0.6; ay=ny*0.6;} else if(bd<250){ax=-nx*0.5; ay=-ny*0.5;} else { ax=Math.cos(now*0.0007)*0.5; ay=Math.sin(now*0.0007)*0.5; }
      } else { // dreadnought
        // В3: при критически низкой броне дредноут ищет монеты, чтобы восполнить её
        let coin = null, cd = Infinity;
        const armorPct = b.maxArmor ? b.armor / b.maxArmor : 1;
        if (hasArmor && armorPct < def.armorResupplyPct) {
          for (const c of world.coins) { const d = Math.hypot(c.x - b.x, c.y - b.y); if (d < cd) { cd = d; coin = c; } }
        }
        if (coin && cd < def.coinSeekR) { ax = (coin.x - b.x) / cd; ay = (coin.y - b.y) / cd; }
        else if (hasBurst) {
          if (bd > 300) { ax = nx; ay = ny; } else if (bd < 180) { ax = -nx * 0.45; ay = -ny * 0.45; }
        } else {
          if (bd > 340) { ax = nx; ay = ny; } else if (bd < 220) { ax = -nx * 0.4; ay = -ny * 0.4; }
        }
      }
      // поворот
      const want=Math.atan2(target.y - b.y, target.x - b.x);
      let da=(want-b.a)%(Math.PI*2); if(da>Math.PI)da-=Math.PI*2; if(da<-Math.PI)da+=Math.PI*2;
      b.a += Math.max(-def.turnRate*dt, Math.min(def.turnRate*dt, da));
      // стрельба
      if(base==='dreadnought'){
        if (hasBurst) {
          if (b.burstLeft > 0 && now >= b.burstNextAt) {
            fireDreadVolley(world, b, def);
            b.burstLeft--;
            if (b.burstLeft > 0) b.burstNextAt = now + def.burst.intervalMs;
            else b.fireCdAt = now + (def.burst.reloadMs || 2600) * rand(world.rng, 0.9, 1.15);
          } else if ((b.burstLeft || 0) <= 0 && now >= b.fireCdAt && bd < 820) {
            fireDreadVolley(world, b, def);
            b.burstLeft = (def.burst.volleys || 3) - 1;
            b.burstNextAt = now + def.burst.intervalMs;
            b.fireCdAt = now + (def.burst.reloadMs || 2600);
          }
        } else if (now >= b.fireCdAt && bd < 820) {
          fireDreadVolley(world, b, def);
          b.fireCdAt = now + def.fireCooldownMs * rand(world.rng, 0.85, 1.25);
        }
      } else if(now>=b.fireCdAt && bd< 820){
        b.fireCdAt = now + def.fireCooldownMs * rand(world.rng,0.85,1.25);
        if(base==='leviathan'){
          if (hasSpiral) {
            // В1: фаза 2+ — спиральный залп: точки круга смещаются с каждым залпом
            b.spinA = (b.spinA || 0) + ((def.spiral && def.spiral.spinStep) || 0.8);
            const off = b.spinA;
            for(let k=0;k<def.bulletCount;k++){
              const ang = (k/def.bulletCount)*Math.PI*2 + off;
              world.bullets.push({ id: world.nextBulletId++, x:b.x, y:b.y, vx: Math.cos(ang)*def.bulletSpeed, vy: Math.sin(ang)*def.bulletSpeed, a:ang, enemy:true, born:world.t });
            }
          } else {
            for(let k=0;k<def.bulletCount;k++){
              const ang = (k/def.bulletCount)*Math.PI*2;
              world.bullets.push({ id: world.nextBulletId++, x:b.x, y:b.y, vx: Math.cos(ang)*def.bulletSpeed, vy: Math.sin(ang)*def.bulletSpeed, a:ang, enemy:true, born:world.t });
            }
          }
          addFx(world,'shoot', b.x,b.y,2);
        } else {
          const n = def.bulletCount || 1;
          if (n > 1) {
            // веер: phantom++ стреляет двумя очередями с разбросом
            for (let k = 0; k < n; k++) {
              const off = (k - (n - 1) / 2) * (def.spread || 0.2);
              const ang = b.a + off;
              world.bullets.push({ id: world.nextBulletId++, x:b.x+Math.cos(ang)*(b.r || def.radius + 6), y:b.y+Math.sin(ang)*(b.r || def.radius + 6), vx:Math.cos(ang)*def.bulletSpeed, vy:Math.sin(ang)*def.bulletSpeed, a:ang, enemy:true, born:world.t });
            }
          } else {
            world.bullets.push({ id: world.nextBulletId++, x:b.x+Math.cos(b.a)*(b.r || def.radius + 6), y:b.y+Math.sin(b.a)*(b.r || def.radius + 6), vx:Math.cos(b.a)*def.bulletSpeed, vy:Math.sin(b.a)*def.bulletSpeed, a:b.a, enemy:true, born:world.t });
          }
          addFx(world,'shoot', b.x,b.y,1);
        }
      }
      // фантом кидает мины
      if(hasMines && now >= b.mineCdAt){
        b.mineCdAt = now + (def.mineIntervalMs||5500) * rand(world.rng,0.9,1.2);
        const ang = world.rng()*Math.PI*2;
        const dist = rand(world.rng, 30, 70);
        world.mines.push({ id: world.nextMineId++, owner: null, x: b.x + Math.cos(ang)*dist, y: b.y + Math.sin(ang)*dist, vx:0, vy:0, born: world.t, bossMine:true });
        addFx(world,'mine', b.x, b.y, 1);
      }
      // В1: клоны фантома в фазе 3 (только у phantom++)
      if (hasClone && now >= b.cloneAt) {
        const curClones = world.bosses.filter((x) => x.clone && x.key === 'phantom' && !x.dead).length;
        const maxClones = (def.clone && def.clone.max) || 2;
        if (curClones < maxClones) {
          spawnPhantomClone(world, b);
          b.cloneAt = now + ((def.clone && def.clone.intervalMs) || 4000);
        } else {
          b.cloneAt = now + 1500;
        }
      }
      // В1: лазерные лучи левиафана в фазе 3
      if (hasLaser && now >= b.laserAt) {
        const L = def.laser || {};
        b.laserAt = now + (L.intervalMs || 4500);
        const count = L.count || 2;
        for (let side = 0; side < count; side++) {
          const a0 = b.a + (side - (count - 1) / 2) * 0.35;
          world.bossLasers.push({
            id: world.nextBossLaserId++,
            bossId: b.id,
            x: b.x, y: b.y,
            spin: side % 2 === 0 ? -1 : 1,
            a: a0, aStart: a0,
            until: now + (L.durationMs || 1600),
            nextTick: now,
            dps: L.dps || 26, tickMs: L.tickMs || 100,
            width: L.width || 12, len: L.len || 760,
            dead: false,
          });
        }
        addFx(world,'laser', b.x, b.y, 2);
      }
    }
    b.vx += ax * def.accel * dt;
    b.vy += ay * def.accel * dt;
    const damp=Math.exp(-1.8*dt); b.vx*=damp; b.vy*=damp;
    const sp=Math.hypot(b.vx,b.vy); if(sp>def.maxSpeed){ b.vx*=def.maxSpeed/sp; b.vy*=def.maxSpeed/sp; }
    b.x += b.vx*dt; b.y += b.vy*dt;
    b.x=Math.max(-def.radius, Math.min(w+def.radius,b.x));
    b.y=Math.max(-def.radius, Math.min(h+def.radius,b.y));
  }
  world.bosses = world.bosses.filter(b=>!b.dead);
}

// В1: лазерные лучи босса (левиафан++): вращаются, следуют за боссом, бьют игрока.
function updateBossLasers(world, dt, now) {
  for (const ls of world.bossLasers) {
    if (ls.dead) continue;
    const boss = world.bosses.find((x) => x.id === ls.bossId);
    if (!boss || boss.dead) { ls.dead = true; continue; }
    if (now >= ls.until) { ls.dead = true; continue; }
    const def = bossDef(boss.key);
    const L = (def && def.laser) || {};
    // луч следует за боссом и «дышит» по синусу влево-вправо
    ls.x = boss.x; ls.y = boss.y;
    const dur = L.durationMs || 1600;
    const t = Math.max(0, Math.min(1, 1 - (ls.until - now) / dur));
    const span = L.spinSpan || 1.1;
    ls.a = ls.aStart + ls.spin * Math.sin(t * Math.PI) * span;
    if (now < (ls.nextTick || 0)) continue;
    ls.nextTick = now + (L.tickMs || 100);
    const x2 = ls.x + Math.cos(ls.a) * ls.len;
    const y2 = ls.y + Math.sin(ls.a) * ls.len;
    const wHalf = L.width || 12;
    for (const p of world.players) {
      if (!p.alive || p.out) continue;
      if (pointToSegDist(p.x, p.y, ls.x, ls.y, x2, y2) <= B.ship.radius * 0.85 + wHalf) {
        shipHit(world, p, now);
      }
    }
    for (const a of world.asteroids) {
      if (a.dead) continue;
      if (pointToSegDist(a.x, a.y, ls.x, ls.y, x2, y2) <= a.r + wHalf) {
        a.hp -= (L.dps || 26) * ((L.tickMs || 100) / 1000);
        if (a.hp <= 0) destroyAsteroid(world, a, null);
      }
    }
  }
  world.bossLasers = world.bossLasers.filter((l) => !l.dead);
}

// боссы расталкивают астероиды и кометы
function pushAsteroidsByBosses(world, dt) {
  for (const b of world.bosses) {
    if (b.dead) continue;
    const def = bossDef(b.key);
    for (const a of world.asteroids) {
      if (a.dead) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.r + def.radius;
      if (dist >= minDist || dist < 0.001) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      // сдвигаем за пределы хитбокса босса
      a.x += nx * (overlap + 4);
      a.y += ny * (overlap + 4);
      // разлетаются в сторону от босса
      const push = 180 + overlap * 12;
      a.vx = nx * push;
      a.vy = ny * push;
    }
  }
}

// --- лазеры и мины ---
function pointToSegDist(px,py, x1,y1,x2,y2){
  const vx=x2-x1, vy=y2-y1, wx=px-x1, wy=py-y1;
  const c1 = vx*wx+vy*wy; if(c1<=0) return Math.hypot(px-x1,py-y1);
  const c2=vx*vx+vy*vy; if(c2<=c1) return Math.hypot(px-x2,py-y2);
  const t=c1/c2; const bx=x1+vx*t, by=y1+vy*t; return Math.hypot(px-bx,py-by);
}
function detonateMine(world, mine, owner){
  if(mine.dead) return; mine.dead=true;
  const M=B.abilities.mines;
  addFx(world,'boom', mine.x,mine.y, 2.2);
  const R=M.blastRadius; const CR=M.chainRadius;
  // собрать цели в R и цепи
  const hitAsteroids=[];
  for(const a of world.asteroids){ if(a.dead) continue; if(Math.hypot(a.x-mine.x,a.y-mine.y) <= R + a.r*0.5){ hitAsteroids.push(a); }}
  const hitEnemies=[];
  for(const e of world.enemies){ if(e.dead) continue; if(Math.hypot(e.x-mine.x,e.y-mine.y)<=R){ hitEnemies.push(e); }}
  const hitBosses=[];
  for(const b of world.bosses){ if(b.dead) continue; if(Math.hypot(b.x-mine.x,b.y-mine.y)<= R + B.bosses.types[b.key].radius*0.6){ hitBosses.push(b); }}
  // цепь: если попали — взрываем ближайших до maxChain в CR
  let primaries = hitAsteroids.length+hitEnemies.length+hitBosses.length;
  if(primaries>0){
    // собрать кандидатов вокруг точки взрыва
    const candidates=[];
    for(const a of world.asteroids){ if(a.dead||hitAsteroids.includes(a)) continue; const d=Math.hypot(a.x-mine.x,a.y-mine.y); if(d<=CR + a.r) candidates.push({obj:a, kind:'a', d}); }
    for(const e of world.enemies){ if(e.dead||hitEnemies.includes(e)) continue; const d=Math.hypot(e.x-mine.x,e.y-mine.y); if(d<=CR) candidates.push({obj:e, kind:'e', d}); }
    for(const b of world.bosses){ if(b.dead||hitBosses.includes(b)) continue; const d=Math.hypot(b.x-mine.x,b.y-mine.y); if(d<=CR) candidates.push({obj:b, kind:'b', d}); }
    candidates.sort((u,v)=>u.d-v.d);
    for(let i=0;i<Math.min(M.maxChain, candidates.length);i++){
      const c=candidates[i]; if(c.kind==='a') hitAsteroids.push(c.obj); else if(c.kind==='e') hitEnemies.push(c.obj); else hitBosses.push(c.obj);
    }
  }
  for(const a of hitAsteroids){ a.hp -= M.blastDamage; if(a.hp<=0) destroyAsteroid(world,a,owner); else addFx(world,'hit',a.x,a.y,1); }
  for(const e of hitEnemies){ damageEnemy(world, e, M.blastDamage, owner); }
  for(const b of hitBosses){ damageBoss(world, b, M.blastDamage, owner); }
}

function updateMines(world, dt, now){
  for(const m of world.mines){
    if(world.t - m.born < B.abilities.mines.armMs) continue;
    let tripped=false;
    for(const a of world.asteroids){ if(Math.hypot(a.x-m.x,a.y-m.y) <= B.abilities.mines.blastRadius*0.55 + a.r*0.5){ tripped=true; break; } }
    if(!tripped) for(const e of world.enemies){ if(Math.hypot(e.x-m.x,e.y-m.y) <= B.abilities.mines.blastRadius*0.45){ tripped=true; break; } }
    if(!tripped) for(const b of world.bosses){ if(Math.hypot(b.x-m.x,b.y-m.y) <= B.abilities.mines.blastRadius*0.55){ tripped=true; break; } }
    if(tripped){
      const owner = world.players.find(p=>p.id===m.owner)||null;
      detonateMine(world,m,owner);
    }
    if(now - m.born > B.mine.lifeMs) m.dead=true;
  }
  world.mines = world.mines.filter(m=>!m.dead);
}

function updateLasers(world, dt, now){
  for(const ls of world.lasers){
    if(now >= ls.until){ ls.dead=true; continue; }
    const p = world.players.find(pl=>pl.id===ls.owner);
    if(!p||!p.alive){ ls.dead=true; continue; }
    // лазер следует за кораблём
    const W=B.world.width, H=B.world.height;
    const len = Math.hypot(W,H) + 120;
    const x2 = p.x + Math.cos(p.a)*len;
    const y2 = p.y + Math.sin(p.a)*len;
    const x1b = p.x + Math.cos(p.a+Math.PI)*len;
    const y1b = p.y + Math.sin(p.a+Math.PI)*len;
    ls.x = p.x; ls.y = p.y; ls.a = p.a;
    if(now < (ls.nextTick||0)) continue;
    ls.nextTick = now + B.abilities.laser.tickMs;
    const ownerP = p;
    const wHalf = B.abilities.laser.width;
    const checkLine=(x1,y1,x2a,y2a)=>{
      for(const a of world.asteroids){ if(a.dead) continue; if(pointToSegDist(a.x,a.y,x1,y1,x2a,y2a) <= a.r + wHalf){ a.hp -= B.abilities.laser.dps * (B.abilities.laser.tickMs/1000); if(a.hp<=0) destroyAsteroid(world,a,ownerP); }}
      for(const e of world.enemies){ if(e.dead) continue; if(pointToSegDist(e.x,e.y,x1,y1,x2a,y2a) <= (e.r||B.enemies.radius) + wHalf){ damageEnemy(world, e, B.abilities.laser.dps * (B.abilities.laser.tickMs/1000), ownerP); }}
      for(const b of world.bosses){ if(b.dead) continue; const r=B.bosses.types[b.key].radius; if(pointToSegDist(b.x,b.y,x1,y1,x2a,y2a) <= r + wHalf){ damageBoss(world, b, B.abilities.laser.dps * (B.abilities.laser.tickMs/1000), ownerP); }}
    };
    checkLine(p.x,p.y,x2,y2);
    checkLine(p.x,p.y,x1b,y1b);
  }
  world.lasers = world.lasers.filter(l=>!l.dead);
}

function updateCrystals(world, dt, now){
  const C=B.crystals;
  const damp=Math.exp(-C.driftDamping*dt);
  for(const cr of world.crystals){
    cr.vx*=damp; cr.vy*=damp;
    let target=null, best=C.magnetRadius;
    for(const p of world.players){ if(!p.alive||p.out) continue; const d=Math.hypot(p.x-cr.x,p.y-cr.y); if(d<best){best=d; target=p;}}
    if(target){
      const d=Math.max(best,1);
      cr.vx += ((target.x-cr.x)/d)*420*dt;
      cr.vy += ((target.y-cr.y)/d)*420*dt;
    }
    cr.x += cr.vx*dt; cr.y += cr.vy*dt;
    cr.x=Math.max(C.radius, Math.min(B.world.width-C.radius, cr.x));
    cr.y=Math.max(C.radius, Math.min(B.world.height-C.radius, cr.y));
    if(target && Math.hypot(target.x-cr.x,target.y-cr.y) < C.pickupRadius){
      cr.dead=true;
      if(cr.kind==='coins'){
        target.coins += C.coinValue;
        target.score += C.coinValue;
        addFx(world,'coin', cr.x, cr.y, 2);
      } else {
        const ok = grantAbility(world,target,cr.ability);
        if(!ok){ target.coins += 500; target.score += 500; addFx(world,'coin',cr.x,cr.y,1); }
      }
    } else if(now - cr.born > C.lifeMs) cr.dead=true;
  }
  world.crystals = world.crystals.filter(c=>!c.dead);
}

// --- самонаводящиеся ракеты ---

function detonateMissile(world, k, small = false) {
  if (k.dead) return;
  k.dead = true;
  const M = B.missile;
  addFx(world, 'boom', k.x, k.y, small ? 1.4 : 2.4);
  const R = small ? M.blastRadius * 0.4 : M.blastRadius;
  const owner = world.players.find((p) => p.id === k.owner) || null;
  // урон зависит от уровня модуля «Ракеты» (Б1)
  const dmg = small ? 2 : ((owner && owner.missileBlastDamage) || M.blastDamage);
  // урон получают только астероиды, кометы и враги — игроков не задевает
  for (const a of world.asteroids) {
    if (a.dead) continue;
    if (Math.hypot(a.x - k.x, a.y - k.y) <= R + a.r * 0.5) {
      a.hp -= dmg;
      if (a.hp <= 0) destroyAsteroid(world, a, owner);
    }
  }
  for (const en of world.enemies) {
    if (en.dead) continue;
    if (Math.hypot(en.x - k.x, en.y - k.y) <= R) {
      damageEnemy(world, en, dmg, owner);
    }
  }
  for (const boss of world.bosses) {
    if (boss.dead) continue;
    const def = B.bosses.types[boss.key];
    if (Math.hypot(boss.x - k.x, boss.y - k.y) <= R + def.radius*0.35) {
      damageBoss(world, boss, dmg, owner);
    }
  }
}

function updateMissiles(world, dt, now) {
  const M = B.missile;
  for (const k of world.missiles) {
    // ближайшая цель — астероид или враг (враги чуть приоритетнее)
    let best = null;
    let bd = Infinity;
    for (const en of world.enemies) {
      const d = Math.hypot(en.x - k.x, en.y - k.y) * 0.7;
      if (d < bd) { bd = d; best = en; }
    }
    for (const a of world.asteroids) {
      const d = Math.hypot(a.x - k.x, a.y - k.y);
      if (d < bd) { bd = d; best = a; }
    }
    if (best) {
      const want = Math.atan2(best.y - k.y, best.x - k.x);
      let da = (want - k.a) % (Math.PI * 2);
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      const turn = M.turnRate * dt;
      k.a += Math.max(-turn, Math.min(turn, da));
      const rr = (best.type != null ? best.r : B.enemies.radius) + 16;
      if (bd < rr) {
        detonateMissile(world, k);
        continue;
      }
    }
    k.spd = Math.min(k.spd + M.accel * dt, M.maxSpeed);
    k.x += Math.cos(k.a) * k.spd * dt;
    k.y += Math.sin(k.a) * k.spd * dt;
    if (now - k.born > M.lifeMs) detonateMissile(world, k, true);
  }
  world.missiles = world.missiles.filter((k) => !k.dead);
}

export function stepWorld(world, dtSec, inputs) {
  if (world.status !== 'running') return;
  const dt = Math.min(Math.max(dtSec, 0), 0.05); // защита от скачков времени
  world.t += dt * 1000;
  const now = world.t;
  const w = B.world.width;
  const h = B.world.height;
  const S = B.ship;

  // --- корабли ---
  for (const p of world.players) {
    if (p.out) continue;
    if (!p.alive) {
      if (p.lives > 0 && now >= p.respawnAt) respawnShip(world, p);
      else continue;
    }
    const inp = inputs[p.id] || EMPTY_INPUT;
    let mx = Number.isFinite(inp.mx) ? Math.max(-1, Math.min(1, inp.mx)) : 0;
    let my = Number.isFinite(inp.my) ? Math.max(-1, Math.min(1, inp.my)) : 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    p.vx += mx * S.accel * dt;
    p.vy += my * S.accel * dt;
    const damp = Math.exp(-S.friction * dt);
    p.vx *= damp;
    p.vy *= damp;
    const sp = Math.hypot(p.vx, p.vy);
    // карточка «Скорость» (А3): бонус к максимальной скорости умножается поверх базы;
    // Ангар (Б2): базовая характеристика «Скорость» — тоже поверх базы
    const maxSp = S.maxSpeed * (1 + (p.speedBonus || 0) + (p.hg && p.hg.speed || 0));
    if (sp > maxSp) { p.vx *= maxSp / sp; p.vy *= maxSp / sp; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const R = S.radius;
    if (p.x < R) { p.x = R; p.vx *= -0.4; }
    if (p.x > w - R) { p.x = w - R; p.vx *= -0.4; }
    if (p.y < R) { p.y = R; p.vy *= -0.4; }
    if (p.y > h - R) { p.y = h - R; p.vy *= -0.4; }

    if (Number.isFinite(inp.aim)) p.a = inp.aim;
    p.thrust = len > 0.15;

    if (inp.shoot && now >= p.cooldownAt) {
      p.cooldownAt = now + fireCooldownMs(p, now);
      spawnBullet(world, p);
    }

    // пуск самонаводящейся ракеты (ПКМ / F) — только при активном модуле «Ракеты»
    if (inp.mis && now >= p.missileCdAt && p.hasMissiles && p.missiles > 0) {
      p.missileCdAt = now + B.missile.fireCooldownMs;
      p.missiles--;
      world.missiles.push({
        id: world.nextMissileId++,
        x: p.x + Math.cos(p.a) * (S.radius + 8),
        y: p.y + Math.sin(p.a) * (S.radius + 8),
        a: p.a,
        spd: 150,
        owner: p.id,
        born: world.t,
      });
      addFx(world, 'shoot', p.x + Math.cos(p.a) * S.radius, p.y + Math.sin(p.a) * S.radius, 1);
    }

    // лазер: Q — тратит 1 заряд из запаса (Б3: одноразовые заряды)
    if (inp.laser && p.hasLaser && p.laserCharges > 0 && now >= (p.laserCdUntil||0) && now >= (p.laserActiveUntil||0)) {
      p.laserCharges--;
      p.laserActiveUntil = now + B.abilities.laser.durationMs;
      p.laserCdUntil = now + B.abilities.laser.cooldownMs;
      p.laserTickAt = now;
      world.lasers.push({ id: world.nextLaserId++, owner: p.id, x:p.x, y:p.y, a:p.a, until: p.laserActiveUntil, nextTick: now });
      addFx(world, 'laser', p.x, p.y, 2);
    }
    // мины: E — запас одноразовых зарядов, пополняется дропом с врагов
    if (p.hasMines) {
      if (inp.mine && p.mineStock > 0 && now >= (p.mineCdUntil||0)) {
        world.mines.push({ id: world.nextMineId++, owner: p.id, x: p.x, y: p.y, vx:0, vy:0, born: world.t });
        p.mineStock--;
        p.mineCdUntil = now + B.abilities.mines.cooldownMs;
        addFx(world, 'mine', p.x, p.y, 1);
      }
    }
  }

  // --- пули ---
  const bm = 30; // запас за краем
  for (const b of world.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  world.bullets = world.bullets.filter(
    (b) => now - b.born < B.bullet.lifeMs &&
      b.x > -bm && b.x < w + bm && b.y > -bm && b.y < h + bm
  );

  // --- астероиды и кометы ---
  for (const a of world.asteroids) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.rot += a.rotSpeed * dt;
    if (a.sat) {
      a.sat.ang += a.sat.speed * dt;
      a.sat.rot += a.sat.rotSpeed * dt;
    }
    if (a.type === 'comet') {
      // комета летит насквозь и удаляется, вылетев за поле
      const m = a.r + 60;
      if (!a.entered && a.x > -10 && a.x < w + 10 && a.y > -10 && a.y < h + 10) {
        a.entered = true;
      }
      if (a.entered &&
        (a.x < -m || a.x > w + m || a.y < -m || a.y > h + m)) {
        a.dead = true;
      }
    } else {
      a.x = wrap(a.x, w, a.r + 10);
      a.y = wrap(a.y, h, a.r + 10);
    }
  }

  // --- отсроченные кометы: стрелка-предупреждение показана, теперь реальный спавн ---
  for (let i = world.pendingComets.length - 1; i >= 0; i--) {
    const pc = world.pendingComets[i];
    if (now >= pc.at) {
      for (const c of pc.plan) makeComet(world, c.x, c.y, c.vx, c.vy, c.r);
      world.pendingComets.splice(i, 1);
    }
  }

  // --- В2: отсроченные боссы: значки-предупреждение показаны, теперь реальный вход ---
  for (let i = world.pendingBosses.length - 1; i >= 0; i--) {
    const pb = world.pendingBosses[i];
    if (now >= pb.at) {
      enterBoss(world, pb);
      world.pendingBosses.splice(i, 1);
    }
  }

  // --- столкновения: пули (игроков и врагов) × астероиды и кометы ---
  for (const b of world.bullets) {
    if (b.dead) continue;
    for (const a of world.asteroids) {
      if (a.dead) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const rr = a.r + B.bullet.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        const owner = b.enemy ? null : (world.players.find((p) => p.id === b.owner) || null);
        a.hp -= owner ? bulletDamage(owner) : 1;
        b.dead = true;
        if (a.hp <= 0) destroyAsteroid(world, a, owner);
        else addFx(world, 'hit', b.x, b.y, 1);
        break;
      }
    }
  }
  world.bullets = world.bullets.filter((b) => !b.dead);
  world.asteroids = world.asteroids.filter((a) => !a.dead);

  // --- столкновения: пули игроков × враги ---
  for (const b of world.bullets) {
    if (b.dead || b.enemy) continue;
    for (const e of world.enemies) {
      if (e.dead) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const rr = (e.r || B.enemies.radius) + B.bullet.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        const owner = world.players.find((p) => p.id === b.owner) || null;
        const dmg = owner ? bulletDamage(owner) : 1;
        b.dead = true;
        damageEnemy(world, e, dmg, owner);
        break;
      }
    }
  }
  world.enemies = world.enemies.filter((e) => !e.dead);

  // --- столкновения: простые противники × астероиды и кометы ---
  // Орбитальный (В4) ломает метеориты на пути и сам не гибнет; остальные гибнут.
  for (const e of world.enemies) {
    if (e.dead) continue;
    for (const a of world.asteroids) {
      if (a.dead) continue;
      const dx = a.x - e.x;
      const dy = a.y - e.y;
      const rr = a.r + (e.r || B.enemies.radius);
      if (dx * dx + dy * dy <= rr * rr) {
        if (e.kind === 'orbital') {
          destroyAsteroid(world, a, null);
        } else {
          killEnemy(world, e, null);
        }
        break;
      }
    }
  }
  world.enemies = world.enemies.filter((e) => !e.dead);
  world.asteroids = world.asteroids.filter((a) => !a.dead);

  // --- столкновения: пули игроков × боссы ---
  for (const b of world.bullets) {
    if (b.dead || b.enemy) continue;
    for (const boss of world.bosses) {
      if (boss.dead) continue;
      const def = B.bosses.types[boss.key];
      const dx = boss.x - b.x;
      const dy = boss.y - b.y;
      const rr = (boss.r || def.radius) + B.bullet.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        const owner = world.players.find((p) => p.id === b.owner) || null;
        b.dead = true;
        damageBoss(world, boss, owner ? bulletDamage(owner) : 1, owner);
        break;
      }
    }
  }
  world.bosses = world.bosses.filter((boss) => !boss.dead);
  world.bullets = world.bullets.filter((b) => !b.dead);

  // --- столкновения: пули × ракеты (пуля сбивает ракету, кроме своих) ---
  for (const b of world.bullets) {
    if (b.dead) continue;
    for (const k of world.missiles) {
      if (k.dead) continue;
      if (!b.enemy && b.owner === k.owner) continue; // свои пули не сбивают свою ракету
      const dx = k.x - b.x;
      const dy = k.y - b.y;
      const rr = B.missile.radius + B.bullet.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        b.dead = true;
        detonateMissile(world, k); // подбитая ракета взрывается там, где была
        break;
      }
    }
  }
  world.missiles = world.missiles.filter((k) => !k.dead);
  world.bullets = world.bullets.filter((b) => !b.dead);

  // --- столкновения: корабли × всё опасное ---
  for (const p of world.players) {
    if (!p.alive || p.out || now < p.invulnUntil) continue;
    let hit = false;
    for (const a of world.asteroids) {
      const dx = a.x - p.x;
      const dy = a.y - p.y;
      const rr = a.r + S.radius * 0.85; // чуть щадящий хитбокс
      if (dx * dx + dy * dy <= rr * rr) { hit = true; break; }
    }
    if (!hit) {
      for (const b of world.bullets) {
        if (!b.enemy || b.dead) continue;
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const rr = S.radius * 0.9 + B.bullet.radius;
        if (dx * dx + dy * dy <= rr * rr) { b.dead = true; hit = true; break; }
      }
    }
    if (!hit) {
      for (const e of world.enemies) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const rr = e.r == undefined ? B.enemies.radius + S.radius * 0.85 : e.r + S.radius * 0.85;
        if (dx * dx + dy * dy <= rr * rr) { hit = true; break; }
      }
    }
    if (!hit) {
      for (const boss of world.bosses) {
        const def = B.bosses.types[boss.key];
        const dx = boss.x - p.x;
        const dy = boss.y - p.y;
        const rr = (boss.r || def.radius) + S.radius * 0.85;
        if (dx * dx + dy * dy <= rr * rr) { hit = true; break; }
      }
    }
    if (hit) shipHit(world, p, now);
  }

  // --- монеты ---
  const C = B.coin;
  const coinDamp = Math.exp(-C.driftDamping * dt);
  for (const c of world.coins) {
    c.vx *= coinDamp;
    c.vy *= coinDamp;
    // магнит к ближайшему живому игроку (в пределах игрок.радиуса;
    // Ангар (Б2): базовая характеристика «Магнит» расширяет радиус)
    let pull = null;
    let pullD = Infinity;
    for (const p of world.players) {
      if (!p.alive || p.out) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      const radius = C.magnetRadius * (1 + (p.hg && p.hg.magnet || 0));
      if (d < radius && d < pullD) { pullD = d; pull = p; }
    }
    // голодные враги-сборщики (В4) перетягивают монету, если они ближе игрока
    for (const e of world.enemies) {
      if (e.dead) continue;
      const st = enemyStats(e.kind);
      const wants = e.kind === 'armored' ? e.armor < e.maxArmor
        : e.kind === 'burst' ? e.powLvl < st.powMax : false;
      if (!wants) continue;
      const d = Math.hypot(e.x - c.x, e.y - c.y);
      if (d <= st.coinMagnetR && d < pullD) { pullD = d; pull = e; }
    }
    // В3: дредноут тянет монеты, пока броня повреждена (варианты +/++ тоже)
    for (const boss of world.bosses) {
      if (boss.dead || bossBaseKey(boss.key) !== 'dreadnought' || boss.armor >= boss.maxArmor) continue;
      const m = B.bosses.types[boss.key].coinMagnetR || B.bosses.types.dreadnought.coinMagnetR || 200;
      const d = Math.hypot(boss.x - c.x, boss.y - c.y);
      if (d <= m && d < pullD) { pullD = d; pull = boss; }
    }
    if (pull) {
      const d = Math.max(pullD, 1);
      c.vx += ((pull.x - c.x) / d) * C.magnetPull * dt;
      c.vy += ((pull.y - c.y) / d) * C.magnetPull * dt;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.x = Math.max(C.radius, Math.min(w - C.radius, c.x));
    c.y = Math.max(C.radius, Math.min(h - C.radius, c.y));

    // подбор: игрок в приоритете при одновременном касании
    let grabbed = null;
    for (const p of world.players) {
      if (!p.alive || p.out) continue;
      if (Math.hypot(p.x - c.x, p.y - c.y) < C.pickupRadius) { grabbed = p; break; }
    }
    if (!grabbed && pull) {
      const bdef = pull.kind ? enemyStats(pull.kind).coinPickupR : (bossBaseKey(pull.key) === 'dreadnought' ? (B.bosses.types[pull.key].coinPickupR || B.bosses.types.dreadnought.coinPickupR || 42) : 0);
      if (bdef && Math.hypot(pull.x - c.x, pull.y - c.y) < bdef) grabbed = pull;
    }
    if (grabbed) {
      c.dead = true;
      if (grabbed.kind === 'armored') {
        // бронированный: 1 монета → +10% брони
        grabbed.armor = Math.min(grabbed.maxArmor, grabbed.armor + grabbed.maxArmor * enemyStats(grabbed.kind).armorPerCoin);
        addFx(world, 'coin', c.x, c.y, 1);
      } else if (grabbed.kind === 'burst') {
        // очередной стрелок: 1 монета → сильнее очередь
        grabbed.powLvl = Math.min(enemyStats(grabbed.kind).powMax, grabbed.powLvl + 1);
        addFx(world, 'coin', c.x, c.y, 1);
      } else if (bossBaseKey(grabbed.key) === 'dreadnought') {
        // В3: дредноут подбирает монету → +armorPerCoin% макс. брони
        const adef = B.bosses.types[grabbed.key] || {};
        const perCoin = adef.armorPerCoin || B.bosses.types.dreadnought.armorPerCoin || 0.08;
        grabbed.armor = Math.min(grabbed.maxArmor, grabbed.armor + grabbed.maxArmor * perCoin);
        addFx(world, 'coin', c.x, c.y, 1);
      } else {
        grabbed.coins++;
        grabbed.score += C.scorePerCoin;
        addFx(world, 'coin', c.x, c.y, 1);
      }
    } else if (now - c.born > C.lifeMs) {
      c.dead = true;
    }
  }
  world.coins = world.coins.filter((c) => !c.dead);

  // --- энергетические сферы (экспа) — те же монеты, но дают energy ---
  const EN = B.energy;
  const enDamp = Math.exp(-EN.driftDamping * dt);
  for (const s of world.energySpheres) {
    s.vx *= enDamp;
    s.vy *= enDamp;
    // магнит: притяжение к ближайшему живому кораблю (радиус зависит от бонуса карточки)
    let target = null;
    let bestD = Infinity;
    for (const p of world.players) {
      if (!p.alive || p.out) continue;
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      const radius = EN.magnetRadius * (1 + (p.energyMagnetBonus || 0) + (p.hg && p.hg.magnet || 0));
      if (d < radius && d < bestD) { bestD = d; target = p; }
    }
    if (target) {
      const d = Math.max(bestD, 1);
      s.vx += ((target.x - s.x) / d) * EN.magnetPull * dt;
      s.vy += ((target.y - s.y) / d) * EN.magnetPull * dt;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.x = Math.max(EN.radius, Math.min(w - EN.radius, s.x));
    s.y = Math.max(EN.radius, Math.min(h - EN.radius, s.y));

    if (target && Math.hypot(target.x - s.x, target.y - s.y) < EN.pickupRadius) {
      s.dead = true;
      target.energy++;
      target.exp++;
      addFx(world, 'energy', s.x, s.y, 1);
      // А3: энергия — прогресс уровня; при достижении порога — уровень ↑ + карточки
      if (!world.pendingCards[target.id] && target.energy >= expThreshold(target.level)) {
        target.level++;
        world.pendingCards[target.id] = pickRandomCards(world.rng, target, 3);
        addFx(world, 'levelup', target.x, target.y, 2);
      }
    } else if (now - s.born > EN.lifeMs) {
      s.dead = true;
    }
  }
  world.energySpheres = world.energySpheres.filter((s) => !s.dead);

  // --- патроны для ракет (дроп с врагов/боссов, магнит к кораблю с модулем) ---
  {
    const MP = B.missile;
    const mpDamp = Math.exp(-1.6 * dt);
    for (const pk of world.missilePacks) {
      pk.vx *= mpDamp;
      pk.vy *= mpDamp;
      let target = null;
      let bestD = MP.packMagnetRadius;
      for (const p of world.players) {
        if (!p.alive || p.out) continue;
        if (!p.hasMissiles || p.missiles >= (p.missileMaxAmmo || MP.maxAmmo)) continue;
        const d = Math.hypot(p.x - pk.x, p.y - pk.y);
        if (d < bestD) { bestD = d; target = p; }
      }
      if (target) {
        const d = Math.max(bestD, 1);
        pk.vx += ((target.x - pk.x) / d) * MP.packMagnetPull * dt;
        pk.vy += ((target.y - pk.y) / d) * MP.packMagnetPull * dt;
      }
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      pk.x = Math.max(MP.packRadius, Math.min(w - MP.packRadius, pk.x));
      pk.y = Math.max(MP.packRadius, Math.min(h - MP.packRadius, pk.y));
      if (target && Math.hypot(target.x - pk.x, target.y - pk.y) < MP.packPickupRadius) {
        pk.dead = true;
        target.missiles = Math.min(target.missileMaxAmmo || MP.maxAmmo, target.missiles + MP.pack);
        addFx(world, 'upgrade', pk.x, pk.y, 1);
      } else if (now - pk.born > MP.packLifeMs) {
        pk.dead = true;
      }
    }
    world.missilePacks = world.missilePacks.filter((p) => !p.dead);
  }

  // --- заряды способностей (броня/лазер/мины) — магнит к кораблю с разблокированной способностью ---
  {
    const AP = B.abilityPack;
    const apDamp = Math.exp(-AP.driftDamping * dt);
    for (const pk of world.abilityPacks) {
      pk.vx *= apDamp;
      pk.vy *= apDamp;
      let target = null;
      let bestD = AP.magnetRadius;
      for (const p of world.players) {
        if (!p.alive || p.out) continue;
        const has = pk.kind === 'armor' ? p.hasArmor : pk.kind === 'laser' ? p.hasLaser : p.hasMines;
        if (!has) continue;
        const A = B.abilities[pk.kind];
        const cur = pk.kind === 'armor' ? p.armorCharges : pk.kind === 'laser' ? p.laserCharges : p.mineStock;
        const max = pk.kind === 'armor' ? A.maxCharges : pk.kind === 'laser' ? A.maxCharges : A.maxStock;
        if (cur >= max) continue;
        const d = Math.hypot(p.x - pk.x, p.y - pk.y);
        if (d < bestD) { bestD = d; target = p; }
      }
      if (target) {
        const d = Math.max(bestD, 1);
        pk.vx += ((target.x - pk.x) / d) * AP.magnetPull * dt;
        pk.vy += ((target.y - pk.y) / d) * AP.magnetPull * dt;
      }
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      pk.x = Math.max(AP.radius, Math.min(w - AP.radius, pk.x));
      pk.y = Math.max(AP.radius, Math.min(h - AP.radius, pk.y));
      if (target && Math.hypot(target.x - pk.x, target.y - pk.y) < AP.pickupRadius) {
        pk.dead = true;
        const A = B.abilities[pk.kind];
        if (pk.kind === 'armor') {
          target.armorCharges = Math.min(A.maxCharges, target.armorCharges + A.dropPack);
        } else if (pk.kind === 'laser') {
          target.laserCharges = Math.min(A.maxCharges, target.laserCharges + A.dropPack);
        } else {
          target.mineStock = Math.min(A.maxStock, target.mineStock + A.dropPack);
        }
        addFx(world, 'upgrade', pk.x, pk.y, 1);
      } else if (now - pk.born > AP.lifeMs) {
        pk.dead = true;
      }
    }
    world.abilityPacks = world.abilityPacks.filter((p) => !p.dead);
  }

  // --- powerups (щит/ускорение с комет/врагов) ---
  {
    const PU = B.powerups;
    const puDamp = Math.exp(-PU.driftDamping * dt);
    for (const u of world.powerups) {
      u.vx *= puDamp; u.vy *= puDamp;
      let target=null; let bestD=PU.magnetRadius;
      for (const p of world.players){ if(!p.alive||p.out) continue; const d=Math.hypot(p.x-u.x,p.y-u.y); if(d<bestD){bestD=d; target=p;}}
      if (target){ const d=Math.max(bestD,1); u.vx+=((target.x-u.x)/d)*PU.magnetPull*dt; u.vy+=((target.y-u.y)/d)*PU.magnetPull*dt; }
      u.x+=u.vx*dt; u.y+=u.vy*dt;
      u.x=Math.max(PU.radius, Math.min(w-PU.radius, u.x));
      u.y=Math.max(PU.radius, Math.min(h-PU.radius, u.y));
      if (target && Math.hypot(target.x-u.x, target.y-u.y) < PU.pickupRadius){
        u.dead=true;
        const def=PU.types[u.tp];
        if(u.tp==='rapidFire') target.rapidFireUntil=Math.max(target.rapidFireUntil, now+def.durationMs);
        else if(u.tp==='shield') target.shieldUntil=Math.max(target.shieldUntil, now+def.durationMs);
        addFx(world,'powerup',u.x,u.y,1);
      } else if(now-u.born > PU.lifeMs) u.dead=true;
    }
    world.powerups = world.powerups.filter(u=>!u.dead);
  }

  // --- враги, боссы, ракеты, способности ---
  updateEnemies(world, dt, now);
  updateBosses(world, dt, now);
  updateBossLasers(world, dt, now);
  pushAsteroidsByBosses(world, dt);
  updateMissiles(world, dt, now);
  updateMines(world, dt, now);
  updateLasers(world, dt, now);
  updateCrystals(world, dt, now);
  // уничтоженное здесь же убираем из мира, чтобы не попало в снапшот
  world.enemies = world.enemies.filter((e) => !e.dead);
  world.bosses = world.bosses.filter((b) => !b.dead);
  world.missiles = world.missiles.filter((k) => !k.dead);
  world.asteroids = world.asteroids.filter((a) => !a.dead);
  world.mines = world.mines.filter((m) => !m.dead);
  world.crystals = world.crystals.filter((c) => !c.dead);
  world.energySpheres = world.energySpheres.filter((s) => !s.dead);
  world.missilePacks = world.missilePacks.filter((p) => !p.dead);
  world.abilityPacks = world.abilityPacks.filter((p) => !p.dead);
  world.lasers = world.lasers.filter((l) => !l.dead);
  world.bossLasers = world.bossLasers.filter((l) => !l.dead);

  // --- эффекты: удаляем старше 600 мс ---
  world.fx = world.fx.filter((f) => now - f.bornAt < 600);

  // --- волны противников (состав, время, частота, кол-во, охлаждение) ---
  {
    const WA = B.waves;
    const list = WA.list || [];
    const K = B.enemyKinds || {};
    if (list.length) {
      const idx = Math.min(world.waveIndex, list.length - 1);
      const wave = list[idx];
      const spawning = world.wavePhase === 'spawning' || world.wavePhase === 'awaitBoss';
      if (spawning) world.waveTimer -= dt * 1000; // в awaitBoss таймер уже 0 — стоим на месте

      if (spawning) {
        // частота появления: по каждому виду спавним по таймеру,
        // пока не исчерпан лимит вида за волну или потолок на арене
        for (const entry of (wave.spawns || [])) {
          const kind = entry.kind;
          const handler = SPAWNERS[kind];
          if (!handler) continue;
          const def = K[kind] || {};
          const cfg = Object.assign({}, def, entry);
          const chance = cfg.spawnChance != null ? cfg.spawnChance : 1; // шанс спавна вида за волну
          let st = world.waveSpawns[kind] || (world.waveSpawns[kind] = { timer: 500, spawned: 0 });
          st.timer -= dt * 1000;
          if (st.spawned < cfg.count && st.timer <= 0) {
            if (handler.countAlive(world) < cfg.max && (chance >= 1 || world.rng() < chance)) {
              handler.spawn(world, cfg);
              st.spawned++;
            }
            st.timer += cfg.intervalMs * rand(world.rng, 0.75, 1.25);
          }
        }
        // конец спавна волны: по времени — либо, если жив босс этой волны,
        // переходим в ожидание (волна держится, спавн её состава продолжается)
        if (world.wavePhase === 'spawning' && world.waveTimer <= 0) {
          if (waveBossAlive(world)) {
            world.wavePhase = 'awaitBoss';
          } else {
            world.wavePhase = 'cooldown';
            world.waveTimer = wave.cooldownMs;
          }
        }
        // босс побеждён — ждать больше нечего, отсчёт охлаждения с начала
        if (world.wavePhase === 'awaitBoss' && !waveBossAlive(world)) {
          world.wavePhase = 'cooldown';
          world.waveTimer = wave.cooldownMs;
        }
      } else { // cooldown — период охлаждения после волны
        world.waveTimer -= dt * 1000;
        if (world.waveTimer <= 0) {
          if (world.waveIndex < list.length - 1) world.waveIndex++;
          startWave(world, list[Math.min(world.waveIndex, list.length - 1)]);
        }
      }
    }
  }

  // --- туманность после двух боссов — фиолетовый фон + спутники ---
  if (!world.nebulaActive && world.bossesFought >= 2) {
    world.nebulaActive = true;
    addFx(world, 'nebula', w/2, h/2, 3);
    // дооснастить существующие астероиды спутниками
    for (const a of world.asteroids) {
      if (!a.sat && a.type !== 'comet' && world.rng() < B.nebula.satelliteChance) {
        const N = B.nebula;
        a.sat = {
          ang: rand(world.rng,0,Math.PI*2),
          dist: rand(world.rng,N.satelliteDistMin,N.satelliteDistMax)+a.r*0.35,
          r: Math.max(5, a.r*N.satelliteSizeFactor*rand(world.rng,0.8,1.15)),
          rot: rand(world.rng,0,Math.PI*2),
          rotSpeed: rand(world.rng,-2,2),
          speed: rand(world.rng,N.orbitSpeedMin,N.orbitSpeedMax)*(world.rng()<0.5?1:-1),
          seed: randInt(world.rng,1,1e9),
        };
      }
    }
  }

  // --- конец матча ---
  const everyoneOut = world.players.every((p) => p.out);
  let timeUp = false;
  if (world.durationMs != null) {
    world.timeLeftMs = Math.max(0, world.durationMs - world.t);
    if (world.timeLeftMs <= 0) timeUp = true;
  }
  if (everyoneOut || timeUp) world.status = 'over';
}

// Компактный снимок состояния для сети/рендера
export function snapshotOf(world) {
  return {
    gm: world.godMode ? 1 : 0,
    nb: world.nebulaActive ? 1 : 0,
    st: world.status,
    t: Math.round(world.t),
    tl: world.timeLeftMs == null ? null : Math.round(world.timeLeftMs),
    ps: world.players.map((p) => ({
      i: p.id,
      n: p.nick,
      sl: p.slot,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      a: Math.round(p.a * 100) / 100,
      al: p.alive ? 1 : 0,
      o: p.out ? 1 : 0,
      l: p.lives,
      c: p.coins,
      e: p.energy,
      s: p.score,
      k: p.kills,
      d: p.deaths,
      dl: p.dmgLvl,
      rl: p.rateLvl,
      lv: p.level,
      rs: p.alive ? 0 : Math.max(0, p.respawnAt - world.t),
      iv: Math.max(0, p.invulnUntil - world.t),
      th: p.thrust ? 1 : 0,
      mk: p.missiles || 0,
      hm: p.hasMissiles ? 1 : 0,
      mm: p.missileMaxAmmo || B.missile.maxAmmo,
      co: p.cos, // Б2: ключ косметики корабля
      ab: {
        ar: p.hasArmor ? 1 : 0, ac: p.armorCharges||0, amx: B.abilities.armor.maxCharges,
        ls: p.hasLaser ? 1 : 0, lc: Math.max(0,(p.laserCdUntil||0)-world.t), la: Math.max(0,(p.laserActiveUntil||0)-world.t),
        lac: p.laserCharges||0, lamx: p.laserMaxCharges||0,
        mn: p.hasMines ? 1 : 0, mc: Math.max(0,(p.mineCdUntil||0)-world.t), ml: p.mineStock||0, mx: B.abilities.mines.maxStock,
        rf: world.t < p.rapidFireUntil ? Math.max(0, p.rapidFireUntil - world.t) : 0,
        sh: world.t < p.shieldUntil ? Math.max(0, p.shieldUntil - world.t) : 0,
      },
    })),
    as: world.asteroids.map((a) => {
      const o = {
        i: a.id,
        tp: a.type,
        x: Math.round(a.x * 10) / 10,
        y: Math.round(a.y * 10) / 10,
        r: Math.round(a.r * 10) / 10,
        hp: a.hp,
        mh: a.maxHp,
        ro: Math.round(a.rot * 100) / 100,
        sd: a.shapeSeed,
      };
      if (a.sat) {
        o.sa = Math.round(a.sat.ang * 100)/100;
        o.sd2 = a.sat.seed;
        o.sr = Math.round(a.sat.r*10)/10;
        o.sdst = Math.round(a.sat.dist*10)/10;
        o.srot = Math.round(a.sat.rot*100)/100;
      }
      if (a.type === 'comet') {
        o.vx = Math.round(a.vx);
        o.vy = Math.round(a.vy);
      }
      return o;
    }),
    bs: world.bullets.map((b) => ({
      i: b.id,
      x: Math.round(b.x),
      y: Math.round(b.y),
      a: Math.round(b.a * 100) / 100,
      e: b.enemy ? 1 : undefined,
    })),
    es: world.enemies.map((e) => ({
      i: e.id,
      k: e.kind,
      x: Math.round(e.x * 10) / 10,
      y: Math.round(e.y * 10) / 10,
      a: Math.round(e.a * 100) / 100,
      h: e.hp,
      hm: e.maxHp,
      ar: e.kind === 'armored' ? Math.round(e.armor * 10) / 10 : undefined,
      am: e.maxArmor || undefined,
      pw: e.powLvl || undefined,
    })),
    rk: world.missiles.map((k) => ({
      i: k.id,
      x: Math.round(k.x),
      y: Math.round(k.y),
      a: Math.round(k.a * 100) / 100,
    })),
    mp: world.missilePacks.map((pk) => ({ i: pk.id, x: Math.round(pk.x), y: Math.round(pk.y) })),
    ap: world.abilityPacks.map((pk) => ({ i: pk.id, x: Math.round(pk.x), y: Math.round(pk.y), k: pk.kind })),
    cs: world.coins.map((c) => ({ i: c.id, x: Math.round(c.x), y: Math.round(c.y) })),
    en: world.energySpheres.map((s) => ({ i: s.id, x: Math.round(s.x), y: Math.round(s.y) })),
    cw: world.pendingComets.map((pc) => ({
      i: pc.id,
      x: Math.round(pc.x),
      y: Math.round(pc.y),
      vx: Math.round(pc.vx),
      vy: Math.round(pc.vy),
      r: Math.round(pc.r),
      t: Math.round(Math.max(0, pc.at - world.t)),
    })),
    pb: world.pendingBosses.map((pb) => ({
      i: pb.id,
      k: pb.key,
      s: pb.side,
      x: Math.round(pb.warnX),
      y: Math.round(pb.warnY),
      t: Math.round(Math.max(0, pb.at - world.t)),
    })),
    pu: world.powerups.map((u)=>({ i:u.id, tp:u.tp, x:Math.round(u.x), y:Math.round(u.y) })),
    bo: world.bosses.map((b)=>({ i:b.id, k:b.key, x:Math.round(b.x*10)/10, y:Math.round(b.y*10)/10, a:Math.round(b.a*100)/100, h:b.hp, hm:b.maxHp, ar:b.armor != null ? Math.round(b.armor*10)/10 : undefined, am:b.maxArmor||undefined, ph:b.phase || undefined, mx:b.maxPhase||undefined, cl:b.clone?1:undefined, r:b.r ? Math.round(b.r) : undefined })),
    bl: world.bossLasers.map((l)=>({ i:l.id, x:Math.round(l.x), y:Math.round(l.y), a:Math.round(l.a*100)/100 })),
    cr: world.crystals.map((c)=>({ i:c.id, x:Math.round(c.x), y:Math.round(c.y), k:c.kind, ab:c.ability||undefined })),
    mn: world.mines.map((m)=>({ i:m.id, x:Math.round(m.x), y:Math.round(m.y) })),
    ls: world.lasers.map((l)=>({ i:l.id, x:Math.round(l.x), y:Math.round(l.y), a:Math.round(l.a*100)/100, o:l.owner })),
    fx: world.fx.map((f) => ({ i: f.id, tp: f.type, x: Math.round(f.x), y: Math.round(f.y), z: f.size, k: f.k })),
    pc: world.pendingCards, // { playerId: [cardObj, ...] } — А3: карточки для выбора
  };
}
