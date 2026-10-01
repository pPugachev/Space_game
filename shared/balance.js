// Единый баланс игры: импортируется и сервером (Node ESM), и браузером (статика /shared/).
// Меняйте значения здесь — поведение сервера и клиента обновится вместе.

export const BALANCE = {
  world: { width: 1600, height: 900 },

  ship: {
    radius: 14,
    accel: 640,          // px/s^2
    friction: 2.4,       // экспоненциальное затухание скорости
    maxSpeed: 260,
    lives: 3,
    respawnMs: 2500,
    invulnMs: 2000,      // неуязвимость после респавна
    fireCooldownMs: 280, // базовая скорострельность
    dropCoinsOnDeath: true,
  },

  bullet: {
    speed: 560,
    lifeMs: 1100,
    radius: 5,
  },

  asteroid: {
    small: {
      radiusMin: 13, radiusMax: 18,
      hp: 1, score: 10,
      coinsMin: 0, coinsMax: 1,
      energyMin: 1, energyMax: 1,
      speedMin: 49, speedMax: 80,   // −30% от прежних 70/115
    },
    medium: {
      radiusMin: 26, radiusMax: 34,
      hp: 5, score: 50,
      coinsMin: 2, coinsMax: 3,
      energyMin: 1, energyMax: 2,
      speedMin: 31, speedMax: 56,   // −30% от прежних 45/80
    },
    large: {
      radiusMin: 42, radiusMax: 52,
      hp: 10, score: 100,
      coinsMin: 4, coinsMax: 6,
      energyMin: 2, energyMax: 3,
      speedMin: 17, speedMax: 38,   // −30% от прежних 25/55
    },
    // раскалывание больших астероидов на меньшие; 0 = отключить
    splitLargeIntoMediums: 2,
    splitMediumIntoSmalls: 2,
    maxCount: 14,
    comet: {
      radiusMin: 12, radiusMax: 16,
      hp: 1, score: 60,          // одно попадание = убийство (сбивается с одного выстрела)
      coinsMin: 1, coinsMax: 2,
      energyMin: 1, energyMax: 1,
      // скорость ниже скорости пули (bullet.speed = 560) — иначе комету почти
      // невозможно достать: упреждение слишком большое, а время жизни пули мало
      speedMin: 300, speedMax: 430,
      spawnWarnMs: 900, // предупреждение (мигающая стрелка) до появления кометы
    },
  },

  // Уровни угрозы: разблокируются по максимальному счёту игрока в матче
  comets: {
    unlockScore: 3000,
    intervalMinMs: 1700,
    intervalMaxMs: 2900,
  },

  enemies: {
    unlockScore: 6000,
    firstSpawnDelayMs: 1500,
    intervalMinMs: 6500,
    intervalMaxMs: 11000,
    maxAlive: 2,
    hp: 2,
    radius: 16,
    score: 150,
    coinsMin: 5, coinsMax: 8,
    energyMin: 2, energyMax: 4,
    accel: 280,
    maxSpeed: 195,
    turnRate: 3.2,
    fireCooldownMs: 1500,
    bulletSpeed: 430,
    bulletLifeMs: 2000,
    preferredDistMin: 230,
    preferredDistMax: 370,
    engageDistMax: 750,
  },

  coin: {
    radius: 9,
    magnetRadius: 64,   // монета летит к ближайшему живому кораблю
    magnetPull: 420,    // ускорение притяжения
    pickupRadius: 24,
    lifeMs: 12000,
    driftDamping: 1.6,  // затухание разлёта после выпадения
    scorePerCoin: 2,
  },

  // Энергетические сферы (матчевая экспа): ведут себя как монеты (магнит,
  // подбор), но при подборе добавляют `energy` игроку, а не `coins`. Энергия
  // накапливается как прогресс и не тратится (см. PLAN А2/А3).
  energy: {
    radius: 8,
    magnetRadius: 64,   // сфера летит к ближайшему живому кораблю
    magnetPull: 420,    // ускорение притяжения
    pickupRadius: 24,
    lifeMs: 12000,
    driftDamping: 1.6,  // затухание разлёта после выпадения
  },

  // Rogue-like (А3): экспа накапливается как прогресс и не тратится. При
  // достижении порога следующего уровня — бесплатный выбор «1 из 3» карточек.
  // Логика применения карточек — в shared/world.js (applyCard); здесь только
  // id/название/иконка/описание для генерации оверлея в браузере.
  exp: {
    baseThreshold: 10,  // энергии для первого уровня (1→2)
    multiplier: 2,      // каждый следующий уровень дороже в ×2
  },

  cards: {
    pool: [
      { id: 'damage', name: 'Урон +1', icon: '💥', desc: '+1 урон каждого выстрела' },
      { id: 'firerate', name: 'Скорострельность', icon: '⚡', desc: '+1 уровень скорострельности' },
      { id: 'life', name: '+1 Жизнь', icon: '❤', desc: '+1 к запасу жизней (до 5)' },
      { id: 'speed', name: 'Скорость +15%', icon: '💨', desc: 'Выше максимальная скорость корабля' },
      { id: 'magnet', name: 'Магнит экспы +30%', icon: '🧲', desc: 'Шире радиус подбора сфер энергии' },
      { id: 'armor', name: 'Броня +2', icon: '🛡', desc: '+2 заряда брони (до 5)' },
    ],
  },

  upgrades: {
    damage: {
      name: 'Урон',
      costs: [8, 16, 28, 45],
      dmgPerLevel: 1,          // базовый урон выстрела = 1
    },
    firerate: {
      name: 'Скорострельность',
      costs: [8, 16, 28, 45],
      cooldownFactor: 0.88,    // кулдаун * factor за каждый уровень
    },
    life: {
      name: 'Жизнь',
      cost: 20,
      maxLives: 5,             // потолок: базовые 3 жизни + максимум 2 докупленные
    },

    // Модули (Б1): разблокировка → активация → усиление.
    //   unlockCost      — цена разблокировки в Ангаре (монеты режима). Для ракет
    //                     разблокировка происходит бесплатно с босса Фантома.
    //   activateCost    — цена активации в Ангаре. Пока модуль не активирован,
    //                     заряды с врагов не падают.
    //   upgradeCosts    — стоимость каждого уровня: upgradeCosts[n] = цена для
    //                     перехода на уровень (n+1) (т.е. 0-й элемент → ур.1 из ур.0).
    //   maxLevel        — потолок уровня.
    // Эффект от уровня задаётся функциями-умножителями (см. moduleStats в world.js).
    modules: {
      rockets: {
        key: 'rockets', name: 'Ракеты',
        desc: 'Самонаводящиеся ракеты. Разблокируются с босса Фантома; после активации патроны падают с врагов.',
        unlockableFromBoss: 'phantom', // босс, с которого выпадает разблокировка модуля
        unlockCost: 0,        // с Фантома — бесплатно; в Ангаре будет цена
        activateCost: 10,
        upgradeCosts: [10, 20, 40, 80], // ур.1,2,3,4
        maxLevel: 4,
        base: {
          maxAmmo: 6,          // базовый потолок боезапаса (ур.0)
          blastDamage: 5,      // базовый урон взрыва
          pack: 2,             // сколько ракет даёт один дроп
          dropChance: 0.35,    // базовый шанс выпадения патронов с врагов
        },
        perLevel: {
          maxAmmo: 2,          // +макс. боезапас за уровень
          blastDamage: 1,      // +урон взрыва за уровень
          dropChance: 0.05,    // +шанс дропа за уровень
        },
      },
      laser: {
        key: 'laser', name: 'Лазер',
        desc: 'Мощный лазер по направлению прицела.',
        unlockCost: 40, activateCost: 15,
        upgradeCosts: [15, 30, 60], maxLevel: 3,
      },
      mines: {
        key: 'mines', name: 'Мины',
        desc: 'Разбрасывает мины, взрывающиеся при контакте с врагом.',
        unlockCost: 40, activateCost: 15,
        upgradeCosts: [15, 30, 60], maxLevel: 3,
      },
      armor: {
        key: 'armor', name: 'Броня',
        desc: 'Поглощает урон вместо жизни.',
        unlockCost: 30, activateCost: 10,
        upgradeCosts: [10, 20, 40], maxLevel: 3,
      },
    },
  },

  // Ангар (Б2): покупки между матчами за монеты банка режима (solo/multi раздельно).
  //   base  — базовые характеристики: пассивные бонусы со старта матча. Покупаются
  //           по 5 уровней; коэффициенты задаются лестницей coefs (1%→3%→5%→10%→15%,
  //           т.е. уровень N даёт coefs[N-1] накопленно). Цена следующего уровня —
  //           costs[level] (1-й = 10, далее ×2). Карточки матча (А3) дают сверху.
  //   maxLevel — единый потолок уровней базовых характеристик.
  //   cosmetics — косметика на аккаунт (не зависит от режима): цвет корабля или
  //           эффект. Покупается 1 раз за монеты выбранного банка, equipe-тся одна.
  hangar: {
    maxLevel: 5,
    stats: [
      { key: 'speed',    name: 'Скорость', icon: '💨',
        costs: [10, 20, 40, 80, 160], coefs: [0.01, 0.03, 0.05, 0.10, 0.15],
        desc: '+% к максимальной скорости корабля' },
      { key: 'magnet',   name: 'Магнит', icon: '🧲',
        costs: [10, 20, 40, 80, 160], coefs: [0.01, 0.03, 0.05, 0.10, 0.15],
        desc: '+% к радиусу подбора монет и сфер энергии' },
      { key: 'damage',   name: 'Урон', icon: '💥',
        costs: [10, 20, 40, 80, 160], coefs: [0.01, 0.03, 0.05, 0.10, 0.15],
        desc: '+% к урону каждого выстрела' },
      { key: 'firerate', name: 'Скорострельность', icon: '⚡',
        costs: [10, 20, 40, 80, 160], coefs: [0.01, 0.03, 0.05, 0.10, 0.15],
        desc: '−% к задержке между выстрелами' },
    ],
    cosmetics: [
      { key: 'default',  name: 'Классик',  kind: 'color',  color: null,          cost: 0,  desc: 'Стандартная раскраска корабля' },
      { key: 'azure',    name: 'Лазурь',   kind: 'color',  color: '#5ad0ff',     cost: 15, desc: 'Голубая раскраска и пламя' },
      { key: 'emerald',  name: 'Изумруд',  kind: 'color',  color: '#34c77b',     cost: 20, desc: 'Зелёная раскраска и пламя' },
      { key: 'crimson',  name: 'Багрянец', kind: 'color',  color: '#ff5f66',     cost: 30, desc: 'Красная раскраска и пламя' },
      { key: 'gold',     name: 'Золото',   kind: 'color',  color: '#ffd75e',     cost: 50, desc: 'Золотая раскраска и пламя' },
      { key: 'neon',     name: 'Неон',     kind: 'effect', color: '#b88bff',     cost: 80, desc: 'Неоновое свечение вокруг корабля' },
    ],
  },

  // Модуль «Ракеты» (Д1/Б1): по умолчанию ракет нет — модуль разблокируется с
  // босса Фантома, после чего патроны могут падать с врагов (если модуль активен).
  // Здесь — физика ракеты и дропа; значения «по умолчанию» (базовые, уровень 0).
  // Скалирование по уровню модуля (макс.боезапас/урон/шанс дропа) — см. BALANCE.upgrades.modules.
  missile: {
    radius: 5,
    accel: 340,                // снижено (было 560) — ракета разгоняется плавнее
    maxSpeed: 260,             // снижено (было 440) — ракета летит медленнее
    turnRate: 4.4,             // рад/с — скорость доворота на цель
    lifeMs: 4000,
    blastRadius: 95,
    blastDamage: 5,            // базовый (ур.0); растёт с уровнем модуля
    maxAmmo: 6,                // базовый потолок боезапаса (ур.0)
    pack: 2,                   // сколько ракет даёт один пополняющий дроп
    fireCooldownMs: 500,       // задержка между пусками
    dropChance: 0.35,          // базовый шанс дропа патронов (ур.0)
    packRadius: 10,            // размер иконки патронов
    packMagnetRadius: 64,      // магнит патронов к кораблю с активным модулем
    packMagnetPull: 420,
    packPickupRadius: 24,
    packLifeMs: 12000,
  },

  powerups: {
    cometChance: 0.25,
    enemyChance: 0.10,
    radius: 12,
    magnetRadius: 56,
    magnetPull: 380,
    pickupRadius: 26,
    lifeMs: 10000,
    driftDamping: 1.8,
    types: {
      rapidFire: { durationMs: 5000, cooldownFactor: 0.5 },
      shield:    { durationMs: 10000 },
    },
  },

  bosses: {
    // В2: предупреждение о боссе. За warnMs до появления — гудок-волна
    // (forcePush расталкивает игрока и объекты от точки входа) + серия
    // мигающих значков на стороне, откуда босс войдёт в арену.
    warnMs: 2000,          // за сколько до появления босса включается предупреждение
    hornRadius: 520,       // радиус выталкивающей волны
    hornStrength: 460,     // сила толчка (поправка на массу — в world.js)
    warnIcons: 4,          // сколько значков рисуется вдоль стороны входа
    // Боссы выпускаются волнами через waves.list[].bosses (см. конфигурацию волн).
    // У каждого босса 3 варианта: базовый (key, 1 фаза), усиленный (key+, 2 фазы),
    // сильнейший (key++, 3 фазы). Поздние волны выпускают усиленные версии.
    // Поля фаз:
    //   phaseCount   — всего фаз у варианта (1..3)
    //   startPhase   — с какой фазы начинается бой (по умолчанию 1)
    //   phasesAt     — проценты max HP, при падении ниже которых включается
    //                  следующая фаза; длина = phaseCount − startPhase
    //   спос. from   — с какой фазы активна способность (armorFrom/burstFrom/
    //                  mineFrom/teleportFrom/cloneFrom/spiralFrom/laserFrom)
    types: {
      dreadnought: {
        key: 'dreadnought', name: 'Дредноут',
        hp: 140, radius: 52, scoreReward: 600,
        accel: 90, maxSpeed: 95, turnRate: 1.6,
        fireCooldownMs: 900, bulletSpeed: 380, bulletCount: 3, spread: 0.22,
        phaseCount: 1, // базовый — 1 фаза: стандартный веер из 3 пуль
        // В3-способности (очереди + щит) включаются с фазы 2 — у базовой версии
        // до неё не доходит, но поведение сохраняется для вручную созданных боссов
        burstFrom: 2,
        burst: { volleys: 3, intervalMs: 260, reloadMs: 2600 },
        armorFrom: 2,
        armorHp: 70,
        armorPerCoin: 0.03,
        armorResupplyPct: 0.30,
        coinMagnetR: 200, coinSeekR: 480, coinPickupR: 42,
      },
      'dreadnought+': {
        key: 'dreadnought+', name: 'Дредноут+', base: 'dreadnought',
        hp: 200, radius: 52, scoreReward: 900,
        accel: 100, maxSpeed: 105, turnRate: 1.7,
        fireCooldownMs: 850, bulletSpeed: 400, bulletCount: 3, spread: 0.22,
        phaseCount: 2, startPhase: 1, phasesAt: [0.5],
        // фаза 2: очереди по 3 залпа + щит, пополняемый монетами (В3)
        burstFrom: 2,
        burst: {
          volleys: 3, intervalMs: 260, reloadMs: 2600,
        },
        armorFrom: 2,
        armorHp: 70,                  // полоска брони (как у бронированных врагов)
        armorPerCoin: 0.03,           // 1 монета → +3% макс. брони
        armorResupplyPct: 0.30,       // ниже 30% брони — ищет монеты, а не стреляет
        coinMagnetR: 200, coinSeekR: 480, coinPickupR: 42,
      },
      'dreadnought++': {
        key: 'dreadnought++', name: 'Дредноут++', base: 'dreadnought',
        hp: 270, radius: 54, scoreReward: 1300,
        accel: 110, maxSpeed: 115, turnRate: 1.8,
        fireCooldownMs: 800, bulletSpeed: 420, bulletCount: 4, spread: 0.26,
        // 3 фазы: начинается СРАЗУ со 2-й (очереди + щит), фаза 3 — ускоренные очереди
        phaseCount: 3, startPhase: 2, phasesAt: [0.33],
        burstFrom: 2,
        burst: {
          volleys: 4, intervalMs: 200, reloadMs: 1900,
        },
        armorFrom: 2,
        armorHp: 110,
        armorPerCoin: 0.05,
        armorResupplyPct: 0.30,
        coinMagnetR: 230, coinSeekR: 520, coinPickupR: 46,
      },
      phantom: {
        key: 'phantom', name: 'Фантом',
        hp: 250, radius: 46, scoreReward: 900,
        accel: 220, maxSpeed: 165, turnRate: 2.8,
        fireCooldownMs: 700, bulletSpeed: 460, bulletCount: 1,
        strafeSpeed: 140,
        phaseCount: 1,       // базовый — 1 фаза: стрельба + мины
        mineFrom: 1,
        mineIntervalMs: 5500,
      },
      'phantom+': {
        key: 'phantom+', name: 'Фантом+', base: 'phantom',
        hp: 340, radius: 46, scoreReward: 1200,
        accel: 240, maxSpeed: 180, turnRate: 3.0,
        fireCooldownMs: 650, bulletSpeed: 480, bulletCount: 1,
        strafeSpeed: 150,
        phaseCount: 2, startPhase: 1, phasesAt: [0.5],
        // фаза 2 добавляет телепорт (к минам) — «телепорт+мины»
        mineFrom: 1,
        mineIntervalMs: 5200,
        teleportFrom: 2,
        teleportIntervalMs: 3200,
        teleportDist: 430,
      },
      'phantom++': {
        key: 'phantom++', name: 'Фантом++', base: 'phantom',
        hp: 430, radius: 48, scoreReward: 1700,
        accel: 260, maxSpeed: 195, turnRate: 3.2,
        fireCooldownMs: 600, bulletSpeed: 500, bulletCount: 2, spread: 0.3,
        strafeSpeed: 160,
        phaseCount: 3, startPhase: 1, phasesAt: [0.66, 0.33],
        mineFrom: 1,
        mineIntervalMs: 5000,
        teleportFrom: 2,
        teleportIntervalMs: 2800,
        teleportDist: 460,
        cloneFrom: 3,
        clone: { max: 2, intervalMs: 3800, hpFactor: 0.4, radiusFactor: 0.7, lifeMs: 12000 },
      },
      leviathan: {
        key: 'leviathan', name: 'Левиафан',
        hp: 280, radius: 60, scoreReward: 1200,
        accel: 70, maxSpeed: 105, turnRate: 1.2,
        fireCooldownMs: 1200, bulletSpeed: 340, bulletCount: 8, // круговой залп
        phaseCount: 1, // базовый — 1 фаза: круговой залп
        spiralFrom: 99,
      },
      'leviathan+': {
        key: 'leviathan+', name: 'Левиафан+', base: 'leviathan',
        hp: 380, radius: 62, scoreReward: 1600,
        accel: 80, maxSpeed: 120, turnRate: 1.3,
        fireCooldownMs: 1050, bulletSpeed: 360, bulletCount: 10,
        phaseCount: 2, startPhase: 1, phasesAt: [0.5],
        // фаза 2: спираль + ускорение
        spiralFrom: 2,
        spiral: { spinStep: 0.9 },
        laserFrom: 99,
      },
      'leviathan++': {
        key: 'leviathan++', name: 'Левиафан++', base: 'leviathan',
        hp: 480, radius: 64, scoreReward: 2200,
        accel: 90, maxSpeed: 135, turnRate: 1.4,
        fireCooldownMs: 950, bulletSpeed: 380, bulletCount: 12,
        phaseCount: 3, startPhase: 1, phasesAt: [0.66, 0.33],
        spiralFrom: 2,
        spiral: { spinStep: 1.1 },
        // фаза 3: лазерные лучи поверх спирали
        laserFrom: 3,
        laser: { intervalMs: 4500, durationMs: 1600, width: 12, dps: 26, tickMs: 100, len: 760, count: 2, spinSpan: 1.1 },
      },
    },
  },

  crystals: {
    coinValue: 1000,            // 1 кристал = 1000 монет
    lifeMs: 18000,
    radius: 14,
    magnetRadius: 90,
    pickupRadius: 30,
    driftDamping: 1.2,
  },

  abilities: {
    armor:  { name: 'Броня', charges: 2, maxCharges: 5, dropChance: 0.12, dropPack: 1 },
    laser:  { name: 'Лазер', durationMs: 5000, cooldownMs: 4000, dps: 18, width: 14, tickMs: 90, charges: 1, maxCharges: 3, dropChance: 0.12, dropPack: 1 },
    mines:  { name: 'Мины', max: 3, maxStock: 10, cooldownMs: 2000, blastRadius: 115, blastDamage: 7, chainRadius: 210, maxChain: 6, armMs: 400, dropChance: 0.15, dropPack: 2 },
  },

  abilityPack: {
    radius: 10,
    magnetRadius: 64,
    magnetPull: 420,
    pickupRadius: 24,
    lifeMs: 12000,
    driftDamping: 1.6,
  },

  mine: {
    radius: 10,
    lifeMs: 25000,
  },

  matchDurationMs: 300000,

  nebula: {
    satelliteChance: 0.35,       // шанс что астероид получит спутник после 2 босса
    satelliteDistMin: 32,
    satelliteDistMax: 52,
    satelliteSizeFactor: 0.42,   // размер спутника от родителя
    orbitSpeedMin: 0.9,          // рад/с
    orbitSpeedMax: 1.9,
  },

  // Реестр типов спавнящихся противников в волнах. Каждый вид имеет параметры
  // по умолчанию; конкретная волна может их переопределить.
  //   intervalMs   — частота появления (интервал между спавнами, мс)
  //   count        — сколько объектов этого вида за волну
  //   max          — потолок одновременно на арене
  //   composition  — (только для астероидов) состав волны: веса типов
  // ПРИ ДОБАВЛЕНИИ НОВОГО ВИДА ПРОТИВНИКА:
  //   1) добавьте запись сюда (ключ = id вида),
  //   2) добавьте обработчик в shared/world.js в объект SPAWNERS по этому ключу.
  enemyKinds: {
    asteroid: { intervalMs: 1400, count: 14, max: 14,
      composition: { small: 0.6, medium: 0.32, large: 0.08 } },
    comet:    { intervalMs: 1900, count: 6,  max: 6,
      // шанс, что очередная попытка спавна кометы реализуется (было 1.0 —
      // каждая попытка давала комету); 0.5 = вдвое реже
      spawnChance: 0.5 },
    enemy:    { intervalMs: 8000, count: 2,  max: 2 },
    // Бронированный (В4): броня = +100% HP, поглощает урон первой; собирает
    // монеты (1 → +10% брони). При броне < 30% прекращает огонь и уходит за
    // монетами, поэтому убить можно, если не дать ему пополниться.
    armored: {
      intervalMs: 8000, count: 1, max: 2,
      hp: 3, armorHp: 2, radius: 20,
      score: 220, coinsMin: 6, coinsMax: 9, energyMin: 3, energyMax: 5,
      accel: 240, maxSpeed: 175, turnRate: 2.6,
      fireCooldownMs: 1800, bulletSpeed: 380,
      preferredDistMin: 250, preferredDistMax: 380, engageDistMax: 720,
      armorPerCoin: 0.10, armorResupplyPct: 0.30,
      coinMagnetR: 170, coinSeekR: 430, coinPickupR: 26,
    },
    // Очередной стрелок (В4): быстрые очереди (интервал 0.1с) с паузой 2с;
    // собирает монеты — растёт: +выстрел в очереди и быстрее пули.
    burst: {
      intervalMs: 7000, count: 1, max: 2,
      hp: 3, radius: 18,
      score: 260, coinsMin: 7, coinsMax: 10, energyMin: 3, energyMax: 5,
      accel: 260, maxSpeed: 185, turnRate: 3.0,
      fireCooldownMs: 1500, bulletSpeed: 470,
      preferredDistMin: 300, preferredDistMax: 430, engageDistMax: 760,
      burstShots: 5, shotIntervalMs: 100, burstCooldownMs: 2000,
      powMax: 6, powPerShot: 4, powSpeed: 0.04,
      coinMagnetR: 140, coinSeekR: 380, coinPickupR: 26,
    },
    // Орбитальный (В4): держится на орбите вокруг игрока (не строго), высокая
    // скорость; ломает метеориты, мешающие орбите, а столкновение с игроком
    // наносит урон.
    orbital: {
      intervalMs: 12000, count: 1, max: 1,
      hp: 3, radius: 17,
      score: 250, coinsMin: 5, coinsMax: 8, energyMin: 2, energyMax: 4,
      accel: 380, maxSpeed: 300, turnRate: 2.2,
      fireCooldownMs: 0, bulletSpeed: 0,
      preferredDistMin: 190, preferredDistMax: 330, engageDistMax: 0,
      orbitRMin: 200, orbitRMax: 320,
    },
  },

  // Очередь волн. Каждая волна:
  //   durationMs   — время волны (сколько она длится)
  //   cooldownMs   — период охлаждения после волны (пауза без спавна)
  //   bosses       — боссы, выпускаемые в начале волны: ['dreadnought', 'phantom', 'leviathan']
  //   spawns       — какие виды противников появляются и с какими параметрами:
  //                  [{ kind: 'вид', intervalMs?, count?, max?, composition?, spawnChance? }]
  //                  пропущенные поля берутся из enemyKinds; вид не указан — не спавнится.
  //                  spawnChance — шанс, что очередная попытка спавна реализуется
  //                  (по умолчанию 1 = всегда).
  //                  Новый вид противника добавляется новой записью в этом списке.
  // Волны проигрываются по порядку; после последней повторяется она же.
  waves: {
    list: [
      // 1. Затишье: только астероиды
      { durationMs: 10000, cooldownMs: 2000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1600, count: 8,
            composition: { small: 0.80, medium: 0.20, large: 0.00 } },
        ] },
      // 2. Разгон: крупнее астероиды + первые кометы
      { durationMs: 12000, cooldownMs: 2000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1200, count: 12,
            composition: { small: 0.60, medium: 0.35, large: 0.05 } },
          { kind: 'comet', intervalMs: 2600, count: 3 },
        ] },
      // 3. Первый охотник: подключается вражеский корабль
      { durationMs: 13000, cooldownMs: 20200,
        spawns: [
          { kind: 'asteroid', intervalMs: 1100, count: 12,
            composition: { small: 0.50, medium: 0.40, large: 0.10 } },
          { kind: 'comet', intervalMs: 2400, count: 3 },
          { kind: 'enemy', intervalMs: 10000, count: 1 },
        ] },
      // 4. Дредноут с эскортом из комет и охотников
      { durationMs: 15000, cooldownMs: 3000, bosses: ['dreadnought'],
        spawns: [
          { kind: 'asteroid', intervalMs: 1400, count: 10,
            composition: { small: 0.45, medium: 0.40, large: 0.15 } },
          { kind: 'comet', intervalMs: 2200, count: 4 },
          { kind: 'enemy', intervalMs: 10000, count: 1 },
          { kind: 'armored', intervalMs: 8000, count: 1 },
        ] },
      // 5. Кометный ливень
      { durationMs: 12000, cooldownMs: 2000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1000, count: 14,
            composition: { small: 0.40, medium: 0.40, large: 0.20 } },
          { kind: 'comet', intervalMs: 1200, count: 8 },
        ] },
      // 6. Шквал: плотный поток мелочи (максимум на арене повыше)
      { durationMs: 12000, cooldownMs: 2000,
        spawns: [
          { kind: 'asteroid', intervalMs: 600, count: 22, max: 20,
            composition: { small: 0.85, medium: 0.15, large: 0.00 } },
          { kind: 'comet', intervalMs: 3000, count: 2 },
        ] },
      // 7. Каменный вал: только крупные глыбы
      { durationMs: 13000, cooldownMs: 2000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1300, count: 14, max: 16,
            composition: { small: 0.25, medium: 0.40, large: 0.35 } },
        ] },
      // 8. Заслон: бронированные прикрывают очередного стрелка
      { durationMs: 14000, cooldownMs: 2500,
        spawns: [
          { kind: 'asteroid', intervalMs: 1200, count: 12,
            composition: { small: 0.35, medium: 0.45, large: 0.20 } },
          { kind: 'comet', intervalMs: 2600, count: 3 },
          { kind: 'armored', intervalMs: 7000, count: 2 },
          { kind: 'burst', intervalMs: 8000, count: 1 },
        ] },
      // 9. Фантом под прикрытием комет и врагов
      { durationMs: 16000, cooldownMs: 3000, bosses: ['phantom'],
        spawns: [
          { kind: 'asteroid', intervalMs: 1200, count: 12,
            composition: { small: 0.35, medium: 0.45, large: 0.20 } },
          { kind: 'comet', intervalMs: 1800, count: 5 },
          { kind: 'enemy', intervalMs: 7000, count: 2 },
          { kind: 'armored', intervalMs: 8000, count: 1 },
          { kind: 'burst', intervalMs: 7000, count: 1 },
        ] },
      // 10. Стая охотников: Фантом зовёт подкрепление
      { durationMs: 14000, cooldownMs: 2500,
        spawns: [
          { kind: 'asteroid', intervalMs: 900, count: 16,
            composition: { small: 0.30, medium: 0.45, large: 0.25 } },
          { kind: 'enemy', intervalMs: 6000, count: 3 },
          { kind: 'burst', intervalMs: 7000, count: 1 },
        ] },
      // 11. Вихрь: орбитальные рвут арену, стрелки их прикрывают
      { durationMs: 14000, cooldownMs: 2500,
        spawns: [
          { kind: 'asteroid', intervalMs: 900, count: 16,
            composition: { small: 0.30, medium: 0.45, large: 0.25 } },
          { kind: 'comet', intervalMs: 2000, count: 4 },
          { kind: 'orbital', intervalMs: 9000, count: 2 },
          { kind: 'burst', intervalMs: 7000, count: 2 },
        ] },
      // 12. Полная тревога: всё и сразу
      { durationMs: 14000, cooldownMs: 2000,        spawns: [
          { kind: 'asteroid', intervalMs: 700, count: 20,
            composition: { small: 0.30, medium: 0.40, large: 0.30 } },
          { kind: 'comet', intervalMs: 1400, count: 8 },
          { kind: 'enemy', intervalMs: 5500, count: 4 },
          { kind: 'armored', intervalMs: 7000, count: 2 },
          { kind: 'burst', intervalMs: 6000, count: 2 },
          { kind: 'orbital', intervalMs: 12000, count: 1 },
        ] },
      // 13. Стальной дождь: стена бронированных, камней почти нет
      { durationMs: 14000, cooldownMs: 3000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1500, count: 8,
            composition: { small: 0.50, medium: 0.50, large: 0.00 } },
          { kind: 'armored', intervalMs: 5500, count: 3, max: 3 },
          { kind: 'burst', intervalMs: 6500, count: 2 },
          { kind: 'enemy', intervalMs: 7000, count: 2 },
        ] },
      // 14. Левиафан — финал всех фаз
      { durationMs: 18000, cooldownMs: 4000, bosses: ['leviathan'],
        spawns: [
          { kind: 'asteroid', intervalMs: 1000, count: 14,
            composition: { small: 0.30, medium: 0.40, large: 0.30 } },
          { kind: 'comet', intervalMs: 1500, count: 6 },
          { kind: 'enemy', intervalMs: 6000, count: 3 },
          { kind: 'armored', intervalMs: 6000, count: 2 },
          { kind: 'burst', intervalMs: 6000, count: 2 },
          { kind: 'orbital', intervalMs: 11000, count: 2 },
        ] },
      // 15. Затяжной бой (без босса) — передышка перед усиленными боссами
      { durationMs: 15000, cooldownMs: 2500,
        spawns: [
          { kind: 'asteroid', intervalMs: 850, count: 18,
            composition: { small: 0.35, medium: 0.40, large: 0.25 } },
          { kind: 'comet', intervalMs: 1600, count: 7 },
          { kind: 'enemy', intervalMs: 6000, count: 3 },
          { kind: 'armored', intervalMs: 7000, count: 2 },
          { kind: 'burst', intervalMs: 6500, count: 2 },
          { kind: 'orbital', intervalMs: 12000, count: 1 },
        ] },
      // 16. Дробный дождь: только мелочь и кометы — спокойная волна-разрядка
      { durationMs: 13000, cooldownMs: 3000,
        spawns: [
          { kind: 'asteroid', intervalMs: 700, count: 20, max: 20,
            composition: { small: 0.45, medium: 0.40, large: 0.15 } },
          { kind: 'comet', intervalMs: 1800, count: 5 },
        ] },
      // 17. Усиленный Дредноут+ (2 фазы: стандарт → очереди + щит)
      { durationMs: 15000, cooldownMs: 3000, bosses: ['dreadnought+'],
        spawns: [
          { kind: 'asteroid', intervalMs: 1300, count: 12,
            composition: { small: 0.40, medium: 0.40, large: 0.20 } },
          { kind: 'comet', intervalMs: 2000, count: 4 },
          { kind: 'enemy', intervalMs: 8000, count: 2 },
          { kind: 'armored', intervalMs: 8000, count: 1 },
        ] },
      // 18. Усиленный Фантом+ (2 фазы: стрельба → телепорт + мины)
      { durationMs: 16000, cooldownMs: 3000, bosses: ['phantom+'],
        spawns: [
          { kind: 'asteroid', intervalMs: 1100, count: 12,
            composition: { small: 0.35, medium: 0.40, large: 0.25 } },
          { kind: 'comet', intervalMs: 1700, count: 5 },
          { kind: 'enemy', intervalMs: 6500, count: 2 },
          { kind: 'burst', intervalMs: 7000, count: 1 },
        ] },
      // 19. Штурм: одни корабли и очереди, камней почти нет
      { durationMs: 14000, cooldownMs: 3000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1800, count: 6,
            composition: { small: 0.40, medium: 0.40, large: 0.20 } },
          { kind: 'comet', intervalMs: 2200, count: 4 },
          { kind: 'enemy', intervalMs: 5000, count: 3 },
          { kind: 'burst', intervalMs: 6000, count: 2 },
        ] },
      // 20. Усиленный Левиафан+ (2 фазы: круг → спираль + ускорение)
      { durationMs: 18000, cooldownMs: 4000, bosses: ['leviathan+'],
        spawns: [
          { kind: 'asteroid', intervalMs: 950, count: 14,
            composition: { small: 0.30, medium: 0.40, large: 0.30 } },
          { kind: 'comet', intervalMs: 1400, count: 6 },
          { kind: 'enemy', intervalMs: 5500, count: 3 },
          { kind: 'armored', intervalMs: 6000, count: 2 },
          { kind: 'orbital', intervalMs: 11000, count: 1 },
        ] },
      // 21. Кольцо: орбитальные в кольце и броня по периметру
      { durationMs: 15000, cooldownMs: 3000,
        spawns: [
          { kind: 'asteroid', intervalMs: 1400, count: 10,
            composition: { small: 0.30, medium: 0.50, large: 0.20 } },
          { kind: 'orbital', intervalMs: 8500, count: 2 },
          { kind: 'armored', intervalMs: 6500, count: 2 },
          { kind: 'comet', intervalMs: 2400, count: 3 },
        ] },
      // 22. Осада: Дредноут++ (начинает с фазы 2) + Фантом++
      { durationMs: 18000, cooldownMs: 4000, bosses: ['dreadnought++', 'phantom++'],
        spawns: [
          { kind: 'asteroid', intervalMs: 850, count: 16,
            composition: { small: 0.30, medium: 0.40, large: 0.30 } },
          { kind: 'comet', intervalMs: 1300, count: 6 },
          { kind: 'enemy', intervalMs: 5000, count: 3 },
          { kind: 'burst', intervalMs: 6000, count: 2 },
        ] },
      // 23. Левиафан++ — финал (3 фазы: круг → спираль → лазеры), повторяется
      { durationMs: 20000, cooldownMs: 4000, bosses: ['leviathan++'],
        spawns: [
          { kind: 'asteroid', intervalMs: 800, count: 16,
            composition: { small: 0.30, medium: 0.40, large: 0.30 } },
          { kind: 'comet', intervalMs: 1200, count: 7 },
          { kind: 'enemy', intervalMs: 5000, count: 3 },
          { kind: 'armored', intervalMs: 5600, count: 2 },
          { kind: 'burst', intervalMs: 5500, count: 2 },
          { kind: 'orbital', intervalMs: 10000, count: 2 },
        ] },
    ],
  },
};
