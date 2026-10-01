// UI-оверлей выбора карточки при росте уровня rogue-like (А3).
// Оверлей построен в index.html; модуль управляет видимостью и колбэками.

let open = false;
let onSelectCb = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function showCardPicker(cards, fn) {
  onSelectCb = fn;
  const el = document.getElementById('cardPicker');
  const row = el.querySelector('.card-picker-row');
  row.innerHTML = '';
  (cards || []).forEach((card) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card-option';
    b.innerHTML =
      `<span class="card-option-icon">${esc(card.icon)}</span>` +
      `<span class="card-option-name">${esc(card.name)}</span>` +
      `<span class="card-option-desc">${esc(card.desc)}</span>`;
    b.addEventListener('click', () => {
      if (!open || !onSelectCb) return;
      const fn2 = onSelectCb;
      hideCardPicker();
      fn2(card.id);
    });
    row.appendChild(b);
  });
  open = true;
  el.classList.remove('hidden');
}

export function hideCardPicker() {
  open = false;
  onSelectCb = null;
  const el = document.getElementById('cardPicker');
  if (el) el.classList.add('hidden');
}

export function isCardPickerOpen() {
  return open;
}
