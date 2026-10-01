// Мультиплеер: сервер авторитетен. Клиент шлёт инпуты (~20 Гц) и рисует
// интерполированные снапшоты с задержкой ~120 мс.
import { showCardPicker, hideCardPicker } from './cards.js';

const INTERP_DELAY_MS = 120;
const SEND_INTERVAL_MS = 50;

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function startMultiGame({ net, renderer, input, selfId, onOver, onBuyResult }) {
  const buffer = []; // [{ recvAt, s }]
  const offState = net.on('game:state', (s) => {
    buffer.push({ recvAt: performance.now(), s });
    if (buffer.length > 30) buffer.shift();
  });
  const offOver = net.on('game:over', () => {
    // результаты покажет main.js; здесь просто останавливаемся
    stop();
  });
  hideCardPicker();
  let pickerBusy = false;

  // А3: в свежем снапшоте появились карточки уровня → показываем оверлей,
  // выбор уходит на сервер (card:select), сервер применяет карточку и гасит pc.
  function checkCards(latest) {
    const me = latest && Array.isArray(latest.ps) ? latest.ps.find((p) => p.i === selfId) : null;
    const pending = (latest && latest.pc && me) ? latest.pc[me.i] : null;
    if (pending && pending.length && !pickerBusy) {
      pickerBusy = true;
      showCardPicker(pending, (cardId) => {
        net.api.selectCard(cardId);
        pickerBusy = false;
      });
    } else if (!pending && pickerBusy) {
      pickerBusy = false;
      hideCardPicker();
    }
  }

  async function doBuy(track) {
    const res = await net.api.buyUpgrade(track);
    if (onBuyResult) onBuyResult(res ?? { error: 'offline' });
    return res;
  }

  let pendingLaser=false, pendingMine=false;
  const sendTimer = setInterval(() => {
    if (!net.isConnected()) return;
    const me = findSelf();
    const move = input.getMove();
    if (input.wantsLaser()) pendingLaser = input.consumeLaser() || true;
    if (input.wantsMine()) pendingMine = input.consumeMine() || true;
    net.api.sendInput({
      mx: move.mx,
      my: move.my,
      aim: me ? input.getAim(me.x, me.y) : undefined,
      shoot: me && me.al ? input.isShooting() : false,
      mis: me && me.al ? input.wantsMissile() : false,
      laser: me && me.al ? pendingLaser : false,
      mine: me && me.al ? pendingMine : false,
    });
    pendingLaser=false; pendingMine=false;
  }, SEND_INTERVAL_MS);

  let raf = null;

  function findSelf() {
    if (!buffer.length) return null;
    return buffer[buffer.length - 1].s.ps.find((p) => p.i === selfId) ?? null;
  }

  function interpolated(renderAt) {
    // ищем пару снапшотов s0 <= renderAt <= s1
    for (let i = buffer.length - 1; i > 0; i--) {
      const s1 = buffer[i];
      const s0 = buffer[i - 1];
      if (s0.recvAt <= renderAt && renderAt <= s1.recvAt) {
        const span = Math.max(s1.recvAt - s0.recvAt, 1);
        const t = (renderAt - s0.recvAt) / span;
        return blend(s0.s, s1.s, t);
      }
    }
    return buffer.length ? buffer[buffer.length - 1].s : null;
  }

  function blend(a, b, t) {
    const byIdA = new Map(a.ps.map((p) => [p.i, p]));
    const ps = b.ps.map((p) => {
      const pa = byIdA.get(p.i);
      if (!pa) return p;
      return {
        ...p,
        x: lerp(pa.x, p.x, t),
        y: lerp(pa.y, p.y, t),
        a: lerpAngle(pa.a, p.a, t),
      };
    });
    const asByIdA = new Map(a.as.map((x) => [x.i, x]));
    const csByIdA = new Map(a.cs.map((x) => [x.i, x]));
    const as = b.as.map((x) => {
      const xa = asByIdA.get(x.i);
      return xa ? { ...x, x: lerp(xa.x, x.x, t), y: lerp(xa.y, x.y, t) } : x;
    });
    const cs = b.cs.map((x) => {
      const xa = csByIdA.get(x.i);
      return xa ? { ...x, x: lerp(xa.x, x.x, t), y: lerp(xa.y, x.y, t) } : x;
    });
    const boByIdA = new Map((a.bo||[]).map(x=>[x.i,x]));
    const crByIdA = new Map((a.cr||[]).map(x=>[x.i,x]));
    const puByIdA = new Map((a.pu||[]).map(x=>[x.i,x]));
    const bo = (b.bo||[]).map(x=>{ const xa=boByIdA.get(x.i); return xa?{...x,x:lerp(xa.x,x.x,t), y:lerp(xa.y,x.y,t), a:lerpAngle(xa.a,x.a,t)}:x; });
    const cr = (b.cr||[]).map(x=>{ const xa=crByIdA.get(x.i); return xa?{...x,x:lerp(xa.x,x.x,t), y:lerp(xa.y,x.y,t)}:x; });
    const pu = (b.pu||[]).map(x=>{ const xa=puByIdA.get(x.i); return xa?{...x,x:lerp(xa.x,x.x,t), y:lerp(xa.y,x.y,t)}:x; });
    const esByIdA = new Map((a.es || []).map((x) => [x.i, x]));
    const rkByIdA = new Map((a.rk || []).map((x) => [x.i, x]));
    const es = (b.es || []).map((x) => {
      const xa = esByIdA.get(x.i);
      return xa ? { ...x, x: lerp(xa.x, x.x, t), y: lerp(xa.y, x.y, t), a: lerpAngle(xa.a, x.a, t) } : x;
    });
    const rk = (b.rk || []).map((x) => {
      const xa = rkByIdA.get(x.i);
      return xa ? { ...x, x: lerp(xa.x, x.x, t), y: lerp(xa.y, x.y, t), a: lerpAngle(xa.a, x.a, t) } : x;
    });
    return { ...b, ps, as, cs, pu: pu||b.pu||a.pu, bo, cr, es, rk, mn:b.mn||a.mn, ls:b.ls||a.ls };
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    // покупка апгрейда с клавиш 1/2
    const buyTrack = input.consumeBuyKey();
    if (buyTrack) doBuy(buyTrack);

    const renderAt = performance.now() - INTERP_DELAY_MS;
    const state = interpolated(renderAt);
    if (state) {
      // карточки берём из свежего снапшота (буфер), а не из интерполированного
      const latest = buffer.length ? buffer[buffer.length - 1].s : null;
      checkCards(latest);
      renderer.setState(state);
      renderer.updateHud(state, selfId);
    }
  }

  raf = requestAnimationFrame(frame);

  function stop() {
    clearInterval(sendTimer);
    offOver();
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    hideCardPicker();
  }

  return {
    buy: doBuy,
    stop,
  };
}
