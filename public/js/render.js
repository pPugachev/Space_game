// Отрисовка: canvas-мир 1600x900 с letterbox-масштабированием + HUD на DOM.
import { BALANCE } from '/shared/balance.js';

const W = BALANCE.world.width;
const H = BALANCE.world.height;

const SHIP_IMG = new Image();
SHIP_IMG.src = '/img/player/ship.png';

const BOSS_IMGS = {};
BOSS_IMGS.dreadnought = new Image();
BOSS_IMGS.dreadnought.src = '/img/enemies/dreadnought.png';
BOSS_IMGS.phantom = new Image();
BOSS_IMGS.phantom.src = '/img/enemies/phantom.png';
BOSS_IMGS.leviathan = new Image();
BOSS_IMGS.leviathan.src = '/img/enemies/leviathan.png';

const SLOT_COLORS = ['#5ad0ff', '#ffb458', '#7dff9e', '#ff8ad8'];

// Косметика корабля (Б2): описание по ключу из снапшота (p.co)
function cosmeticDef(key) {
  if (!key || key === 'default') return null;
  return (BALANCE.hangar?.cosmetics || []).find((c) => c.key === key) || null;
}
const FX_COLORS = {
  boom: ['#ffd75e', '#ff9d4d', '#ff6b4a'],
  hit: ['#ffffff', '#ffe9a8'],
  coin: ['#ffd75e', '#fff3c0'],
  energy: ['#7dff9e', '#c8ffd9'],
  shoot: ['#fff2b0'],
  spawn: ['#5ad0ff', '#bff1ff'],
  upgrade: ['#7dff9e', '#d2ffde'],
  shield: ['#7dd8ff', '#bff1ff'],
  laser: ['#ff5a66', '#ffb0b8'],
  mine: ['#ffb458', '#ffd08a'],
  levelup: ['#b88bff', '#ffe9a8'],
  bossphase: ['#ffd75e', '#ffffff', '#9d7dff', '#ff5a66'],
};

function hashRand(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let view = { scale: 1, ox: 0, oy: 0 };
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let mouseX = 0;
  let mouseY = 0;
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
  });

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const scale = Math.min(cssW / W, cssH / H);
    view = {
      scale,
      ox: (cssW - W * scale) / 2,
      oy: (cssH - H * scale) / 2,
    };
  }
  window.addEventListener('resize', resize);
  resize();

  // звёздный фон
  const rng = hashRand(777);
  const stars = [];
  for (let i = 0; i < 170; i++) {
    stars.push({
      x: rng() * W,
      y: rng() * H,
      r: 0.4 + rng() * 1.4,
      ph: rng() * Math.PI * 2,
      sp: 0.4 + rng() * 1.6,
    });
  }
  // туманность (фиолетовые облака) — показывается после 2 босса
  const nebulaBlobs = [];
  const rng2 = hashRand(9999);
  for (let i=0;i<14;i++){
    nebulaBlobs.push({
      x: rng2()*W,
      y: rng2()*H,
      rx: 220 + rng2()*380,
      ry: 140 + rng2()*220,
      alpha: 0.08 + rng2()*0.13,
      hue: 265 + rng2()*35, // фиолетовый
    });
  }

  // форма астероидов по seed (кэш)
  const shapes = new Map();
  function asteroidShape(a) {
    let pts = shapes.get(a.i);
    if (!pts) {
      const r = hashRand(a.sd);
      const n = 9 + Math.floor(r() * 4);
      pts = [];
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const rad = 0.72 + r() * 0.42;
        pts.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
      }
      if (shapes.size > 600) shapes.clear();
      shapes.set(a.i, pts);
    }
    return pts;
  }

  // частицы и тряска
  const particles = [];
  const seenFx = new Set();
  let shake = 0;

  function spawnFxParticles(f) {
    if (seenFx.has(f.i)) return;
    seenFx.add(f.i);
    if (seenFx.size > 400) {
      // сбрасываем старые метки, оставляем последние ~200
      const arr = [...seenFx].slice(-200);
      seenFx.clear();
      arr.forEach((v) => seenFx.add(v));
    }
    const colors = FX_COLORS[f.tp] || ['#ffffff'];
    const count = f.tp === 'boom' ? 12 + f.z * 7 : f.tp === 'hit' ? 5 : f.tp === 'coin' ? 7 : 3;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = f.tp === 'boom' ? 50 + Math.random() * 220 * f.z : 30 + Math.random() * 120;
      particles.push({
        x: f.x, y: f.y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: f.tp === 'boom' ? 0.55 + Math.random() * 0.35 : 0.25 + Math.random() * 0.25,
        age: 0,
        r: f.tp === 'boom' ? 1.6 + Math.random() * 2.4 * Math.min(f.z, 2) : 1 + Math.random() * 1.6,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    if (f.tp === 'boom') shake = Math.min(shake + 2.2 * f.z, 16);
    if (onFxSound) onFxSound(f, current);
  }

  let onFxSound = null;
  let onCometWarnCb = null;
  const seenCometWarn = new Set();
  let lastTs = null;
  let current = null;

  function frame(ts) {
    const dt = lastTs == null ? 0.016 : Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    requestAnimationFrame(frame);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // вне арены — более тёмный, но с фиолетовым отливом если туманность активна
    const neb = current && current.nb;
    ctx.fillStyle = neb ? '#0b0614' : '#05070c';
    ctx.fillRect(0, 0, cssW, cssH);
    if (!current) return;

    // фон арены
    if (neb) {
      const grad = ctx.createLinearGradient(view.ox, view.oy, view.ox, view.oy + H*view.scale);
      grad.addColorStop(0, '#1a1030');
      grad.addColorStop(0.5, '#20144a');
      grad.addColorStop(1, '#120e2a');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = '#080a12';
    }
    ctx.fillRect(view.ox, view.oy, W * view.scale, H * view.scale);

    shake *= Math.exp(-7 * dt);
    const shx = (Math.random() - 0.5) * shake;
    const shy = (Math.random() - 0.5) * shake;
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, (view.ox + shx) * dpr, (view.oy + shy) * dpr);

    drawWorld(ctx, current, ts / 1000, dt);

    // кастомный прицел — контрастный, с чёрной подложкой и свечением,
    // чтобы не терялся на любом фоне (объекты, туманность, астероиды)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = mouseX;
    const cy = mouseY;
    const pl = 1 + 0.08 * Math.sin(ts * 0.006);
    const sz = 10 * pl;
    const arm = 3;
    ctx.lineCap = 'round';
    // 1) широкая тёмная подложка (контур), гарантирует контраст
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.78)';
    ctx.beginPath(); ctx.moveTo(cx - sz, cy); ctx.lineTo(cx + sz, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - sz); ctx.lineTo(cx, cy + sz); ctx.stroke();
    // 2) белые линии поверх подложки (с разрывом в центре)
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255,255,255,.85)';
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.moveTo(cx - sz, cy); ctx.lineTo(cx - arm, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + arm, cy); ctx.lineTo(cx + sz, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - sz); ctx.lineTo(cx, cy - arm); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + arm); ctx.lineTo(cx, cy + sz); ctx.stroke();
    // 3) яркие уголки + центральная точка со свечением
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cx, cy, 2.0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(cx, cy, 3.6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  function drawWorld(ctx, s, now, dt) {
    // границы арены
    ctx.strokeStyle = 'rgba(79,140,255,.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // звёзды (мерцание)
    for (const st of stars) {
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(now * st.sp + st.ph));
      ctx.globalAlpha = tw;
      ctx.fillStyle = s.nb ? '#e0c8ff' : '#cfe0ff';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // туманность — большие полупрозрачные фиолетовые пятна
    if (s.nb) {
      for (const bl of nebulaBlobs) {
        const pulse = 0.9 + 0.22*Math.sin(now*0.35 + bl.x*0.002);
        ctx.globalAlpha = bl.alpha * pulse;
        const grad = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, Math.max(bl.rx, bl.ry));
        grad.addColorStop(0, `hsla(${bl.hue},85%,62%,0.55)`);
        grad.addColorStop(0.45, `hsla(${bl.hue+12},78%,58%,0.22)`);
        grad.addColorStop(1, `hsla(${bl.hue+18},70%,48%,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(bl.x, bl.y, bl.rx, bl.ry, 0, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // монеты
    for (const c of s.cs) {
      const pulse = 1 + 0.12 * Math.sin(now * 5 + c.i);
      ctx.fillStyle = '#ffd75e';
      ctx.strokeStyle = '#8a6a1d';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 9 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff3c0';
      ctx.beginPath();
      ctx.arc(c.x - 2.6, c.y - 2.6, 3.1 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // энергетические сферы (экспа) — зелёные, светятся
    for (const sph of (s.en || [])) {
      const pulse = 1 + 0.15 * Math.sin(now * 5 + sph.i);
      ctx.save();
      ctx.shadowColor = 'rgba(125,255,158,.8)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#3ad66e';
      ctx.strokeStyle = '#1a7a38';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sph.x, sph.y, 8 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#c8ffd9';
      ctx.beginPath();
      ctx.arc(sph.x - 2, sph.y - 2.2, 2.6 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // powerups (щит/ускорение)
    const PU_COLORS = { rapidFire: '#ff6ba8', shield: '#5ad0ff' };
    const PU_GLOW = { rapidFire: 'rgba(255,107,168,.6)', shield: 'rgba(90,208,255,.6)' };
    for (const u of (s.pu || [])) {
      const color = PU_COLORS[u.tp] || '#ffffff';
      const glow = PU_GLOW[u.tp] || 'rgba(255,255,255,.3)';
      const pulse = 1 + 0.18 * Math.sin(now * 6 + u.i);
      const r = 12 * pulse;
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(now * 2 + u.i);
      ctx.shadowColor = glow;
      ctx.shadowBlur = 16;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.6, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.tp === 'rapidFire' ? '⚡' : '🛡', 0, 1);
      ctx.restore();
    }

    // патроны для ракет (оранжевые «ящики» с ракетой)
    for (const pk of (s.mp || [])) {
      const pulse = 1 + 0.14 * Math.sin(now * 6 + pk.i);
      ctx.save();
      ctx.translate(pk.x, pk.y);
      ctx.rotate(Math.PI / 4);
      ctx.scale(pulse, pulse);
      ctx.shadowColor = 'rgba(255,180,88,.7)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#3a2a12';
      ctx.strokeStyle = '#ffb458';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.rect(-10, -10, 20, 20);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      // мини-ракета внутри
      ctx.fillStyle = '#dfe6f2';
      ctx.strokeStyle = '#8fa2c0';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(-4, -3);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-4, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // заряды способностей (броня/лазер/мины) — цветные шестиугольники
    const AP_COLORS = { armor: '#7dd8ff', laser: '#ff6b9e', mines: '#ffb458' };
    const AP_GLOW = { armor: 'rgba(125,216,255,.7)', laser: 'rgba(255,107,158,.7)', mines: 'rgba(255,180,88,.7)' };
    const AP_ICONS = { armor: '🛡', laser: '⚡', mines: '💣' };
    for (const pk of (s.ap || [])) {
      const color = AP_COLORS[pk.k] || '#ffffff';
      const glow = AP_GLOW[pk.k] || 'rgba(255,255,255,.3)';
      const pulse = 1 + 0.14 * Math.sin(now * 6 + pk.i);
      ctx.save();
      ctx.translate(pk.x, pk.y);
      ctx.rotate(now * 1.5 + pk.i);
      ctx.shadowColor = glow;
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#1a1a2e';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3;
        const r = 10 * pulse;
        if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(AP_ICONS[pk.k] || '?', 0, 1);
      ctx.restore();
    }

    // астероиды и кометы
    const TYPE_FILL = { small: '#8f97ab', medium: '#767f96', large: '#5f687e', comet: '#cfe8ff' };
    for (const a of s.as) {
      const pts = asteroidShape(a);
      // хвост кометы — против направления скорости
      if (a.tp === 'comet') {
        let vx = a.vx;
        let vy = a.vy;
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
          vx = Math.cos(a.ro || 0) * 300;
          vy = Math.sin(a.ro || 0) * 300;
        }
        const vl = Math.hypot(vx, vy) || 1;
        const ux = -vx / vl;
        const uy = -vy / vl;
        const len = 20 + a.r * 1.5 + vl * 0.18;
        const grad = ctx.createLinearGradient(a.x, a.y, a.x + ux * len, a.y + uy * len);
        grad.addColorStop(0, 'rgba(160,215,255,.85)');
        grad.addColorStop(1, 'rgba(160,215,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = a.r * 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + ux * len, a.y + uy * len);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.ro || 0);
      ctx.fillStyle = TYPE_FILL[a.tp] || '#8f97ab';
      ctx.strokeStyle = a.hp < a.mh ? '#ffb458' : (a.tp === 'comet' ? '#6db3ff' : '#39415a');
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const px = pts[k][0] * a.r;
        const py = pts[k][1] * a.r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // спутник астероида (после 2 босса)
      if (a.sa !== undefined) {
        const sx = a.x + Math.cos(a.sa) * a.sdst;
        const sy = a.y + Math.sin(a.sa) * a.sdst;
        // орбита
        ctx.strokeStyle = s.nb ? 'rgba(180,120,255,.18)' : 'rgba(120,140,180,.15)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.sdst, 0, Math.PI*2); ctx.stroke();
        // спутник
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(a.srot || 0);
        const satPts = asteroidShape({ i: a.i*9973 + 1, sd: a.sd2 });
        ctx.fillStyle = s.nb ? '#c9b6ff' : '#8f97ab';
        ctx.strokeStyle = s.nb ? '#6a4da6' : '#39415a';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let k=0;k<satPts.length;k++) {
          const px = satPts[k][0] * (a.sr || 7);
          const py = satPts[k][1] * (a.sr || 7);
          if(k===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

    // предупреждение о кометах: мигающая стрелка у края арены
    for (const cw of (s.cw || [])) {
      if ((now % 0.3) >= 0.15) continue; // мигает несколько раз
      const ang = Math.atan2(cw.vy, cw.vx);
      const pulse = (now % 0.55) / 0.55;
      // кольцо-импульс у точки входа
      ctx.strokeStyle = 'rgba(140,205,255,' + (0.55 * (1 - pulse)).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cw.x, cw.y, 10 + pulse * 26, 0, Math.PI * 2);
      ctx.stroke();
      // стрелка по направлению полёта (внутрь арены)
      ctx.save();
      ctx.translate(cw.x, cw.y);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(207,232,255,.9)';
      ctx.strokeStyle = '#6db3ff';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = 'rgba(90,208,255,.95)';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(26, 0);
      ctx.lineTo(0, -12);
      ctx.lineTo(9, 0);
      ctx.lineTo(0, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(17, 0);
      ctx.lineTo(6, -5);
      ctx.lineTo(9.5, 0);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    const WARN_ICON_COLOR = { dreadnought: '#ff9d4d', phantom: '#9d7dff', leviathan: '#4dffc8' };

    // В2: предупреждение о боссе — серия мигающих значков на стороне входа
    for (const pb of (s.pb || [])) {
      const baseKey = (pb.k || '').replace(/\++$/, '');
      const col = WARN_ICON_COLOR[baseKey] || '#ff9d4d';
      const n = BALANCE.bosses.warnIcons || 4;
      const inward = {
        0: Math.PI / 2,   // сверху — вниз
        1: Math.PI,       // справа — влево
        2: -Math.PI / 2,  // снизу — вверх
        3: 0,             // слева — вправо
      }[pb.s] ?? 0;
      const off0 = -Math.floor(n / 2);
      for (let k = 0; k < n; k++) {
        const idx = off0 + k;
        const dx = (pb.s === 0 || pb.s === 2) ? 0 : idx * 38;
        const dy = (pb.s === 0 || pb.s === 2) ? idx * 38 : 0;
        const x = pb.x + dx;
        const y = pb.y + dy;
        const urgent = pb.t < 600 ? (now % 0.25) < 0.13 : (now % 0.5) < 0.25;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(inward);
        ctx.globalAlpha = urgent ? 0.95 : 0.3;
        ctx.fillStyle = col;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(30, 0);
        ctx.lineTo(0, -13);
        ctx.lineTo(11, 0);
        ctx.lineTo(0, 13);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(20, 0);
        ctx.lineTo(7, -6);
        ctx.lineTo(11, 0);
        ctx.lineTo(7, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // имя босса рядом со значками
      const def = (pb.k && BALANCE.bosses.types[pb.k]) || null;
      if (def) {
        ctx.save();
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 8;
        const labelX = pb.s === 1 ? pb.x - 64 : pb.s === 3 ? pb.x + 64 : pb.x;
        const labelY = pb.s === 0 ? pb.y + 78 : pb.s === 2 ? pb.y - 58 : pb.y + 5;
        ctx.fillText((def.name + '').toUpperCase(), labelX, labelY);
        ctx.restore();
      }
    }

    // пули (вражеские — красные)
    ctx.lineCap = 'round';
    for (const b of s.bs) {
      ctx.strokeStyle = b.e ? '#ff6b73' : '#fff2b0';
      ctx.shadowColor = b.e ? '#ff5a66' : '#ffd75e';
      ctx.shadowBlur = 7;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - Math.cos(b.a) * 15, b.y - Math.sin(b.a) * 15);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // самонаводящиеся ракеты
    for (const k of (s.rk || [])) {
      // шлейф
      if (Math.random() < 0.75) {
        particles.push({
          x: k.x - Math.cos(k.a) * 10,
          y: k.y - Math.sin(k.a) * 10,
          vx: (Math.random() - 0.5) * 30 - Math.cos(k.a) * 40,
          vy: (Math.random() - 0.5) * 30 - Math.sin(k.a) * 40,
          life: 0.3,
          age: 0,
          r: 1.2 + Math.random() * 1.6,
          color: Math.random() < 0.5 ? '#ffb458' : '#ff8a5c',
        });
      }
      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(k.a);
      // пламя
      const fl = 8 + Math.random() * 7;
      ctx.fillStyle = Math.random() < 0.5 ? '#ff9d4d' : '#ffd75e';
      ctx.beginPath();
      ctx.moveTo(-7, -2.6);
      ctx.lineTo(-7 - fl, 0);
      ctx.lineTo(-7, 2.6);
      ctx.closePath();
      ctx.fill();
      // корпус-дротик
      ctx.fillStyle = '#dfe6f2';
      ctx.strokeStyle = '#8fa2c0';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-7, -4.4);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-7, 4.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // вражеские корабли (4 вида: охотник, бронированный, очередь, орбитальный)
    for (const en of (s.es || [])) {
      const kind = en.k || 'enemy';
      ctx.save();
      ctx.translate(en.x, en.y);
      ctx.rotate(en.a);

      if (kind === 'armored') {
        // бронированный: шестигранная бронепластина
        const fl = 7 + Math.random() * 6;
        ctx.fillStyle = Math.random() < 0.5 ? '#5b6678' : '#7a8799';
        ctx.beginPath();
        ctx.moveTo(-10, -5);
        ctx.lineTo(-10 - fl, 0);
        ctx.lineTo(-10, 5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#232a38';
        ctx.strokeStyle = '#6ec9ff';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2;
          const rr = k % 2 === 0 ? 15 : 12;
          const px = Math.cos(ang) * rr;
          const py = Math.sin(ang) * rr;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#3b4a63';
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#161d2b';
        ctx.strokeStyle = '#8fd8ff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(19, 0);
        ctx.lineTo(8, -4);
        ctx.lineTo(8, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (kind === 'burst') {
        // очередной стрелок: стреловидный с двумя стволами
        const fl = 9 + Math.random() * 8;
        ctx.fillStyle = Math.random() < 0.5 ? '#ff7b3d' : '#ffb158';
        ctx.beginPath();
        ctx.moveTo(-11, -4);
        ctx.lineTo(-11 - fl, 0);
        ctx.lineTo(-11, 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#1d1408';
        ctx.strokeStyle = '#ffb158';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(21, 0);
        ctx.lineTo(-12, -11);
        ctx.lineTo(-6, 0);
        ctx.lineTo(-12, 11);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#ff7b3d';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(22, -3); ctx.lineTo(27, -3);
        ctx.moveTo(22, 3); ctx.lineTo(27, 3);
        ctx.stroke();
        // пульс «заряженной очереди»
        const pulse = 0.6 + 0.4 * Math.sin(now * 20 + en.i);
        ctx.fillStyle = `rgba(255,160,60,${0.25 + 0.3 * pulse})`;
        ctx.beginPath();
        ctx.arc(0, 0, 2 + 3 * pulse, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 'orbital') {
        // орбитальный: круглая платформа с вращающимся кольцом
        ctx.fillStyle = '#0d1a1e';
        ctx.strokeStyle = '#4fe3c1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#8ffff0';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 18, now * 3 + en.i, now * 3 + en.i + 4.2);
        ctx.stroke();
        ctx.fillStyle = '#4fe3c1';
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c9fff2';
        ctx.beginPath();
        ctx.arc(18, 0, 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // охотник: стандартный красный
        const fl = 8 + Math.random() * 8;
        ctx.fillStyle = Math.random() < 0.5 ? '#ff5a66' : '#ff9d4d';
        ctx.beginPath();
        ctx.moveTo(-11, -4);
        ctx.lineTo(-11 - fl, 0);
        ctx.lineTo(-11, 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#1c1016';
        ctx.strokeStyle = '#ff5a66';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(20, 0);
        ctx.lineTo(-13, -12);
        ctx.lineTo(-5, 0);
        ctx.lineTo(-13, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ff8ad8';
        ctx.beginPath();
        ctx.arc(3, 0, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // полоска HP
      const bw = 30;
      if (en.h < en.hm || kind === 'armored') {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(en.x - bw / 2, en.y - 26, bw, 4);
        ctx.fillStyle = kind === 'armored' ? '#6ec9ff' : '#ff5a66';
        ctx.fillRect(en.x - bw / 2, en.y - 26, bw * Math.max(0, en.h / en.hm), 4);
      }
      // бронированный: полоска брони (иконка)
      if (kind === 'armored' && en.am > 0) {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(en.x - bw / 2, en.y - 21, bw, 3);
        ctx.fillStyle = '#4fb6ff';
        const ratio = Math.max(0, Math.min(1, (en.ar || 0) / en.am));
        ctx.fillRect(en.x - bw / 2, en.y - 21, bw * ratio, 3);
      }
      // очередной стрелок: индикатор усиления монетами
      if (kind === 'burst' && en.pw) {
        ctx.fillStyle = '#ffb158';
        for (let q = 0; q < Math.min(en.pw, 8); q++) {
          ctx.beginPath();
          ctx.arc(en.x - bw / 2 + 6 + q * 5, en.y - 31, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // кристаллы (1 = 1000 монет и способности)
    for (const cr of (s.cr || [])) {
      const pulse = 1 + 0.14*Math.sin(now*4 + cr.i);
      const isCoin = cr.k === 'coins';
      const col = isCoin ? '#ffd75e' : (cr.ab==='armor' ? '#7dd8ff' : cr.ab==='laser' ? '#ff6b9e' : '#7dff9e');
      const stroke = isCoin ? '#8a6a1d' : '#1a1a2e';
      ctx.save();
      ctx.translate(cr.x, cr.y);
      ctx.rotate(now*1.2);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = col;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // ромб
      ctx.moveTo(0, -14); ctx.lineTo(10, 0); ctx.lineTo(0, 14); ctx.lineTo(-10, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(4, 0); ctx.lineTo(0, 8); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      // подпись
      ctx.fillStyle = isCoin ? '#ffd75e' : col;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign='center';
      ctx.fillText(isCoin ? '1000' : (cr.ab==='armor'?'ЩИТ':cr.ab==='laser'?'ЛУЧ':'МИНЫ'), cr.x, cr.y+28);
    }

    // мины
    for (const m of (s.mn || [])) {
      const pulse = 1 + 0.18*Math.sin(now*6 + m.i);
      ctx.fillStyle = '#1b1f2b';
      ctx.strokeStyle = '#ffb458';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x, m.y, 10*pulse, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath(); ctx.arc(m.x, m.y, 3.2, 0, Math.PI*2); ctx.fill();
      // шипы
      ctx.strokeStyle='#ffb458'; ctx.lineWidth=1.4;
      for(let k=0;k<4;k++){ const ang=k*Math.PI/2+ now*2; ctx.beginPath(); ctx.moveTo(m.x+Math.cos(ang)*10, m.y+Math.sin(ang)*10); ctx.lineTo(m.x+Math.cos(ang)*14, m.y+Math.sin(ang)*14); ctx.stroke(); }
    }

    // лазеры (две стороны)
    for (const ls of (s.ls || [])) {
      const owner = (s.ps||[]).find(p=>p.i===ls.o);
      if(!owner) continue;
      const len = Math.hypot(W,H)+120;
      const x2 = owner.x + Math.cos(owner.a)*len;
      const y2 = owner.y + Math.sin(owner.a)*len;
      const x1 = owner.x + Math.cos(owner.a+Math.PI)*len;
      const y1 = owner.y + Math.sin(owner.a+Math.PI)*len;
      ctx.strokeStyle = 'rgba(255,80,110,.95)';
      ctx.shadowColor='#ff4d6d'; ctx.shadowBlur=14; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(owner.x, owner.y); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(owner.x, owner.y); ctx.lineTo(x1,y1); ctx.stroke();
      ctx.shadowBlur=0;
      ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(owner.x, owner.y); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(owner.x, owner.y); ctx.lineTo(x1,y1); ctx.stroke();
    }

    // лазеры боссов (В1: левиафан++)
    for (const bl of (s.bl || [])) {
      const len = 760;
      const x2 = bl.x + Math.cos(bl.a) * len;
      const y2 = bl.y + Math.sin(bl.a) * len;
      ctx.strokeStyle = 'rgba(255,70,50,.9)';
      ctx.shadowColor = '#ff2d2d'; ctx.shadowBlur = 18; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(x2, y2); ctx.stroke();
    }

    // боссы
    for (const b of (s.bo || [])) {
      const def = BALANCE.bosses.types[b.k];
      const baseKey = (b.k || '').replace(/\++$/, '');
      const r = b.r || (def ? def.radius : 50);
      const col = baseKey==='dreadnought' ? '#ff9d4d' : baseKey==='phantom' ? '#9d7dff' : '#4dffc8';
      const inside = b.x + r > 0 && b.x - r < W && b.y + r > 0 && b.y - r < H;
      if (inside) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        if (b.cl) ctx.globalAlpha = 0.45; // призрачные клоны фантома
        const pulse = 1 + 0.06*Math.sin(now*3 + b.i);
        ctx.scale(pulse, pulse);
        ctx.fillStyle = '#0f131c';
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.beginPath();
        const img = BOSS_IMGS[baseKey];
        if (img && img.complete && img.naturalWidth > 0) {
          const size = r * 3;
          ctx.save();
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(img, -size / 2, -size / 2, size, size);
          ctx.restore();
        } else {
          ctx.fillRect(-r*0.9, -r*0.65, r*1.8, r*1.3);
          ctx.strokeRect(-r*0.9, -r*0.65, r*1.8, r*1.3);
          ctx.fillStyle='#1e2a3a'; ctx.fillRect(-r*0.6, -r*0.3, r*1.2, r*0.6);
          ctx.fillStyle=col; ctx.fillRect(r*0.35, -6, 18,12);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        const bw = 74;
        ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(b.x-bw/2, b.y - r -18, bw, 7);
        ctx.fillStyle = b.h/b.hm <0.3 ? '#ff4d4d' : col;
        ctx.fillRect(b.x-bw/2, b.y - r -18, bw*Math.max(0,b.h/b.hm),7);
        ctx.fillStyle='#fff'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center';
        ctx.fillText((def?def.name:b.k).toUpperCase(), b.x, b.y - r -24);
        // В3: полоска брони (под HP-баром), пополняется монетами — у любого босса со щитом
        if (b.am > 0) {
          ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(b.x-bw/2, b.y - r -9, bw, 5);
          ctx.fillStyle='#4fb6ff';
          const aratio = Math.max(0, Math.min(1, (b.ar || 0) / b.am));
          ctx.fillRect(b.x-bw/2, b.y - r -9, bw*aratio, 5);
        }
        // В1: индикатор фаз — ромбики под HP-баром (текущая фаза ярче)
        if (b.mx > 1 && !b.cl) {
          const fx = b.mx || 1;
          const step = 12;
          const x0 = b.x - ((fx - 1) * step) / 2;
          for (let i = 1; i <= fx; i++) {
            const active = i <= (b.ph || 1);
            ctx.fillStyle = active ? '#ffd75e' : 'rgba(255,255,255,.25)';
            ctx.beginPath();
            ctx.moveTo(x0 + (i - 1) * step, b.y - r - 2);
            ctx.lineTo(x0 + (i - 1) * step + 4, b.y - r - 7);
            ctx.lineTo(x0 + (i - 1) * step + 8, b.y - r - 2);
            ctx.lineTo(x0 + (i - 1) * step + 4, b.y - r + 3);
            ctx.closePath();
            ctx.fill();
          }
        }
      } else {
        const cx = Math.max(r, Math.min(W - r, b.x));
        const cy = Math.max(r, Math.min(H - r, b.y));
        const ang = Math.atan2(b.y - cy, b.x - cx);
        const tx = cx + Math.cos(ang) * 28;
        const ty = cy + Math.sin(ang) * 28;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(ang);
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-6, -8);
        ctx.lineTo(-6, 8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle='#ff4d4d'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center';
        ctx.fillText((def?def.name:b.k).toUpperCase(), tx, ty - 12);
      }
    }

    // корабли
    for (const p of s.ps) {
      if (!p.al) continue;
      const color = SLOT_COLORS[(p.sl ?? 0) % SLOT_COLORS.length];
      const blink = p.iv > 0 && Math.sin(now * 22) < 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = blink ? 0.28 : 1;

      // косметика (Б2): цветовая подсветка / неоновое свечение вокруг корабля
      const cos = cosmeticDef(p.co);
      if (cos && cos.color) {
        const isNeon = cos.kind === 'effect';
        ctx.globalAlpha = blink ? 0.14 : (isNeon ? 0.45 : 0.22);
        ctx.fillStyle = cos.color;
        ctx.beginPath();
        ctx.arc(0, 0, isNeon ? 26 : 30, 0, Math.PI * 2);
        ctx.fill();
        if (isNeon) {
          ctx.globalAlpha = blink ? 0.35 : 0.7;
          ctx.strokeStyle = cos.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 27, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = blink ? 0.28 : 1;
      }
      ctx.rotate(p.a);

      const flameColor = cos && cos.color ? cos.color : null;
      if (p.th) { // пламя двигателя
        const fl = 10 + Math.random() * 9;
        ctx.fillStyle = flameColor || (Math.random() < 0.5 ? '#ff9d4d' : '#ffd75e');
        ctx.beginPath();
        ctx.moveTo(-13, -5);
        ctx.lineTo(-13 - fl, 0);
        ctx.lineTo(-13, 5);
        ctx.closePath();
        ctx.fill();
      }

      if (SHIP_IMG && SHIP_IMG.complete && SHIP_IMG.naturalWidth > 0) {
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(SHIP_IMG, -19, -19, 38, 38);
      } else {
        ctx.fillStyle = '#12161f';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(19, 0);
        ctx.lineTo(-12, -11);
        ctx.lineTo(-6, 0);
        ctx.lineTo(-12, 11);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(2, 0, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      const ab = p.ab;
      // аура мигает только перед истечением эффекта (<2с), иначе ровная
      const auraPulse = (msLeft) => (msLeft > 0 && msLeft < 2000) ? (0.15 + 0.85*Math.abs(Math.sin(now*16))) : 1;
      if (p.iv > 0) { // щит неуязвимости после респавна
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now * 10);
        ctx.strokeStyle = '#bff1ff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
      // временный щит с комет/врагов (голубой сплошной)
      if (ab && ab.sh > 0) {
        const pl = auraPulse(ab.sh);
        ctx.globalAlpha = 0.62 * pl;
        ctx.strokeStyle = '#5ad0ff';
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(0,0, 26, 0,Math.PI*2); ctx.stroke();
        ctx.globalAlpha = 0.24 * pl;
        ctx.fillStyle = '#5ad0ff';
        ctx.beginPath(); ctx.arc(0,0, 26, 0,Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // ускорение стрельбы (оранжевое свечение)
      if (ab && ab.rf > 0) {
        const pl = auraPulse(ab.rf);
        ctx.globalAlpha = 0.54 * pl;
        ctx.strokeStyle = '#ff6ba8';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0,0, 30, 0,Math.PI*2); ctx.stroke();
        ctx.globalAlpha = 0.16 * pl;
        ctx.fillStyle = '#ff6ba8';
        ctx.beginPath(); ctx.arc(0,0, 30, 0,Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // постоянный щит от босса (1 заряд, пунктир) — постоянный, не мигает
      if (ab && ab.ar && ab.ac>0) {
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = '#7dd8ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.arc(0,0, 30, 0,Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // частицы поверх
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.age += dt;
      if (pt.age >= pt.life) { particles.splice(i, 1); continue; }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.exp(-2.2 * dt);
      pt.vy *= Math.exp(-2.2 * dt);
      ctx.globalAlpha = 1 - pt.age / pt.life;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  requestAnimationFrame(frame);

  // ===== HUD =====
  const hudEls = {
    left: document.getElementById('hudLeft'),
    right: document.getElementById('hudRight'),
    timer: document.getElementById('timerText'),
    timerSub: document.getElementById('timerSub'),
    abilityBar: document.getElementById('abilityBar'),
    godBadge: document.getElementById('godModeBadge'),
    upgBtns: [...document.querySelectorAll('.upg-btn')],
  };
  const hudCache = {};

  function fmtTime(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  function buildCard(el, p, color) {
    el.style.borderColor = color;
    const key = p.i + '|' + p.n + '|' + p.s + '|' + p.l + '|' + p.c + '|' + p.e + '|' + p.o + '|' + p.mk + '|' + p.hm + '|' + (p.lv||1) + '|' + Math.ceil((p.rs || 0) / 1000);
    if (hudCache[el.id] !== key) {
      hudCache[el.id] = key;
      const lives = p.o ? '✕' : '♥'.repeat(p.l) + '<span style="opacity:.25">' + '♥'.repeat(Math.max(0, BALANCE.ship.lives - p.l)) + '</span>';
      const lv = p.lv || 1;
      const thr = Math.round(BALANCE.exp.baseThreshold * Math.pow(BALANCE.exp.multiplier, lv - 1));
      el.innerHTML =
        `<div class="ph-nick" style="color:${color}">${escapeHtml(p.n)}</div>` +
        `<div class="ph-score">${p.s}</div>` +
        `<div class="ph-line"><span class="lives">${lives}</span>` +
        `<span class="coins-ico">● ${p.c}</span>` +
        `<span class="lvl-ico" title="Уровень rogue-like">★ ${lv}</span>` +
        `<span class="energy-ico" title="Энергия (экспа: ${p.e}/${thr})">✦ ${p.e}/${thr}</span>` +
        (p.hm ? `<span class="rockets-ico" title="Боезапас ракет">🚀 ${p.mk}/${p.mm || BALANCE.missile.maxAmmo}</span>` : '') +
        (p.rs > 0 ? `<span style="color:#ffc24b">возрождение ${Math.ceil(p.rs / 1000)}…</span>` : '') +
        '</div>';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function updateUpgrades(p) {
    // A1: внутриматчевый магазин за монеты отключён — апгрейды берутся в Ангаре
    for (const btn of hudEls.upgBtns) {
      const pipsEl = btn.querySelector('.pips');
      const costEl = btn.querySelector('.cost');
      if (pipsEl && pipsEl.textContent !== '') pipsEl.textContent = '';
      if (costEl && costEl.textContent !== 'Ангар') costEl.textContent = 'Ангар';
      btn.disabled = true;
    }
  }

  return {
    getView: () => view,

    // вызывается каждый кадр из игрового цикла
    setState(s) {
      // новые эффекты → частицы/звук
      if (s.fx) for (const f of s.fx) spawnFxParticles(f);
      // новые предупреждения о кометах → звук/напоминание
      if (s.cw) {
        for (const cw of s.cw) {
          if (seenCometWarn.has(cw.i)) continue;
          seenCometWarn.add(cw.i);
          if (seenCometWarn.size > 400) {
            const arr = [...seenCometWarn].slice(-200);
            seenCometWarn.clear();
            arr.forEach((v) => seenCometWarn.add(v));
          }
          if (onCometWarnCb) onCometWarnCb(cw, current);
        }
      }
      current = s;
    },

    resetFx() {
      particles.length = 0;
      seenFx.clear();
      shake = 0;
      for (const k of Object.keys(hudCache)) delete hudCache[k];
    },

    updateHud(s, selfId, opts = {}) {
      const ps = s.ps || [];
      const left = ps.find((p) => p.sl === 0) ?? ps[0] ?? null;
      const right = ps.find((p) => p.sl === 1) ?? (ps.length > 1 ? ps[ps.length - 1] : null);
      if (left) buildCard(hudEls.left, left, SLOT_COLORS[0]);
      else hudEls.left.innerHTML = '';
      if (right) buildCard(hudEls.right, right, SLOT_COLORS[1]);
      else hudEls.right.innerHTML = '';
      hudEls.left.classList.toggle('self', !!left && left.i === selfId);
      hudEls.right.classList.toggle('self', !!right && right.i === selfId);

      const me = left?.i === selfId ? left : right?.i === selfId ? right : null;
      if (me) updateUpgrades(me);

      const timerText = opts.solo ? fmtTime(s.t) : (s.tl != null ? fmtTime(s.tl) : '∞');
      if (hudEls.timer.textContent !== timerText) hudEls.timer.textContent = timerText;
      const sub = opts.subText || (opts.solo ? 'время полёта' : 'до конца матча');
      if (hudEls.timerSub.textContent !== sub) hudEls.timerSub.textContent = sub;

      if (hudEls.godBadge) hudEls.godBadge.classList.toggle('hidden', !s.gm);

      // способности и временные пауэр-апы
      if (hudEls.abilityBar) {
        if (!me || !me.ab) hudEls.abilityBar.innerHTML='';
        else {
          const ab = me.ab;
          const fmt = (ms)=> ms<=0 ? 'ГОТОВ' : Math.ceil(ms/1000)+'с';
          const parts=[];
          if (ab.sh > 0) parts.push(`<span style="padding:2px 6px;border-radius:6px;background:#0a2e4a;color:#5ad0ff;border:1px solid #2a6ea6">🛡 врем. щит ${Math.ceil(ab.sh/1000)}с</span>`);
          if (ab.rf > 0) parts.push(`<span style="padding:2px 6px;border-radius:6px;background:#4a1a3a;color:#ff6ba8;border:1px solid #a62a6e">⚡ ускорение ${Math.ceil(ab.rf/1000)}с</span>`);
          if (ab.ar) parts.push(`<span style="padding:2px 6px;border-radius:6px;background:${ab.ac>0?'#0e3a4a':'#1a1a1a'};color:${ab.ac>0?'#7dd8ff':'#555'};border:1px solid #2a5a6e">🛡 Броня ${ab.ac}/${ab.amx||5}</span>`);
          if (ab.ls) {
            const active = ab.la>0;
            const ready = ab.lac>0 && !active && ab.lc<=0;
            parts.push(`<span style="padding:2px 6px;border-radius:6px;background:${active?'#4a0e1a':ready?'#3a1a2a':'#1a1a1a'};color:${ab.lac>0?'#ff7a9e':'#555'};border:1px solid #6e2a3a">Q ЛАЗЕР ${ab.lac}/${ab.lamx||3} ${active? '🔥 '+Math.ceil(ab.la/1000)+'с' : (ab.lac>0&&ab.lc>0?fmt(ab.lc):(ab.lac<=0?'нет зарядов':''))}</span>`);
          }
          if (ab.mn) {
            const maxM = ab.mx||10;
            const ready = ab.ml>0 && ab.mc<=0;
            parts.push(`<span style="padding:2px 6px;border-radius:6px;background:${ab.ml>0?(ready?'#2a2a0e':'#222'):'#1a1a1a'};color:${ab.ml>0?'#ffd27a':'#555'};border:1px solid #6e5a2a">E МИНЫ ${ab.ml}/${maxM} ${ab.ml>0&&ab.mc>0? '('+fmt(ab.mc)+')':(ab.ml<=0?'нет зарядов':'')}</span>`);
          }
          hudEls.abilityBar.innerHTML = parts.join('');
        }
      }
    },

    onFx(fn) { onFxSound = fn; },
    onCometWarn(fn) { onCometWarnCb = fn; },
  };
}
