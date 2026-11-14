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
