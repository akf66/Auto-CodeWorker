/* Auto-CodWorker console. Talks to the Engine's HTTP API; no sample data. Built from console/src by scripts/build-console.py. */
(() => {
  'use strict';
  const I = {
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
    x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
    clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M8 5v3.2l2 1.3" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
    hand: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v6M5 4v5M11 4v5M5 9c0 3 1.5 5 3 5s3-2 3-5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5l7 4.5-7 4.5z" fill="currentColor"/></svg>',
    file: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h5l3 3v9H4z M9 2v3h3" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l1-3 7-7 2 2-7 7z" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    term: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4l4 4-4 4M8 12h5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
    tool: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M5.5 8h5M8 5.5v5" stroke="currentColor" stroke-width="1.3"/></svg>',
    flag: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 14V2.5h7l-1.5 3 1.5 3H4" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    box: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5L8 2l5.5 3v6L8 14l-5.5-3z M2.5 5L8 8l5.5-3 M8 8v6" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
    gate: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l5.5 2v4.2c0 3.3-2.4 5.6-5.5 6.8-3.1-1.2-5.5-3.5-5.5-6.8V3.5z" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    alert: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l6.5 11.5h-13z M8 6.5v3.5M8 11.6v.4" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
    chev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5l4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    ext: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9M11 3.5v9" stroke="currentColor" stroke-width="1.8"/></svg>',
    redo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.5 7.5A4.5 4.5 0 1 1 11 4.2M12.5 2.5v3h-3" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
    lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>',
    send: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h10M9 4.5L12.5 8 9 11.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  };

  /* ---------- helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const main = $('#main');

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

  /* ---------- v0.2: plans and pull-request groups, memory, eval set, code index, environment plans,
     rollout, architecture, evidence, delegate, standby. These are called from app.body.js; everything
     they use from there (api, table, kv …) exists by the time a page is rendered. ---------- */
  let STANDBY = null, EVAL_CMP = null, ENV_DRAFT = null;
  const evalForms = {};
  const PLAN_ST = { open: ['tag--you', '等确认'], confirmed: ['', '进行中'], done: ['tag--ok', '已完成'], dropped: ['', '已放弃'] };
  const EV_KIND = { perf: '性能', stress: '压测', data: '数据核对', soak: '长时间运行', manual: '人工确认' };
  const NODE_ROLE = { primary: '主机', follower: '备机（只读）', fenced: '已被取代（只读）' };

  /* where a queue item leads */
  const qHref = q => q.kind === 'plan' ? `#plan-${q.ticket}` : q.kind === 'env' ? `#project-${q.project}` : `#ticket-${q.ticket}${{ mandate: '-mandate', oscillation: '-review', rounds: '-review', rollout: '-rollout', evidence: '-checks' }[q.kind] || ''}`;

  /* ---------- plans ---------- */
  const taskTag = x => !x ? '<span class="tag">未开始</span>' : x.merged ? `<span class="tag tag--ok">${I.check}已合并</span>` : x.kind === 'you' ? '<span class="tag tag--you">等人处理</span>' : x.kind === 'fail' ? '<span class="tag tag--bad">失败</span>' : `<span class="tag">${esc(x.state || '进行中')}</span>`;
  const planDepth = tasks => { const d = []; tasks.forEach((x, i) => { d[i] = (x.deps || []).length ? Math.max(...x.deps.map(j => d[j - 1] ?? 0)) + 1 : 0; }); return d; };
  const fitText = (str, max, em) => { let w = 0, out = ''; for (const ch of str) { w += /[⺀-￯]/.test(ch) ? em : em * 0.55; if (w > max - em) return `${out}…`; out += ch; } return str; };
  const planSvg = rows => {
    const tasks = rows.map(r => r.task), d = planDepth(tasks), nw = 244, nh = 58, gx = 56, gy = 16, pad = 6, cols = Math.max(...d) + 1;
    const inCol = c => tasks.filter((_, i) => d[i] === c).length, nRows = Math.max(...Array.from({ length: cols }, (_, c) => inCol(c)));
    const W = pad * 2 + cols * nw + (cols - 1) * gx, H = pad * 2 + nRows * nh + (nRows - 1) * gy, seen = {};
    const pos = tasks.map((_, i) => { const c = d[i], r = seen[c] = (seen[c] ?? -1) + 1, off = (nRows - inCol(c)) * (nh + gy) / 2; return { x: pad + c * (nw + gx), y: pad + off + r * (nh + gy) }; });
    const edges = tasks.flatMap((x, i) => (x.deps || []).map(j => { const a = pos[j - 1], b = pos[i], ay = a.y + nh / 2, by = b.y + nh / 2, ax = a.x + nw, bx = b.x - 7, mx = (ax + bx) / 2;
      return `<path class="pg__edge" d="M${ax} ${ay} C${mx} ${ay} ${mx} ${by} ${bx} ${by}"/><path class="pg__tip" d="M${bx} ${by - 4} L${bx + 7} ${by} L${bx} ${by + 4}z"/>`; })).join('');
    const nodes = rows.map((r, i) => { const p = pos[i], x = r.task, k = r.ticket, s = !k ? '' : k.merged ? 'ok' : k.kind === 'you' || k.kind === 'fail' ? 'you' : 'warm';
      return `<g class="pg__node" data-s="${s}"><title>${esc(x.title)}</title><rect x="${p.x}" y="${p.y}" width="${nw}" height="${nh}" rx="8"/><text class="pg__n" x="${p.x + 12}" y="${p.y + 23}">${i + 1}</text><text class="pg__t" x="${p.x + 28}" y="${p.y + 23}">${esc(fitText(x.title, 196, 14))}</text><text class="pg__s" x="${p.x + 28}" y="${p.y + 43}">${esc(fitText(`${k ? `${k.id}，` : ''}${!k ? '未开始' : k.merged ? '已合并' : k.state || '进行中'}，${pname(r.project)}`, 200, 12))}</text></g>`; }).join('');
    return `<div class="pg-wrap"><svg class="pg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="任务依赖图：${tasks.map((x, i) => `${i + 1} ${esc(x.title)}${(x.deps || []).length ? `，依赖 ${x.deps.join('、')}` : ''}`).join('；')}">${edges}${nodes}</svg></div>`;
  };
  const PLAN_EXAMPLE = [{ title: '接口', goal: '', deps: [], covers: [1], stacked: false, est: 20 }, { title: '页面', goal: '', deps: [1], covers: [2], stacked: true, est: 20 }];
  const pagePlans = async () => {
    crumbs([['计划']]);
    const plans = (await get('/api/plans')).sort((a, b) => b.created - a.created);
    main.innerHTML = `
      <div class="page-head"><div><h1>计划</h1><p>一个 PR 装不下的需求拆成有依赖的任务：审批人确认一次，任务按依赖自动开工。任务分在几个仓库时，它们的 PR 是一组，按依赖顺序合并。</p></div></div>
      <section class="region" aria-label="计划列表">${table([{ t: '计划' }, { t: '项目' }, { t: '状态' }, { t: '任务', num: 1 }, { t: '提出人' }, { t: '时间', num: 1 }], plans.map(p => { const done = p.tasks.filter(x => x.ticket).length; const projs = [...new Set([p.project, ...p.tasks.map(x => x.project).filter(Boolean)])]; return `<tr data-href="#plan-${p.id}">
        ${td('', `<a class="title" href="#plan-${p.id}">${esc(p.id)} ${esc(p.goal)}</a>${p.change ? '<span class="sub">有一份改动等确认</span>' : ''}`)}${td('项目', esc(projs.map(pname).join('、')))}${td('状态', `<span class="tag ${PLAN_ST[p.status]?.[0] || ''}">${PLAN_ST[p.status]?.[1] || esc(p.status)}</span>`)}
        ${td('任务', `<span class="mono">${done} / ${p.tasks.length}</span>`, 1)}${td('提出人', esc(who(p.by)))}${td('时间', `<span class="mono">${when(p.created)}</span>`, 1)}</tr>`; }), ['还没有计划', '需求大到一个 PR 装不下时，在下面提一份计划。'])}</section>
      <section class="region" aria-labelledby="pn-h"><h2 id="pn-h">提一份计划</h2><p class="ink-2">每条验收标准至少要有一个任务覆盖。<code>deps</code> 写它依赖的任务序号（只能是排在前面的）；<code>stacked</code> 为 true 时，依赖的任务开出 PR 就开工；<code>project</code> 写别的项目编号时，这个任务在那个仓库里做。</p>
        <form class="well stack-md" data-form="plan-new"><div class="form-grid">
          ${field('pl-proj', '项目', select('id="pl-proj" name="project"', PROJECTS.map(x => [x.project.id, x.project.name]), PROJECTS[0]?.project.id))}${field('pl-goal', '目标', '<input class="input" id="pl-goal" name="goal" autocomplete="off" required>')}</div>
          ${field('pl-acc', '验收标准', '<textarea class="textarea" id="pl-acc" name="accept" rows="3" required></textarea>', '每行一条')}
          ${field('pl-tasks', '任务（JSON）', `<textarea class="textarea mono" id="pl-tasks" name="tasks" rows="9" spellcheck="false">${esc(JSON.stringify(PLAN_EXAMPLE, null, 2))}</textarea>`)}
          <div class="actions actions--start"><button class="btn" type="submit">提交计划</button></div></form></section>`;
  };
  const pagePlan = async id => {
    let d;
    try { d = await get(`/api/plans/${id}`); } catch (e) { if (e.status !== 404) throw e; crumbs([['计划', '#plans'], [id]]); main.innerHTML = `<div class="empty"><h1>找不到计划 ${esc(id)}</h1><p>编号可能写错了。</p><a class="btn btn--line" href="#plans">回到计划列表</a></div>`; return; }
    const p = d.plan, st = PLAN_ST[p.status] || ['', p.status];
    crumbs([['计划', '#plans'], [`${p.id} ${p.goal}`]]);
    const cover = p.accept.map((a, i) => { const by = d.tasks.map((r, j) => [r, j]).filter(([r]) => (r.task.covers || []).includes(i + 1)); return `<tr>${td('验收标准', `${i + 1}. ${esc(a)}`)}${td('由哪些任务覆盖', by.map(([r, j]) => `${j + 1} ${esc(r.task.title)}`).join('、') || '<span class="tag tag--bad">没有任务覆盖</span>')}${td('状态', by.length && by.every(([r]) => r.ticket?.merged) ? `<span class="tag tag--ok">${I.check}已合并</span>` : '<span class="tag">未完成</span>')}</tr>`; });
    const ch = p.change;
    main.innerHTML = `
      <div class="ticket-head"><h1>${esc(p.id)} ${esc(p.goal)}</h1><div class="meta">${d.projects.map(x => cbtn(`#project-${x}`, esc(pname(x)))).join('')}<span class="tag ${st[0]}">${st[1]}</span><span class="tag">第 ${p.version} 版</span><span class="note">${esc(who(p.by))} 提出${p.confirmed_by ? `，${esc(who(p.confirmed_by))} 确认` : ''}</span></div></div>
      ${p.status === 'open' ? `<div class="well well--row"><p class="ink">${d.can.approve ? '确认后，没有依赖的任务马上开工，其余的按依赖自动开始。任务不再逐个确认。' : `需要${d.projects.length > 1 ? '涉及的每个项目' : '这个项目'}的审批角色确认。`}</p>${d.can.approve ? `<div class="actions"><button class="btn" type="button" data-act="plan-confirm" data-id="${p.id}">确认计划</button><button class="btn btn--line" type="button" data-act="plan-drop" data-id="${p.id}">放弃</button></div>` : ''}</div>` : ''}
      ${ch ? `<section class="region" aria-labelledby="pc-h"><div class="region-head"><h2 id="pc-h">等确认的改动</h2><p>${tLink(ch.from)} 的 Worker 提议，${when(ch.at)}</p></div><div class="well stack-md"><p class="ink">${esc(ch.why)}</p>
        <ul class="plandiff">${ch.tasks.map((x, i) => { const old = p.tasks.find(o => o.title === x.title); const same = old && JSON.stringify([old.deps, old.covers, !!old.stacked, old.project || null]) === JSON.stringify([x.deps, x.covers, !!x.stacked, x.project || null]); return same ? '' : `<li><span class="tag ${old ? 'tag--warm' : 'tag--ok'}">${old ? '改动' : '新增'}</span><div><p class="ink">任务 ${i + 1}：${esc(x.title)}</p><p class="note">覆盖验收 ${(x.covers || []).join('、') || '无'}${(x.deps || []).length ? `，依赖任务 ${x.deps.join('、')}` : '，没有依赖'}${x.project ? `，在 ${esc(pname(x.project))}` : ''}</p></div></li>`; }).join('')}
        ${p.tasks.filter(o => !ch.tasks.some(x => x.title === o.title)).map(o => `<li><span class="tag tag--bad">去掉</span><div><p class="ink">${esc(o.title)}</p></div></li>`).join('')}</ul>
        ${d.can.approve ? `<form class="stack-sm" data-form="plan-change" data-id="${p.id}">${field('pc-why', '不同意的原因（同意时不用写）', '<input class="input" id="pc-why" name="reason" autocomplete="off">')}<div class="actions actions--start"><button class="btn" type="submit" name="accept" value="1">按这份改</button><button class="btn btn--line" type="submit" name="accept" value="0">不改，按原计划</button></div></form>` : '<p class="note">需要审批角色决定。</p>'}</div></section>` : ''}
      <section class="region" aria-labelledby="pg-h"><div class="region-head"><h2 id="pg-h">任务图</h2><p>箭头从被依赖的任务指向后做的任务</p></div>${planSvg(d.tasks)}
        <ol class="accept">${d.tasks.map((r, i) => `<li data-s="${r.ticket?.merged ? 'ok' : 'todo'}"><span class="accept__n mono">${i + 1}</span><div><p>${r.ticket ? `<a href="#ticket-${r.ticket.id}">${esc(r.ticket.id)} ${esc(r.task.title)}</a>` : esc(r.task.title)}</p><p class="note">${esc(pname(r.project))}，${(r.task.deps || []).length ? `依赖任务 ${r.task.deps.join('、')}` : '没有依赖'}${r.task.stacked ? '，依赖的任务开出 PR 就开工' : ''}${r.task.est ? `，约 ${yuan(r.task.est)}` : ''}</p></div><span class="accept__side">${taskTag(r.ticket)}${r.ticket?.pr && /^https?:/.test(r.ticket.pr.url) ? cbtn(r.ticket.pr.url, `<span class="mono">PR #${r.ticket.pr.number}</span>${I.ext}`, true) : r.ticket?.pr ? `<span class="tag"><span class="mono">PR #${r.ticket.pr.number}</span></span>` : ''}</span></li>`).join('')}</ol></section>
      ${d.group ? `<section class="region" aria-labelledby="gr-h"><div class="region-head"><h2 id="gr-h">PR 组的合并顺序</h2><p>这份计划跨 ${d.projects.length} 个仓库。按顺序合并：后面的 PR 是对着前面的验证的</p></div>
        <ol class="steps">${d.group.order.map((g, i) => `<li data-s="${g.merged ? 'merged' : ''}"><span class="steps__n mono">${i + 1}</span>${tLink(g.ticket)}<span>${esc(pname(g.project))}${g.pr ? ` #${g.pr.number}` : ''}</span>${g.merged ? `<span class="tag tag--ok">${I.check}已合并</span>` : g.ready && g.pr ? '<span class="tag">可以合并</span>' : '<span class="tag">还没准备好</span>'}</li>`).join('')}</ol>
        <p class="note">${d.group.ready ? `全组都准备好了。下一个该合并的是 ${esc(d.group.next || '')}。` : '组里还有 PR 没准备好。先合并的仓库会依赖还没合并的改动，所以等全组准备好再按顺序合并。'}</p></section>` : ''}
      <section class="region" aria-labelledby="cv-h"><div class="region-head"><h2 id="cv-h">验收覆盖</h2><p>每条验收标准至少要有一个任务覆盖</p></div>${table([{ t: '验收标准' }, { t: '由哪些任务覆盖' }, { t: '状态' }], cover, ['没有验收标准', ''])}</section>
      <section class="region" aria-labelledby="bd-h"><h2 id="bd-h">预算</h2>${kv([['计划上限', yuan(d.budget), '各任务估算合计加 20%，超出后新的一轮停下等人'], ['已花', yuan(d.spent), d.budget ? `${Math.round(d.spent / d.budget * 100)}%` : '']])}</section>`;
  };

  /* ---------- project memory ---------- */
  const pageMemory = async () => {
    crumbs([['项目记忆']]);
    const m = await get('/api/memory');
    main.innerHTML = `
      <div class="page-head"><div><h1>项目记忆</h1><p>任务合并后，Engine 把审查里被证实并修复过的问题提议成记忆。审批人采纳后，这个项目之后的 Worker 开工时会读到。</p></div></div>
      <section class="region" aria-labelledby="mp-h"><div class="region-head"><h2 id="mp-h">等审核的提议</h2><p>可以改了再采纳</p></div>
        ${m.proposals.length ? `<div>${m.proposals.map(({ proposal: x, can }) => `<article class="proposal"><form class="stack-sm" data-form="mem-accept" data-id="${x.id}"><h3>${cbtn(`#project-${x.project}`, esc(pname(x.project)))}</h3>
          ${can ? field(`mt-${x.id}`, '记忆内容', `<textarea class="textarea" id="mt-${x.id}" name="text" rows="2">${esc(x.text)}</textarea>`) : `<blockquote>${esc(x.text)}</blockquote>`}
          ${can ? '<div class="actions actions--start"><button class="btn btn--line" type="submit" name="do" value="accept">采纳</button><button class="btn btn--text" type="submit" name="do" value="reject">不采纳</button></div>' : '<p class="note">需要这个项目的审批角色审核。</p>'}</form>
          <p class="from">来自 ${tLink(x.from)}：${esc(x.why)}</p></article>`).join('')}</div>` : '<div class="empty"><h3>没有等审核的提议</h3><p>任务合并后，新的提议会出现在这里。</p></div>'}</section>
      <section class="region" aria-labelledby="me-h"><h2 id="me-h">已采纳的记忆</h2>${table([{ t: '项目' }, { t: '内容' }, { t: '来自' }, { t: '谁采纳' }, { t: '<span class="visually-hidden">操作</span>' }], m.entries.map(x => `<tr>${td('项目', esc(pname(x.project)))}${td('内容', `<span class="ink">${esc(x.text)}</span>`)}${td('来自', x.from ? tLink(x.from) : '')}${td('谁采纳', `${esc(who(x.by))}<span class="sub mono">${when(x.at)}</span>`)}${td('', myRole(x.project) === 'approver' || isAdmin() ? `<div class="actions"><button class="btn btn--text" type="button" data-act="mem-remove" data-id="${x.id}">删除</button></div>` : '')}</tr>`), ['还没有记忆', '采纳的提议会出现在这里。'])}</section>`;
  };

  /* ---------- router eval set ---------- */
  const pageEval = async () => {
    crumbs([['评测集']]);
    let ev, cfg;
    try { [ev, cfg] = await Promise.all([get('/api/eval'), get('/api/settings')]); } catch (e) { if (e.status !== 403) throw e; main.innerHTML = '<div class="page-head"><div><h1>评测集</h1><p>路由的评测集由全局的审批角色或管理员维护。</p></div></div><div class="empty"><h3>你没有查看评测集的权限</h3><p>需要全局的审批角色。</p></div>'; return; }
    const models = cfg.endpoints.flatMap(e => e.models.map(m => [`${e.id}|${m}`, `${e.name} / ${m}`]));
    const cur = ev.router ? `${ev.router.endpoint}|${ev.router.model}` : '';
    const epName = id => cfg.endpoints.find(e => e.id === id)?.name || id;
    const last = ev.runs[0];
    main.innerHTML = `
      <div class="page-head"><div><h1>评测集</h1><p>用例是真实的路由输入加上它应该判成什么。跑一次评测，就是拿每条用例原样重放给一个模型，不会开任务。评测集里有用例后，换路由模型前要先让新模型在这套用例上跑过，而且不能比现在的差。</p></div></div>
      <section class="region" aria-labelledby="ec-h"><div class="region-head"><h2 id="ec-h">用例</h2><p>在<a href="#routing">路由记录</a>里把判对的和判错的记录加进来</p></div>
        ${table([{ t: '消息' }, { t: '应该判成' }, { t: '备注' }, { t: '<span class="visually-hidden">操作</span>' }], ev.cases.map(c => `<tr>${td('消息', `<span class="ink">${esc(c.input.text)}</span><span class="sub">${esc(c.input.channel)}，${esc(who(c.input.sender))}</span>`)}${td('应该判成', `${esc(DECISION[c.decision] || c.decision)}${c.project ? `<span class="sub">${esc(pname(c.project))}</span>` : ''}`)}${td('备注', esc(c.note) || '<span class="note">无</span>')}${td('', `<div class="actions"><button class="btn btn--text" type="button" data-act="eval-remove" data-id="${esc(c.id)}">移出</button></div>`)}</tr>`), ['评测集是空的', '空的时候，换路由模型不受限制。'])}</section>
      ${ev.cases.length ? `<section class="region" aria-labelledby="er-h"><h2 id="er-h">跑评测</h2>
        <form class="well stack-md" data-form="eval-run"><div class="form-grid">${field('er-m', '用哪个模型', select('id="er-m" name="target"', [['', '路由现在用的模型'], ...models], ''))}</div><div class="actions actions--start"><button class="btn btn--line" type="submit">跑这 ${ev.cases.length} 条用例</button></div></form>
        <form class="well stack-md" data-form="eval-compare"><h3>比较两个模型</h3><div class="form-grid">${field('ec-a', '模型 A', select('id="ec-a" name="a"', models, cur || models[0]?.[0]))}${field('ec-b', '模型 B', select('id="ec-b" name="b"', models, models.find(m => m[0] !== cur)?.[0] || models[0]?.[0]))}</div><div class="actions actions--start"><button class="btn btn--line" type="submit">在同一套用例上比较</button></div>
          ${EVAL_CMP ? `<div class="stack-sm" role="status"><p class="ink">${esc(EVAL_CMP.verdict)}</p>${kv([[esc(EVAL_CMP.a.model), `${EVAL_CMP.a.passed} / ${EVAL_CMP.a.cases}`, `只有它通过的 ${EVAL_CMP.only_a} 条`], [esc(EVAL_CMP.b.model), `${EVAL_CMP.b.passed} / ${EVAL_CMP.b.cases}`, `只有它通过的 ${EVAL_CMP.only_b} 条`]])}</div>` : ''}</form></section>` : ''}
      <section class="region" aria-labelledby="eh-h"><div class="region-head"><h2 id="eh-h">评测记录</h2><p>用例集变了以后，旧的记录不再作数</p></div>
        ${table([{ t: '时间' }, { t: '模型' }, { t: '通过', num: 1 }, { t: '用例集' }, { t: '谁跑的' }], ev.runs.map(r => `<tr>${td('时间', `<span class="mono">${when(r.at)}</span>`)}${td('模型', `${esc(r.model)}<span class="sub">${esc(epName(r.endpoint))}</span>`)}${td('通过', `<span class="mono">${r.passed} / ${r.cases}</span>${r.errors ? `<span class="sub">${r.errors} 条调用失败</span>` : ''}`, 1)}${td('用例集', r.set === ev.set ? '<span class="tag tag--ok">现在这套</span>' : '<span class="tag">旧的</span>')}${td('谁跑的', esc(who(r.by)))}</tr>`), ['还没有跑过评测', ''])}
        ${last && last.misses.length ? `<h3>最近一次没通过的用例（${esc(last.model)}）</h3>${table([{ t: '消息' }, { t: '应该判成' }, { t: '实际' }], last.misses.map(x => { const c = ev.cases.find(k => k.id === x.case); return `<tr>${td('消息', esc(c?.input.text || x.case))}${td('应该判成', esc(x.want))}${td('实际', esc(x.got))}</tr>`; }), ['', ''])}` : ''}</section>`;
  };
  const evalAddRow = r => evalForms[r.id] ? `<tr><td colspan="7"><form class="well stack-sm" data-form="eval-add" data-id="${r.id}"><p class="ink">这条被标成了判断有误。它应该判成什么？</p><div class="form-grid">
      ${field(`ea-d-${r.id}`, '应该判成', select(`id="ea-d-${r.id}" name="decision"`, Object.entries(DECISION), 'new_ticket'))}${field(`ea-p-${r.id}`, '项目（可选）', select(`id="ea-p-${r.id}" name="project"`, [['', '不限'], ...PROJECTS.map(x => [x.project.id, x.project.name])], ''))}${field(`ea-n-${r.id}`, '备注（可选）', `<input class="input" id="ea-n-${r.id}" name="note" autocomplete="off">`)}</div>
      <div class="actions actions--start"><button class="btn btn--line" type="submit">加入评测集</button><button class="btn btn--text" type="button" data-act="eval-add-close" data-id="${r.id}">收起</button></div></form></td></tr>` : '';

  /* ---------- project page: code index and environment plan ---------- */
  const projectExtras = async (p, canApprove) => {
    const [ix, env] = await Promise.all([get(`/api/projects/${p.id}/index`), get(`/api/projects/${p.id}/env`)]);
    const info = ix.info, q = ix.quality, plan = env.plan;
    const editable = ENV_DRAFT?.project === p.id ? ENV_DRAFT.plan : { setup: plan.setup, services: plan.services, env: plan.env };
    return `
      <section class="region" aria-labelledby="ix-h"><div class="region-head"><h2 id="ix-h">代码索引</h2><p>用正则从基线分支里取符号、表、主题和路由；不是编译器，跨文件的引用不解析</p></div>
        ${info ? kv([['建于', `<span class="mono">${when(info.built)}</span>`, `提交 ${esc(info.commit.slice(0, 7))}`], ['内容', `${info.files} 个文件，${info.symbols} 个符号`, `${info.access} 处表、主题或路由`], ['新鲜度', ix.behind == null ? '不知道' : ix.behind === 0 ? '和基线分支一致' : `落后 ${ix.behind} 个提交`, ix.stale ? '落后太多，预判不可靠，重建一下' : ''], ['模块预判', q.predicted || q.actual ? `预判 ${q.predicted} 个，命中 ${q.hit} 个` : '还没有数据', q.actual ? `实际改到 ${q.actual} 个模块` : '任务开出 PR 时打分'] ]) : '<p class="note">还没有建索引。建了以后：消息里只提函数名或文件名时也能认出模块（并触发那个模块的确认规则），Worker 开工时会拿到一份仓库地图。任务合并后索引自动重建。</p>'}
        ${canApprove ? `<div class="actions actions--start"><button class="btn btn--line" type="button" data-act="index-build" data-id="${esc(p.id)}">${info ? '重建索引' : '建索引'}</button></div>` : ''}
        ${ix.access?.length ? table([{ t: '文件' }, { t: '类型' }, { t: '名字' }], ix.access.slice(0, 40).map(a => `<tr>${td('文件', `<code>${esc(a.file)}</code>`)}${td('类型', esc({ table: '表', topic: '主题', route: '路由' }[a.kind] || a.kind))}${td('名字', `<code>${esc(a.name)}</code>`)}</tr>`), ['', '']) : ''}</section>
      <section class="region" aria-labelledby="en-h"><div class="region-head"><h2 id="en-h">环境计划</h2><p>${plan.version ? `第 ${plan.version} 版，${esc(who(plan.by))} ${when(plan.at)}${plan.note ? `：${esc(plan.note)}` : ''}` : '还没有单独设过，用项目卡里的准备命令'}</p></div>
        ${facts([['准备命令', plan.setup.map(x => `<code>${esc(x)}</code>`).join('<br>') || '无'], ['服务', plan.services.map(s => `<code>${esc(s.name)}</code>：<code>${esc(s.start)}</code>，健康检查 <code>${esc(s.health)}</code>，最多等 ${s.wait_s || 60} 秒`).join('<br>') || '无'], ['环境变量', Object.entries(plan.env).map(([k, v]) => `<code>${esc(k)}=${esc(v)}</code>`).join('<br>') || '无']])}
        ${env.proposals.map(x => `<div class="well stack-sm"><p class="ink">${tLink(x.from)} 的 Worker 提议改环境计划：${esc(x.why)}</p><p class="note">没有自动采纳，因为${esc(x.need)}。</p><ul class="spec__list">${x.changes.map(c => `<li>${I.edit}<span>${esc(c)}</span></li>`).join('')}</ul>
          ${canApprove ? `<form class="stack-sm" data-form="env-decide" data-id="${esc(x.id)}">${field(`ed-${x.id}`, '不同意的原因（同意时不用写）', `<input class="input" id="ed-${x.id}" name="reason" autocomplete="off">`)}<div class="actions actions--start"><button class="btn" type="submit" name="accept" value="1">同意，之后的沙箱按它准备</button><button class="btn btn--line" type="submit" name="accept" value="0">不同意</button></div></form>` : '<p class="note">需要这个项目的审批角色决定。</p>'}</div>`).join('')}
        ${canApprove ? `<form class="well stack-md" data-form="env-save" data-id="${esc(p.id)}"><h3>修改环境计划</h3><p class="ink-2">Worker 只能自己加设置里允许的安装命令（<code>env_auto</code>）；服务、变量和其它命令都要审批角色在这里改，或者同意 Worker 的提议。变量里不放凭据。</p>
          ${field('ev-json', '环境计划（JSON）', `<textarea class="textarea mono" id="ev-json" name="json" rows="10" spellcheck="false">${esc(JSON.stringify(editable, null, 2))}</textarea>`, ENV_DRAFT?.project === p.id ? `这是按仓库里的文件生成的草稿，还没有保存${ENV_DRAFT.plan.note ? `。${esc(ENV_DRAFT.plan.note)}` : ''}` : '')}${field('ev-note', '说明（可选）', '<input class="input" id="ev-note" name="note" autocomplete="off">')}
          <div class="actions actions--start"><button class="btn" type="submit">保存为新版本</button><button class="btn btn--line" type="button" data-act="env-detect" data-id="${esc(p.id)}">按仓库生成草稿</button></div></form>` : ''}
        ${env.history.length > 1 ? `<h3>历史版本</h3>${table([{ t: '版本' }, { t: '时间' }, { t: '谁' }, { t: '说明' }, { t: '<span class="visually-hidden">操作</span>' }], [...env.history].reverse().map(h => `<tr>${td('版本', `第 ${h.version} 版${h.version === plan.version ? '<span class="sub">当前</span>' : ''}`)}${td('时间', `<span class="mono">${when(h.at)}</span>`)}${td('谁', esc(who(h.by)))}${td('说明', esc(h.note) || '<span class="note">无</span>')}${td('', canApprove && h.version !== plan.version ? `<div class="actions"><button class="btn btn--text" type="button" data-act="env-rollback" data-id="${esc(p.id)}" data-v="${h.version}">回到这一版</button></div>` : '')}</tr>`), ['', ''])}` : ''}</section>`;
  };

  /* ---------- ticket: rollout, architecture, evidence ---------- */
  const PHASE_ST = { todo: ['', '还没到'], now: ['tag--warm', '进行中'], ready: ['tag--you', '条件已达成，可以推进'], done: ['tag--ok', '已完成'], rolled_back: ['tag--bad', '已回退'] };
  const curPhase = t => { const i = (t.mandate.rollout || []).findIndex(ph => ph.state === 'now' || ph.state === 'ready'); return i < 0 ? null : [i, t.mandate.rollout[i]]; };
  const rolloutView = d => {
    const t = d.ticket, phases = t.mandate.rollout || [], issues = t.issues || [];
    return `${phases.length ? `<div class="region sub-head"><div class="region-head"><h3>上线阶段</h3><p>合并只是开始。每个阶段的条件达成后，由审批人确认进入下一阶段</p></div>
        <ol class="accept">${phases.map((ph, i) => { const st = PHASE_ST[ph.state || 'todo'] || ['', ph.state]; return `<li data-s="${ph.state === 'done' ? 'ok' : 'todo'}"><span class="accept__n mono">${i + 1}</span><div><p>${esc(ph.name)}</p>
          ${ph.action ? `<p class="note">进入这一阶段要做的：${esc(ph.action)}</p>` : ''}<p class="note">推进条件：${esc(ph.gate || '由人判断')}${ph.hold_minutes ? `，要连续满足 ${mins(ph.hold_minutes)}` : ''}${ph.gate_url ? `。Engine 每 30 秒查一次 <code>${esc(ph.gate_url)}</code>` : ''}</p>
          ${ph.back ? `<p class="note">回退办法：${esc(ph.back)}</p>` : ''}${ph.since ? `<p class="note">进入时间 <span class="mono">${when(ph.since)}</span></p>` : ''}</div><span class="accept__side"><span class="tag ${st[0]}">${st[1]}</span></span></li>`; }).join('')}</ol></div>` : '<div class="empty"><h3>这个任务没有上线阶段</h3><p>需求单里写了分阶段上线时，合并后会在这里一步步推进。</p></div>'}
      ${issues.length || t.merged_at ? `<div class="region sub-head"><div class="region-head"><h3>合并后的线上问题</h3><p>监控把落在这次改动的文件上的问题报到这里</p></div>
        ${table([{ t: '时间' }, { t: '问题' }, { t: '文件' }, { t: '来源' }, { t: '修复' }], issues.map((x, i) => `<tr>${td('时间', `<span class="mono">${when(x.at)}</span>`)}${td('问题', x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title))}${td('文件', `<code>${esc(x.file)}</code>`)}${td('来源', esc(x.source))}${td('修复', x.fix ? tLink(x.fix) : d.can.approve ? `<button class="btn btn--text" type="button" data-act="t-fix-issue" data-id="${t.id}" data-index="${i}">开修复任务</button>` : '<span class="note">还没有</span>')}</tr>`), ['没有报上来的问题', '有问题时会出现在这里，可以直接开修复任务。'])}</div>` : ''}`;
  };
  const rolloutEntry = d => {
    const t = d.ticket, cur = curPhase(t);
    if (!cur) return { body: '', keys: '' };
    const [i, ph] = cur;
    if (!d.can.approve) return { body: '<p class="note">上线阶段由这个项目的审批角色推进。</p>', keys: '' };
    return { body: `${ph.state === 'ready' ? `<div class="entry__keys"><button class="btn" type="button" data-act="t-rollout-advance" data-id="${t.id}">这一阶段完成${i + 1 < t.mandate.rollout.length ? '，进入下一阶段' : '，上线结束'}</button></div>` : `<p class="note">推进条件还没有达成：${esc(ph.gate)}</p>`}
      <form class="entry__form" data-form="t-rollout-back" data-id="${t.id}">${field('rb-why', '出了问题要回退时，写原因', '<input class="input" id="rb-why" name="reason" autocomplete="off">', ph.back ? `回退办法：${esc(ph.back)}` : '')}<div class="entry__keys"><button class="btn btn--line" type="submit">回退第 ${i + 1} 阶段</button></div></form>`, keys: '' };
  };

  /* left to right: a component sits one column after the furthest thing that points at it */
  const archLayout = a => {
    const ids = a.nodes.map(n => n.id), edges = [...a.before, ...a.after].filter(e => ids.includes(e[0]) && ids.includes(e[1]) && e[0] !== e[1]);
    const col = Object.fromEntries(ids.map(id => [id, 0]));
    for (let pass = 0; pass < ids.length; pass++) { let moved = false; edges.forEach(([f, t]) => { if (col[t] < col[f] + 1 && col[f] + 1 < ids.length) { col[t] = col[f] + 1; moved = true; } }); if (!moved) break; }
    const seen = {}, row = {};
    ids.forEach(id => { row[id] = seen[col[id]] = (seen[col[id]] ?? -1) + 1; });
    return { col, row, cols: Math.max(0, ...Object.values(col)) + 1, rows: Math.max(0, ...Object.values(row)) + 1 };
  };
  const archSvg = (a, side, W) => {
    const L = archLayout(a), key = e => `${e[0]}>${e[1]}`, bk = new Set(a.before.map(key)), fk = new Set(a.after.map(key));
    const shown = a.nodes.filter(n => side === 'before' ? n.change !== 'added' : n.change !== 'removed'), ok = new Set(shown.map(n => n.id));
    const edges = a[side].filter(e => ok.has(e[0]) && ok.has(e[1]));
    const padX = 10, padY = 20, nh = 54, rowH = 82, nw = Math.min(176, Math.floor((W - padX * 2 - (L.cols - 1) * 64) / L.cols)), gap = L.cols > 1 ? (W - padX * 2 - L.cols * nw) / (L.cols - 1) : 0;
    /* an edge that skips a column in the same row would run behind the boxes between: it dips under them instead */
    const dips = e => L.row[e[0]] === L.row[e[1]] && Math.abs(L.col[e[0]] - L.col[e[1]]) > 1;
    const H = padY * 2 + (L.rows - 1) * rowH + nh + (edges.some(e => dips(e) && L.row[e[0]] === L.rows - 1) ? 22 : 0), X = id => padX + L.col[id] * (nw + gap), Y = id => padY + L.row[id] * rowH, f1 = v => v.toFixed(1);
    const tip = (x, y, dx, dy) => `<polygon points="${f1(x)},${f1(y)} ${f1(x - dx * 8 - dy * 4.5)},${f1(y - dy * 8 - dx * 4.5)} ${f1(x - dx * 8 + dy * 4.5)},${f1(y - dy * 8 + dx * 4.5)}"/>`;
    const lines = edges.map(e => {
      const [s, t] = e, st = side === 'before' ? (fk.has(key(e)) ? 'same' : 'removed') : bk.has(key(e)) ? 'same' : 'added';
      const lbl = (x, y, anchor) => e[2] ? `<text class="arch__lbl" x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}" dominant-baseline="middle">${esc(e[2])}</text>` : '';
      let body;
      if (dips(e)) {
        const sx = L.col[t] > L.col[s] ? 1 : -1, x1 = X(s) + nw / 2 + sx * 24, x2 = X(t) + nw / 2 - sx * 24, y = Y(s) + nh, low = y + 30;
        body = `<path d="M ${f1(x1)} ${f1(y)} C ${f1(x1)} ${f1(low)} ${f1(x2)} ${f1(low)} ${f1(x2)} ${f1(y + 9)}"/>${tip(x2, y + 2, 0, -1)}${lbl((x1 + x2) / 2, y + 23, 'middle')}`;
      } else if (L.col[s] !== L.col[t]) {
        const sx = L.col[t] > L.col[s] ? 1 : -1, x1 = sx > 0 ? X(s) + nw : X(s), y1 = Y(s) + nh / 2, x2 = sx > 0 ? X(t) - 2 : X(t) + nw + 2, y2 = Y(t) + nh / 2, mx = (x1 + x2) / 2;
        body = `<path d="M ${f1(x1)} ${f1(y1)} C ${f1(mx)} ${f1(y1)} ${f1(mx)} ${f1(y2)} ${f1(x2 - sx * 7)} ${f1(y2)}"/>${tip(x2, y2, sx, 0)}${lbl(mx, (y1 + y2) / 2, 'middle')}`;
      } else {
        const sy = L.row[t] > L.row[s] ? 1 : -1, x = X(s) + nw / 2, y1 = sy > 0 ? Y(s) + nh : Y(s), y2 = sy > 0 ? Y(t) - 2 : Y(t) + nh + 2;
        body = `<path d="M ${f1(x)} ${f1(y1)} L ${f1(x)} ${f1(y2 - sy * 7)}"/>${tip(x, y2, 0, sy)}${lbl(x + 10, (y1 + y2) / 2, 'start')}`;
      }
      return `<g class="arch__edge" data-s="${st}">${body}</g>`;
    }).join('');
    const BADGE = { added: '新增', removed: '移除' };
    const boxes = shown.map(n => {
      const st = side === 'before' ? (n.change === 'removed' ? 'removed' : 'same') : n.change === 'added' ? 'added' : 'same', x = X(n.id), y = Y(n.id), round = n.kind === 'store' || n.kind === 'queue', tx = x + (round ? 20 : 12);
      return `<g class="arch__node" data-s="${st}"><rect x="${f1(x)}" y="${y}" width="${nw}" height="${nh}" rx="${round ? nh / 2 : 6}"/><text class="arch__name" x="${f1(tx)}" y="${y + 23}">${esc(fitText(n.name, nw - 24, 14))}</text><text class="arch__sub" x="${f1(tx)}" y="${y + 41}">${esc(fitText(n.sub || (n.paths || []).join(' '), nw - 24, 11))}</text>${BADGE[st] ? `<g class="arch__badge"><rect x="${f1(x + nw - 44)}" y="${y - 9}" width="36" height="18" rx="4"/><text x="${f1(x + nw - 26)}" y="${y + 0.5}" text-anchor="middle" dominant-baseline="middle">${BADGE[st]}</text></g>` : ''}</g>`;
    }).join('');
    const name = id => a.nodes.find(n => n.id === id)?.name || id;
    const say = `${side === 'before' ? '改动前' : '改动后'}：${edges.map(e => `${name(e[0])}到${name(e[1])}${e[2] ? `（${e[2]}）` : ''}`).join('；') || '没有连线'}`;
    return `<svg class="arch__svg" viewBox="0 0 ${W} ${H}" style="--min:${Math.round(W * 0.8)}px" role="img" aria-label="${esc(say)}">${lines}${boxes}</svg>`;
  };
  const archView = d => {
    const a = d.ticket.arch;
    if (!a) return '<div class="empty"><h3>这个任务没有架构变化</h3><p>改动会增减服务、存储、队列或改变调用关系时，Worker 会提交一份架构变化，Engine 拿它和 diff 核对。</p></div>';
    const st = a.status === 'verified' ? `<span class="tag tag--ok">${I.check}和改动核对过，一致</span>` : a.status === 'diverged' ? '<span class="tag tag--bad">和改动不一致</span>' : '<span class="tag">Worker 提交的，还没核对</span>';
    const fig = (side, cap) => `<figure class="arch__fig"><figcaption>${cap}</figcaption><div class="arch__canvas" tabindex="0" role="group" aria-label="${cap}的架构图，放不下时可以左右滑动">${archSvg(a, side, 470)}</div></figure>`;
    const key = (cls, l) => `<li><i class="akey${cls ? ` akey--${cls}` : ''}"></i>${l}</li>`;
    return `<section class="arch sub-head" aria-labelledby="arch-h"><div class="region-head"><h3 id="arch-h">架构变化</h3><p>结构由 Worker 提交，图由控制台画；新增和移除的组件必须在 diff 里有对应的文件改动</p></div>
      <div class="spec__chips">${st}</div>${a.summary ? `<p class="arch__sum">${esc(a.summary)}</p>` : ''}
      ${(a.divergence || []).length ? `<ul class="spec__list">${a.divergence.map(x => `<li>${I.alert}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
      <div class="arch__figs">${fig('before', '改动前')}${fig('after', '改动后')}</div>
      <ul class="legend" aria-label="图例">${key('', '代码')}${key('store', '存储或队列')}${key('added', '新增')}${key('removed', '移除')}</ul></section>`;
  };

  const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const runChart = (base, head) => {
    const hi = Math.max(...base, ...head, 1), step = Math.pow(10, Math.floor(Math.log10(hi))) / (hi / Math.pow(10, Math.floor(Math.log10(hi))) < 2.5 ? 4 : 2), max = Math.ceil(hi * 1.05 / step) * step;
    const W = 640, Lp = 64, R = 16, H = 132, x = v => Lp + (v / max) * (W - Lp - R), rows = [['base', '改动前', base, 40], ['head', '改动后', head, 84]];
    const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => +(i * step).toPrecision(6));
    return `<figure class="rchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每轮的测量值：改动前 ${base.join('、')}，改动后 ${head.join('、')}">
      ${ticks.map(v => `<line class="rchart__grid" x1="${x(v)}" x2="${x(v)}" y1="20" y2="104"/><text class="rchart__tick" x="${x(v)}" y="122">${v}</text>`).join('')}
      ${rows.map(([k, name, vs, y]) => `<text class="rchart__row" x="0" y="${y + 4}">${name}</text>${vs.map((v, i) => `<circle class="rchart__dot rchart__dot--${k}" cx="${x(v)}" cy="${y}" r="5"><title>${name}第 ${i + 1} 轮：${v}</title></circle>`).join('')}${vs.length ? `<line class="rchart__med rchart__med--${k}" x1="${x(median(vs))}" x2="${x(median(vs))}" y1="${y - 11}" y2="${y + 11}"/>` : ''}`).join('')}
    </svg><figcaption class="legend"><span><i class="sdot sdot--base"></i>改动前</span><span><i class="sdot sdot--head"></i>改动后</span><span><i class="sdot sdot--med"></i>竖线是中位数</span></figcaption></figure>`;
  };
  const evidenceView = d => {
    const t = d.ticket, ev = t.evidence || [];
    if (!ev.length) return '';
    return `<div class="region sub-head"><div class="region-head"><h3>非功能验收的证据</h3><p>性能在改动前后各跑几轮比中位数；合并前证明不了的，标成延后，由上线阶段或人确认</p></div>
      <ol class="accept">${ev.map(e => `<li data-s="${e.ok ? 'ok' : 'todo'}"><span class="accept__n mono">${e.criterion}</span><div><p>${esc(t.mandate.accept[e.criterion - 1] || '')}</p><p class="note">${esc(EV_KIND[e.kind] || e.kind)}${e.note ? `：${esc(e.note)}` : ''}${e.sha ? `，提交 <span class="mono">${esc(e.sha.slice(0, 7))}</span>` : ''}</p>
        ${(e.base || []).length && (e.head || []).length ? runChart(e.base, e.head) : ''}</div><span class="accept__side"><span class="tag ${e.waived_by ? '' : e.ok ? 'tag--ok' : e.deferred ? 'tag--warm' : 'tag--bad'}">${e.waived_by ? `${esc(who(e.waived_by))} 按人工确认处理` : e.ok ? `${I.check}通过` : e.deferred ? '延后到上线后确认' : '没有通过'}</span></span></li>`).join('')}</ol></div>`;
  };
  const ticketTabs2 = t => [['timeline', '时间线'], ['review', '审查'], ['checks', '检查与测试'], ['mandate', '需求单'], (t.mandate.rollout || []).length || (t.issues || []).length || t.stage === 'rolling_out' ? ['rollout', '上线'] : null, t.arch ? ['arch', '架构'] : null, ['sandbox', '沙箱']].filter(Boolean);
  const ticketTab2 = (d, tab) => tab === 'rollout' ? rolloutView(d) : tab === 'arch' ? archView(d) : ticketTab(d, tab) + (tab === 'checks' ? evidenceView(d) : '');
  const ticketMeta2 = t => `${t.plan ? cbtn(`#plan-${t.plan}`, `计划 <span class="mono">${esc(t.plan)}</span>`) : ''}${t.stack_on ? `<span class="tag">叠放在 ${esc(t.stack_on)} 上</span>` : ''}${(t.siblings || []).map(s => `<a class="tag" href="#ticket-${esc(s)}">依赖别的仓库里的 ${esc(s)}</a>`).join('')}`;

  /* ---------- members: who covers for me ---------- */
  const delegateForm = () => {
    const d = ME?.member?.delegate, on = d && d.until > Date.now();
    if (!ME?.member) return '';
    return `<section class="region" aria-labelledby="dg-h"><div class="region-head"><h2 id="dg-h">我不在时由谁代理</h2><p>${on ? `现在由 ${esc(who(d.to))} 代理，到 ${when(d.until)}` : '没有设代理'}</p></div>
      <form class="well stack-md" data-form="delegate"><p class="ink-2">代理人在这段时间里能看到并处理原本只有你能处理的事。到期自动结束，每次设置都记在安全记录里。</p><div class="form-grid">
        ${field('dg-to', '代理人', select('id="dg-to" name="to"', [['', '不设代理'], ...MEMBERS.filter(m => m.id !== ME.id).map(m => [m.id, m.name])], on ? d.to : ''))}${field('dg-days', '几天', '<input class="input num" id="dg-days" name="days" type="number" min="1" max="30" step="1" value="3">')}</div>
        <div class="actions actions--start"><button class="btn btn--line" type="submit">保存</button></div></form></section>`;
  };

  /* ---------- ops: alerts and standby ---------- */
  const opsExtras = (o, sb) => `
      <section class="region" aria-labelledby="oa-h"><div class="region-head"><h2 id="oa-h">告警</h2><p>同样的数字也在 <code>/metrics</code> 里，给 Prometheus 抓</p></div>
        ${(o.alerts || []).length ? `<ul class="spec__list">${o.alerts.map(a => `<li>${I.alert}<span>${esc(a.text)}<span class="note">，从 <span class="mono">${when(a.since)}</span> 开始</span></span></li>`).join('')}</ul>` : '<p class="note">现在没有告警。</p>'}</section>
      ${sb ? `<section class="region" aria-labelledby="sb-h"><div class="region-head"><h2 id="sb-h">热备</h2><p>备机持续拉主机的事件日志，只读。切换由人决定；这不是自动选主</p></div>
        ${kv([['这台是', NODE_ROLE[sb.role] || esc(sb.role), `任期 ${sb.epoch}`], ['事件序号', `<span class="mono">${sb.seq}</span>`], sb.role === 'follower' ? ['主机', `<code>${esc(sb.primary)}</code>`, sb.behind === 0 ? '已追平' : `落后 ${sb.behind} 条`] : sb.peers?.length ? ['留意的对端', sb.peers.map(x => `<code>${esc(x)}</code>`).join('<br>')] : ['备机', '没有配置', '在备机的配置里写 standby.primary 指向这台'], sb.last_contact ? ['上次同步', `<span class="mono">${when(sb.last_contact)}</span>`] : null])}
        ${sb.problem ? `<p class="warn-line">${I.alert}<span>${esc(sb.problem)}</span></p>` : ''}
        ${sb.role === 'follower' && isAdmin() ? `<div class="well well--row"><p class="ink">提升后这台成为主机，任期加一，并通知旧主机停止接受操作。只在确认旧主机已经停机、或者它还连得上时提升：两台同时接受操作会让日志分叉。</p><button class="btn btn--line" type="button" data-act="promote">提升为主机</button></div>` : ''}</section>` : ''}`;
  const standbyBanner = () => STANDBY && STANDBY.role !== 'primary' ? `<div class="well well--row" role="status"><p class="warn-line">${I.lock}<span>${STANDBY.role === 'follower' ? '这台是备机：只能看，不能操作。操作请到主机上做。' : '这台已被新的主机取代：只能看，不能操作。'}</span></p><a class="btn btn--line" href="#ops">看热备状态</a></div>` : '';

  /* ---------- actions and forms of the pages above ---------- */
  const V2_ACT = {
    'plan-confirm': async (b, id) => { const r = await api('POST', `/api/plans/${id}/confirm`, {}); toast(`计划已确认${r.started.length ? `，${r.started.join('、')} 开工` : ''}`); },
    'plan-drop': async (b, id) => { await api('POST', `/api/plans/${id}/drop`, {}); toast('计划已放弃'); },
    'mem-remove': async (b, id) => { await api('POST', `/api/memory/${id}/remove`, {}); toast('记忆已删除'); },
    'eval-remove': async (b, id) => { await api('DELETE', `/api/eval/cases/${encodeURIComponent(id)}`); toast('已移出评测集'); },
    'eval-add': async (b, id) => { if (b.dataset.wrong === '1') { evalForms[id] = true; return; } await api('POST', '/api/eval/cases', { route: id }); toast('已加入评测集：按当时的判断算对', ['看评测集', '#eval']); },
    'eval-add-close': async (b, id) => { delete evalForms[id]; },
    'index-build': async (b, id) => { const r = await api('POST', `/api/projects/${id}/index`, {}); toast(`索引已建好：${r.files} 个文件，${r.symbols} 个符号`); },
    'env-detect': async (b, id) => { ENV_DRAFT = { project: id, plan: await api('POST', `/api/projects/${id}/env/detect`, {}) }; const p = ENV_DRAFT.plan; ENV_DRAFT.plan = { setup: p.setup, services: p.services, env: p.env, note: p.note }; toast('草稿已填进表单，检查后保存'); },
    'env-rollback': async (b, id) => { const r = await api('POST', `/api/projects/${id}/env/rollback`, { version: +b.dataset.v }); toast(`已回到第 ${b.dataset.v} 版的内容，记为第 ${r.version} 版`); },
    't-rollout-advance': async (b, id) => { await api('POST', `/api/tickets/${id}/rollout-advance`, {}); toast(`${id}：已推进到下一阶段`); },
    't-fix-issue': async (b, id) => { const r = await api('POST', `/api/tickets/${id}/fix-issue`, { index: +b.dataset.index }); toast(`已开修复任务 ${r.id}`, ['打开', `#ticket-${r.id}`]); },
    promote: async () => { const r = await api('POST', '/api/standby/promote', {}); STANDBY = null; toast(`已提升为主机，任期 ${r.epoch}。${r.note}`); },
  };
  const V2_FORM = {
    'plan-new': async fd => { let tasks; try { tasks = JSON.parse(fd.get('tasks')); } catch (x) { throw new Error(`任务的 JSON 解析失败：${x.message}`); }
      const r = await api('POST', '/api/plans', { project: fd.get('project'), goal: String(fd.get('goal')).trim(), accept: String(fd.get('accept')).split('\n').map(x => x.trim()).filter(Boolean), tasks }); toast(`计划 ${r.id} 已提交，等审批人确认`); location.hash = `#plan-${r.id}`; },
    'plan-change': async (fd, f, id, btn) => { const accept = btn?.value === '1'; const r = await api('POST', `/api/plans/${id}/change`, { accept, reason: fd.get('reason') }); toast(accept ? `计划已按提议修改${r.started.length ? `，${r.started.join('、')} 开工` : ''}` : '没有改，按原计划继续'); },
    'mem-accept': async (fd, f, id, btn) => { if (btn?.value === 'reject') { await api('POST', `/api/memory/${id}/reject`, {}); toast('没有采纳'); } else { await api('POST', `/api/memory/${id}/accept`, { text: String(fd.get('text') || '').trim() || undefined }); toast('已采纳，之后的 Worker 会读到'); } },
    'eval-run': async fd => { const [endpoint, model] = String(fd.get('target') || '').split('|'); const r = await api('POST', '/api/eval/run', model ? { target: { endpoint, model } } : {}); toast(`${r.model}：通过 ${r.passed} / ${r.cases}`); },
    'eval-compare': async fd => { const pair = v => { const [endpoint, model] = String(v).split('|'); return { endpoint, model }; }; EVAL_CMP = await api('POST', '/api/eval/compare', { a: pair(fd.get('a')), b: pair(fd.get('b')) }); },
    'eval-add': async (fd, f, id) => { await api('POST', '/api/eval/cases', { route: id, decision: fd.get('decision'), project: fd.get('project') || undefined, note: fd.get('note') }); delete evalForms[id]; toast('已加入评测集', ['看评测集', '#eval']); },
    'env-save': async (fd, f, id) => { let p; try { p = JSON.parse(fd.get('json')); } catch (x) { throw new Error(`JSON 解析失败：${x.message}`); } const r = await api('PUT', `/api/projects/${id}/env`, { setup: p.setup || [], services: p.services || [], env: p.env || {}, note: fd.get('note') }); ENV_DRAFT = null; toast(`环境计划已保存为第 ${r.version} 版，之后新建的沙箱按它准备`); },
    'env-decide': async (fd, f, id, btn) => { const accept = btn?.value === '1'; await api('POST', `/api/env/${encodeURIComponent(id)}/${accept ? 'accept' : 'reject'}`, { reason: fd.get('reason') }); toast(accept ? '已同意，环境计划有了新版本' : '没有同意，已告诉 Worker'); },
    't-rollout-back': async (fd, f, id) => { await api('POST', `/api/tickets/${id}/rollout-back`, { reason: fd.get('reason') }); toast(`${id}：已记为回退`); },
    delegate: async fd => { const to = fd.get('to'); await api('PUT', '/api/me/delegate', { to: to || null, days: +fd.get('days') || 3 }); ME = null; toast(to ? `已设 ${who(to)} 为代理人` : '已取消代理'); },
  };

  /* ---------- state and API ---------- */
  let ME = null, MEMBERS = [], PROJECTS = [];
  const chat = [];
  const replays = {};
  let ticketsTab = 'open', tlFilter = 'all', shownToken = null, LAST_SETTINGS = null;
  const tokenKey = 'acw_token';
  const getToken = () => { try { return localStorage.getItem(tokenKey) || ''; } catch { return ''; } };
  const setToken = t => { try { t ? localStorage.setItem(tokenKey, t) : localStorage.removeItem(tokenKey); } catch { /* private mode */ } };

  const api = async (method, path, body) => {
    const headers = { Accept: 'application/json' };
    if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let resp;
    try { resp = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch { throw new Error('连不上 Engine，请检查它是否在运行'); }
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!resp.ok) { const e = new Error(data?.error || `接口返回 ${resp.status}`); e.status = resp.status; throw e; }
    return data;
  };
  const get = p => api('GET', p);

  /* ---------- formatting ---------- */
  const pad = n => String(n).padStart(2, '0');
  const clock = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const when = ms => { if (!ms) return ''; const d = new Date(ms), n = new Date(); return d.toDateString() === n.toDateString() ? clock(ms) : `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${clock(ms)}`; };
  const mins = m => m < 1 ? '不到 1 分钟' : m < 60 ? `${Math.round(m)} 分钟` : m % 60 ? `${Math.floor(m / 60)} 小时 ${Math.round(m % 60)} 分` : `${m / 60} 小时`;
  const yuan = v => `¥${(+v || 0).toFixed(v >= 100 ? 0 : 2)}`;
  const who = id => (ME && id === ME.id ? '你' : MEMBERS.find(m => m.id === id)?.name || id || '');
  const names = ids => (ids || []).map(who).join('、') || '没有人';
  const pname = id => PROJECTS.find(p => p.project.id === id)?.project.name || id || '';
  const ROLE = { visitor: '访客', requester: '提需求', approver: '审批', admin: '管理' };
  const myRole = pid => { const r = ME?.member?.roles || {}; return r['*'] === 'admin' ? 'admin' : r[pid] || r['*'] || (ME?.auth === 'none' ? 'admin' : 'visitor'); };
  const isAdmin = () => myRole() === 'admin';
  const QKIND = { mandate: '需求单等确认', ask: '等回答', risk: '改动等批准', budget: '超出预算', oscillation: '审查来回改', rounds: '审查轮数用完', failed: '失败', pr: 'PR 等审批', plan: '计划等确认', env: '环境计划等确认', rollout: '上线阶段可推进', evidence: '验收没法自动取证' };
  const PRIO = { high: '高', normal: '普通', low: '低' };
  const STAGE_NAME = { router: '路由与需求单', worker: '开发', reviewer: '审查', tester: '写测试', env: '环境规划' };
  const STAGE_DO = { router: '判断需求归属、整理需求单、直接回答', worker: 'codex 在沙箱里改代码，经模型网关调用', reviewer: '审查 diff，并独立复核 P0 / P1', tester: '按验收标准生成测试', env: '环境规划（环境计划的草稿按规则生成，不用模型）' };
  const DECISION = { answer: '直接回答', new_ticket: '新开任务', route_to_ticket: '发给已有任务', ask: '先问清楚', stop_ticket: '停止任务' };
  const CONF = { high: '高', medium: '中', low: '低' };

  /* ---------- small pieces ---------- */
  const stateWord = k => ({
    you: `<span class="state state--you">${I.hand}需要人</span>`, run: `<span class="state state--run">${I.play}进行中</span>`,
    wait: `<span class="state state--wait">${I.clock}等待</span>`, fail: `<span class="state state--fail">${I.alert}失败</span>`,
    done: `<span class="state state--ok">${I.check}已完成</span>`, dropped: `<span class="state state--wait">${I.x}已结束</span>`,
  }[k] || '');
  const KIND_WORD = { you: '需要人', run: '进行中', wait: '等待', fail: '失败', done: '已完成', dropped: '已结束' };
  const cbtn = (href, html, ext) => `<a class="cbtn" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${html}</a>`;
  const tLink = id => cbtn(`#ticket-${id}`, `<span class="mono">${esc(id)}</span>`);
  const kv = items => `<dl class="kv">${items.filter(Boolean).map(([k, v, sub]) => `<div><dt>${k}</dt><dd>${v}${sub ? `<span class="sub">${sub}</span>` : ''}</dd></div>`).join('')}</dl>`;
  const facts = items => `<dl class="facts">${items.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const table = (heads, rows, empty) => rows.length ? `<div class="table-wrap"><table class="table table--stack"><thead><tr>${heads.map(h => `<th${h.num ? ' class="num"' : ''}>${h.t}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<div class="empty"><h3>${esc(empty[0])}</h3><p>${esc(empty[1])}</p></div>`;
  const td = (label, html, num) => `<td data-label="${esc(label)}"${num ? ' class="num"' : ''}>${html}</td>`;
  const tabs = (items, current, label) => `<nav class="tabs" aria-label="${esc(label)}">${items.map(([href, text, key, n]) => `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${esc(text)}${n != null ? `<span class="n">${n}</span>` : ''}</a>`).join('')}</nav>`;
  const select = (attrs, options, cur) => `<span class="select-wrap select-wrap--block"><select class="select" ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${I.down}</span>`;
  const field = (id, label, input, help) => `<div class="field"><label for="${id}">${label}</label>${input}${help ? `<span class="help" id="${id}-help">${help}</span>` : ''}</div>`;
  const num = (name, label, val, help, step) => field(`f-${name.replace(/\W/g, '-')}`, label, `<input class="input num" id="f-${name.replace(/\W/g, '-')}" name="${name}" type="number" inputmode="decimal" min="0" step="${step || 1}" value="${esc(val)}">`, help);
  const skeleton = n => `<div class="skeleton" aria-hidden="true">${'<span></span>'.repeat(n)}</div><p class="visually-hidden" role="status">正在加载</p>`;
  const errorBox = e => `<div class="error" role="alert"><h3>加载失败</h3><p>${esc(e.message)}</p><button class="btn btn--line" type="button" data-act="reload">重试</button></div>`;

  let toastTimer;
  const toast = (text, link) => {
    const root = $('#toast-root');
    clearTimeout(toastTimer);
    root.innerHTML = `<div class="toast" role="status"><span>${esc(text)}</span>${link ? `<a class="btn btn--text" href="${link[1]}">${esc(link[0])}</a>` : ''}</div>`;
    toastTimer = setTimeout(() => { root.innerHTML = ''; }, 7000);
  };
  const busy = (btn, on) => { if (!btn) return; if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(btn.textContent)}`; } else { btn.disabled = false; btn.removeAttribute('aria-busy'); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; } };
  const inlineError = (host, err) => { host?.querySelector('.inline-error')?.remove(); host?.insertAdjacentHTML('beforeend', `<span class="inline-error" role="alert">${esc(err.message)}</span>`); };
  const crumbs = parts => { $('#crumbs').innerHTML = parts.map((p, i) => i < parts.length - 1 ? `<span class="crumb${i === 0 ? '' : ' hide-sm'}"><a href="${p[1]}">${esc(p[0])}</a>${I.chev}</span>` : `<span>${esc(p[0])}</span>`).join(''); };

  /* ---------- nav ---------- */
  const NAV = [
    ['work', [['overview', '总览'], ['chat', '对话'], ['tickets', '任务'], ['plans', '计划'], ['routing', '路由记录'], ['eval', '评测集']]],
    ['proj', [['projects', '项目'], ['memory', '项目记忆']]],
    ['sys', [['cost', '成本'], ['notifications', '通知']]],
    ['admin', [['members', '成员与权限'], ['security', '安全'], ['ops', '运维'], ['config', '设置']]],
  ];
  const renderNav = (route, counts = {}) => {
    const cur = { ticket: 'tickets', project: 'projects', plan: 'plans' }[route] || route;
    NAV.forEach(([group, items]) => {
      $(`#nav-${group}`).innerHTML = items.map(([id, label]) => `<li><a href="#${id}"${cur === id ? ' aria-current="page"' : ''}><span>${label}</span>${counts[id] ? `<span class="count">${counts[id]}</span>` : ''}</a></li>`).join('');
    });
  };

  /* ---------- pages ---------- */
  const pageLogin = err => {
    crumbs([['登录']]);
    main.innerHTML = `<div class="page-head"><div><h1>需要成员令牌</h1><p>令牌由管理员签发（<code>acw token --member 你的编号</code>，或在“成员与权限”里点“签发令牌”）。它只存在这个浏览器里。</p></div></div>
      <form class="well stack-md form-narrow" data-form="login">${field('tok', '令牌', '<input class="input mono" id="tok" name="token" type="password" autocomplete="off" required>', err ? esc(err) : '以 acw_ 开头')}
      <div class="actions actions--start"><button class="btn" type="submit">进入控制台</button></div></form>`;
  };

  const queueRow = q => {
    const href = qHref(q);
    return `<li class="inbox__item" data-href="${href}">
      <div class="inbox__when"><time class="mono">${clock(q.since)}</time><span>${mins(q.waited_minutes)}</span>${q.overdue_minutes > 0 ? '<span class="tag tag--bad">超时</span>' : ''}</div>
      <div class="inbox__main"><div class="inbox__line"><a class="title" href="${href}">${esc(q.title)}</a></div>
        <p class="inbox__why"><span class="state state--you">${esc(QKIND[q.kind] || q.kind)}</span><span class="inbox__proj">${esc(pname(q.project))}</span><span class="inbox__text">${esc(q.why.split('\n')[0])}</span></p></div>
      <div class="actions"><a class="btn btn--line" href="${href}">处理</a></div></li>`;
  };
  const runRow = t => `<li data-k="${t.kind}"><a class="title" href="#ticket-${t.id}">${t.id} ${esc(t.title)}</a><span class="runlist__state">${esc(t.state)}${t.why && t.kind === 'wait' ? `：${esc(t.why)}` : ''}</span><span class="runlist__bar" aria-hidden="true"></span><time class="mono">${clock(t.updated)}</time></li>`;

  const pageOverview = async () => {
    crumbs([['总览']]);
    const o = await get('/api/overview'), s = o.stats;
    main.innerHTML = `
      <div class="ov-head">
        <div class="ov-head__text"><h1>${o.queue.length ? `需要你处理的 ${o.queue.length} 件事` : '现在没有等你处理的事'}</h1></div>
        <dl class="ministats" aria-label="现在">
          <div><dt>待处理</dt><dd>${s.queue}<span class="u"> / ${s.queue_limit}</span></dd></div>
          <div><dt>今天新任务</dt><dd>${s.today_new}</dd></div>
          <div><dt>等审批的 PR</dt><dd>${s.prs_open}</dd></div>
          <div><dt>今天合并</dt><dd>${s.merged_today}</dd></div>
          <div><dt>Worker 槽位</dt><dd>${s.workers_used}<span class="u"> / ${s.workers}</span></dd></div>
          <div><dt>沙箱</dt><dd>${s.sandboxes}</dd></div>
        </dl>
      </div>
      ${o.draining ? `<div class="well stack-sm" role="status"><p class="warn-line">${I.pause}Engine 正在排空</p><p class="ink-2">每个任务做完当前这一步就停下，不再开新任务。在“运维”里结束排空后继续。</p></div>` : ''}
      ${s.queue >= s.queue_limit ? `<div class="well well--row"><p class="warn-line">${I.alert}<span>你的待处理到了上限 ${s.queue_limit} 件。项目的审批人都满了时，新任务会先排队。</span></p></div>` : ''}
      <div class="ov-grid">
        <div class="ov-main"><section class="region sheet" aria-labelledby="q-h"><div class="region-head"><h2 id="q-h">等你处理</h2><p>最早开始等的在上面</p></div>
          ${o.queue.length ? `<ol class="inbox">${o.queue.map(queueRow).join('')}</ol>` : '<div class="empty"><h3>都处理完了</h3><p>有任务需要人时，这里和飞书都会出现。</p><a class="btn btn--line" href="#chat">去对话里提个需求</a></div>'}
          <p class="note">同一件事，有权限的人都能看到，谁先处理都可以。</p></section></div>
        <div class="ov-side">
          ${o.queued.length ? `<section class="region" aria-labelledby="qd-h"><div class="region-head"><h2 id="qd-h">排队中</h2><p>先看优先级，再看项目占用</p></div><ul class="runlist">${o.queued.map(runRow).join('')}</ul></section>` : ''}
          <section class="region" aria-labelledby="run-h"><div class="region-head"><h2 id="run-h">正在推进</h2><a class="note" href="#tickets">全部任务</a></div>
            ${o.running.length ? `<ul class="runlist">${o.running.map(runRow).join('')}</ul>` : '<p class="note">现在没有任务在跑。</p>'}</section>
        </div>
      </div>`;
    return { overview: o.queue.length };
  };

  const pageChat = async () => {
    crumbs([['对话']]);
    const msgs = chat.map(m => m.who === 'me'
      ? `<div class="msg msg--me"><span class="who">你，${clock(m.t)}</span><div class="bubble">${esc(m.text)}</div></div>`
      : `<div class="msg msg--router"><span class="who">Router，${clock(m.t)}</span><div class="bubble">${esc(m.text || '（没有回复）')}</div>
          <div class="route-card well">${facts([['判断', esc(DECISION[m.route.output.decision] || m.route.output.decision)], m.route.output.project && ['项目', esc(pname(m.route.output.project))], ['依据', esc(m.route.output.why)]])}
          ${m.route.ticket ? `<a href="#ticket-${m.route.ticket}">打开 ${m.route.ticket}</a>` : ''}</div></div>`).join('');
    main.innerHTML = `
      <div class="page-head"><div><h1>对话</h1><p>直接说需求。Router 判断是直接回答、新开任务、发给已有任务，还是先问清楚；每次判断都记在<a href="#routing">路由记录</a>里。</p></div></div>
      <div class="chat"><section class="region" aria-label="与 Router 的对话">
        ${chat.length ? `<div class="thread" id="thread" aria-live="polite">${msgs}</div>` : '<div class="empty"><h3>还没有对话</h3><p>说一句需求试试，写上项目名，例如“hello 的 greet.sh 加一个 --shout 参数”。</p></div>'}
        <form class="composer" data-form="chat">
          <label for="say" class="visually-hidden">给 Router 发消息</label>
          <div class="row"><textarea class="textarea" id="say" name="text" rows="2" placeholder="写上项目名和要改的地方"></textarea><button class="btn" type="submit">${I.send}发送</button></div>
          <span class="help note" id="say-help">Enter 发送，Shift + Enter 换行。写任务编号（如 T-12）会把消息转给那个任务。</span>
        </form></section></div>`;
    $('#thread')?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  };

  const pageTickets = async () => {
    crumbs([['任务']]);
    const all = await get('/api/tickets');
    const groups = { open: all.filter(t => !['done', 'dropped'].includes(t.kind)), you: all.filter(t => ['you', 'fail'].includes(t.kind)), ended: all.filter(t => ['done', 'dropped'].includes(t.kind)) };
    const list = groups[ticketsTab] || groups.open;
    main.innerHTML = `
      <div class="page-head"><div><h1>任务</h1><p>每个任务一条分支、一个沙箱、一个 PR。</p></div><a class="btn btn--line" href="#chat">提需求</a></div>
      ${tabs([['#tickets', '未结束', 'open', groups.open.length], ['#tickets-you', '等人处理', 'you', groups.you.length], ['#tickets-ended', '已结束', 'ended', groups.ended.length]], ticketsTab, '任务筛选')}
      <section class="region" aria-label="任务列表">${table([{ t: '任务' }, { t: '项目' }, { t: '状态' }, { t: '完成条件', num: 1 }, { t: '花费', num: 1 }, { t: '更新', num: 1 }], list.map(t => `<tr data-href="#ticket-${t.id}">
        ${td('', `<a class="title" href="#ticket-${t.id}">${t.id} ${esc(t.title)}</a><span class="sub">${esc(t.state)}${t.why ? `：${esc(t.why.split('\n')[0])}` : ''}</span>`)}${td('项目', esc(pname(t.project)))}${td('状态', stateWord(t.kind))}
        ${td('完成条件', `<span class="mono">${t.passed} / 5</span>`, 1)}${td('花费', yuan(t.cost), 1)}${td('更新', `<span class="mono">${when(t.updated)}</span>`, 1)}</tr>`), ['这里没有任务', '在对话里说一句需求，Router 会开任务。'])}</section>`;
  };

  const TL_ICON = { stage: I.play, report: I.flag, flag: I.flag, box: I.box, code: I.file, cmd: I.term, edit: I.edit, say: I.flag, read: I.file, tool: I.tool, log: I.term, error: I.x, check: I.gate, gate: I.gate, review: I.gate, ask: I.hand };
  const TL_CATS = [['all', '全部'], ['code', '代码'], ['check', '测试与审查'], ['people', '汇报与决定'], ['box', '沙箱']];
  const tlCat = e => ['cmd', 'edit', 'read', 'code', 'tool', 'log', 'say', 'error'].includes(e.kind) ? 'code' : ['check', 'gate', 'review'].includes(e.kind) ? 'check' : e.kind === 'box' ? 'box' : 'people';
  const tlItem = e => `<li data-kind="${e.kind}"${e.kind === 'error' ? ' data-fail' : ''}><time>${clock(e.t)}</time><span class="rail">${TL_ICON[e.kind] || I.tool}</span><div class="body"><span class="what">${esc(e.what)}</span>${e.detail ? `<span class="detail-line">${esc(e.detail)}</span>` : ''}</div></li>`;

  const mandateView = (d) => {
    const t = d.ticket, m = t.mandate, open = t.stage === 'mandate_pending';
    const li = (items, icon, cls) => items.length ? `<ul class="spec__list ${cls}">${items.map(x => `<li>${icon}<span>${esc(x)}</span></li>`).join('')}</ul>` : '<p class="note">没有特别说明</p>';
    const test = i => t.pr_tests.find(x => x.criterion === i + 1);
    return `<div class="spec sub-head">
      <div class="spec__chips">${m.need_confirm ? `<span class="tag tag--warm">涉及${esc(m.need_confirm)}</span>` : ''}<span class="tag${open ? ' tag--you' : m.confirmed_by.length ? ' tag--ok' : ''}">${open ? '等确认' : m.confirmed_by.length ? `${I.check}${esc(names(m.confirmed_by))} 已确认` : '无需确认'}</span>${t.overlap ? `<a class="tag tag--warm" href="#ticket-${t.overlap.with}">和 ${t.overlap.with} 改同一个模块“${esc(t.overlap.module)}”</a>` : ''}${t.depends_on ? `<span class="tag">排在 ${t.depends_on} 后面</span>` : ''}</div>
      <section class="spec__goal"><span class="spec__label">目标</span><p>${esc(m.goal)}</p>${m.answer ? `<p class="note">${I.check} 确认时补充：${esc(m.answer)}</p>` : ''}</section>
      <div class="spec__cols"><section><h3 class="spec__h">做</h3>${li(m.scope, I.check, 'spec__list--in')}</section><section><h3 class="spec__h">不做</h3>${li(m.not, I.x, 'spec__list--out')}</section></div>
      <section><div class="region-head"><h3 class="spec__h">验收标准</h3><p>Tester 按每条生成测试，在改动前后各跑一遍</p></div><ol class="accept">${m.accept.map((a, i) => { const pt = test(i); return `<li data-s="${pt?.head_pass ? 'ok' : 'todo'}"><span class="accept__n mono">${i + 1}</span><div><p>${esc(a)}</p>${pt ? `<p class="note">测试 <code>${esc(pt.name)}</code>：改动前${pt.base_pass ? '通过' : '失败'}，改动后${pt.head_pass ? '通过' : '失败'}</p>` : ''}</div><span class="accept__side"><span class="tag${pt?.head_pass ? ' tag--ok' : ''}">${pt ? (pt.head_pass ? `${I.check}有测试，通过` : '测试没通过') : '还没有测试'}</span></span></li>`; }).join('')}</ol></section>
      ${m.assume.length ? `<aside class="callout"><span class="spec__label">假设</span><ul>${m.assume.map(x => `<li>${esc(x)}</li>`).join('')}</ul></aside>` : ''}
      ${m.open_question ? `<aside class="callout"><span class="spec__label">待确认</span><p>${esc(m.open_question)}</p></aside>` : ''}
      ${open ? '<p class="note">在右侧卡片里确认这份需求单。</p>' : ''}</div>`;
  };

  const ticketTab = (d, tab) => {
    const t = d.ticket;
    if (tab === 'mandate') return mandateView(d);
    if (tab === 'review') return !t.review.round ? '<div class="empty"><h3>还没有审查</h3><p>Worker 的改动通过构建和单元测试后，由独立的审查模型审查 diff。</p></div>' : `
      <div class="region sub-head"><div class="region-head"><h3>第 ${t.review.round} 轮</h3><p>只有经过独立复核证实的 P0 / P1 会拦住任务</p></div>
      ${t.review.findings.length ? `<ul class="findings">${t.review.findings.map(f => `<li data-sev="${esc(f.severity)}"><span class="sev sev--${esc(f.severity)}">${esc(f.severity.toUpperCase())}</span>
        <div class="findings__main"><p class="ink">${esc(f.title)}</p><p class="findings__where"><code>${esc(f.file)}${f.line ? `:${f.line}` : ''}</code></p><p class="note">${esc(f.evidence)}</p></div>
        <div class="findings__side"><span class="tag${f.status === 'fixed' ? ' tag--ok' : f.status === 'open' && f.confirmed ? ' tag--bad' : ''}">${f.status === 'fixed' ? '已修复' : f.status === 'false_positive' ? '误报' : f.confirmed ? '已证实，待修' : '未证实，不阻塞'}</span>
          ${d.can.approve && f.status !== 'fixed' ? `<button class="btn btn--text" type="button" data-act="finding" data-id="${t.id}" data-fp="${esc(f.fingerprint)}" data-status="${f.status === 'false_positive' ? 'open' : 'false_positive'}">${f.status === 'false_positive' ? '恢复' : '标为误报'}</button>` : ''}</div></li>`).join('')}</ul>` : '<p class="note">这一轮没有发现问题。</p>'}</div>`;
    if (tab === 'checks') return !t.checks.length ? '<div class="empty"><h3>还没有检查记录</h3><p>Worker 提交后，Engine 在沙箱里跑项目配置的构建、lint、单元测试和 E2E。</p></div>' : `
      <div class="region sub-head">${table([{ t: '检查' }, { t: '结果' }, { t: '提交' }, { t: '输出末尾' }], t.checks.map(c => `<tr>${td('检查', esc({ build: '构建', lint: 'lint', unit: '单元测试', e2e: '全量 E2E', accept: '验收测试', tests_kept: '测试保留检查' }[c.name] || c.name))}${td('结果', `<span class="tag${c.ok ? ' tag--ok' : ' tag--bad'}">${c.ok ? `${I.check}通过` : '没有通过'}</span>`)}${td('提交', `<span class="mono">${esc((c.sha || '').slice(0, 7))}</span>`)}${td('输出末尾', c.summary ? `<pre class="json"><code>${esc(c.summary)}</code></pre>` : '<span class="note">无</span>')}</tr>`), ['', ''])}</div>
      ${t.pr_tests.length ? `<div class="region sub-head"><div class="region-head"><h3>验收测试</h3><p>改动前失败、改动后通过，才说明测试真的在验这条标准</p></div>${table([{ t: '验收标准' }, { t: '测试文件' }, { t: '改动前' }, { t: '改动后' }], t.pr_tests.map(p => `<tr>${td('验收标准', `${p.criterion}. ${esc(t.mandate.accept[p.criterion - 1] || '')}`)}${td('测试文件', `<code>${esc(p.name)}</code>`)}${td('改动前', `<span class="tag">${p.base_pass ? '通过' : '失败'}</span>`)}${td('改动后', `<span class="tag${p.head_pass ? ' tag--ok' : ' tag--bad'}">${p.head_pass ? '通过' : '失败'}</span>`)}</tr>`), ['', ''])}</div>` : ''}`;
    if (tab === 'sandbox') return !d.sandbox ? `<div class="empty"><h3>现在没有沙箱</h3><p>${['done', 'dropped'].includes(d.kind) ? '任务结束后沙箱已回收。' : '任务开工时创建；丢了会用模板和任务分支重建。'}</p></div>` : `
      <div class="region sub-head">${kv([['提供方', esc(d.sandbox.provider)], ['宿主机', esc(d.sandbox.host)], ['模板', esc(d.sandbox.template)], ['状态', d.sandbox.state === 'paused' ? '已暂停' : '运行中'], ['创建', `<span class="mono">${when(d.sandbox.created)}</span>`]])}
      <p class="note">沙箱里没有模型 key 和 GitHub 令牌：模型请求经 Engine 的网关，代码只以 git bundle 进出，只有任务分支 <code>${esc(t.branch || '')}</code> 会被推到远端。</p></div>`;
    const tl = d.timeline.filter(e => tlFilter === 'all' || tlCat(e) === tlFilter);
    return `${t.progress.length && !['done', 'dropped'].includes(d.kind) ? `<section class="progress sub-head" aria-labelledby="pg-h"><div class="region-head"><h3 id="pg-h">Worker 的进度</h3><p>来自沙箱里的 <code>io/progress.md</code></p></div><ol class="progress__list">${t.progress.map(([st, x]) => `<li data-s="${st}">${st === 'done' ? I.check : st === 'now' ? I.play : I.clock}<span>${esc(x)}</span></li>`).join('')}</ol></section>` : ''}
      <div class="region-head sub-head"><div class="chips" role="group" aria-label="按类别筛选">${TL_CATS.map(([k, l]) => { const n = k === 'all' ? d.timeline.length : d.timeline.filter(e => tlCat(e) === k).length; return `<button class="chip" type="button" data-act="tl-filter" data-f="${k}" aria-pressed="${tlFilter === k}"${n ? '' : ' disabled'}>${l}<span class="n">${n}</span></button>`; }).join('')}</div></div>
      <ol class="timeline" id="tl">${tl.map(tlItem).join('')}</ol>`;
  };

  const entryCard = d => {
    const t = d.ticket, k = d.kind, ask = t.stage === 'blocked' ? t.ask : null, q = d.queue[0];
    const stop = !['done', 'dropped'].includes(k) && d.can.request ? `<button class="btn btn--line" type="button" data-act="t-stop" data-id="${t.id}">停止任务</button>` : '';
    let body = '', keys = '';
    const lead = `<p class="entry__state">${esc(ask && ask.kind === 'ask' ? ask.text : t.state)}</p>${t.why && !(ask && ask.kind === 'ask') ? `<p class="entry__why">${esc(t.why)}</p>` : ''}`;
    if (t.stage === 'mandate_pending' && d.can.approve) {
      body = `<form class="entry__form" data-form="t-confirm" data-id="${t.id}">
        ${field('m-ans', '补充（可选）', '<input class="input" id="m-ans" name="answer" autocomplete="off">', t.mandate.open_question ? esc(t.mandate.open_question) : '不写就按需求单里的假设推进')}
        ${t.overlap ? field('m-rel', `和 ${t.overlap.with} 的关系`, select('id="m-rel" name="rel"', [['par', '并行，合并前各自变基'], ['after', `排在 ${t.overlap.with} 后面`], ['merge', `并入 ${t.overlap.with}`]], 'par')) : ''}
        <div class="entry__keys"><button class="btn" type="submit">确认需求单</button>${stop}</div></form>`;
    } else if (t.stage === 'mandate_pending') {
      body = '<p class="note">需要这个项目的审批角色确认。</p>'; keys = stop;
    } else if (ask && d.can.approve && ask.kind === 'ask') {
      body = `<form class="entry__form" data-form="t-answer" data-id="${t.id}">${field('ans', '你的回答', '<textarea class="textarea" id="ans" name="text" rows="3" required></textarea>')}<div class="entry__keys"><button class="btn" type="submit">提交回答</button>${stop}</div></form>`;
    } else if (ask && d.can.approve && ask.kind === 'budget') {
      body = `<form class="entry__form" data-form="t-budget" data-id="${t.id}">${field('extra', '提高多少（元）', '<input class="input num" id="extra" name="extra" type="number" min="1" step="1" value="40" required>', `已花 ${yuan(t.cost)}，现在的上限 ${yuan(d.budget)}`)}<div class="entry__keys"><button class="btn" type="submit">提高预算并继续</button>${stop}</div></form>`;
    } else if (ask && d.can.approve && ask.kind === 'risk') {
      body = `<ul class="spec__list">${t.risks.map(r => `<li>${I.alert}<span>${esc(r.what)}：<code>${esc(r.paths.join('、'))}</code></span></li>`).join('')}</ul>`;
      keys = `<button class="btn" type="button" data-act="t-approve-risks" data-id="${t.id}">批准这些改动</button>${stop}`;
    } else if (ask && d.can.approve && ask.kind === 'evidence') {
      body = '<p class="note">项目卡里没有配这类验收的取证命令。可以这次按人工确认处理；想让它自动取证，停止任务后在项目卡的 <code>evidence</code> 里配上命令。</p>';
      keys = `<button class="btn" type="button" data-act="t-answer" data-id="${t.id}" data-text="waive">按人工确认处理</button>${stop}`;
    } else if (ask && d.can.approve) {
      keys = `<button class="btn" type="button" data-act="t-answer" data-id="${t.id}" data-text="">继续修</button><button class="btn btn--line" type="button" data-act="t-answer" data-id="${t.id}" data-text="false_positive">标为误报</button>${stop}`;
    } else if (t.handed) {
      keys = d.can.approve ? `<button class="btn" type="button" data-act="t-handback" data-id="${t.id}">交还给 Worker</button>${stop}` : stop;
    } else if (k === 'fail') {
      keys = `${d.can.request ? `<button class="btn" type="button" data-act="t-retry" data-id="${t.id}">${I.redo}重试</button>` : ''}${stop}`;
    } else if (t.stage === 'pr_open') {
      keys = `${t.pr && /^https?:/.test(t.pr.url) ? `<a class="btn" href="${esc(t.pr.url)}" target="_blank" rel="noopener">${I.ext}打开 PR #${t.pr.number}</a>` : ''}${d.forge === 'local' && d.can.approve ? `<button class="btn" type="button" data-act="t-merge" data-id="${t.id}">合并（本地演示）</button>` : ''}${stop}`;
      if (d.forge !== 'local') body = '<p class="note">合并在 GitHub 上进行。合并后任务自动结束，沙箱回收。</p>';
    } else if (t.stage === 'rolling_out') {
      ({ body, keys } = rolloutEntry(d));
    } else if (k === 'run') {
      keys = `${d.can.approve && t.branch ? `<button class="btn btn--line" type="button" data-act="t-handover" data-id="${t.id}">我来接手</button>` : ''}${stop}`;
    } else keys = stop;
    if (ask && !d.can.approve) body = '<p class="note">需要这个项目的审批角色处理。</p>';
    const cells = [['提需求', esc(who(t.by))], ['花费', `${yuan(t.cost)} / ${yuan(d.budget)}`], q ? ['谁能处理', esc(names(q.owners))] : ['完成条件', `<span class="mono">${d.contract.filter(c => c.result === 'pass').length} / 5</span>`], q && ['时限', `${mins(q.limit_minutes)}${q.overdue_minutes > 0 ? `，已超 ${mins(q.overdue_minutes)}` : ''}`]].filter(Boolean);
    return `<section class="entry" aria-label="任务现在的状态" data-k="${k}">
      <header class="entry__head"><span class="entry__kind"><i class="mark" aria-hidden="true"></i>${KIND_WORD[k]}</span><span class="entry__id mono">${esc(t.id)}</span><span class="entry__wait">${t.since ? `已等 <b>${mins((Date.now() - t.since) / 60000)}</b>` : `<span class="mono">${when(t.updated)}</span> 更新`}</span></header>
      <div class="entry__lead">${lead}</div>${body}${keys ? `<div class="entry__keys">${keys}</div>` : ''}
      <dl class="entry__cells">${cells.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>
      ${k === 'wait' && t.stage === 'queued' && d.can.approve ? `<div class="entry__form">${field('prio', '优先级', select(`id="prio" data-act="t-priority" data-id="${t.id}"`, Object.entries(PRIO), t.priority))}</div>` : ''}</section>`;
  };

  const pageTicket = async (id, tab) => {
    let d;
    try { d = await get(`/api/tickets/${id}`); } catch (e) { if (e.status !== 404) throw e; crumbs([['任务', '#tickets'], [id]]); main.innerHTML = `<div class="empty"><h1>找不到任务 ${esc(id)}</h1><p>编号可能写错了。</p><a class="btn btn--line" href="#tickets">回到任务列表</a></div>`; return; }
    const t = d.ticket;
    crumbs([['任务', '#tickets'], [`${t.id} ${t.title}`]]);
    const tabList = ticketTabs2(t);
    main.innerHTML = `
      <div class="ticket-head"><h1>${t.id} ${esc(t.title)}</h1>
        <div class="meta">${cbtn(`#project-${t.project}`, esc(d.project_name || t.project))}${ticketMeta2(t)}${t.branch ? `<span class="tag"><span class="mono">${esc(t.branch)}</span></span>` : ''}${t.pr ? (/^https?:/.test(t.pr.url) ? cbtn(t.pr.url, `<span class="mono">PR #${t.pr.number}</span>${I.ext}`, true) : `<span class="tag"><span class="mono">PR #${t.pr.number}</span></span>`) : ''}<span class="tag"><i class="avatar" aria-hidden="true">${esc(who(t.by).slice(0, 1))}</i>${esc(who(t.by))}提的</span><span class="tag"><span class="mono">${when(t.created)}</span> 创建</span>${t.tainted ? '<span class="tag tag--warm">读过外部内容</span>' : ''}</div>
        <figure class="quote"><blockquote>${esc(t.source_text)}</blockquote><figcaption>${esc(t.via)}</figcaption></figure></div>
      <div class="detail"><div class="region">${tabs(tabList.map(([k, l]) => [`#ticket-${t.id}${k === 'timeline' ? '' : `-${k}`}`, l, k]), tab, '任务详情')}<div>${ticketTab2(d, tab)}</div></div>
        <aside class="aside" aria-labelledby="c-h">${entryCard(d)}
          <div class="ticks"><div class="region-head head-gap"><h2 id="c-h">完成条件</h2><span class="num ink-2">${d.contract.filter(c => c.result === 'pass').length} / 5</span></div>
            <ul class="checklist">${d.contract.map(c => `<li data-r="${c.result}">${c.result === 'pass' ? I.check : c.result === 'fail' ? I.x : I.clock}<div><span class="t">${esc(c.title)}</span>${c.note ? `<span class="s">${esc(c.note)}</span>` : ''}</div></li>`).join('')}</ul>
            <p class="note">5 项都在最新提交上通过，Engine 才开 PR。不会自动合并。</p></div></aside></div>`;
  };

  const pageRouting = async () => {
    crumbs([['路由记录']]);
    const [routes, cfg] = await Promise.all([get('/api/routing'), get('/api/settings')]);
    const models = cfg.endpoints.flatMap(e => e.models.map(m => [`${e.id}|${m}`, `${e.name} / ${m}`]));
    main.innerHTML = `
      <div class="page-head"><div><h1>路由记录</h1><p>Router 每次判断只读一份存下来的输入，所以任何一条都能换个模型原样重放，逐字段对比。重放不会改动任何任务。</p></div></div>
      <section class="region" aria-label="路由记录">${table([{ t: '时间' }, { t: '消息' }, { t: '判断' }, { t: '项目' }, { t: '可信度' }, { t: '依据' }, { t: '<span class="visually-hidden">操作</span>' }], routes.map(r => { const rp = replays[r.id]; return `<tr>
        ${td('时间', `<span class="mono">${when(r.at)}</span>`)}${td('消息', `<span class="ink">${esc(r.input.text)}</span><span class="sub">${esc(r.input.channel)}，${esc(who(r.input.sender))}（${ROLE[r.input.sender_role] || '没有登记'}）</span>`)}
        ${td('判断', `${esc(DECISION[r.output.decision] || r.output.decision)}${r.ticket ? `<span class="sub">${tLink(r.ticket)}</span>` : ''}`)}${td('项目', esc(pname(r.output.project)) || '无')}${td('可信度', esc(CONF[r.output.confidence] || ''))}${td('依据', `${esc(r.output.why)}${r.wrong ? '<span class="sub">已标为判断有误</span>' : ''}`)}
        ${td('', `<div class="actions"><button class="btn btn--text" type="button" data-act="route-open" data-id="${r.id}" aria-expanded="${rp ? 'true' : 'false'}">重放</button>${r.wrong ? '' : `<button class="btn btn--text" type="button" data-act="route-wrong" data-id="${r.id}">判断有误</button>`}${isAdmin() || myRole() === 'approver' ? `<button class="btn btn--text" type="button" data-act="eval-add" data-id="${r.id}" data-wrong="${r.wrong || r.moved ? 1 : 0}">加入评测集</button>` : ''}</div>`)}</tr>${evalAddRow(r)}
        ${rp ? `<tr><td colspan="7"><form class="well stack-sm" data-form="replay" data-id="${r.id}">
          <div class="form-grid">${field(`rm-${r.id}`, '用哪个模型重放', select(`id="rm-${r.id}" name="target"`, [['', `当前设置（${r.input.model || '规则'}）`], ...models], rp.target || ''))}</div>
          <div class="actions actions--start"><button class="btn btn--line" type="submit">用同一份输入重放</button><button class="btn btn--text" type="button" data-act="route-close" data-id="${r.id}">收起</button></div>
          ${rp.now ? table([{ t: '字段' }, { t: '当时' }, { t: '重放' }], ['decision', 'project', 'ticket', 'confidence'].map(k => `<tr>${td('字段', `<code>${k}</code>`)}${td('当时', esc(rp.was[k] ?? '无'))}${td('重放', `${esc(rp.now[k] ?? '无')}${(rp.was[k] ?? null) !== (rp.now[k] ?? null) ? ' <span class="tag tag--warm">不同</span>' : ''}`)}</tr>`), ['', '']) : ''}</form></td></tr>` : ''}`; }), ['还没有路由记录', '对话、飞书里发来的每条消息都会记在这里。'])}</section>`;
  };

  const pageProjects = async () => {
    crumbs([['项目']]);
    main.innerHTML = `
      <div class="page-head"><div><h1>项目</h1><p>项目卡决定 Router 怎么认出项目、哪些模块的改动要审批、沙箱里跑哪些命令。</p></div>${isAdmin() ? '<a class="btn btn--line" href="#project-new">接入项目</a>' : ''}</div>
      <section class="region" aria-label="项目列表">${table([{ t: '项目' }, { t: '仓库' }, { t: '未结束任务', num: 1 }, { t: '审批人' }], PROJECTS.map(({ project: p, open, approvers }) => `<tr data-href="#project-${p.id}">${td('', `<a class="title" href="#project-${p.id}">${esc(p.name)}</a><span class="sub">${esc(p.summary)}</span>`)}${td('仓库', `<code>${esc(p.slug || p.repo)}</code>`)}${td('未结束任务', open, 1)}${td('审批人', esc(names(approvers)))}</tr>`), ['还没有接入项目', '接入一个仓库后，Router 才能把需求路由过去。'])}</section>`;
  };

  const NEW_PROJECT = { id: '', name: '', summary: '', aliases: [], channels: [], repo: 'https://github.com/org/repo.git', slug: 'org/repo', base_branch: 'main', modules: [{ name: '计费', paths: ['billing/'], confirm: '计费与金额' }], commands: { setup: [], build: null, lint: null, unit: null, e2e: null }, protected_tests: ['tests/'], test_gen: null, sandbox: { provider: null, self_hosted_only: false, template: null }, two_person: false };
  const pageProject = async id => {
    const row = PROJECTS.find(x => x.project.id === id), p = row?.project || NEW_PROJECT, fresh = !row;
    crumbs([['项目', '#projects'], [fresh ? '接入项目' : p.name]]);
    const c = p.commands || {};
    const extras = fresh ? '' : await projectExtras(p, ['approver', 'admin'].includes(myRole(p.id)));
    main.innerHTML = `
      <div class="page-head"><div><h1>${fresh ? '接入项目' : esc(p.name)}</h1><p>${fresh ? '填好项目卡后保存。仓库要能用 Engine 的 GitHub 令牌访问。' : esc(p.summary)}</p></div></div>
      ${fresh ? '' : `<section class="region" aria-labelledby="pc-h"><h2 id="pc-h">项目卡</h2>${kv([['仓库', `<code>${esc(p.repo)}</code>`, esc(`${p.slug}，基线分支 ${p.base_branch}`)], ['别名', esc(p.aliases.join('、') || '无')], ['渠道', esc(p.channels.join('、') || '无')], ['审批人', esc(names(row.approvers))], ['需确认的模块', p.modules.filter(m => m.confirm).map(m => `<span class="tag tag--warm">${esc(m.name)}：${esc(m.confirm)}</span>`).join(' ') || '无'], ['受保护的测试', `<code>${esc(p.protected_tests.join('、') || '无')}</code>`], ['沙箱', p.sandbox.self_hosted_only ? '沙箱只用自建' : '按全局设置', p.sandbox.template ? esc(`模板 ${p.sandbox.template}`) : '']])}
        <h3>沙箱里跑的命令</h3>${facts([['准备', (c.setup || []).map(x => `<code>${esc(x)}</code>`).join('<br>') || '无'], ['构建', c.build ? `<code>${esc(c.build)}</code>` : '没有配置'], ['lint', c.lint ? `<code>${esc(c.lint)}</code>` : '没有配置'], ['单元测试', c.unit ? `<code>${esc(c.unit)}</code>` : '没有配置'], ['全量 E2E', c.e2e ? `<code>${esc(c.e2e)}</code>` : '没有配置：完成条件里会写明“未运行”'], ['验收测试', p.test_gen ? `<code>${esc(p.test_gen.command)}</code>，放在 <code>${esc(p.test_gen.dir)}</code>` : '没有配置']])}</section>`}
      ${extras}
      ${isAdmin() ? `<section class="region" aria-labelledby="pe-h"><h2 id="pe-h">${fresh ? '项目卡' : '编辑项目卡'}</h2><p class="ink-2">项目卡是一份 JSON。<code>modules[].confirm</code> 写了规则名的模块，需求单和改动都要审批角色确认；<code>test_gen.command</code> 里的 <code>{file}</code> 会换成测试文件路径。</p>
        <form class="stack-md" data-form="project">${field('pj', '项目卡 JSON', `<textarea class="textarea mono" id="pj" name="json" rows="22" spellcheck="false">${esc(JSON.stringify(p, null, 2))}</textarea>`)}<div class="actions actions--start"><button class="btn" type="submit">保存项目卡</button></div></form></section>` : ''}`;
  };

  const pageMembers = async () => {
    crumbs([['成员与权限']]);
    const roleText = m => Object.entries(m.roles).map(([k, r]) => `${k === '*' ? '全局' : pname(k)}：${ROLE[r]}`).join('，');
    main.innerHTML = `
      <div class="page-head"><div><h1>成员与权限</h1><p>角色在 Engine 里检查，控制台只是照着显示。没登记的发送人按访客处理：只回答，不开任务。</p></div></div>
      ${shownToken ? `<div class="well stack-sm" role="status"><p class="ink">${esc(who(shownToken.id))} 的新令牌，只显示这一次：</p><pre class="json"><code>${esc(shownToken.token)}</code></pre></div>` : ''}
      <section class="region" aria-label="成员">${table([{ t: '成员' }, { t: 'GitHub' }, { t: '角色' }, { t: '待处理上限', num: 1 }, { t: '<span class="visually-hidden">操作</span>' }], MEMBERS.map(m => `<tr>${td('', `<span class="title">${esc(m.name)}</span><span class="sub mono">${esc(m.id)}</span>`)}${td('GitHub', m.github ? `<code>${esc(m.github)}</code>` : '<span class="note">没有绑定</span>')}${td('角色', esc(roleText(m)))}${td('待处理上限', m.queue_limit ?? '默认', 1)}${td('', isAdmin() ? `<div class="actions"><button class="btn btn--text" type="button" data-act="member-token" data-id="${esc(m.id)}">签发令牌</button></div>` : '')}</tr>`), ['还没有成员', '用 acw init 创建第一个管理员。'])}</section>
      ${delegateForm()}
      ${isAdmin() ? `<section class="region" aria-labelledby="ma-h"><h2 id="ma-h">添加或修改成员</h2><p class="ink-2">编号相同就是修改。PR 上的评论只有来自绑定了 GitHub 账号、且有审批角色的成员时，才会被当作指令。</p>
        <form class="well stack-md" data-form="member"><div class="form-grid">
          ${field('mb-id', '编号', '<input class="input mono" id="mb-id" name="id" autocomplete="off" required>', '字母和数字，之后不能改')}${field('mb-name', '名字', '<input class="input" id="mb-name" name="name" autocomplete="off" required>')}
          ${field('mb-gh', 'GitHub 账号（可选）', '<input class="input mono" id="mb-gh" name="github" autocomplete="off">')}${field('mb-fs', '飞书 open_id（可选）', '<input class="input mono" id="mb-fs" name="feishu" autocomplete="off" placeholder="ou_…">', '在飞书里给机器人发消息时，按它认出是谁')}${field('mb-role', '全局角色', select('id="mb-role" name="global"', Object.entries(ROLE), 'requester'))}
          ${field('mb-proj', '项目角色（可选）', '<input class="input mono" id="mb-proj" name="projects" autocomplete="off" placeholder="hello=approver, web=requester">', '格式：项目编号=角色，逗号分隔；角色写 requester 或 approver')}${field('mb-limit', '待处理上限（可选）', '<input class="input num" id="mb-limit" name="queue_limit" type="number" min="1">', '不填用全局设置')}
        </div><div class="actions actions--start"><button class="btn" type="submit">保存成员</button></div></form></section>` : ''}`;
  };

  const logPage = async (title, lead, path, heads, row, empty) => { crumbs([[title]]); const rows = await get(path); main.innerHTML = `<div class="page-head"><div><h1>${title}</h1><p>${lead}</p></div></div><section class="region" aria-label="${title}">${table(heads, rows.map(row), empty)}</section>`; };
  const pageSecurity = () => logPage('安全', '权限被拒、外部内容、密钥扫描和 webhook 验签失败都记在这里。', '/api/security', [{ t: '时间' }, { t: '任务' }, { t: '类型' }, { t: '谁' }, { t: '发生了什么' }, { t: '处理' }],
    e => `<tr>${td('时间', `<span class="mono">${when(e.ts)}</span>`)}${td('任务', e.ticket ? tLink(e.ticket) : '<span class="note">无</span>')}${td('类型', `<span class="nowrap">${esc(e.kind)}</span>`)}${td('谁', esc(who(e.who)))}${td('发生了什么', `<span class="ink">${esc(e.what)}</span>`)}${td('处理', esc(e.result))}</tr>`, ['没有安全记录', '有请求被拒绝或内容被打码时会出现在这里。']);
  const pageNotifications = () => logPage('通知', '需要人处理的事会推到飞书群；没有配置飞书 webhook 时只记录，不发送。', '/api/notifications', [{ t: '时间' }, { t: '事项' }, { t: '类别' }, { t: '通知谁' }, { t: '结果' }],
    e => `<tr>${td('时间', `<span class="mono">${when(e.ts)}</span>`)}${td('事项', `<span class="ink">${esc(e.text)}</span>`)}${td('类别', esc(QKIND[e.kind] || e.kind))}${td('通知谁', esc(e.to))}${td('结果', e.sent ? `<span class="tag tag--ok">${I.check}已推送</span>` : '<span class="tag">没有发送：未配置飞书</span>')}</tr>`, ['还没有通知', '有任务需要人时会出现在这里。']);

  const quota = (v, max, unit) => { const pct = Math.min(100, Math.round((v / max) * 100) || 0); return `<div class="bar-cell"${pct >= 80 ? ' data-hot' : ''}><span class="bar-cell__bar" style="--w:${pct}%"></span><span class="mono">${unit}${(+v).toFixed(unit ? 2 : 0)} / ${unit}${max}</span></div>`; };
  const pageCost = async () => {
    crumbs([['成本']]);
    const c = await get('/api/cost');
    const rows = list => list.map(r => `<tr>${td('', esc(STAGE_NAME[r.key] || r.key || '未归类'))}${td('输入 token', r.input.toLocaleString(), 1)}${td('输出 token', r.output.toLocaleString(), 1)}${td('金额', yuan(r.amount), 1)}</tr>`);
    main.innerHTML = `
      <div class="page-head"><div><h1>成本</h1><p>近 30 天 ${yuan(c.total_30d)}，今天 ${yuan(c.total_today)}。Worker 的用量由模型网关统计，其余阶段由 Engine 统计。</p></div></div>
      ${c.unpriced ? `<div class="well well--row"><p class="warn-line">${I.alert}<span>有模型没有填价格：只记了 token，金额按 0 计，预算对它不起作用。</span></p><a class="btn btn--line" href="#config">去填价格</a></div>` : ''}
      <section class="region" aria-labelledby="cs-h"><h2 id="cs-h">按阶段（近 30 天）</h2>${table([{ t: '阶段' }, { t: '输入 token', num: 1 }, { t: '输出 token', num: 1 }, { t: '金额', num: 1 }], rows(c.by_stage), ['还没有用量', '任务跑起来后会有数字。'])}</section>
      <section class="region" aria-labelledby="cm-h"><h2 id="cm-h">按模型（近 30 天）</h2>${table([{ t: '模型' }, { t: '输入 token', num: 1 }, { t: '输出 token', num: 1 }, { t: '金额', num: 1 }], rows(c.by_model), ['还没有用量', ''])}</section>
      <section class="region" aria-labelledby="cq-h"><div class="region-head"><h2 id="cq-h">额度</h2><p>项目额度用完后，新任务排队，在跑的不中断</p></div>
        ${table([{ t: '项目' }, { t: `今天，上限 ¥${c.limits.project_day}` }, { t: `近 30 天，上限 ¥${c.limits.project_month}` }], c.projects.map(p => `<tr>${td('', esc(p.name))}${td('今天', quota(p.day, c.limits.project_day, '¥'))}${td('近 30 天', quota(p.month, c.limits.project_month, '¥'))}</tr>`), ['没有项目', ''])}
        ${table([{ t: '成员' }, { t: `今天新任务，上限 ${c.limits.member_day} 个` }], c.members.map(m => `<tr>${td('', esc(m.name))}${td('今天新任务', quota(m.today, c.limits.member_day, ''))}</tr>`), ['没有成员', ''])}</section>`;
  };

  const pageOps = async () => {
    crumbs([['运维']]);
    const [o, sb] = await Promise.all([get('/api/ops'), get('/api/standby').catch(() => null)]);
    main.innerHTML = `
      <div class="page-head"><div><h1>运维</h1><p>Engine 只有一份事实：事件日志。投影、待处理、成本都可以从它重建。</p></div></div>
      <section class="region" aria-labelledby="oe-h"><h2 id="oe-h">Engine</h2>${kv([['事件序号', `<span class="mono">${o.last_seq}</span>`], ['沙箱提供方', esc(o.sandbox_provider), o.sandbox_isolated ? '有隔离' : '没有隔离，只用于开发和演示'], ['代码托管', esc(o.forge)], ['Worker', esc(o.agent)], ['飞书通知', o.feishu ? '已配置' : '没有配置，只记录'], ['正在跑的任务', o.running.length ? o.running.map(tLink).join(' ') : '无']])}
        ${!o.sandbox_isolated ? `<p class="warn-line">${I.alert}<span>现在用的沙箱没有隔离：命令能读到这台机器上的文件，也能访问网络。不要拿它跑不可信的仓库。</span></p>` : ''}</section>
      ${opsExtras(o, sb)}
      ${isAdmin() ? `<section class="region" aria-labelledby="od-h"><h2 id="od-h">升级前排空</h2><div class="well well--row"><p class="ink">${o.draining ? '正在排空：任务做完当前这一步就停，不开新任务。' : '排空后，每个任务做完当前这一步就停下，重启 Engine 后从停下的地方继续。'}</p><button class="btn btn--line" type="button" data-act="drain" data-on="${o.draining ? '0' : '1'}">${o.draining ? '结束排空' : '开始排空'}</button></div>
        <div class="well well--row"><p class="ink">从事件日志重建全部投影。不会重发通知，也不会重跑任务。</p><button class="btn btn--line" type="button" data-act="rebuild">重建投影</button></div></section>` : ''}
      <section class="region" aria-labelledby="os-h"><h2 id="os-h">沙箱</h2>${table([{ t: '沙箱' }, { t: '任务' }, { t: '项目' }, { t: '提供方' }, { t: '宿主机' }, { t: '状态' }], o.sandboxes.map(s => `<tr>${td('', `<span class="mono">${esc(s.id)}</span>`)}${td('任务', tLink(s.ticket))}${td('项目', esc(pname(s.project)))}${td('提供方', esc(s.provider))}${td('宿主机', esc(s.host))}${td('状态', s.state === 'paused' ? '已暂停' : '运行中')}</tr>`), ['现在没有沙箱', '任务开工时创建，结束后回收。'])}</section>`;
  };

  const modelOpts = (cfg, epId) => (cfg.endpoints.find(e => e.id === epId)?.models || []).map(m => [m, m]);
  const pageSettings = async () => {
    crumbs([['设置']]);
    const cfg = await get('/api/settings'), s = cfg.settings, ro = isAdmin() ? '' : ' disabled';
    LAST_SETTINGS = s;
    const eps = cfg.endpoints.map(e => [e.id, e.name]);
    const fbOpts = [['', '不设'], ...cfg.endpoints.flatMap(e => e.models.map(m => [`${e.id}|${m}`, `${e.name} / ${m}`]))];
    const models = [...new Set([...Object.values(s.stages).flatMap(m => [m.model, (m.fallback || '').split('|')[1]]), ...Object.keys(s.catalog)].filter(Boolean))];
    main.innerHTML = `
      <div class="page-head"><div><h1>设置</h1><p>保存后立即生效。每次保存留一个版本，当前第 ${s.version} 版。</p></div></div>
      <section class="region" aria-labelledby="ep-h"><h2 id="ep-h">模型接入</h2>
        <p class="ink-2">任何兼容 OpenAI 接口的外部服务都能接：填 https 的 Base URL 和 API key，模型列表从它的 <code>GET /models</code> 拉取。接口类型选 Responses 时，codex 的请求直接转发；选 Chat Completions 时由网关转换。</p>
        ${table([{ t: '名称' }, { t: 'Base URL' }, { t: '接口' }, { t: 'API key' }, { t: '模型' }, { t: '<span class="visually-hidden">操作</span>' }], cfg.endpoints.map(e => `<tr>${td('', `<span class="title">${esc(e.name)}</span>`)}${td('Base URL', `<code>${esc(e.base)}</code>`)}${td('接口', e.api === 'responses' ? 'Responses' : 'Chat Completions')}${td('API key', `<code>••••${esc(e.key_hint)}</code>`)}${td('模型', `<span class="mono">${e.models.length}</span> 个<span class="sub">${when(e.pulled_at)} 拉取：${esc(e.models.slice(0, 4).join('、'))}${e.models.length > 4 ? ' 等' : ''}</span>`)}${td('', isAdmin() ? `<div class="actions"><button class="btn btn--text" type="button" data-act="ep-pull" data-id="${e.id}">重新拉取</button><button class="btn btn--text" type="button" data-act="ep-del" data-id="${e.id}">删除</button></div>` : '')}</tr>`), ['还没有模型接入', '先加一个接入，再给各阶段选模型。'])}
        ${isAdmin() ? `<form class="well stack-md" data-form="endpoint" novalidate><h3>添加接入</h3><div class="form-grid">
          ${field('ep-name', '名称', '<input class="input" id="ep-name" name="name" autocomplete="off" placeholder="例如：OrcaRouter">')}${field('ep-base', 'Base URL', '<input class="input mono" id="ep-base" name="base" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1">')}
          ${field('ep-key', 'API key', '<input class="input" id="ep-key" name="key" type="password" autocomplete="off">', '只存在 Engine 的密钥表里，不进事件，不进沙箱')}${field('ep-api', '接口类型', select('id="ep-api" name="api"', [['chat', 'Chat Completions'], ['responses', 'Responses（也支持 Chat Completions）']], 'chat'))}
        </div><div class="actions actions--start"><button class="btn" type="submit">拉取模型并添加</button></div></form>` : ''}</section>
      <form id="settings" data-form="settings" class="stack-xl">
        <section class="region" aria-labelledby="mo-h"><h2 id="mo-h">每个阶段用哪个模型</h2><p class="ink-2">模型只能从所选接入拉到的列表里选。主模型重试后仍不可用时，这次请求改用备用模型；都不可用，任务等待，不算失败。</p>
          ${table([{ t: '阶段' }, { t: '接入' }, { t: '模型' }, { t: '备用模型' }], ['router', 'worker', 'reviewer', 'tester'].map(k => { const m = s.stages[k] || {}; return `<tr>${td('', `<span class="title">${STAGE_NAME[k]}</span><span class="sub">${STAGE_DO[k]}</span>`)}${td('接入', select(`name="ep-${k}" aria-label="${STAGE_NAME[k]}的接入"${ro}`, [['', '没有选'], ...eps], m.endpoint))}${td('模型', select(`name="md-${k}" aria-label="${STAGE_NAME[k]}的模型"${ro}`, m.endpoint ? modelOpts(cfg, m.endpoint) : [['', '先选接入']], m.model))}${td('备用模型', select(`name="fb-${k}" aria-label="${STAGE_NAME[k]}的备用模型"${ro}`, fbOpts, m.fallback || ''))}</tr>`; }), ['', ''])}</section>
        ${isAdmin() ? `<div class="well stack-sm">${field('f-eval-override', '换路由模型时越过评测的理由（平时留空）', '<input class="input" id="f-eval-override" name="eval_override" autocomplete="off">', '评测集里有用例时，新的路由模型要先跑过评测且不比现在的差。确实要越过时在这里写理由，会记进安全记录')}</div>` : ''}
        <section class="region" aria-labelledby="ex-h"><h2 id="ex-h">执行限制</h2><div class="form-grid">
          ${num('workers', 'Worker 槽位', s.workers, '同时在跑的任务数')}${num('repo_parallel', '每个仓库并行任务', s.repo_parallel)}${num('budget', '单任务预算上限（元）', s.budget, '超出后任务停下，等审批人决定')}
          ${num('project_day', '项目每日额度（元）', s.project_day)}${num('project_month', '项目 30 天额度（元）', s.project_month)}${num('member_day', '成员每日新任务（个）', s.member_day)}
          ${num('queue_limit', '每人待处理上限（件）', s.queue_limit, '项目的审批人都到上限时，新任务排队')}${num('rounds', '审查轮数上限', s.rounds, '超出后转给人')}
          ${field('f-sched', '槽位不够时', select(`id="f-sched" name="sched"${ro}`, [['fair', '按项目权重公平分配'], ['fifo', '先来先做']], s.sched), '优先级高的总在前面')}
        </div></section>
        <section class="region" aria-labelledby="sl-h"><h2 id="sl-h">等人处理的时限（分钟）</h2><p class="ink-2">过半提醒能处理的人，到点升级给所有审批人和管理员。</p><div class="form-grid">${Object.entries(QKIND).map(([k, l]) => num(`sla.${k}`, l, s.sla[k] ?? 60)).join('')}</div></section>
        <section class="region" aria-labelledby="ca-h"><h2 id="ca-h">模型价格</h2><p class="ink-2"><code>/models</code> 不返回价格和上下文窗口，要在这里填。价格是每百万 token 的金额（元）。没填的模型只记 token，金额按 0。</p>
          ${table([{ t: '模型' }, { t: '上下文窗口', num: 1 }, { t: '输入价格', num: 1 }, { t: '输出价格', num: 1 }], models.map(m => { const c = s.catalog[m] || {}; return `<tr>${td('', `<span class="mono">${esc(m)}</span>${s.catalog[m] ? '' : '<span class="sub">还没有填</span>'}`)}${td('上下文窗口', `<input class="input num" name="cat.${esc(m)}.context" type="number" min="0" value="${c.context || 0}" aria-label="${esc(m)} 的上下文窗口"${ro}>`, 1)}${td('输入价格', `<input class="input num" name="cat.${esc(m)}.input_price" type="number" min="0" step="0.01" value="${c.input_price || 0}" aria-label="${esc(m)} 的输入价格"${ro}>`, 1)}${td('输出价格', `<input class="input num" name="cat.${esc(m)}.output_price" type="number" min="0" step="0.01" value="${c.output_price || 0}" aria-label="${esc(m)} 的输出价格"${ro}>`, 1)}</tr>`; }), ['先给阶段选模型', '选过的模型会出现在这里。'])}</section>
        ${isAdmin() ? '<div class="savebar"><span>改完后保存，立即生效</span><div class="actions"><button class="btn" type="submit">保存设置</button></div></div>' : ''}
      </form>
      <section class="region" aria-labelledby="hi-h"><h2 id="hi-h">历史版本</h2>${table([{ t: '版本' }, { t: '时间' }, { t: '谁' }, { t: '改了什么' }, { t: '<span class="visually-hidden">操作</span>' }], cfg.history.map(h => `<tr>${td('版本', `第 ${h.version} 版${h.version === s.version ? '<span class="sub">当前</span>' : ''}`)}${td('时间', `<span class="mono">${when(h.at)}</span>`)}${td('谁', esc(who(h.by)))}${td('改了什么', `${esc(h.note || '')}<span class="sub">${h.changes.slice(0, 6).map(c => `${esc(c.key)}：${esc(JSON.stringify(c.from))} → ${esc(JSON.stringify(c.to))}`).join('<br>')}${h.changes.length > 6 ? `<br>等 ${h.changes.length} 项` : ''}</span>`)}${td('', isAdmin() && h.version !== s.version ? `<div class="actions"><button class="btn btn--text" type="button" data-act="rollback" data-v="${h.version}">回滚到这一版</button></div>` : '')}</tr>`), ['', ''])}</section>`;
    const f = $('#settings');
    f?.addEventListener('change', e => {
      if (!e.target.name?.startsWith('ep-')) return;
      const sel = f.elements[`md-${e.target.name.slice(3)}`], cur = sel.value, opts = modelOpts(cfg, e.target.value);
      sel.innerHTML = (opts.length ? opts : [['', '先选接入']]).map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  /* ---------- routing ---------- */
  const parse = () => {
    const h = decodeURIComponent(location.hash.replace(/^#/, '')) || 'overview';
    let m;
    if ((m = h.match(/^ticket-(T-\d+)(?:-(review|checks|mandate|sandbox|rollout|arch))?$/))) return ['ticket', m[1], m[2] || 'timeline'];
    if ((m = h.match(/^plan-(P-\d+)$/))) return ['plan', m[1]];
    if ((m = h.match(/^tickets(?:-(you|ended))?$/))) return ['tickets', m[1] || 'open'];
    if ((m = h.match(/^project-(.+)$/))) return ['project', m[1]];
    return [h];
  };
  const PAGES = { overview: pageOverview, chat: pageChat, routing: pageRouting, projects: pageProjects, members: pageMembers, security: pageSecurity, notifications: pageNotifications, cost: pageCost, ops: pageOps, config: pageSettings, plans: pagePlans, memory: pageMemory, eval: pageEval };
  let renderSeq = 0;
  const render = async keep => {
    const seq = ++renderSeq, [route, a, b] = parse();
    const scroll = keep ? $('.main').scrollTop : 0;
    renderNav(route);
    if (!keep) main.innerHTML = skeleton(6);
    try {
      if (!ME) { ME = await get('/api/me'); }
      [MEMBERS, PROJECTS, STANDBY] = await Promise.all([get('/api/members'), get('/api/projects'), get('/api/standby').catch(() => null)]);
      if (seq !== renderSeq) return;
      $('#whoami').textContent = ME.auth === 'none' ? `${who(ME.id) === '你' ? ME.member?.name || ME.id : ME.id}（开发模式，没有登录）` : `${ME.member?.name || ME.id}，${ROLE[myRole()]}`;
      if (route === 'tickets') { ticketsTab = a; await pageTickets(); }
      else if (route === 'ticket') await pageTicket(a, b);
      else if (route === 'project') await pageProject(a);
      else if (route === 'plan') await pagePlan(a);
      else await (PAGES[route] || pageOverview)();
      if (seq !== renderSeq) return;
      main.insertAdjacentHTML('afterbegin', standbyBanner());
      const n = route === 'overview' ? null : (await get('/api/overview')).queue.length;
      renderNav(route, { overview: n ?? $$('.inbox__item').length });
    } catch (e) {
      if (seq !== renderSeq) return;
      if (e.status === 403 && !ME) { pageLogin(getToken() ? '这个令牌无效' : ''); return; }
      main.innerHTML = errorBox(e);
    }
    document.title = `${$('h1', main)?.textContent || '控制台'}，Auto-CodWorker`;
    ddEnhance();
    if (keep) $('.main').scrollTop = scroll; else main.focus({ preventScroll: true });
  };
  window.addEventListener('hashchange', () => { tlFilter = 'all'; $('.main').scrollTop = 0; closeMenu(); render(); });

  /* ---------- live updates ---------- */
  let pending = null, es = null;
  const typing = () => { const a = document.activeElement; return (a && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || !!ddOpen; };
  const refreshSoon = () => { clearTimeout(pending); pending = setTimeout(function tick() { if (typing()) { pending = setTimeout(tick, 1500); return; } render(true); }, 350); };
  const live = () => {
    if (es) es.close();
    es = new EventSource(`/api/events${getToken() ? `?token=${encodeURIComponent(getToken())}` : ''}`);
    es.onmessage = refreshSoon;
    es.addEventListener('reload', refreshSoon);
    es.onopen = () => { $('#live').innerHTML = '实时'; };
    es.onerror = () => { $('#live').innerHTML = '连接断开，重连中'; };
  };

  /* ---------- menu ---------- */
  const shell = $('#shell'), menuBtn = $('#menu-btn');
  function closeMenu() { shell.dataset.menu = ''; menuBtn.setAttribute('aria-expanded', 'false'); $('.scrim')?.remove(); }
  menuBtn.addEventListener('click', () => {
    if (shell.dataset.menu === 'open') return closeMenu();
    shell.dataset.menu = 'open'; menuBtn.setAttribute('aria-expanded', 'true');
    const sc = document.createElement('div'); sc.className = 'scrim'; sc.addEventListener('click', closeMenu); document.body.append(sc);
    $('#side a').focus();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && shell.dataset.menu === 'open') { closeMenu(); menuBtn.focus(); } });

  /* ---------- actions ---------- */
  const T_ACT = { 't-stop': ['stop', '已停止'], 't-retry': ['retry', '已重新排队'], 't-handover': ['handover', 'Worker 已停下，分支交给你'], 't-handback': ['handback', '已交还给 Worker'], 't-approve-risks': ['approve-risks', '已批准，继续开 PR'], 't-merge': ['merge', '已合并，任务结束'] };
  document.addEventListener('click', async e => {
    const row = e.target.closest('tr[data-href], li[data-href]');
    if (row && !e.target.closest('a, button, select, input, label')) { location.hash = row.dataset.href; return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT') return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'reload') return render();
    if (act === 'tl-filter') { tlFilter = b.dataset.f; return render(true); }
    if (act === 'route-open') { replays[id] = replays[id] || {}; return render(true); }
    if (act === 'route-close') { delete replays[id]; return render(true); }
    busy(b, true);
    try {
      if (T_ACT[act]) { await api('POST', `/api/tickets/${id}/${T_ACT[act][0]}`, {}); toast(`${id}：${T_ACT[act][1]}`); }
      else if (act === 't-answer') { await api('POST', `/api/tickets/${id}/answer`, { text: b.dataset.text }); toast(`${id}：已提交`); }
      else if (act === 'finding') { await api('POST', `/api/tickets/${id}/finding`, { fingerprint: b.dataset.fp, status: b.dataset.status }); toast(b.dataset.status === 'open' ? '已恢复为待修' : '已标为误报，下一轮审查不再提'); }
      else if (act === 'route-wrong') { await api('POST', `/api/routing/${id}/feedback`, { wrong: true }); toast('已记下这次判断有误'); }
      else if (act === 'member-token') { shownToken = { id, token: (await api('POST', `/api/members/${id}/token`, {})).token }; }
      else if (act === 'ep-pull') { const r = await api('POST', `/api/model-endpoints/${id}/pull`, {}); toast(`拉到 ${r.endpoint.models.length} 个模型${r.fresh.length ? `，多了 ${r.fresh.join('、')}` : '，没有变化'}`); }
      else if (act === 'ep-del') { await api('DELETE', `/api/model-endpoints/${id}`); toast('接入已删除'); }
      else if (act === 'rollback') { const r = await api('POST', '/api/settings/rollback', { version: +b.dataset.v }); toast(`已回滚到第 ${b.dataset.v} 版的值，记为第 ${r.version} 版`); }
      else if (act === 'drain') { await api('POST', '/api/ops/drain', { on: b.dataset.on === '1' }); toast(b.dataset.on === '1' ? '开始排空' : '排空结束，任务继续'); }
      else if (act === 'rebuild') { const r = await api('POST', '/api/ops/rebuild', {}); toast(`重放了 ${r.replayed} 个事件`); }
      else if (V2_ACT[act]) await V2_ACT[act](b, id);
      await render(true);
    } catch (err) { busy(b, false); inlineError(b.closest('.actions, .entry__keys, .well') || b.parentElement, err); }
  });
  document.addEventListener('change', async e => {
    const sel = e.target.closest('select[data-act="t-priority"]');
    if (!sel) return;
    try { await api('POST', `/api/tickets/${sel.dataset.id}/priority`, { priority: sel.value }); toast(`优先级改成${PRIO[sel.value]}，排队顺序已重新计算`); render(true); }
    catch (err) { inlineError(sel.closest('.field'), err); }
  });
  document.addEventListener('keydown', e => { if (e.target.id === 'say' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); } });
  document.addEventListener('submit', async e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const kind = f.dataset.form, btn = e.submitter || f.querySelector('[type=submit]'), fd = new FormData(f), id = f.dataset.id;
    f.querySelector('.inline-error')?.remove();
    if (kind === 'login') { setToken(String(fd.get('token')).trim()); ME = null; live(); return render(); }
    busy(btn, true);
    try {
      if (kind === 'chat') {
        const text = String(fd.get('text')).trim();
        if (!text) { const h = $('#say-help'); h.dataset.error = ''; h.textContent = '先写一句需求再发送'; busy(btn, false); return $('#say').focus(); }
        chat.push({ who: 'me', t: Date.now(), text });
        const route = await api('POST', '/api/router/messages', { text });
        chat.push({ who: 'router', t: Date.now(), text: route.output.reply, route });
        await render(true); $('#say')?.focus(); return;
      }
      if (kind === 't-confirm') { await api('POST', `/api/tickets/${id}/confirm`, { answer: fd.get('answer'), rel: fd.get('rel') || 'par' }); toast(`${id}：需求单已确认`); location.hash = `#ticket-${id}`; }
      if (kind === 't-answer') { await api('POST', `/api/tickets/${id}/answer`, { text: fd.get('text') }); toast(`${id}：已回答，Worker 继续`); }
      if (kind === 't-budget') { await api('POST', `/api/tickets/${id}/budget`, { extra: +fd.get('extra') }); toast(`${id}：预算已提高`); }
      if (kind === 'replay') { const target = String(fd.get('target') || ''), [endpoint, model] = target.split('|'); const r = await api('POST', `/api/routing/${id}/replay`, target ? { endpoint, model } : {}); replays[id] = { target, ...r }; }
      if (kind === 'project') { let p; try { p = JSON.parse(fd.get('json')); } catch (x) { throw new Error(`JSON 解析失败：${x.message}`); } if (!p.id) throw new Error('项目卡要有 id'); await api('PUT', `/api/projects/${encodeURIComponent(p.id)}`, p); toast(`项目卡已保存，Router 立即按新的别名和规则路由`); location.hash = `#project-${p.id}`; }
      if (kind === 'member') {
        const roles = { '*': fd.get('global') };
        String(fd.get('projects') || '').split(',').map(x => x.trim()).filter(Boolean).forEach(x => { const [k, r] = x.split('=').map(y => y.trim()); if (!k || !['requester', 'approver', 'visitor'].includes(r)) throw new Error(`项目角色写法不对：${x}`); roles[k] = r; });
        const mid = String(fd.get('id')).trim();
        const was = MEMBERS.find(m => m.id === mid);
        // the form replaces the member: what it has no field for is carried over
        await api('PUT', `/api/members/${encodeURIComponent(mid)}`, { name: String(fd.get('name')).trim(), github: String(fd.get('github') || '').trim() || null, feishu: String(fd.get('feishu') || '').trim() || was?.feishu || null, roles, queue_limit: fd.get('queue_limit') ? +fd.get('queue_limit') : null, delegate: was?.delegate || null });
        toast(`成员 ${mid} 已保存`);
      }
      if (kind === 'endpoint') { const r = await api('POST', '/api/model-endpoints', { name: fd.get('name'), base: fd.get('base'), key: fd.get('key'), api: fd.get('api') }); toast(`已添加 ${r.name}，拉到 ${r.models.length} 个模型`); }
      if (V2_FORM[kind]) await V2_FORM[kind](fd, f, id, btn);
      if (kind === 'settings') {
        const changes = {};
        ['router', 'worker', 'reviewer', 'tester'].forEach(k => { const ep = fd.get(`ep-${k}`), model = fd.get(`md-${k}`); if (ep && model) changes[`stages.${k}`] = { endpoint: ep, model, fallback: fd.get(`fb-${k}`) || null }; });
        ['workers', 'repo_parallel', 'budget', 'project_day', 'project_month', 'member_day', 'queue_limit', 'rounds'].forEach(k => { changes[k] = +fd.get(k); });
        changes.sched = fd.get('sched');
        for (const [k, v] of fd.entries()) { if (k.startsWith('sla.')) changes[k] = +v; }
        // model names contain dots, so the catalog goes up whole instead of key by key
        const cat = { ...(LAST_SETTINGS?.catalog || {}) };
        for (const [k, v] of fd.entries()) { const m = k.match(/^cat\.(.+)\.(context|input_price|output_price)$/); if (m) (cat[m[1]] = { context: 0, input_price: 0, output_price: 0, ...cat[m[1]] })[m[2]] = +v; }
        Object.keys(cat).forEach(m => { const c = cat[m]; if (!c.context && !c.input_price && !c.output_price) delete cat[m]; });
        changes.catalog = cat;
        if (String(fd.get('eval_override') || '').trim()) changes._eval_override = String(fd.get('eval_override')).trim();
        const r = await api('PATCH', '/api/settings', { changes, note: '在控制台修改' });
        toast(`设置已保存，当前第 ${r.version} 版`);
      }
      await render(true);
    } catch (err) { busy(btn, false); if (kind === 'chat') chat.pop(); inlineError(f.querySelector('.actions, .entry__keys, .row') || f, err); }
  });

  live();
  render();
})();
