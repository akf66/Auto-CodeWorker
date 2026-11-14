  /* ---------- dropdowns: a drawn listbox over every <select> ----------
     The native element stays in the page as the value and the event source, so forms, validation and handlers do not change.
     It is taken out of the tab order; a button shows its value and opens a popup list. Long lists get a search box. */
  let ddOpen = null, ddSeq = 0, ddType = '', ddTypeAt = 0;
  const ddSet = (el, k, v) => { if (v == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== String(v)) el.setAttribute(k, v); };
  const ddSync = sel => {
    const { btn } = sel._dd, val = btn.firstElementChild, text = sel.selectedOptions[0]?.textContent || '';
    if (val.textContent !== text) val.textContent = text;
    if (btn.disabled !== sel.disabled) btn.disabled = sel.disabled;
    ddSet(btn, 'aria-invalid', sel.getAttribute('aria-invalid')); ddSet(btn, 'aria-describedby', sel.getAttribute('aria-describedby'));
    ddSet(btn, 'aria-label', `${sel._dd.name}：${text}`);
  };
  const ddEnhance = () => $$('select').forEach(sel => {
    if (!sel._dd) {
      const id = `dd-${++ddSeq}`, wrap = sel.closest('.select-wrap') || sel.parentElement, btn = document.createElement('button'), pop = document.createElement('div');
      const name = sel.getAttribute('aria-label') || sel.labels?.[0]?.textContent.trim() || '选项';
      btn.type = 'button'; btn.className = `dd__btn${sel.classList.contains('mono') ? ' mono' : ''}`; btn.innerHTML = '<span class="dd__val"></span>';
      btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', id);
      pop.className = 'dd__pop'; pop.id = id; pop.hidden = true;
      wrap.classList.add('dd'); sel.classList.add('dd__native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
      sel.after(btn); wrap.append(pop); sel._dd = { btn, pop, name, id }; btn._sel = pop._sel = sel;
    }
    ddSync(sel);
  });
  /* fixed to the viewport so a scrolling table cannot clip it; opens upward when there is more room above */
  const ddPlace = (pop, btn) => {
    const r = btn.getBoundingClientRect(), below = innerHeight - r.bottom - 12, above = r.top - 12, up = below < 220 && above > below;
    pop.style.minWidth = `${r.width}px`; pop.style.maxHeight = `${Math.max(140, Math.min(340, up ? above : below))}px`;
    pop.style.top = up ? 'auto' : `${r.bottom + 4}px`; pop.style.bottom = up ? `${innerHeight - r.top + 4}px` : 'auto';
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
  };
  const ddFilter = (pop, q) => { $$('.dd__opt', pop).forEach(o => { o.hidden = !!q && !o.textContent.toLowerCase().includes(q); }); const list = $$('.dd__opt:not([hidden])', pop); $('.dd__none', pop).hidden = list.length > 0; return list; };
  const ddOpts = () => $$('.dd__opt:not([hidden])', ddOpen._dd.pop);
  const ddActive = (el, scroll = true) => {
    const { pop } = ddOpen._dd; $$('.dd__opt.is-active', pop).forEach(o => o.classList.remove('is-active'));
    const focus = [$('.dd__search', pop), $('.dd__list', pop)].filter(Boolean);
    if (!el) { focus.forEach(f => f.removeAttribute('aria-activedescendant')); return; }
    el.classList.add('is-active'); focus.forEach(f => f.setAttribute('aria-activedescendant', el.id)); if (scroll) el.scrollIntoView({ block: 'nearest' });
  };
  const ddHide = refocus => {
    if (!ddOpen) return; const sel = ddOpen, { btn, pop } = sel._dd; ddOpen = null;
    pop.hidden = true; pop.innerHTML = ''; btn.setAttribute('aria-expanded', 'false'); if (refocus && btn.isConnected) btn.focus();
  };
  const ddShow = sel => {
    ddHide(); const { btn, pop, name, id } = sel._dd, opts = [...sel.options], search = opts.length > 8;
    pop.innerHTML = `${search ? `<div class="dd__find"><input class="dd__search input" type="text" role="combobox" aria-expanded="true" aria-controls="${id}-l" aria-autocomplete="list" aria-label="在${esc(name)}里搜索" placeholder="搜索" autocomplete="off" spellcheck="false"></div>` : ''}
      <ul class="dd__list${sel.classList.contains('mono') ? ' mono' : ''}" id="${id}-l" role="listbox" aria-label="${esc(name)}" tabindex="-1">${opts.map((o, i) => `<li class="dd__opt" id="${id}-o${i}" role="option" data-i="${i}" aria-selected="${o.selected}"${o.disabled ? ' aria-disabled="true"' : ''}><span>${esc(o.textContent)}</span>${o.selected ? I.check : ''}</li>`).join('')}</ul>
      <p class="dd__none" hidden>没有匹配的选项</p>`;
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); ddOpen = sel;
    ddPlace(pop, btn);
    ddActive($(`.dd__opt[aria-selected="true"]`, pop) || ddOpts()[0]);
    /* on a touch screen the search box is not focused, so the keyboard does not cover the list until someone wants it */
    ((!matchMedia('(pointer: coarse)').matches && $('.dd__search', pop)) || $('.dd__list', pop)).focus({ preventScroll: true });
  };
  const ddPick = el => {
    if (!el || el.getAttribute('aria-disabled') === 'true') return; const sel = ddOpen, i = +el.dataset.i, changed = sel.selectedIndex !== i;
    ddHide(true);
    /* closed and focus back on the button before anyone hears about the change: a handler is then free to re-render or move focus */
    if (changed) { sel.selectedIndex = i; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  /* what a connection returned from /models: the same popup, read-only, each model tagged with the stages that use it */
  /* the prototype's model-list popup is not part of the live console */
  let mlBtn = null; const mlPop = { contains: () => false }; const mlHide = () => {}; const mlShow = () => {};
  document.addEventListener('click', e => {
    const ml = e.target.closest('.mlist__btn');
    if (ml) { if (mlBtn === ml) mlHide(true); else mlShow(ml); return; }
    if (mlBtn && !e.target.closest('#mlpop')) mlHide();
    const btn = e.target.closest('.dd__btn'), opt = e.target.closest('.dd__opt');
    if (opt && ddOpen && !opt.closest('#mlpop')) { ddPick(opt); return; }
    if (btn) { if (ddOpen === btn._sel) ddHide(true); else ddShow(btn._sel); return; }
    if (ddOpen && !e.target.closest('.dd__pop')) ddHide();
  });
  document.addEventListener('keydown', e => {
    if (mlBtn && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); mlHide(true); return; }
    const btn = e.target.closest?.('.dd__btn');
    if (btn && !ddOpen && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); ddShow(btn._sel); return; }
    if (!ddOpen || !e.target.closest?.('.dd__pop')) return;
    const list = ddOpts(), at = list.indexOf($('.dd__opt.is-active', ddOpen._dd.pop)), go = i => { e.preventDefault(); ddActive(list[Math.max(0, Math.min(list.length - 1, i))]); };
    if (e.key === 'ArrowDown') go(at + 1); else if (e.key === 'ArrowUp') go(at - 1); else if (e.key === 'Home' && !e.target.matches('.dd__search')) go(0); else if (e.key === 'End' && !e.target.matches('.dd__search')) go(list.length - 1);
    else if (e.key === 'Enter' || (e.key === ' ' && !e.target.matches('.dd__search'))) { e.preventDefault(); ddPick(list[at]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ddHide(true); }
    else if (e.key === 'Tab') ddHide(true);
    else if (e.key.length === 1 && !e.target.matches('.dd__search')) { const t = Date.now(); ddType = t - ddTypeAt > 600 ? e.key : ddType + e.key; ddTypeAt = t; const hit = list.find(o => o.textContent.trim().toLowerCase().startsWith(ddType.toLowerCase())); if (hit) ddActive(hit); }
  }, true);
  document.addEventListener('input', e => {
    if (!e.target.matches?.('.dd__search')) return; e.stopPropagation(); const q = e.target.value.trim().toLowerCase();
    if (mlBtn && mlPop.contains(e.target)) ddFilter(mlPop, q);
    else if (ddOpen) { const list = ddFilter(ddOpen._dd.pop, q); ddActive(list.find(o => o.getAttribute('aria-selected') === 'true') || list[0]); }
  }, true);
  document.addEventListener('mousemove', e => { const o = ddOpen && !e.target.closest?.('#mlpop') && e.target.closest?.('.dd__opt'); if (o && !o.classList.contains('is-active')) ddActive(o, false); });
  document.addEventListener('focusin', e => { if (mlBtn && e.target !== mlBtn && !mlPop.contains(e.target)) mlHide(); if (e.target._dd) e.target._dd.btn.focus(); else if (ddOpen && !e.target.closest('.dd')) ddHide(); });
  $('.main').addEventListener('scroll', () => { ddHide(); mlHide(); }, { passive: true });
  window.addEventListener('resize', () => { ddHide(); mlHide(); });
  let ddQueued = false;
  new MutationObserver(() => { if (ddQueued) return; ddQueued = true; queueMicrotask(() => { ddQueued = false; if (ddOpen && !ddOpen.isConnected) ddOpen = null; ddEnhance(); }); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-invalid', 'disabled'] });
  ddEnhance();

