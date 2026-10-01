// Ангар (Б2): оверлей между матчами — банк режима (solo/multi отдельно) и три
// раздела: базовые характеристики, модули, косметика. Покупки идут через сервер
// (api.hangarBuyStat / module:* / api.cosmeticBuy / api.cosmeticEquip).
import { BALANCE } from '/shared/balance.js';
import { moduleCost } from '/shared/world.js';

const MAX_LVL = BALANCE.hangar.maxLevel;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function createHangar({ api, getStats, setStats, requireOnline, toast }) {
  const els = {
    overlay: document.getElementById('hangarOverlay'),
    banks: document.getElementById('hangarBanks'),
    bankLabel: document.getElementById('hangarBankLabel'),
    tabs: document.getElementById('hangarTabs'),
    body: document.getElementById('hangarBody'),
    error: document.getElementById('hangarError'),
    closeBtn: document.getElementById('hangarCloseBtn'),
  };

  let mode = 'solo'; // выбранный банк: из него платим и читаем прогресс
  let tab = 'stats'; // stats | modules | cosmetics
  let busy = false;

  function stats() {
    return getStats() || {};
  }

  function fmtCoins(n) {
    return (Number(n) || 0).toLocaleString('ru-RU');
  }

  function fail(msg) {
    els.error.textContent = msg || '';
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    try {
      const res = await fn();
      if (res && res.error) {
        fail(ERR_TEXT[res.error] || res.message || 'Не удалось выполнить');
      } else if (res && res.ok && res.data) {
        setStats(res.data);
        fail('');
        render();
      }
    } catch (e) {
      fail('Сервер недоступен');
    } finally {
      busy = false;
    }
  }

  function open() {
    if (!requireOnline()) return;
    mode = 'solo';
    tab = 'stats';
    setModeButtons();
    setTabButtons();
    render();
    els.overlay.classList.remove('hidden');
  }

  function close() {
    els.overlay.classList.add('hidden');
  }

  function setModeButtons() {
    for (const btn of els.banks.children) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    }
    els.bankLabel.textContent =
      `Банк «${mode === 'multi' ? 'Multi' : 'Solo'}»: 🪙 ${fmtCoins(mode === 'multi' ? stats().coinsMulti : stats().coinsSolo)}`;
  }

  function setTabButtons() {
    for (const btn of els.tabs.children) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
  }

  // --- характеристика: пипсы уровней + текущий/следующий бонус ---
  function statBlock(def, level, coins) {
    const row = document.createElement('div');
    row.className = 'hangar-row';
    const pips = document.createElement('span');
    pips.className = 'h-pips';
    pips.textContent = Array.from({ length: MAX_LVL }, (_, i) => (i < level ? '●' : '○')).join('');
    pips.title = `Уровень ${level} из ${MAX_LVL}`;

    const cur = def.coefs[level - 1] * 100;
    const next = def.coefs[level] * 100;

    const info = document.createElement('span');
    info.className = 'h-info';
    info.textContent = level === 0
      ? `${def.icon} ${def.desc.replace('%', '')} пока не усилил`
      : `${def.icon} уровень ${level} · ${cur}%`;

    const btn = document.createElement('button');
    btn.className = 'btn h-btn';
    if (level >= MAX_LVL) {
      btn.textContent = 'Максимум';
      btn.disabled = true;
    } else {
      const cost = def.costs[level];
      btn.textContent = `Улучшить ${cost} 🪙 → ${next}%`;
      btn.disabled = coins < cost;
      btn.addEventListener('click', () => run(() => api.hangarBuyStat(def.key, mode)));
    }
    row.append(escEl(def.icon + ' ' + def.name), pips, info, btn);
    return row;
  }

  // --- модуль (Б1): разблокировка → активация → улучшение ---
  function moduleBlock(key) {
    const def = BALANCE.upgrades.modules[key];
    const st = stats().modules && stats().modules[mode];
    const unlocked = !!(st && st.unlocked && st.unlocked[key]);
    const active = !!(st && st.active && st.active[key]);
    const level = (st && st.levels && st.levels[key]) || 0;
    const safe = getSafeBanks();
    const coins = mode === 'multi' ? safe.coinsMulti : safe.coinsSolo;

    const row = document.createElement('div');
    row.className = 'hangar-row hangar-module';

    const name = document.createElement('span');
    name.className = 'h-name';
    name.textContent = `${def.name} · ур. ${level}`;

    const desc = document.createElement('span');
    desc.className = 'h-desc';
    desc.textContent = def.desc;

    const state = document.createElement('span');
    state.className = 'h-state';
    if (!unlocked) state.textContent = '🔒 Закрыт';
    else if (!active) state.textContent = '🔓 Разблокирован, не активен';
    else state.textContent = `✅ Активен (ур. ${level}/${def.maxLevel})`;

    row.append(name, desc, state);

    const actions = document.createElement('span');
    actions.className = 'h-actions';
    if (!unlocked) {
      if (def.unlockableFromBoss) {
        actions.append(escEl('Добудьте с босса Фантом'));
      } else {
        const cost = moduleCost(key, 'unlock');
        const btn = document.createElement('button');
        btn.className = 'btn h-btn';
        btn.textContent = `Разблокировать ${cost} 🪙`;
        btn.disabled = coins < cost;
        btn.addEventListener('click', () => run(() => api.moduleUnlock(key, mode)));
        actions.append(btn);
      }
    } else if (!active) {
      const cost = moduleCost(key, 'activate');
      const btn = document.createElement('button');
      btn.className = 'btn primary h-btn';
      btn.textContent = `Активировать ${cost} 🪙`;
      btn.disabled = coins < cost;
      btn.addEventListener('click', () => run(() => api.moduleSetActive(key, true, mode)));
      actions.append(btn);
    } else {
      const upCost = moduleCost(key, 'upgrade', level);
      if (upCost != null) {
        const btn = document.createElement('button');
        btn.className = 'btn h-btn';
        btn.textContent = `Улучшить ${upCost} 🪙`;
        btn.disabled = coins < upCost;
        btn.addEventListener('click', () => run(() => api.moduleUpgrade(key, mode)));
        actions.append(btn);
      } else {
        const max = document.createElement('button');
        max.className = 'btn h-btn';
        max.textContent = 'Максимум';
        max.disabled = true;
        actions.append(max);
      }
      const off = document.createElement('button');
      off.className = 'btn h-btn h-off';
      off.textContent = 'Снять';
      off.addEventListener('click', () => run(() => api.moduleSetActive(key, false, mode)));
      actions.append(off);
    }
    row.append(actions);
    return row;
  }

  // --- косметика: цвет корабля / эффект ---
  function cosmeticBlock(def, owned, equipped) {
    const row = document.createElement('div');
    row.className = 'hangar-row hangar-cosmetic';
    const swatch = document.createElement('span');
    swatch.className = 'h-swatch' + (def.kind === 'effect' ? ' glow' : '');
    swatch.style.background = def.color || 'linear-gradient(135deg,#5ad0ff,#b88bff)';
    swatch.title = def.desc;

    const name = document.createElement('span');
    name.className = 'h-name';
    name.textContent = def.name;

    const state = document.createElement('span');
    state.className = 'h-state';
    if (!owned) state.textContent = 'Куплено: нет';
    else state.textContent = equipped === def.key ? '✅ Надето' : 'Куплено';

    const safe = getSafeBanks();
    const coins = mode === 'multi' ? safe.coinsMulti : safe.coinsSolo;
    const btn = document.createElement('button');
    btn.className = 'btn h-btn';
    if (!owned) {
      btn.textContent = `Купить ${def.cost} 🪙`;
      btn.disabled = coins < def.cost;
      btn.addEventListener('click', () => run(() => api.cosmeticBuy(def.key, mode)));
    } else if (equipped === def.key) {
      btn.textContent = 'Надето';
      btn.disabled = true;
    } else {
      btn.textContent = 'Экипировать';
      btn.addEventListener('click', () => run(() => api.cosmeticEquip(def.key)));
    }
    row.append(swatch, name, state, btn);
    return row;
  }

  // защита от отсутствующих данных старой сессии
  function getSafeBanks() {
    return stats();
  }

  function render() {
    setModeButtons();
    setTabButtons();
    els.body.textContent = '';
    const st = stats();
    const banco = mode === 'multi' ? st.coinsMulti : st.coinsSolo;

    if (tab === 'stats') {
      for (const def of BALANCE.hangar.stats) {
        const hg = (st.hangar && st.hangar[mode]) || {};
        els.body.append(statBlock(def, hg[def.key] || 0, banco));
      }
    } else if (tab === 'modules') {
      if (!st.modules) {
        els.body.append(escEl('Данные о модулях отсутствуют — переподключитесь.'));
        return;
      }
      for (const key of Object.keys(BALANCE.upgrades.modules)) {
        els.body.append(moduleBlock(key));
      }
    } else {
      const cos = st.cosmetics || { owned: [], equipped: 'default' };
      for (const def of BALANCE.hangar.cosmetics) {
        els.body.append(cosmeticBlock(def, cos.owned.includes(def.key), cos.equipped));
      }
    }
  }

  function escEl(text) {
    const span = document.createElement('span');
    span.className = 'h-desc';
    span.textContent = text;
    return span;
  }

  els.banks.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    mode = btn.dataset.mode || 'solo';
    render();
  });

  els.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    tab = btn.dataset.tab || 'stats';
    render();
  });

  els.closeBtn.addEventListener('click', close);

  return { open, close };
}

const ERR_TEXT = {
  'not-enough-coins': 'Не хватает монет в банке режима',
  'max-level': 'Максимальный уровень',
  'already-unlocked': 'Уже разблокировано',
  'already-active': 'Уже активно',
  'not-unlocked': 'Сначала разблокируйте модуль',
  'already-owned': 'Уже куплено',
  'not-owned': 'Сначала купите предмет',
  'already-equipped': 'Уже надето',
  'unknown-stat': 'Неизвестная характеристика',
  'unknown-module': 'Неизвестный модуль',
  'unknown-cosmetic': 'Неизвестный предмет',
};