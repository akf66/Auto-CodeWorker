/* Auto-CodWorker console prototype. Sample data in data.js; every action goes through api(), a mock adapter. */
(() => {
  'use strict';
  const D = window.ACW_DATA; const { RULES, EVALSET, PREFS } = D;
  const { MEMBERS, SECURITY, OPS, QUALITY, EVALS, PROJECTS, ENV_PLANS, TICKETS, ROUTING, CHAT, MEMORY_PROPOSALS, HOSTS, BASELINES, COST_BY_ROLE, SETTINGS, PR_BASE, NOTIFS, SANDBOX_CFG } = D;

  /* ---------- icons (one set) ---------- */
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
  let demo = 'full';
  let ticketQuery = '';
  let ticketProject = 'all';
  const ONBOARD = [];
  let editingCard = null;
  let tlFilter = 'all';
  let connecting = null;
  let editingMember = null;
  let addingEp = false;
  const START = Date.now();
  const now = () => { const m = 36 + Math.floor((Date.now() - START) / 60000); return `10:${String(m).padStart(2, '0')}`; };

  const api = (method, path, body) => new Promise((resolve, reject) => {
    setTimeout(() => (demo === 'error' ? reject(new Error('接口返回 503：Engine 暂时不可用，请稍后重试')) : resolve({ ok: true, method, path, body })), 420 + Math.round(Math.random() * 320));
  });
  const busy = (btn, on, label) => {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.setAttribute('aria-busy', 'true'); btn.disabled = true; btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(label || btn.textContent)}`; }
    else { btn.removeAttribute('aria-busy'); btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  };
  let toastTimer;
  let startedQ = [];
  const toast = (text, { undo, link } = {}) => {
    if (startedQ.length) { text = `${text}；${startedQ.join('、')} 排队结束，已自动开工`; startedQ = []; }
    const root = $('#toast-root');
    clearTimeout(toastTimer);
    root.innerHTML = `<div class="toast" role="status"><span>${esc(text)}</span>${link ? `<a class="btn btn--text" href="${link[1]}">${esc(link[0])}</a>` : ''}${undo ? '<button class="btn btn--line" type="button" data-undo>撤销</button>' : ''}</div>`;
    toastTimer = setTimeout(() => { root.innerHTML = ''; }, 8000);
    if (undo) $('[data-undo]', root).addEventListener('click', () => { clearTimeout(toastTimer); root.innerHTML = ''; undo(); });
    $('a', root)?.addEventListener('click', () => { root.innerHTML = ''; });
  };
  const inlineError = (host, err) => { host.querySelector('.inline-error')?.remove(); host.insertAdjacentHTML('beforeend', `<span class="inline-error" role="alert">${esc(err.message)}</span>`); };

  /* ---------- derived data ---------- */
  const T = id => TICKETS.find(t => t.id === id);
  const P = id => PROJECTS.find(p => p.id === id);
  const pname = id => P(id)?.name || id;
  const plans = pid => ENV_PLANS[pid] || [];
  const currentPlan = pid => plans(pid).filter(p => p.state === 'frozen').at(-1);
  const pendingPlans = () => PROJECTS.flatMap(p => plans(p.id).filter(x => x.state === 'pending').map(x => ({ pid: p.id, plan: x })));
  const passCount = c => (c ? c.filter(x => x.r === 'pass').length : 0);
  const isOpen = t => !['done', 'dropped'].includes(t.kind);
  const needsYou = t => t.kind === 'you' || t.kind === 'fail';
  const nextTicketId = () => `T-${Math.max(...TICKETS.map(t => +t.id.slice(2))) + 1}`;
  const memIdNext = () => `L-${Math.max(0, ...PROJECTS.flatMap(p => p.memory.map(m => +m.id.slice(2)))) + 1}`;

  /* roles are checked by the Engine before a command writes any event; the console only mirrors them */
  const RANK = { 访客: 0, 提需求: 1, 审批: 2, 管理: 3 };
  const ME = 'kaifeng';
  const M = id => MEMBERS.find(m => m.id === id);
  const roleOf = (mid, pid) => { const m = M(mid); if (!m) return '访客'; const g = m.roles['*'] || '访客'; return g === '管理' ? g : (pid && m.roles[pid]) || g; };
  const can = (mid, need, pid) => RANK[roleOf(mid, pid)] >= RANK[need];
  const who = mid => (mid === ME ? '你' : M(mid)?.name || mid);
  const names = ids => [...ids.filter(x => x !== ME), ...ids.filter(x => x === ME)].map(who).join('、');
  const ownersFor = (pid, need) => MEMBERS.filter(m => can(m.id, need, pid)).map(m => m.id);
  const needOf = t => {
    if (!needsYou(t)) return null;
    if (t.kind === 'fail') return { what: '重试', also: t.by };
    if (t.mandate?.open) return { what: `确认需求单（涉及${t.mandate.needConfirm}）` };
    if (t.ask) return { what: { casdoor: '放开沙箱出站域名', oscillation: '处理来回改', budget: '提高预算或停止' }[t.ask.kind] || '回答问题' };
    return { what: t.group ? '审批 PR 组' : 'PR 审批' };
  };
  const ownersOf = t => { const n = needOf(t); if (!n) return []; return MEMBERS.filter(m => m.id === n.also || can(m.id, '审批', t.project)).map(m => m.id); };
  const queue = (mid = ME) => {
    const rows = TICKETS.filter(needsYou).sort((a, b) => (a.since || a.updated).localeCompare(b.since || b.updated)).map(t => ({ key: t.id, href: link.ticket(t.id, t.action?.tab), title: `${t.id} ${t.title}`, project: t.project, state: t.state, why: t.why, since: t.since || t.updated, act: t, owners: t.handTo ? [t.handTo] : ownersOf(t) }));
    pendingPlans().filter(x => !x.plan.rejected).forEach(({ pid, plan }) => rows.push({ key: `env-${pid}`, href: link.plan(pid, plan.v), title: `环境计划 ${plan.v}`, project: pid, state: '等你确认', why: `${plan.note}；${plan.reason}`, since: plan.date.replace('今天 ', ''), plan: [pid, plan.v], owners: ownersFor(pid, '审批') }));
    ONBOARD.filter(o => o.state === 'ready').forEach(o => rows.push({ key: `onb-${o.id}`, href: '#projects', title: `接入 ${o.name}`, project: null, projectText: '新项目', state: '初稿等你确认', why: '项目卡、AGENTS.md 和环境计划 v1 已生成并跑通', since: o.since, onb: true, owners: ownersFor(null, '管理') }));
    const mine = MEMORY_PROPOSALS.filter(m => can(mid, '审批', m.project));
    if (mine.length) { const ps = [...new Set(mine.map(m => m.project))]; rows.push({ key: 'memory', href: '#memory', title: `项目记忆提议 ${mine.length} 条`, project: ps.length === 1 ? ps[0] : null, projectText: ps.length > 1 ? `${ps.length} 个项目` : null, state: '等你审核', why: '采纳后写进对应项目的记忆', since: '今天', mem: true, owners: [...new Set(MEMORY_PROPOSALS.flatMap(m => ownersFor(m.project, '审批')))] }); }
    TICKETS.filter(t => t.rollout?.phases.some(p => p.st === 'ready')).forEach(t => { const i = t.rollout.phases.findIndex(p => p.st === 'ready'), ph = t.rollout.phases[i]; rows.push({ key: `roll-${t.id}`, href: link.ticket(t.id, 'rollout'), title: `${t.id} ${t.title}`, project: t.project, state: '上线阶段可以推进', why: `第 ${i + 1} 阶段达标：${ph.metric || ph.gate}`, since: ph.readyAt || '今天', roll: true, owners: ownersFor(t.project, '审批') }); });
    TICKETS.filter(t => t.plan?.replan).forEach(t => rows.push({ key: `plan-${t.plan.id}`, href: `#plan-${t.plan.id}`, title: `计划 ${t.plan.id} 要改`, project: t.project, state: '计划改动等你确认', why: t.plan.replan.why.split('。')[0], since: t.plan.replan.t, planRow: true, owners: ownersFor(t.project, '审批') }));
    /* a delegate sees the absent member's items as well, until the date they set */
    return rows.filter(r => r.owners.includes(mid) || (PREFS.delegate.on && PREFS.delegate.to === mid && r.owners.includes(ME)));
  };
  /* every item someone waits on has a time limit; past it the item is escalated to another approver */
  const SLA = t => t.ask ? ['提问', 30] : t.mandate?.open ? ['需求单确认', 120] : t.action?.href ? ['PR 审批', 480] : ['等你决定', 60];
  const fmtMins = d => d < 60 ? `${d} 分钟` : d % 60 ? `${Math.floor(d / 60)} 小时 ${d % 60} 分` : `${d / 60} 小时`;
  const overdue = t => { const a = (t.since || t.updated || '').match(/^(\d{1,2}):(\d{2})$/), b = now().match(/^(\d{1,2}):(\d{2})$/); if (!a || !b) return 0; const w = (+b[1] * 60 + +b[2]) - (+a[1] * 60 + +a[2]); return w > SLA(t)[1] ? w - SLA(t)[1] : 0; };
  const slaText = t => { const [what, lim] = SLA(t), od = overdue(t), others = ownersOf(t).filter(x => x !== ME); return `${what} ${fmtMins(lim)}${od ? `，已超 ${fmtMins(od)}${others.length ? `，已提醒${others.map(who).join('、')}` : ''}` : ''}`; };
  const sandboxes = () => {
    const list = TICKETS.filter(t => t.sandbox).map(t => ({ owner: t.id, project: t.project, provider: 'firecracker', ...t.sandbox, count: t.sandbox.vms.length, vmsSpec: t.sandbox.vms.map(v => v[2]) }));
    BASELINES.forEach(b => { const pl = plans(b.project).find(x => x.v === b.env); if (!b.specs || b.specEnv !== b.env) { b.specs = tplVMs(b.project, pl).map(v => v.spec); b.specEnv = b.env; } list.push({ owner: 'main', project: b.project, provider: 'firecracker', form: pl.form, env: b.env, host: b.host, state: 'running', count: b.vms, vmsSpec: b.specs }); });
    return list;
  };
  const load = () => {
    const sb = sandboxes();
    return {
      workers: TICKETS.filter(t => t.kind === 'run').length,
      previews: sb.filter(s => s.owner !== 'main' && s.state === 'running' && s.preview).length,
      running: sb.filter(s => s.state === 'running').reduce((a, s) => a + s.count, 0),
      paused: sb.filter(s => s.state === 'paused').reduce((a, s) => a + s.count, 0),
    };
  };

  /* ---------- repos, PRs, notifications ---------- */
  const MOD_PATH = { 计费: 'billing', 鉴权: 'auth', 渠道路由: 'routing', 控制台: 'console', 采集: 'ingest', 分钟聚合: 'minuteagg', 看板: 'dashboard', ASR: 'asr', TTS: 'tts', 字幕: 'subtitle', 工作台: 'studio', 发现: 'discover', 抓取: 'fetcher', 入库: 'store', 待补充: 'core' };
  const LANG_EXT = { Go: 'go', 'Next.js': 'tsx', Python: 'py', Java: 'java' };
  const LANG_FILES = { Go: ['handler.go', 'service.go', 'store.go'], 'Next.js': ['page.tsx', 'Table.tsx', 'route.ts'], Python: ['service.py', 'client.py', 'tasks.py'], Java: ['Job.java', 'Sink.java', 'Aggregator.java'] };
  const E2E_BASE = { orcarouter: [64, 27], 'orcax-analytics': [52, 30], orcadub: [41, 23], xbot: [12, 5] };
  const hash = x => [...x].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const pickRepo = (pid, text) => { const r = P(pid).repos, web = r.find(x => x[1] === 'Next.js'); return (web && /页|页面|控制台|按钮|看板|导出|报表/.test(text) ? web : r[0])[0]; };
  const repoOf = t => t.repo || (t.repo = pickRepo(t.project, `${t.title}${t.mandate?.goal || ''}`));
  const nextPR = repo => Math.max(PR_BASE[repo] || 0, ...TICKETS.filter(x => x.repo === repo && x.pr).map(x => x.pr), ...TICKETS.flatMap(x => (x.group || []).filter(g => g.repo === repo).map(g => g.pr))) + 1;
  const gLink = g => `https://github.com/example/${g.repo}/pull/${g.pr}`;
  const prLink = t => `https://github.com/example/${repoOf(t)}/pull/${t.pr}`;
  const prName = t => `${repoOf(t)}#${t.pr}`;
  const ctx = t => {
    const p = P(t.project), text = `${t.title}${t.mandate?.goal || ''}`, mod = p.modules.find(m => text.includes(m)) || p.modules[0], repo = repoOf(t);
    const lang = (p.repos.find(r => r[0] === repo) || p.repos[0])[1];
    const files = LANG_FILES[lang] || LANG_FILES.Go; return { p, mod, repo, ext: LANG_EXT[lang] || 'go', files, dir: MOD_PATH[mod] || 'core', h: hash(t.id) };
  };
  const NOTIFY_LABEL = { blocked: '任务需要你回答或决定', failed: '任务失败', mandate: '需求单需要你确认', pr: 'PR 等你审批', env: '环境计划等你确认', memory: '有新的记忆提议' };
  const notify = (type, title, href) => NOTIFS.unshift({ t: now(), type, title, href, to: SETTINGS.chat, st: SETTINGS.notify[type] ? '已推送' : '没有推送：设置里关闭了这一类' });

  /* ---------- templates and placement ---------- */
  const CFG = SANDBOX_CFG;
  const TPL_BASE = {};
  const memOf = spec => +(String(spec).match(/(\d+)G/) || [0, 0])[1];
  const tplId = (pid, v) => `tpl-${pid}-${v}`;
  const baseOf = id => CFG.base.find(b => b.id === id);
  const tplVMs = (pid, plan) => {
    const p = P(pid), tools = [...new Set(p.repos.map(r => CFG.toolchains[r[1]]).filter(Boolean))];
    const svcImg = s => s.mock ? `acw-mock@${baseOf('acw-mock').digest}` : CFG.services[s.svc] || s.src;
    if (plan.form === 'VM 组') return plan.services.map(s => s.svc === 'app'
      ? { name: 'app', layers: [`acw-base@${tplBase(pid, plan.v)}`, ...tools, `acw-browser@${baseOf('acw-browser').digest}`], spec: SETTINGS.sandbox.app }
      : { name: s.svc, layers: [svcImg(s), { flink: 'PR 里的作业 jar 在启动时提交', kafka: 'topic 已创建', redis: '空实例，不持久化', mysql: '表结构与种子数据已预灌', clickhouse: '表结构与种子数据已预灌', postgres: '表结构与种子数据已预灌' }[s.svc] || (s.mock ? '录制数据已加载' : '按计划初始化')], spec: s.mock ? '1 核 1G' : SETTINGS.sandbox.svc });
    return [{ name: 'app', layers: [`acw-base@${tplBase(pid, plan.v)}`, ...tools, ...plan.services.filter(s => s.svc !== 'app').map(s => s.mock ? 'acw-mock（录制回放）' : `${CFG.services[s.svc] || s.svc}（进程，种子数据已预灌）`), `acw-browser@${baseOf('acw-browser').digest}`], spec: SETTINGS.sandbox.app }];
  };
  const tplBase = (pid, v) => TPL_BASE[tplId(pid, v)] || baseOf('acw-base').digest;
  const tplHosts = (pid, v) => [...new Set([...BASELINES.filter(b => b.project === pid && b.env === v).map(b => b.host), ...TICKETS.filter(t => t.project === pid && t.sandbox?.env === v).map(t => t.sandbox.host)])].filter(h => HOSTS.some(x => x.id === h && !x.down));
  const templates = () => PROJECTS.flatMap(p => plans(p.id).filter(x => x.state !== 'superseded' || plans(p.id).indexOf(x) === plans(p.id).length - 2).map(plan => {
    const vms = tplVMs(p.id, plan);
    return { id: tplId(p.id, plan.v), pid: p.id, plan, vms, snapGB: vms.reduce((a, v) => a + memOf(v.spec), 0), hosts: plan.state === 'pending' ? [] : tplHosts(p.id, plan.v),
      status: plan.state === 'pending' ? (plan.rejected ? '等计划修改后重建' : '已试跑，确认后发布') : plan.state === 'frozen' ? (CFG.update.state === 'building' ? '重建中' : '使用中') : (() => { const n = TICKETS.filter(t => t.project === p.id && t.sandbox?.env === plan.v).length; return n ? `已被取代；还有 ${n} 个任务的沙箱在用，任务结束后清理` : `已被取代，${SETTINGS.sandbox.retention} 天后清理`; })() };
  }));
  const cloudTargets = p => [...new Set([p.provider !== 'inherit' ? p.provider : SETTINGS.sandbox.provider, SETTINGS.sandbox.overflow ? SETTINGS.sandbox.overflowTo : null])].filter(id => id && isCloud(id) && PROV(id).state === 'ok');
  const cloudSync = x => { const p = P(x.pid); if (p.internalOnly) return '沙箱只用自建，不同步'; if (x.plan.form === 'VM 组') return '云端不支持 VM 组'; if (x.plan.state === 'superseded') return '已停用'; const ts = cloudTargets(p); if (!ts.length) return '不需要'; return ts.map(id => `${provName(id)}：${x.plan.state === 'pending' ? '确认后构建' : PROV(id).building ? '构建中' : '已构建'}`).join('；'); };
  const hostFree = id => CFG.hostMem - sandboxes().filter(s => s.host === id && s.state === 'running').reduce((a, s) => a + (s.vmsSpec || []).reduce((b, x) => b + memOf(x), 0), 0);
  const PROV = id => CFG.providers.find(x => x.id === id);
  const provName = id => PROV(id)?.name || id;
  const isCloud = id => PROV(id)?.kind === 'cloud';
  const cloudUsed = id => TICKETS.filter(t => t.sandbox?.provider === id && t.sandbox.state === 'running').length;
  const providerFor = (pid, form) => {
    const p = P(pid), want = p.provider === 'inherit' ? SETTINGS.sandbox.provider : p.provider;
    const why = p.provider === 'inherit' ? `跟随默认提供方` : `项目指定 ${provName(want)}`;
    if (isCloud(want)) {
      if (p.internalOnly) return { id: 'firecracker', why: `${p.name} 要求沙箱只用自建，只用自建` };
      if (PROV(want).state !== 'ok') return { id: 'firecracker', why: `${provName(want)} 未连接，回退自建` };
      if (form === 'VM 组') return { id: 'firecracker', why: `${provName(want)} 不支持 VM 组，回退自建` };
      if (cloudUsed(want) >= PROV(want).quota) return { id: 'firecracker', why: `${provName(want)} 并发已满，回退自建` };
      return { id: want, why };
    }
    const need = memOf(form === 'VM 组' ? SETTINGS.sandbox.app : SETTINGS.sandbox.app);
    const roomy = HOSTS.some(h => !h.down && h.disk >= 15 && hostFree(h.id) >= need);
    const to = SETTINGS.sandbox.overflowTo;
    if (!roomy && SETTINGS.sandbox.overflow && !p.internalOnly && form === '单 VM' && PROV(to)?.state === 'ok' && cloudUsed(to) < PROV(to).quota) return { id: to, why: '自建宿主机资源不足，按溢出规则放到云端' };
    return { id: 'firecracker', why };
  };
  const placeHost = (pid, v) => { const have = tplHosts(pid, v); const pick = HOSTS.filter(h => !h.down && h.disk >= 15).sort((a, b) => (have.includes(b.id) - have.includes(a.id)) || (hostFree(b.id) - hostFree(a.id)))[0]; return pick.id; };
  const placeWhy = (pid, v, host, sb) => { if (sb && isCloud(sb.provider)) return `${sb.providerWhy || '项目指定'}；运行在 ${provName(sb.provider)}`; if ((HOSTS.find(h => h.id === host)?.disk ?? 100) < 15) return `${host} 本地 NVMe 已低于 15%，这个沙箱是在那之前创建的；新沙箱不会再放到这台`; const have = tplHosts(pid, v).filter(h => h !== host); const local = BASELINES.some(b => b.project === pid && b.env === v && b.host === host) || TICKETS.some(t => t.project === pid && t.sandbox?.env === v && t.sandbox.host === host && t.sandbox.state === 'running'); return `${local || !have.length ? '本地已有模板快照，从快照直接恢复' : `先从 ${have[0]} 拷贝模板快照`}；当前空闲内存约 ${hostFree(host)}G`; };

  /* ---------- links (plain #names only) ---------- */
  const link = {
    ticket: (id, tab) => `#ticket-${id}${tab && tab !== 'timeline' ? `-${tab}` : ''}`,
    project: (pid, tab) => `#project-${pid}${tab && tab !== 'card' ? `-${tab}` : ''}`,
    plan: (pid, v) => `#envplan-${pid}-${v}`,
  };
  /* small keys inside tables: a count, a version or an id you can open */
  const cbtn = (href, html, tone = '') => `<a class="cbtn${tone ? ` cbtn--${tone}` : ''}" href="${href}">${html}</a>`;
  const countBtn = (href, n, label) => n ? cbtn(href, `<span class="mono">${n}</span>${label ? ` ${label}` : ''}${I.chev}`) : '<span class="note">无</span>';
  const kv = items => `<dl class="kv">${items.filter(Boolean).map(([k, v, sub]) => `<div><dt>${k}</dt><dd>${v}${sub ? `<span class="sub">${sub}</span>` : ''}</dd></div>`).join('')}</dl>`;
  const pLink = pid => (pid ? `<a href="${link.project(pid)}">${esc(pname(pid))}</a>` : '');

  /* ---------- shared bits ---------- */
  const stateWord = k => ({
    you: `<span class="state state--you">${I.hand}需要你</span>`, run: `<span class="state state--run">${I.play}进行中</span>`,
    wait: `<span class="state state--wait">${I.clock}等待</span>`, fail: `<span class="state state--fail">${I.alert}失败</span>`,
    done: `<span class="state state--ok">${I.check}已完成</span>`, dropped: `<span class="state state--wait">${I.x}已结束</span>`,
  }[k]);
  const planState = p => ({ frozen: '使用中', pending: '等你确认', superseded: '已被取代' }[p.state]);
  const skeleton = n => `<div class="skeleton" aria-hidden="true">${'<span></span>'.repeat(n)}</div><p class="visually-hidden" role="status">正在加载</p>`;
  const errorBox = what => `<div class="error" role="alert"><h3>${esc(what)}加载失败</h3><p>接口返回 503：Engine 暂时不可用。数据没有丢失，恢复后会自动刷新。</p><button class="btn btn--line" type="button" data-act="reload">${I.redo}重新加载</button></div>`;
  const empty = (title, text, action = '') => `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
  const region = (o, full) => demo === 'loading' ? skeleton(o.rows || 5) : demo === 'error' ? errorBox(o.what) : demo === 'empty' ? empty(o.emptyTitle, o.emptyText, o.emptyAction) : full();
  const selectWrap = inner => `<span class="select-wrap">${inner}${I.down}</span>`;
  const tabs = (items, current, label) => `<nav class="tabs" aria-label="${esc(label)}">${items.map(([href, text, key, n]) => `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${esc(text)}${n != null ? `<span class="n">${n}</span>` : ''}</a>`).join('')}</nav>`;
  const table = (cls, heads, rows) => `<div class="table-wrap"><table class="table table--stack ${cls || ''}"><thead><tr>${heads.map(h => `<th${h.num ? ' class="num"' : ''}>${h.t}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const td = (label, html, num) => `<td data-label="${esc(label)}"${num ? ' class="num"' : ''}>${html}</td>`;

  /* ---------- nav ---------- */
  const navItems = () => [
    ['work', [['overview', '总览', queue().length, 'accent'], ['chat', '对话'], ['tickets', '任务', TICKETS.filter(isOpen).length, 'quiet'], ['routing', '路由记录']]],
    ['proj', [['projects', '项目', PROJECTS.length, 'quiet'], ['env', '环境计划', pendingPlans().filter(x => !x.plan.rejected).length, 'accent'], ['memory', '记忆审核', MEMORY_PROPOSALS.length, 'accent']]],
    ['sys', [['sandboxes', '沙箱'], ['cost', '成本'], ['quality', '质量'], ['notifications', '通知']]],
    ['admin', [['members', '成员与权限'], ['security', '安全'], ['ops', '运维', OPS.alerts.filter(a => alertOpen(a)).length, 'quiet'], ['config', '设置']]],
  ];
  const ROUTE_NAV = { plan: 'tickets', report: 'tickets', route: 'routing', ticket: 'tickets', project: 'projects', envplan: 'env', settings: 'config' };
  const renderNav = route => {
    const cur = ROUTE_NAV[route] || route;
    navItems().forEach(([group, items]) => {
      $(`#nav-${group}`).innerHTML = items.map(([id, label, n, tone]) => `<li><a href="#${id}"${cur === id ? ' aria-current="page"' : ''}><span>${label}</span>${n ? `<span class="count${tone === 'quiet' ? ' count--quiet' : ''}">${n}<span class="visually-hidden"> 项</span></span>` : ''}</a></li>`).join('');
    });
  };
  const crumbs = parts => { $('#crumbs').innerHTML = parts.map((p, i) => i < parts.length - 1 ? `<span class="crumb${i === 0 ? '' : ' hide-sm'}"><a href="${p[1]}">${esc(p[0])}</a>${I.chev}</span>` : `<span>${esc(p[0])}</span>`).join(''); };

  /* ---------- ops helpers ---------- */
  const drainNote = () => OPS.drain ? `<div class="well stack-sm" role="status"><p class="warn-line">${I.pause}Engine 正在排空，准备升级</p><p class="ink-2">每个 Worker 做完当前这一步就停下，不再开始新步骤。结束排空后从停下的地方继续。<a href="#ops">去运维</a></p></div>` : '';
  const alertOpen = a => (a.host ? (HOSTS.find(h => h.id === a.host)?.disk ?? 100) < 15 : false);
  const alertState = a => a.host ? (alertOpen(a) ? '未处理' : '已清理快照，恢复到 15% 以上') : a.st;
  const failHost = id => {
    const h = HOSTS.find(x => x.id === id); h.down = true; let n = 0;
    TICKETS.filter(t => t.sandbox && !isCloud(t.sandbox.provider) && t.sandbox.host === id).forEach(t => {
      const to = placeHost(t.project, t.sandbox.env); t.sandbox.host = to; n += 1;
      push(t, { kind: 'box', what: `宿主机 ${id} 失联，沙箱在 ${to} 重建`, d: `用模板 ${tplId(t.project, t.sandbox.env)} 加分支 ${t.branch || `acw/${t.id}`}；${t.kind === 'run' ? '正在做的这一步重做，不算任务失败' : '状态不变'}` });
    });
    let base = 0; BASELINES.filter(b => b.host === id).forEach(b => { b.host = placeHost(b.project, b.env); base += 1; });
    OPS.alerts.unshift({ t: now(), level: '严重', what: `${id} 60 秒没有心跳，标记为下线`, st: `${n} 个任务沙箱、${base} 个 main 基线已在其他宿主机重建` });
    return n + base;
  };
  const startDependents = t => TICKETS.filter(x => x.dependsOn === t.id && x.kind === 'wait').map(x => {
    const plan = currentPlan(x.project);
    push(x, { kind: 'box', what: `${t.id} 已合并，开工`, d: `分支基于合并后的 main；环境计划 ${plan.v}`, live: true });
    Object.assign(x, { kind: 'run', state: '从模板快照恢复沙箱', why: `环境计划 ${plan.v}`, sandbox: sandboxFor(plan, x.project) });
    startAuto(x, 'full'); return x.id;
  });

  /* ---------- overview ---------- */
  const queueAction = r => {
    if (r.plan) return `<a class="btn btn--line" href="${r.href}">查看并确认</a>`;
    if (r.mem) return `<a class="btn btn--line" href="#memory">审核</a>`;
    if (r.onb) return `<a class="btn btn--line" href="#projects">查看初稿</a>`;
    if (r.roll) return `<a class="btn btn--line" href="${r.href}">看上线阶段</a>`;
    if (r.planRow) return `<a class="btn btn--line" href="${r.href}">看改动</a>`;
    const t = r.act;
    if (t.action?.href) return `<a class="btn btn--line" href="${t.action.href}" target="_blank" rel="noopener" aria-label="${esc(t.action.label)}">${I.ext}${t.group ? '打开 PR 组' : '打开 PR'}</a>`;
    if (t.action?.retry) return `<button class="btn btn--line" type="button" data-act="retry" data-id="${t.id}">${I.redo}重试</button>`;
    return `<a class="btn btn--line" href="${r.href}">${esc(t.action?.label || '查看')}</a>`;
  };
  /* The code map: every project side by side, one box per repo, one row per module, a chip per task on each module it changes. */
  const touchOf = t => t.touch?.length ? t.touch : [modOf(t) || P(t.project).modules[0]];
  const codeOf = p => p.code || { lanes: [{ repo: p.repos[0]?.[0] || p.name, mods: p.modules.map(m => [m]) }], links: [] };
  let mapHot = null;
  const mapChip = t => `<a class="mchip" href="${link.ticket(t.id)}" data-id="${t.id}" data-you="${needsYou(t)}" data-kind="${t.kind}" aria-label="${t.id} ${esc(t.title)}，${esc(t.state)}">${t.id}</a>`;
  const codeMap = open => `<div class="cmap">${PROJECTS.map(p => {
    const c = codeOf(p), mine = open.filter(t => t.project === p.id).sort((a, b) => needsYou(b) - needsYou(a));
    return `<section class="cmap__proj" aria-label="${esc(p.name)}">
      <h3><a href="${link.project(p.id)}">${esc(p.name)}</a>${mine.length ? `<span class="cmap__n">${mine.length} 个任务</span>` : ''}</h3>
      ${c.lanes.map((l, i) => `${i ? `<p class="cmap__link"><i aria-hidden="true"></i><span class="vh">向下调用，经</span>${esc(c.links[i - 1] || '')}</p>` : ''}<div class="repo"><p class="repo__name">${esc(l.repo)}</p><ul class="repo__mods">${l.mods.map(([m, guard]) => { const ts = mine.filter(t => touchOf(t).includes(m));
        return `<li class="mod${ts.length ? '' : ' is-idle'}"><span class="mod__name">${esc(m)}${guard ? `<span class="mod__lock" role="img" aria-label="改动需确认：${esc(guard)}" title="改动需确认：${esc(guard)}">${I.lock}</span>` : ''}</span>${ts.length ? `<span class="mod__tasks">${ts.map(mapChip).join('')}</span>` : ''}</li>`; }).join('')}</ul></div>`).join('')}
    </section>`; }).join('')}</div>`;
  const mapPanel = () => {
    mapHot = null;
    const open = demo === 'full' ? TICKETS.filter(isOpen) : [], you = open.filter(needsYou).length;
    const rest = demo === 'loading' || demo === 'error' ? '' : open.length ? `${open.length} 个任务在改代码${you ? `，${you} 个等你处理` : ''}` : '现在没有任务在改代码';
    return `<section class="panel cmap-panel" aria-labelledby="map-h">
      <div class="panel__head"><h2 id="map-h">代码地图</h2><p class="cmap__status" id="map-status" data-rest="${esc(rest)}">${esc(rest)}</p>
        <ul class="legend" aria-label="图例"><li><i class="key key--you"></i>等你处理</li><li><i class="key"></i>自己在推进</li><li>${I.lock}改动需确认</li></ul></div>
      <div class="cmap__body">${demo === 'loading' ? skeleton(4) : demo === 'error' ? errorBox('代码地图') : codeMap(open)}</div>
    </section>`;
  };
  /* Pointing at a chip lights up the same task on every module it changes and names it in the panel head. */
  const mapHover = id => {
    if (id === mapHot) return; mapHot = id;
    const st = $('#map-status'), box = $('.cmap', main); if (!st || !box) return;
    box.classList.toggle('is-hover', !!id);
    $$('.mchip', box).forEach(c => c.classList.toggle('is-hot', !!id && c.dataset.id === id));
    const t = id && T(id);
    if (t) st.innerHTML = `<b class="mono">${t.id}</b>${esc(t.title)}<span>${esc(t.state)}</span>`; else st.textContent = st.dataset.rest;
  };
  const pageOverview = () => {
    crumbs([['总览']]);
    const q = queue(), l = load();
    const today = TICKETS.filter(t => t.day === 'today');
    const running = TICKETS.filter(t => t.kind === 'run' || (t.kind === 'wait' && !t.queued));
    const low = HOSTS.filter(h => h.disk < 15 && !h.down), down = HOSTS.filter(h => h.down);
    main.innerHTML = `
      <div class="ov-head">
        <div class="ov-head__text"><h1 id="ov-h">${demo === 'full' ? (q.length ? `需要你处理的 ${q.length} 件事` : '现在没有等你处理的事') : '需要你处理的事'}</h1></div>
        ${demo === 'full' ? `<dl class="ministats" aria-label="今天">
          <div><dt>待处理</dt><dd>${q.length}<span class="u"> / ${SETTINGS.queueLimit}</span></dd></div>
          <div><dt>今天新任务</dt><dd>${today.length}</dd></div>
          <div><dt>开出的 PR</dt><dd>${TICKETS.filter(t => t.prOpened === 'today').length}</dd></div>
          <div><dt>已合并</dt><dd>${today.filter(t => t.kind === 'done').length}</dd></div>
          <div><dt>Worker 槽位</dt><dd>${l.workers}<span class="u"> / ${SETTINGS.workers}</span></dd></div>
          <div><dt>运行中 VM</dt><dd>${l.running}</dd></div>
        </dl>` : ''}
      </div>
      ${drainNote()}
      ${delegateNote()}
      ${demo === 'full' && q.length >= SETTINGS.queueLimit ? `<div class="well well--row"><p class="warn-line">${I.alert}<span>你的待处理到了上限 ${SETTINGS.queueLimit} 件，新任务会先排队，处理掉几件后自动开工</span></p><a class="btn btn--line" href="#config">调整上限</a></div>` : ''}
      ${mapPanel()}
      <div class="ov-grid">
        <div class="ov-main">
          <section class="region sheet" aria-labelledby="q-h"><div class="region-head"><h2 id="q-h">等你处理</h2><p>最早开始等的在上面；勾选几件可以一起处理</p></div>${demo === 'full' ? batchBar(q) : ''}
            ${region({ what: '待处理事项', emptyTitle: '没有等你处理的事', emptyText: '所有任务都在自己推进。有任务需要你时，这里和飞书都会通知你。', emptyAction: '<a class="btn btn--line" href="#chat">去对话里提个需求</a>', rows: 6 }, () => q.length ? `<ol class="inbox">${q.map(r => { const w = r.act ? waited(r.act) : ''; return `<li class="inbox__item" data-href="${r.href}">
              <div class="inbox__when"><time class="mono">${esc(r.since)}</time>${w ? `<span>${esc(w)}</span>` : ''}${r.act && overdue(r.act) ? '<span class="tag tag--bad">超时</span>' : ''}</div>
              <div class="inbox__main"><div class="inbox__line">${r.act ? `<label class="pick"><input type="checkbox" data-pick="${r.key}"${batchSel.has(r.key) ? ' checked' : ''} aria-label="选中 ${esc(r.title)}"></label>` : '<span class="pick" aria-hidden="true"></span>'}<a class="title" href="${r.href}">${esc(r.title)}</a></div>
                <p class="inbox__why"><span class="state state--you">${esc(r.state)}</span><span class="inbox__proj">${r.project ? esc(pname(r.project)) : esc(r.projectText)}</span><span class="inbox__text">${esc(r.why)}</span></p></div>
              <div class="actions">${queueAction(r)}</div></li>`; }).join('')}</ol>` : empty('都处理完了', '新的事项会出现在这里，也会推送到飞书。'))}
            <p class="note">同一件事，有权限的人都能看到，谁先处理都可以；每件事谁能处理，打开后在卡片里看。</p>
          </section>
        </div>
        <div class="ov-side">
          ${queuedPanel()}
          ${demo === 'full' && running.length ? `<section class="region" aria-labelledby="run-h"><div class="region-head"><h2 id="run-h">正在推进</h2><a class="note" href="#tickets">全部任务</a></div>
            <ul class="runlist">${running.map(t => `<li data-k="${t.kind}"><a class="title" href="${link.ticket(t.id)}">${t.id} ${esc(t.title)}</a><span class="runlist__state">${esc(t.state)}</span><span class="runlist__bar" aria-hidden="true"></span><time class="mono">${esc(hm(t.updated))}</time></li>`).join('')}</ul></section>` : ''}
          <section class="region" aria-labelledby="sys-h">
            <div class="region-head"><h2 id="sys-h">系统</h2><a href="#ops" class="note">运维</a></div>
            ${region({ what: '系统状态', emptyTitle: '系统一切正常', emptyText: 'Router、Engine 和宿主机都在正常运行。', rows: 3 }, () => down.map(h => `<div class="well stack-sm"><p class="warn-line">${I.alert}宿主机 ${h.id} 失联</p><p class="ink-2">上面的沙箱已用模板和任务分支在其他宿主机重建，任务没有失败。<a href="#ops">看运维</a></p></div>`).join('') + low.map(h => `<div class="well well--row"><p class="warn-line">${I.alert}<span>宿主机 ${h.id} 本地 NVMe 剩余 ${h.disk}%，写满后新任务无法从模板恢复</span></p><button class="btn btn--line" type="button" data-act="clean" data-host="${h.id}">清理过期快照</button></div>`).join('') +
              `<p class="note">${low.length || down.length ? `Router、Engine 和 ${HOSTS.filter(h => h.disk >= 15 && !h.down).map(h => h.id).join('、')} 运行正常。` : 'Router、Engine 和全部宿主机运行正常。'}预览环境 ${l.previews} / ${SETTINGS.previews}，已暂停 VM ${l.paused} 台，其中 ${BASELINES.length} 个项目的 main 基线常驻。</p>`)}
          </section>
        </div>
      </div>`;
  };

  /* ---------- tickets ---------- */
  const pageTickets = params => {
    crumbs([['任务']]);
    const tab = params.get('tab') || 'open';
    const groups = { you: TICKETS.filter(needsYou), open: TICKETS.filter(isOpen), ended: TICKETS.filter(t => !isOpen(t)), all: TICKETS };
    const labels = { you: '需要你', open: '未结束', ended: '已结束', all: '全部' };
    const list = groups[tab].filter(t => (ticketProject === 'all' || t.project === ticketProject) && (!ticketQuery || `${t.id}${t.title}`.toLowerCase().includes(ticketQuery.toLowerCase())));
    main.innerHTML = `
      <div class="page-head"><div><h1>任务</h1><p>每个任务一个 Worker 会话和一个沙箱。</p></div>
        <div class="filters">
          <div class="field"><label for="tp">项目</label>${selectWrap(`<select class="select" id="tp">${[['all', '全部项目'], ...PROJECTS.map(p => [p.id, p.name])].map(([v, n]) => `<option value="${v}"${v === ticketProject ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}</div>
          <div class="field"><label for="tq">编号或标题</label><input class="input" id="tq" type="search" value="${esc(ticketQuery)}" autocomplete="off"></div>
        </div></div>
      ${tabs(Object.keys(labels).map(k => [k === 'open' ? '#tickets' : `#tickets-${k}`, labels[k], k, groups[k].length]), tab, '任务分组')}
      <section class="region" aria-label="${labels[tab]}的任务">
      ${region({ what: '任务列表', emptyTitle: '这一组没有任务', emptyText: '在对话里提需求，Router 会判断归属并开任务。', emptyAction: '<a class="btn btn--line" href="#chat">去对话</a>', rows: 8 }, () => list.length ? table('', [{ t: '任务' }, { t: '项目' }, { t: '状态' }, { t: '完成条件', num: 1 }, { t: '审查轮次', num: 1 }, { t: '更新', num: 1 }], list.map(t => `<tr data-href="${link.ticket(t.id)}">
            ${td('', `<a class="title" href="${link.ticket(t.id)}">${t.id} ${esc(t.title)}</a>`)}
            ${td('项目', pLink(t.project))}
            ${td('状态', `${stateWord(t.kind)}<span class="sub">${esc(t.state)}</span>`)}
            ${td('完成条件', t.contract ? `${passCount(t.contract)} / 5` : '不适用', 1)}
            ${td('审查轮次', t.review ? t.review.rounds.length : 0, 1)}
            ${td('更新', esc(t.updated), 1)}</tr>`)) : empty('没有符合筛选的任务', '换一个项目，或清除关键词。', '<button class="btn btn--line" type="button" data-act="clear-filter">清除筛选</button>'))}
      </section>`;
    const tq = $('#tq');
    tq.addEventListener('input', () => { clearTimeout(tq._t); tq._t = setTimeout(() => { ticketQuery = tq.value.trim(); render(true); const n = $('#tq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
    $('#tp').addEventListener('change', e => { ticketProject = e.target.value; render(true); $('#tp').focus(); });
  };

  /* ---------- ticket detail ---------- */
  const tlIcon = e => e.live ? I.play : e.fail ? I.x : ({ shield: I.lock, report: I.flag, box: I.box, file: I.file, edit: I.edit, term: I.term, tool: I.tool, gate: I.gate, flag: I.flag }[e.kind] || I.tool);
  const TL_CATS = [['all', '全部'], ['code', '代码'], ['check', '测试与审查'], ['env', '环境与沙箱'], ['safe', '安全'], ['people', '汇报与决定']];
  const tlCat = e => e.kind === 'shield' ? 'safe' : /env_plan|环境计划|沙箱|快照|VM|模板/.test(e.what) ? 'env' : ['edit', 'file', 'term'].includes(e.kind) && !/压测|复现/.test(e.what) ? 'code' : /review|run_e2e|pr_test|validate|测试|审查|完成条件|CI|复现|压测/.test(e.what) || e.kind === 'gate' ? 'check' : 'people';
  const tlItem = (e, isNew) => `<li class="${isNew ? 'new' : ''}" data-kind="${e.kind}"${e.fail ? ' data-fail' : ''}${e.live ? ' data-live' : ''}><time>${esc(e.t)}</time><span class="rail">${tlIcon(e)}</span><div class="body"><span class="what">${esc(e.what)}${e.live ? '，进行中' : ''}</span>${e.d ? `<span class="detail-line">${esc(e.d)}</span>` : ''}</div></li>`;

  /* the notebook card: an ink head with the kind and the time, ruled cells, keys at the foot */
  const KIND_WORD = { you: '需要你', run: '进行中', wait: '等待', fail: '失败', done: '已完成', dropped: '已结束' };
  const hm = x => (String(x ?? '').match(/(\d{1,2}:\d{2})\s*$/) || [0, ''])[1];
  const dayOf = x => String(x ?? '').replace(/\s*\d{1,2}:\d{2}\s*$/, '').trim() || '今天';
  const minsOf = x => { const m = String(x ?? '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };
  const waited = t => { const a = minsOf(t.since || t.updated), b = minsOf(now()); if (a == null || b == null || b < a) return ''; const d = b - a; return d < 60 ? `${d} 分钟` : `${Math.floor(d / 60)} 小时 ${d % 60} 分`; };
  const entryCard = (t, { lead, body = '', keys = '', cells = [], label, foot = '', cls = '' }) => {
    const w = needsYou(t) ? waited(t) : '';
    return `<section class="entry ${cls}" aria-label="${esc(label)}" data-k="${t.kind}">
      <header class="entry__head"><span class="entry__kind"><i class="mark" aria-hidden="true"></i>${KIND_WORD[t.kind]}</span><span class="entry__id mono">${esc(t.id)}</span>
        <span class="entry__wait">${w ? `已等 <b>${esc(w)}</b>` : `<span class="mono">${esc(hm(t.updated) || dayOf(t.updated))}</span> 更新`}</span></header>
      <div class="entry__lead">${lead}</div>
      ${body}${keys ? `<div class="entry__keys">${keys}</div>` : ''}
      ${cells.length ? `<dl class="entry__cells">${cells.map(([k, v, wide]) => `<div${wide ? ' class="wide"' : ''}><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}${foot}</section>`;
  };
  const ticketLead = t => `<p class="entry__state">${esc(t.state)}</p><p class="entry__why">${esc(t.why)}</p>`;
  const ticketCells = t => { const n = needOf(t); return [['提需求', esc(who(t.by))], n ? ['谁能处理', esc(names(ownersOf(t)))] : ['完成条件', t.contract ? `<span class="mono">${passCount(t.contract)} / 5</span>` : '不适用'], ...(needsYou(t) ? [['时限', esc(slaText(t)), true]] : [])]; };
  const ticketBox = (t, tab) => {
    if (t.ask && t.kind === 'you') return entryCard(t, { label: '任务现在的状态', lead: `<p class="entry__state">${esc(t.ask.text)}</p>`, cells: [['为什么问你', esc(t.why), true], ...ticketCells(t)], body: `
      <form class="entry__form" data-form="answer" data-id="${t.id}" data-endpoint="/api/tickets/${t.id}/answer">
        <div class="entry__keys entry__keys--in">${t.ask.options.map(o => `<button class="btn${o.primary ? '' : ' btn--line'}" type="submit" name="decision" value="${o.value}">${esc(o.label)}</button>`).join('')}</div>
        <details class="entry__more"><summary>补充说明（可选）</summary><div class="field"><label class="visually-hidden" for="ans">补充说明</label><textarea class="textarea" id="ans" name="note" rows="2" placeholder="${esc(t.ask.placeholder || '')}"></textarea><span class="help">${esc(t.ask.help || '')}</span></div></details>
      </form>` });
    if (t.mandate?.open && t.kind === 'you') {
      const o = t.overlap && T(t.overlap.with) && isOpen(T(t.overlap.with)) ? t.overlap : null;
      return entryCard(t, { label: '任务现在的状态', lead: `<p class="entry__state">确认需求单：${esc(t.mandate.goal)}</p><p class="entry__why">涉及${esc(t.mandate.needConfirm)}，${esc(pname(t.project))} 要审批角色确认。${tab === 'mandate' ? '完整内容在左边。' : `<a href="${link.ticket(t.id, 'mandate')}">看完整需求单</a>`}</p>`, cells: ticketCells(t), body: `
        <form class="entry__form" data-form="mandate" data-id="${t.id}" data-endpoint="/api/tickets/${t.id}/mandate/confirm">
          <div class="field"><label for="m-ans">${esc(t.mandate.open)}</label><textarea class="textarea" id="m-ans" name="answer" rows="2" placeholder="${esc(t.mandate.hint || '例如：只展示用量，不拆账单')}"></textarea><span class="help">可以留空，Worker 会按假设推进，并在 PR 里写明。</span></div>
          ${o ? `<fieldset class="checks"><legend class="note">和 ${o.with} 都会改 ${esc(o.files)}</legend>
            <label class="check"><input type="radio" name="rel" value="par" checked>并行做，合并前自动变基</label>
            <label class="check"><input type="radio" name="rel" value="after">排在 ${o.with} 后面</label>
            <label class="check"><input type="radio" name="rel" value="merge">并入 ${o.with}</label></fieldset>` : ''}
          <div class="entry__keys entry__keys--in"><button class="btn" type="submit">确认需求单，开始做</button><a class="btn btn--line" href="#chat">在对话里改</a></div>
        </form>` });
    }
    let keys = '';
    if (t.kind === 'you' && t.action?.href) keys = `<a class="btn" href="${t.action.href}" target="_blank" rel="noopener">${I.ext}${esc(t.action.label)}</a>`;
    else if (t.kind === 'you' && t.action?.tab && t.action.tab !== tab) keys = `<a class="btn" href="${link.ticket(t.id, t.action.tab)}">${esc(t.action.label)}</a>`;
    else if (t.kind === 'fail') keys = `<button class="btn" type="button" data-act="retry" data-id="${t.id}">${I.redo}重试</button>`;
    if (t.handed) keys += `<button class="btn" type="button" data-act="handback" data-id="${t.id}">交还给 Worker</button>`;
    else if (t.kind === 'run') keys += `<button class="btn btn--line" type="button" data-act="handover" data-id="${t.id}">我来接手</button>`;
    if (['run', 'wait'].includes(t.kind)) keys += `<button class="btn btn--line" type="button" data-act="stop" data-id="${t.id}">停止任务</button>`;
    return entryCard(t, { label: '任务现在的状态', lead: ticketLead(t), cells: ticketCells(t), keys });
  };
  const ghProto = t => {
    const nx = t.group?.find(g => g.st === 'open');
    const gh = t.kind === 'you' && nx && t.action?.href ? [['gh-gmerge', `${nx.repo}#${nx.pr} 已合并`], ['gh-gchanges', `${nx.repo}#${nx.pr} 要求修改`]] : t.kind === 'you' && t.pr && t.action?.href ? [['gh-merge', `PR #${t.pr} 已合并`], ['gh-changes', '审批人要求修改'], ['gh-main', 'main 有新提交']] : t.kind === 'wait' && t.waitMerge ? (nx ? [['gh-gmerge', `${nx.repo}#${nx.pr} 已合并`]] : [['gh-merge', `PR #${t.pr} 已合并`]]) : t.kind === 'wait' && t.waitCI ? [['gh-ci', 'CI 通过']] : [];
    return gh.length ? `<div class="proto"><span>原型：模拟 GitHub 回传</span>${gh.map(([x, l]) => `<button class="btn btn--text" type="button" data-act="${x}" data-id="${t.id}">${esc(l)}</button>`).join('')}</div>` : '';
  };

  const ticketTabs = t => [['timeline', '时间线'], ['review', '审查'], ['e2e', 'E2E'], ['mandate', '需求单'], ['sandbox', '沙箱'], ...((t.rollout && !isOpen(t)) || t.postMerge ? [['rollout', '上线']] : [])];
  const pageTicket = (id, params) => {
    const t = T(id);
    if (!t) { crumbs([['任务', '#tickets'], [id]]); main.innerHTML = `<div class="empty"><h1>找不到任务 ${esc(id)}</h1><p>编号可能写错了。</p><a class="btn btn--line" href="#tickets">回到任务列表</a></div>`; return; }
    crumbs([['任务', '#tickets'], [`${t.id} ${t.title}`]]);
    const tab = params.get('tab') || 'timeline';
    const rt = ROUTING.find(r => r.ticket === t.id && r.decision.includes('新开'));
    /* an architecture change gets a full-width band between the goal and the acceptance list, so before and after sit side by side */
    const wide = tab === 'mandate' && t.arch && demo === 'full';
    const asideA = `${ticketBox(t, tab)}
          ${ghProto(t)}`;
    const asideB = `<div class="ticks">
            <div class="region-head head-gap"><h2 id="c-h">完成条件</h2>${t.contract ? `<span class="num ink-2">${passCount(t.contract)} / 5</span>` : ''}</div>
            ${region({ what: '完成条件', emptyTitle: '还没有校验记录', emptyText: 'Worker 汇报 ready 时，Engine 会按最新提交校验这 5 项。', rows: 5 }, () => t.contract ? `<ul class="checklist">${t.contract.map(c => `<li data-r="${c.r}">${c.r === 'pass' ? I.check : c.r === 'fail' ? I.x : I.clock}<div><span class="t">${esc(c.t)}</span>${c.s ? `<span class="s">${esc(c.s)}</span>` : ''}</div></li>`).join('')}</ul>` : '<p class="ink-2">任务没有改动代码就结束了，不需要校验。</p>')}
          </div>
          ${t.group ? `<div class="ticks"><div class="region-head head-gap"><h2 id="g-h">PR 组</h2><span class="num ink-2">已合并 ${t.group.filter(g => g.st === 'merged').length} / ${t.group.length}</span></div>
            <ol class="checklist">${t.group.map((g, i) => { const first = t.group.find(x => x.st === 'open') === g; return `<li data-r="${g.st === 'merged' ? 'pass' : 'wait'}">${g.st === 'merged' ? I.check : I.clock}<div><a class="t" href="${gLink(g)}" target="_blank" rel="noopener">${i + 1}. ${esc(g.repo)}#${g.pr}</a><span class="s">${g.st === 'merged' ? '已合并' : t.kind === 'done' ? '' : first ? (t.kind === 'you' ? '等你审批' : '修改中') : '等前序合并'}</span></div></li>`; }).join('')}</ol></div>` : ''}
          <p class="note">Worker 自己决定做事顺序。5 项都通过，任务才会交给你审批。${t.group ? '跨仓库任务按 PR 组校验：E2E 跑三个仓库 head 的组合，以及按合并顺序的每个中间状态。' : ''}</p>`;
    main.innerHTML = `
      <div class="ticket-head">
        <h1>${t.id} ${esc(t.title)}</h1>
        <div class="meta">${cbtn(link.project(t.project), esc(pname(t.project)))}${t.branch ? `<span class="tag"><span class="mono">${esc(t.branch)}</span></span>` : ''}${t.pr ? cbtn(prLink(t), `<span class="mono">${esc(prName(t))}</span>${I.ext}`) : ''}${t.group ? `<span class="tag">PR 组 ${t.group.length} 个</span>` : ''}<span class="tag"><i class="avatar" aria-hidden="true">${esc(who(t.by).slice(0, 1))}</i>${esc(who(t.by))}提的</span><span class="tag"><span class="mono">${esc(t.created)}</span> 创建</span></div>
        <figure class="quote"><blockquote>${esc(t.source.text)}</blockquote><figcaption>${esc(t.source.via)}${rt ? `<a href="#routing">路由依据</a>` : ''}</figcaption></figure>
        ${t.overlap && isOpen(t) && T(t.overlap.with) && isOpen(T(t.overlap.with)) ? `<p class="warn-line">${I.alert}<span>和 <a href="${link.ticket(t.overlap.with)}">${t.overlap.with}</a> 改动范围重叠：两边都会改 <code>${esc(t.overlap.files)}</code>。${t.dependsOn ? `已排在 ${t.dependsOn} 后面。` : ''}</span></p>` : ''}
        ${drainNote()}
      </div>
      ${wide ? `<div class="detail detail--arch">
        <div class="region">
          ${tabs(ticketTabs(t).map(([k, l]) => [link.ticket(t.id, k), l, k]), tab, '任务详情')}
          <div>${mandateView(t, 'top')}</div>
        </div>
        <aside class="aside" aria-label="现在要做的">
          ${asideA}
        </aside>
        ${archBand(t)}
        <div class="region">${mandateView(t, 'rest')}</div>
        <aside class="aside" aria-labelledby="c-h">
          ${asideB}
        </aside>
      </div>` : `<div class="detail">
        <div class="region">
          ${tabs(ticketTabs(t).map(([k, l]) => [link.ticket(t.id, k), l, k]), tab, '任务详情')}
          <div>${ticketTab(t, tab)}</div>
        </div>
        <aside class="aside" aria-labelledby="c-h">
          ${asideA}
          ${asideB}
        </aside>
      </div>`}`;
  };

  /* the mandate as a spec sheet: the goal, what is in and out, each acceptance line with the test that proves it */
  const PENDING = /^Worker 读完代码后补充/;
  /* Architecture delta. The model hands over nodes and edges; the console lays them out, so "before" and "after" share
     the same positions and the eye only has to find what changed. */
  const archDiff = a => {
    const ids = es => new Set(es.flatMap(e => [e[0], e[1]])), key = e => `${e[0]}>${e[1]}`;
    const b = ids(a.before), f = ids(a.after), bk = new Set(a.before.map(key)), fk = new Set(a.after.map(key));
    const node = id => a.nodes.find(n => n.id === id);
    return { b, f, bk, fk, key, node,
      added: [...f].filter(x => !b.has(x)), removed: [...b].filter(x => !f.has(x)), changed: a.nodes.filter(n => n.subAfter && b.has(n.id) && f.has(n.id)).map(n => n.id),
      edgesAdded: a.after.filter(e => !bk.has(key(e))), edgesRemoved: a.before.filter(e => !fk.has(key(e))) };
  };
  const archSvg = (a, side, W) => {
    const d = archDiff(a), edges = a[side], shown = side === 'before' ? d.b : d.f, down = a.dir === 'down';
    const cols = Math.max(...a.nodes.map(n => n.col)) + 1, rows = Math.max(...a.nodes.map(n => n.row)) + 1;
    const padX = 10, padY = 20, nh = 54, rowH = down ? 100 : 82, nw = Math.min(176, Math.floor((W - padX * 2 - (cols - 1) * (down ? 22 : 64)) / cols)), gap = cols > 1 ? (W - padX * 2 - cols * nw) / (cols - 1) : 0;
    const H = padY * 2 + (rows - 1) * rowH + nh, X = n => padX + n.col * (nw + gap), Y = n => padY + n.row * rowH, cx = n => X(n) + nw / 2, cy = n => Y(n) + nh / 2;
    const nState = id => side === 'before' ? (d.f.has(id) ? 'same' : 'removed') : !d.b.has(id) ? 'added' : d.changed.includes(id) ? 'changed' : 'same';
    const eState = e => side === 'before' ? (d.fk.has(d.key(e)) ? 'same' : 'removed') : d.bk.has(d.key(e)) ? 'same' : 'added';
    const f1 = v => v.toFixed(1), S = e => d.node(e[0]), E = e => d.node(e[1]);
    /* an edge runs along the flow when it changes layer; several edges on one side of a box fan out over ports 12px apart */
    const along = e => down ? S(e).row !== E(e).row : S(e).col !== E(e).col;
    const port = (list, e, pos) => { const s = [...list].sort((p, q) => pos(p) - pos(q)); return (s.indexOf(e) - (s.length - 1) / 2) * 12; };
    const tip = (x, y, dx, dy) => `<polygon points="${f1(x)},${f1(y)} ${f1(x - dx * 8 - dy * 4.5)},${f1(y - dy * 8 - dx * 4.5)} ${f1(x - dx * 8 + dy * 4.5)},${f1(y - dy * 8 + dx * 4.5)}"/>`;
    const lbl = (e, x, y, anchor) => e[2] ? `<text class="arch__lbl" x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}" dominant-baseline="middle">${esc(e[2])}</text>` : '';
    const lines = edges.map(e => {
      const s = S(e), t = E(e), st = eState(e), out = edges.filter(o => o[0] === e[0] && along(o)), inn = edges.filter(o => o[1] === e[1] && along(o));
      let body;
      if (along(e) && down) {
        const sy = t.row > s.row ? 1 : -1, x1 = cx(s) + port(out, e, o => cx(E(o))), y1 = sy > 0 ? Y(s) + nh : Y(s), x2 = cx(t) + port(inn, e, o => cx(S(o))), y2 = sy > 0 ? Y(t) - 2 : Y(t) + nh + 2, my = (y1 + y2) / 2;
        body = `<path d="M ${f1(x1)} ${f1(y1)} C ${f1(x1)} ${f1(my)} ${f1(x2)} ${f1(my)} ${f1(x2)} ${f1(y2 - sy * 7)}"/>${tip(x2, y2, 0, sy)}${lbl(e, (x1 + x2) / 2, my, 'middle')}`;
      } else if (along(e)) {
        const sx = t.col > s.col ? 1 : -1, x1 = sx > 0 ? X(s) + nw : X(s), y1 = cy(s) + port(out, e, o => cy(E(o))), x2 = sx > 0 ? X(t) - 2 : X(t) + nw + 2, y2 = cy(t) + port(inn, e, o => cy(S(o))), mx = (x1 + x2) / 2;
        body = `<path d="M ${f1(x1)} ${f1(y1)} C ${f1(mx)} ${f1(y1)} ${f1(mx)} ${f1(y2)} ${f1(x2 - sx * 7)} ${f1(y2)}"/>${tip(x2, y2, sx, 0)}${lbl(e, mx, (y1 + y2) / 2, 'middle')}`;
      } else if (down) {
        const sx = t.col > s.col ? 1 : -1, x1 = sx > 0 ? X(s) + nw : X(s), x2 = sx > 0 ? X(t) - 2 : X(t) + nw + 2, y = cy(s);
        body = `<path d="M ${f1(x1)} ${f1(y)} L ${f1(x2 - sx * 7)} ${f1(y)}"/>${tip(x2, y, sx, 0)}${lbl(e, (x1 + x2) / 2, y - 10, 'middle')}`;
      } else {
        const sy = t.row > s.row ? 1 : -1, x = cx(s), y1 = sy > 0 ? Y(s) + nh : Y(s), y2 = sy > 0 ? Y(t) - 2 : Y(t) + nh + 2;
        body = `<path d="M ${f1(x)} ${f1(y1)} L ${f1(x)} ${f1(y2 - sy * 7)}"/>${tip(x, y2, 0, sy)}${lbl(e, x + 10, (y1 + y2) / 2, 'start')}`;
      }
      return `<g class="arch__edge" data-s="${st}">${body}</g>`;
    }).join('');
    const BADGE = { added: '新增', removed: '移除', changed: '改动' };
    const boxes = a.nodes.filter(n => shown.has(n.id)).map(n => {
      const st = nState(n.id), x = X(n), y = Y(n), store = n.kind === 'store', tx = x + (store ? 20 : 12);
      return `<g class="arch__node" data-s="${st}"><rect x="${f1(x)}" y="${y}" width="${nw}" height="${nh}" rx="${store ? nh / 2 : 6}"/><text class="arch__name" x="${f1(tx)}" y="${y + 23}">${esc(n.name)}</text><text class="arch__sub" x="${f1(tx)}" y="${y + 41}">${esc(side === 'after' && n.subAfter ? n.subAfter : n.sub)}</text>${BADGE[st] ? `<g class="arch__badge"><rect x="${f1(x + nw - 44)}" y="${y - 9}" width="36" height="18" rx="4"/><text x="${f1(x + nw - 26)}" y="${y + 0.5}" text-anchor="middle" dominant-baseline="middle">${BADGE[st]}</text></g>` : ''}</g>`;
    }).join('');
    const name = id => d.node(id).name, list = es => es.map(e => `${name(e[0])}到${name(e[1])}${e[2] ? `（${e[2]}）` : ''}`).join('；');
    const say = side === 'before' ? `改动前：${list(a.before)}。${d.edgesRemoved.length ? `要移除的连线：${list(d.edgesRemoved)}。` : ''}`
      : `改动后：${list(a.after)}。${d.added.length ? `新增 ${d.added.map(name).join('、')}。` : ''}${d.changed.length ? `改动 ${d.changed.map(id => `${name(id)}（${d.node(id).subAfter}）`).join('、')}。` : ''}`;
    return `<svg class="arch__svg" viewBox="0 0 ${W} ${H}" style="--min:${Math.round(W * 0.8)}px" role="img" aria-label="${esc(say)}">${lines}${boxes}</svg>`;
  };
  const archSame = d => !d.added.length && !d.removed.length && !d.edgesAdded.length && !d.edgesRemoved.length;
  /* the full-width band: what changes in one sentence, then before and after side by side */
  const archBand = t => {
    const a = t.arch, d = archDiff(a), open = t.mandate.open && t.kind === 'you', same = archSame(d);
    const stage = a.stage === 'actual' ? `<span class="tag tag--ok">${I.check}已按 PR 复核</span>` : open ? '<span class="tag tag--you">计划，等你确认</span>' : `<span class="tag tag--ok">${I.check}计划已确认</span>`;
    const counts = [[d.added.length, '新增组件'], [d.removed.length, '移除组件'], [d.edgesAdded.length, '新增连线'], [d.edgesRemoved.length, '移除连线'], [d.changed.length, '改动组件']].filter(x => x[0]).map(([n, l]) => `<span class="tag">${l} <b class="mono">${n}</b></span>`).join('');
    const fig = (side, cap, W) => `<figure class="arch__fig"><figcaption>${cap}</figcaption><div class="arch__canvas" tabindex="0" role="group" aria-label="${cap}的架构图，放不下时可以左右滑动">${archSvg(a, side, W)}</div></figure>`;
    const key = (cls, l) => `<li><i class="akey${cls ? ` akey--${cls}` : ''}"></i>${l}</li>`;
    return `<section class="arch" aria-labelledby="arch-h">
      <div class="region-head"><h2 id="arch-h">架构变化</h2><p>${a.stage === 'actual' ? esc(a.check) : '改动前来自代码索引，改动后是开工前的计划'}</p></div>
      <div class="spec__chips">${stage}${counts}${same ? '<span class="tag">组件和连线没有增减</span>' : ''}</div>
      <p class="arch__sum">${esc(a.summary)}</p>
      <div class="arch__figs">${same ? fig('after', '改动后', 960) : fig('before', '改动前', 470) + fig('after', '改动后', 470)}</div>
      <ul class="legend" aria-label="图例">${key('', '代码')}${key('store', '存储或队列')}${d.added.length || d.edgesAdded.length ? key('added', '新增') : ''}${d.removed.length || d.edgesRemoved.length ? key('removed', '移除') : ''}${d.changed.length ? key('changed', '改动') : ''}</ul>
    </section>`;
  };
  const archNotes = a => `${(a.paths || []).map(p => `<section><h3 class="spec__h">${esc(p.name)}</h3><div class="spec__cols"><div><span class="spec__label">改动前</span><ol class="arch__steps">${p.before.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div><div><span class="spec__label">改动后</span><ol class="arch__steps">${p.after.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div></div></section>`).join('')}
      ${a.risks?.length ? `<section><h3 class="spec__h">风险与回退</h3><dl class="facts">${a.risks.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>` : ''}`;
  const KIND = { func: '功能', perf: '性能', stress: '并发正确性', data: '数据', soak: '长跑', manual: '人工确认' };
  const PHASE = { done: ['ok', '已完成'], now: ['warm', '进行中'], ready: ['you', '条件已达成'], todo: ['', '未开始'] };
  const rolloutTable = t => table('', [{ t: '阶段' }, { t: '动作' }, { t: '进入下一阶段的条件' }, { t: '回退' }, { t: '状态' }], t.rollout.phases.map((ph, i) => `<tr>${td('阶段', `<span class="title">${i + 1} ${esc(ph.name)}</span>${ph.when ? `<span class="sub">${esc(ph.when)}</span>` : ''}`)}${td('动作', esc(ph.action))}${td('进入下一阶段的条件', `${esc(ph.gate)}${ph.metric ? `<span class="sub">${esc(ph.metric)}</span>` : ''}`)}${td('回退', esc(ph.back))}${td('状态', `<span class="tag${PHASE[ph.st][0] ? ` tag--${PHASE[ph.st][0]}` : ''}">${PHASE[ph.st][1]}</span>`)}</tr>`));
  const planView = t => { if (!t.plan) return ''; const all = t.mandate.accept.map((_, i) => i + 1), covered = new Set(t.plan.tasks.flatMap(x => x.covers)), miss = all.filter(i => !covered.has(i));
    return `<section><div class="region-head"><h3 class="spec__h">任务图</h3><p>${cbtn(`#plan-${t.plan.id}`, `计划 <span class="mono">${t.plan.id}</span>${t.plan.replan ? '，有改动等你确认' : ''}`)}：确认一次，任务按依赖自动开工</p></div>
      <ol class="accept accept--plan">${t.plan.tasks.map((x, i) => `<li data-s="${x.ticket ? 'ok' : 'todo'}"><span class="accept__n mono">${i + 1}</span><div><p>${esc(x.title)}</p><p class="note">${x.deps.length ? `依赖任务 ${x.deps.join('、')}` : '没有依赖，先做'}${x.stacked ? '，用叠放 PR 提前开工' : ''}${x.after ? `，排在${esc(x.after)}` : ''}${x.covers.length ? `；覆盖验收标准 ${x.covers.join('、')}` : ''}</p></div><span class="accept__side">${x.ticket === t.id ? '<span class="tag tag--you">本任务</span>' : x.ticket ? cbtn(link.ticket(x.ticket), `<span class="mono">${x.ticket}</span>`) : '<span class="tag">确认后创建</span>'}</span></li>`).join('')}</ol>
      <p class="note">${miss.length ? `验收标准 ${miss.join('、')} 还没有任务覆盖，不能提交确认` : `${all.length} 条验收标准都有任务覆盖`}</p></section>`; };
  const mandateView = (t, part) => {
    const m = t.mandate, fresh = t.e2e?.fresh || [];
    const open = m.open && t.kind === 'you', none = !m.needConfirm && (!m.confirmedBy || /^无需确认/.test(m.confirmedBy));
    const st = open ? ['you', '等你确认'] : none ? ['plain', '无需确认'] : ['ok', '已确认'];
    const testFor = (a, i) => fresh.find(f => f.name.includes(a.replace(/^.*?：/, ''))) || (fresh.length === m.accept.length ? fresh[i] : null);
    const accept = m.accept.map((a, i) => {
      if (PENDING.test(a)) return `<li data-s="todo"><span class="accept__n mono">${i + 1}</span><div><p>${esc(a)}</p></div><span class="tag">待补充</span></li>`;
      const kind = m.kinds?.[i] || 'func', ev = m.evidence?.[i], f = kind === 'func' ? testFor(a, i) : null, ok = kind === 'func' ? !!f && f.head === '通过' : !!ev?.ok;
      const status = kind === 'func' ? (ok ? `${I.check}有测试，通过` : t.e2e ? '没有对应用例' : '还没有测试') : kind === 'manual' ? '审批时人工确认' : ok ? `${I.check}有证据，通过` : kind === 'soak' && ev ? '交给上线阶段' : ev ? '取证中' : '还没有证据';
      return `<li data-s="${ok ? 'ok' : 'todo'}"><span class="accept__n mono">${i + 1}</span><div><p>${esc(a)}</p>${f ? `<p class="note">用例：${esc(f.name)}</p>` : ''}${ev?.note ? `<p class="note">${ok ? '证据：' : ''}${esc(ev.note)}${ev.report ? `，<a href="#report-${t.id}-${i}">看报告</a>` : ''}</p>` : ''}</div><span class="accept__side"><span class="tag">${KIND[kind]}</span><span class="tag${ok ? ' tag--ok' : ''}">${status}</span></span></li>`;
    }).join('');
    const scopeList = (items, icon, cls) => `<ul class="spec__list ${cls}">${items.map(x => `<li>${icon}<span>${esc(x)}</span></li>`).join('')}</ul>`;
    const top = `<div class="spec__chips">${m.needConfirm || (!none && m.confirmedBy) ? `<span class="tag tag--warm">涉及${esc(m.needConfirm || m.confirmedBy.split('：')[0])}</span>` : ''}<span class="tag${st[0] === 'ok' ? ' tag--ok' : st[0] === 'you' ? ' tag--you' : ''}">${st[0] === 'ok' ? I.check : ''}${st[1]}</span>${t.overlap ? `<a class="tag tag--warm" href="${link.ticket(t.overlap.with)}">和 ${t.overlap.with} 改动重叠</a>` : ''}</div>
      <section class="spec__goal"><span class="spec__label">目标</span><p>${esc(m.goal)}</p>${m.confirmedBy && !none ? `<p class="note">${I.check} ${esc(m.confirmedBy)}</p>` : ''}</section>
      <div class="spec__cols">
        <section><h3 class="spec__h">做</h3>${scopeList(m.scope, I.check, 'spec__list--in')}</section>
        <section><h3 class="spec__h">不做</h3>${m.not.length ? scopeList(m.not, I.x, 'spec__list--out') : '<p class="note">没有特别排除的内容</p>'}</section>
      </div>`;
    const rest = `${planView(t)}<section><div class="region-head"><h3 class="spec__h">验收标准</h3><p>每条按类型取证：功能看用例，性能和并发看压测，长跑交给上线阶段</p></div><ol class="accept">${accept}</ol></section>
      ${m.order && t.group ? `<section><h3 class="spec__h">合并顺序</h3><ol class="steps">${t.group.map((g, i) => `<li data-s="${g.st}"><span class="steps__n mono">${i + 1}</span>${cbtn(gLink(g), `<span class="mono">${esc(g.repo)}#${g.pr}</span>`)}<span class="note">${g.st === 'merged' ? '已合并' : i === t.group.findIndex(x => x.st === 'open') ? '下一个合' : '等前序合并'}</span></li>`).join('')}</ol><p class="note">${esc(m.order)}</p></section>` : ''}
      ${t.rollout && isOpen(t) ? `<section><div class="region-head"><h3 class="spec__h">上线阶段</h3><p>合并后按阶段推进；系统只准备动作、看信号、提醒你</p></div>${rolloutTable(t)}</section>` : ''}
      ${t.arch ? archNotes(t.arch) : ''}
      ${m.assume.length ? `<aside class="callout"><span class="spec__label">假设</span><ul>${m.assume.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="note">Worker 按这些推进；不对就在对话里说，它会改需求单。</p></aside>` : ''}
      ${open ? '<p class="note">在右侧卡片里确认这份需求单。</p>' : ''}`;
    return part === 'top' ? `<div class="spec sub-head">${top}</div>` : part === 'rest' ? `<div class="spec">${rest}</div>` : `<div class="spec sub-head">${top}${rest}</div>`;
  };
  const notYet = (t, what) => {
    const msg = {
      T134: '需求单确认后，Worker 才开工。', blocked: 'Worker 还在等你回答问题，没有提交代码。',
      fail: 'E2E 没跑起来，审查要等 E2E 通过之后。', dropped: '任务没有改动代码就结束了。', done: '这个任务的记录已归档，只保留时间线与完成条件。',
    };
    const key = t.kind === 'dropped' ? 'dropped' : t.kind === 'done' ? 'done' : t.ask ? 'blocked' : t.kind === 'fail' ? 'fail' : t.mandate?.open ? 'T134' : null;
    return empty(`还没有${what}`, msg[key] || '任务推进到这一步后会出现在这里。');
  };

  const ticketTab = (t, tab) => {
    if (tab === 'timeline') return region({ what: '时间线', emptyTitle: '还没有动作', emptyText: 'Worker 启动后，每一次读文件、改代码、跑命令、调用能力都会出现在这里。', rows: 8 }, () => `
        ${t.progress && isOpen(t) ? `<section class="progress sub-head" aria-labelledby="pg-h"><div class="region-head"><h3 id="pg-h">Worker 的进度</h3><p><code>.acw/progress.md</code>，沙箱重建后它先读这个</p></div><ol class="progress__list">${t.progress.map(([st, x]) => `<li data-s="${st}">${st === 'done' ? I.check : st === 'now' ? I.play : I.clock}<span>${esc(x)}</span></li>`).join('')}</ol></section>` : ''}
        <div class="region-head sub-head"><div class="chips" role="group" aria-label="按类别筛选">${TL_CATS.map(([k, l]) => { const n = k === 'all' ? t.timeline.length : t.timeline.filter(e => tlCat(e) === k).length; return `<button class="chip" type="button" data-act="tl-filter" data-f="${k}" aria-pressed="${tlFilter === k}"${n ? '' : ' disabled'}>${l}<span class="n">${n}</span></button>`; }).join('')}</div><p class="note">${t.kind === 'run' ? '实时更新中' : ''}</p></div>
        <ol class="timeline" id="tl" data-ticket="${t.id}">${t.timeline.filter(e => tlFilter === 'all' || tlCat(e) === tlFilter).map(e => tlItem(e)).join('')}</ol>`);
    if (tab === 'rollout') return region({ what: '上线记录', emptyTitle: '没有上线记录', emptyText: '任务合并后，分阶段上线的进展和线上回传的问题会出现在这里。', rows: 4 }, () => { const ph = t.rollout?.phases, r = ph ? ph.findIndex(x => x.st === 'ready') : -1;
      return `${ph ? `<div class="region sub-head"><div class="region-head"><h3>上线阶段</h3><p>系统不操作生产：开关由你在配置仓库合并，这里只看信号</p></div>${rolloutTable(t)}${r >= 0 ? `<div class="well well--row"><p class="ink">第 ${r + 1} 阶段的条件已达成：${esc(ph[r].metric || ph[r].gate)}</p><div class="actions"><button class="btn" type="button" data-act="roll-next" data-id="${t.id}">${r + 1 < ph.length ? `进入第 ${r + 2} 阶段` : '完成上线'}</button><button class="btn btn--line" type="button" data-act="roll-back" data-id="${t.id}">回退这一阶段</button></div></div>` : ''}</div>` : ''}
        ${t.postMerge?.length ? `<div class="region sub-head"><div class="region-head"><h3>合并后问题</h3><p>部署和错误追踪回传，按文件对到这个任务</p></div><ul class="findings">${t.postMerge.map((x, i) => `<li data-sev="p1"><span class="sev sev--p1">${esc(x.src)}</span><div class="findings__main"><p class="ink">${esc(x.title)}</p><p class="findings__where"><code>${esc(x.where)}</code></p><p class="note">${esc(x.t)} 起 ${x.count} 次；${esc(x.note)}</p></div><div class="findings__side">${x.fix ? cbtn(link.ticket(x.fix), `<span class="mono">${x.fix}</span>`) : `<button class="cbtn" type="button" data-act="pm-fix" data-id="${t.id}" data-i="${i}">开修复任务</button>`}</div></li>`).join('')}</ul></div>` : ''}`; });
    if (tab === 'review') return region({ what: '审查记录', emptyTitle: '还没有审查', emptyText: 'Worker 完成改动并通过检查后，会派出审查子 agent。', rows: 6 }, () => !t.review ? notYet(t, '审查') : `
        <div class="region sub-head"><h3>轮次</h3>${table('', [{ t: '轮次' }, { t: '提交' }, { t: '发现', num: 1 }, { t: '已证实', num: 1 }, { t: '已修复', num: 1 }, { t: '结论' }], t.review.rounds.map(r => `<tr>${td('轮次', `第 ${r.n} 轮`)}${td('提交', `<code>${r.commit}</code>`)}${td('发现', r.found ?? '进行中', 1)}${td('已证实', r.valid ?? '', 1)}${td('已修复', r.fixed ?? '', 1)}${td('结论', esc(r.verdict))}</tr>`))}</div>
        <div class="region sub-head"><h3>发现的问题</h3>${t.review.findings.length ? `<ul class="findings">${t.review.findings.map((f, i) => `<li data-sev="${f.sev.toLowerCase()}">
          <span class="sev sev--${f.sev.toLowerCase()}">${f.sev}</span>
          <div class="findings__main"><p class="ink">${esc(f.what)}</p><p class="findings__where"><code>${esc(f.where)}</code></p><p class="note">证据：${esc(f.ev)}</p></div>
          <div class="findings__side"><span class="findings__st${/来回改/.test(f.st) ? ' state state--you' : ''}">${esc(f.st)}</span>${f.fp || /已证实|来回改/.test(f.st) ? '' : `<button class="cbtn" type="button" data-act="fp" data-id="${t.id}" data-i="${i}">标为误报</button>`}</div></li>`).join('')}</ul>` : '<p class="ink-2">审查没有发现问题。</p>'}
        <p class="note">标为误报的发现会记进质量度量，用来评估审查模型。只有已证实的 P0 和 P1 会阻塞交付。同一问题在“已修复”后重复出现两次，会判定为来回改并转给你。最多 ${SETTINGS.rounds} 轮。</p></div>`);
    if (tab === 'e2e') return region({ what: 'E2E 结果', emptyTitle: '还没有跑过 E2E', emptyText: '预览环境就绪后，Worker 会按需调用 run_e2e。', rows: 6 }, () => !t.e2e ? notYet(t, 'E2E 结果') : `
        <div class="region sub-head"><div class="region-head"><h3>分层结果</h3>${t.e2e.preview && t.sandbox?.state === 'running' ? `<a href="https://${t.e2e.preview}" target="_blank" rel="noopener" class="link-ext">${I.ext}${t.e2e.preview}</a>` : t.e2e.preview ? '<span class="note">预览环境随沙箱暂停</span>' : ''}</div>
          ${table('', [{ t: '层' }, { t: '通过', num: 1 }, { t: '用时', num: 1 }, { t: '结果' }], t.e2e.tiers.map(x => `<tr>${td('层', `<span class="ink">${x.name}</span>`)}${td('通过', x.pass === null ? `0 / ${x.total}` : `${x.pass} / ${x.total}`, 1)}${td('用时', x.dur || '未运行', 1)}${td('结果', x.r === 'pass' ? `<span class="state state--ok">${I.check}通过</span>` : x.r === 'fail' ? `<span class="state state--fail">${I.x}${esc(x.note)}</span>` : `<span class="state state--wait">${I.clock}${esc(x.note)}</span>`)}</tr>`))}
          ${t.kind === 'fail' ? `<p class="note">失败原因是环境，不是代码。${pname(t.project)} 的环境计划已自动更新，<a href="${link.plan(t.project, currentPlan(t.project).v)}">查看 ${currentPlan(t.project).v}</a>。</p>` : ''}
        </div>
        ${t.e2e.fresh.length ? `<div class="region sub-head"><h3>本 PR 新写的测试</h3>${table('', [{ t: '用例' }, { t: 'base（main 基线）' }, { t: 'head' }, { t: '判断' }], t.e2e.fresh.map(x => `<tr>${td('用例', `<span class="ink">${esc(x.name)}</span>`)}${td('base', `<span class="tag${x.base === '通过' ? ' tag--ok' : ' tag--bad'}">${esc(x.base)}</span>`)}${td('head', `<span class="tag${x.head === '通过' ? ' tag--ok' : ' tag--bad'}">${esc(x.head)}</span>`)}${td('判断', `<span class="tag${x.verdict === '有效' ? ' tag--ok' : ''}">${x.verdict === '有效' ? I.check : ''}${esc(x.verdict)}</span>`)}</tr>`))}
          <p class="note">base 失败、head 通过，说明测试确实验证了这次改动。测试由独立的 Tester 编写，Fixer 只能读不能改。</p></div>` : ''}`);
    if (tab === 'mandate') return region({ what: '需求单', emptyTitle: '还没有需求单', emptyText: 'Router 会把你的话整理成需求单。', rows: 6 }, () => !t.mandate ? notYet(t, '需求单') : mandateView(t));
    if (tab === 'sandbox') return region({ what: '沙箱', emptyTitle: '没有沙箱', emptyText: '任务结束或超过 24 小时后沙箱会被回收。', rows: 6 }, () => {
      const s = t.sandbox;
      if (!s) return empty('没有沙箱', t.kind === 'done' || t.kind === 'dropped' ? '任务结束后沙箱已回收。' : t.kind === 'fail' ? '环境启动失败，沙箱已回收。重试时会用最新的环境计划重新创建。' : '需求单确认后才会创建沙箱。');
      return `<div class="region sub-head">
        <div class="region-head"><h3>${esc(s.form)}，${s.state === 'running' ? '运行中' : '已暂停'}</h3><div class="actions">${s.state === 'running' ? `<button class="btn btn--line" type="button" data-act="pause" data-id="${t.id}">${I.pause}暂停</button>` : `<button class="btn btn--line" type="button" data-act="resume" data-id="${t.id}">${I.play}恢复</button>`}</div></div>
        ${kv([
          ['环境计划', cbtn(link.plan(t.project, s.env), `${esc(pname(t.project))} <span class="mono">${s.env}</span>`)],
          ['模板', cbtn('#sandboxes-templates', `<span class="mono">${tplId(t.project, s.env)}</span>`), `acw-base@${tplBase(t.project, s.env)}，内核 ${CFG.kernel.id} ${CFG.kernel.tag}`],
          ['提供方', cbtn('#sandboxes-providers', esc(provName(s.provider || 'firecracker'))), esc(s.providerWhy || (P(t.project).provider === 'inherit' ? '跟随默认提供方' : `项目指定 ${provName(P(t.project).provider)}`))],
          isCloud(s.provider) ? ['运行位置', `<span class="ink">${esc(provName(s.provider))}</span>`, `已用机时 ${(s.hours || 0).toFixed(1)} 小时；暂停方式：${esc(PROV(s.provider).pause)}`] : ['宿主机', cbtn('#sandboxes', `<span class="mono">${s.host}</span>`), esc(placeWhy(t.project, s.env, s.host))],
          s.preview && s.state === 'running' ? ['预览', cbtn(`https://${s.preview}`, `${I.ext}<span class="mono">${s.preview}</span>`)] : null,
        ])}
        ${table('', [{ t: '服务' }, { t: '内容' }, { t: '规格', num: 1 }], s.vms.map(v => `<tr>${td('服务', `<code>${v[0]}</code>`)}${td('内容', esc(v[1]))}${td('规格', v[2], 1)}</tr>`))}
        <p class="note">${s.form === 'VM 组' ? '每个服务一个 microVM，服务之间按服务名互相访问，网段只属于这个任务。' : '所有服务作为进程跑在同一个 microVM 里。'}暂停会保存内存快照并释放内存，${SETTINGS.idle} 分钟没有动作也会自动暂停。</p></div>`;
    });
    return '';
  };

  /* ---------- chat ---------- */
  const draftCard = (m, i) => `<div class="route-card well">
      <dl class="facts"><dt>判断</dt><dd>新开任务</dd>${m.draft.overlap ? `<dt>重叠</dt><dd>和 <a href="${link.ticket(m.draft.overlap)}">${m.draft.overlap}</a> 改同一个模块${m.draft.needConfirm ? '，确认需求单时可以选并行、排在后面或并入' : '，默认并行，合并前自动变基'}</dd>` : ''}<dt>项目</dt><dd>${pLink(m.draft.project)}，可信度${esc(m.draft.conf)}</dd><dt>依据</dt><dd>${esc(m.draft.why)}</dd><dt>目标</dt><dd>${esc(m.draft.goal)}</dd>${m.draft.needConfirm ? `<dt>确认</dt><dd>涉及“${esc(m.draft.needConfirm)}”，开任务后需求单要你再确认一次</dd>` : ''}</dl>
      ${m.created ? `<a href="${link.ticket(m.created)}">已创建 ${m.created}，打开</a>` : `<div class="actions actions--start"><button class="btn btn--line" type="button" data-act="create-ticket" data-msg="${i}">创建任务</button><button class="btn btn--text" type="button" data-act="focus-say">改一下再说</button></div>`}
    </div>`;
  const pageChat = () => {
    crumbs([['对话']]);
    const msgs = CHAT.map((m, i) => m.who === 'me'
      ? `<div class="msg msg--me"><span class="who">你，${m.t}</span><div class="bubble">${esc(m.text)}</div></div>`
      : `<div class="msg msg--router"><span class="who">Router，${m.t}</span><div class="bubble">${esc(m.text)}</div>
          ${m.opts ? `<div class="route-card"><div class="opts">${m.opts.map(o => `<button class="btn btn--line" type="button" ${m.chosen ? 'disabled' : `data-act="pick" data-msg="${i}" data-val="${esc(o)}"`}${m.chosen === o ? ' aria-pressed="true"' : ''}>${esc(o)}</button>`).join('')}</div></div>` : ''}
          ${m.draft ? draftCard(m, i) : ''}${m.link ? `<a href="${link.ticket(m.link)}">打开 ${m.link}</a>` : ''}</div>`).join('');
    main.innerHTML = `
      <div class="page-head"><div><h1>对话</h1><p>直接说需求。Router 按项目的别名和渠道判断：直接回答、新开任务、发给已有任务，还是先问你。</p></div></div>
      <div class="chat">
        <section class="region" aria-label="与 Router 的对话">
          ${region({ what: '对话', emptyTitle: '还没有对话', emptyText: '说一句需求试试，例如“OrcaRouter 账单页加一个按月导出”。', rows: 6 }, () => `<div class="thread" id="thread" aria-live="polite">${msgs}</div>`)}
          <form class="composer" data-form="chat" data-endpoint="/api/router/messages">
            <label for="say" class="visually-hidden">给 Router 发消息</label>
            <div class="row"><textarea class="textarea" id="say" name="text" rows="2" placeholder="例如：Xbot 抓取加一个按账号过滤"></textarea><button class="btn" type="submit">${I.send}发送</button></div>
            <span class="help note" id="say-help">Enter 发送，Shift + Enter 换行。试试提到项目别名（配音、看板、计费）、“进度”或任务编号。</span>
          </form>
        </section>
        <aside class="region" aria-labelledby="open-h">
          <h2 id="open-h">未结束的任务</h2>
          ${region({ what: '任务', emptyTitle: '没有未结束的任务', emptyText: '新开的任务会出现在这里。', rows: 5 }, () => `<ul class="checklist">${TICKETS.filter(isOpen).map(t => `<li data-r="${t.kind === 'fail' ? 'fail' : 'wait'}">${t.kind === 'you' ? I.hand : t.kind === 'fail' ? I.x : t.kind === 'run' ? I.play : I.clock}<div><a class="t" href="${link.ticket(t.id)}">${t.id} ${esc(t.title)}</a><span class="s">${esc(t.state)}</span></div></li>`).join('')}</ul>`)}
        </aside>
      </div>`;
    $('#thread')?.lastElementChild?.scrollIntoView({ block: 'nearest' });
    const say = $('#say');
    say.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); say.form.requestSubmit(); } });
  };
  const confirmKeywords = { '计费与金额': /计费|金额|账单|价格/, '权限与登录': /权限|登录|鉴权/, '数据库表结构': /表结构|加字段|新表|迁移/, 'ClickHouse 表结构': /ClickHouse 表|表结构/, 'Kafka 消息结构': /消息结构|protobuf/ };
  const routerReply = text => {
    const t = now();
    const rest = PROJECTS.reduce((x, p) => [p.name, ...p.aliases].reduce((y, a) => y.split(a).join(''), x), text).replace(/[\s，。,.!！?？~、]/g, '');
    if (/^(你好|您好|hi|hello|hey|在吗|在不在|谢谢|多谢|好的|ok|嗯|收到)*$/i.test(rest) || rest.length < 3) {
      const named = PROJECTS.find(p => text.toLowerCase().includes(p.name.toLowerCase()) || p.aliases.some(a => text.includes(a)));
      return { who: 'router', t, text: `${/谢/.test(text) ? '不客气。' : '你好。'}${named ? `要对 ${named.name} 做什么？` : '要做点什么？'}说一下要改哪个项目的什么，例如“OrcaDub 字幕加一个导出 SRT”，或者问“现在进度怎么样”。这句不开任务。` };
    }
    if (/进度|怎么样|状态/.test(text)) {
      const by = k => TICKETS.filter(x => x.kind === k).map(x => x.id);
      const parts = [['在等你', [...by('you')]], ['进行中', by('run')], ['在等外部结果', by('wait')], ['失败等重试', by('fail')]].filter(p => p[1].length).map(p => `${p[1].join('、')} ${p[0]}`);
      return { who: 'router', t, text: `直接回答，不开任务：${parts.join('；')}。` };
    }
    const m = text.match(/T-\d{3}/i);
    if (m) {
      const id = m[0].toUpperCase(), tk = T(id);
      if (!tk) return { who: 'router', t, text: `没有找到 ${id}，你说的是哪个任务？` };
      if (!isOpen(tk)) return { who: 'router', t, text: `${id} 已经结束了。要基于它开一个新任务吗？说一下具体要改什么。` };
      tk.timeline.push({ t, kind: 'report', what: `收到追问：${text.slice(0, 30)}`, d: '来自对话，Router 发给本任务' });
      ROUTING.unshift({ id: `R-${Math.max(...ROUTING.map(r => +r.id.slice(2))) + 1}`, t, msg: text, src: '对话', decision: '发给已有任务', ticket: id, project: tk.project, conf: '高', why: '消息里写了任务编号' });
      return { who: 'router', t, text: `已发给 ${id} 的 Worker，它会在当前会话里处理。`, link: id };
    }
    const named = PROJECTS.filter(p => text.toLowerCase().includes(p.name.toLowerCase()));
    const hits = named.length === 1 ? named : PROJECTS.filter(p => p.aliases.some(a => text.toLowerCase().includes(a.toLowerCase())));
    if (hits.length === 1) {
      const p = hits[0], alias = p.aliases.find(a => text.toLowerCase().includes(a.toLowerCase()));
      const need = p.confirm.find(c => confirmKeywords[c]?.test(text));
      const ov = overlapOf(p.id, text);
      return { who: 'router', t, text: '这是一个新需求，我整理了需求单草稿：', draft: { project: p.id, conf: '高', why: named.length === 1 ? `消息里直接写了项目名 ${p.name}` : `命中 ${p.name} 的别名“${alias}”`, goal: text.slice(0, 60), needConfirm: need, overlap: ov && ov.with }, src: text };
    }
    const cands = hits.length > 1 ? hits : PROJECTS;
    return { who: 'router', t, text: hits.length > 1 ? `这句话同时命中 ${hits.map(h => h.name).join('、')}，是哪一个？` : '这句话我判断不出属于哪个项目，选一个：', opts: cands.map(c => c.name), src: text };
  };
  const sandboxFor = (plan, pid) => { const pr = providerFor(pid, plan.form); return { provider: pr.id, providerWhy: pr.why, hours: 0, ...sandboxBody(plan, pid, pr) }; };
  const sandboxBody = (plan, pid, pr) => ({ form: plan.form, env: plan.v, host: isCloud(pr.id) ? provName(pr.id) : placeHost(pid, plan.v), state: 'running', vms: plan.form === 'VM 组' ? plan.services.map(x => [x.svc, x.src, x.svc === 'app' ? SETTINGS.sandbox.app : SETTINGS.sandbox.svc]) : [['app', `${plan.services.map(x => x.svc === 'app' ? x.src.replace('PR 代码：', '') : x.svc).join('、')}、Worker、Chromium`, SETTINGS.sandbox.app]] });
  const titleOf = (goal, pid) => { let x = goal; x = x.replace(new RegExp(`^${P(pid).name}\\s*的?`, 'i'), ''); x = x.replace(/^[，。\s]+/, ''); return x.length > 16 ? `${x.slice(0, 15)}…` : x; };
  const modOf = x => x.mod || x.overlap?.mod || P(x.project).modules.find(m => `${x.title}${x.mandate?.goal || ''}${(x.mandate?.scope || []).join('')}`.includes(m));
  const overlapOf = (pid, text) => { const mod = P(pid).modules.find(m => text.includes(m)); const o = mod && TICKETS.find(x => x.project === pid && isOpen(x) && modOf(x) === mod); return o ? { with: o.id, mod, files: `${MOD_PATH[mod] || 'core'}/` } : null; };
  const createTicket = (pid, goal, srcText, needConfirm, via = '对话') => {
    const id = nextTicketId(), t = now(), plan = currentPlan(pid), ov = overlapOf(pid, `${goal}${srcText}`);
    const tk = {
      id, title: titleOf(goal, pid), repo: pickRepo(pid, goal), project: pid, kind: needConfirm ? 'you' : 'run', created: t, day: 'today', updated: t, since: t,
      source: { via, text: srcText }, state: needConfirm ? '需求单等你确认' : '从模板快照恢复沙箱', why: needConfirm ? `涉及${needConfirm}，按项目规则要审批角色确认` : `环境计划 ${plan.v}`,
      action: needConfirm ? { label: '确认需求单', tab: 'mandate' } : null,
      mandate: { goal, scope: ['Worker 读完代码后补充'], not: [], accept: ['Worker 读完代码后补充，改动前会更新这里'], assume: [], open: needConfirm ? '范围和验收标准是否需要补充？' : null, needConfirm, confirmedBy: needConfirm ? null : '无需确认' },
      contract: [['构建、lint、单元测试'], ['全量 E2E 通过'], ['审查无已证实的 P0 或 P1'], ['测试未删除、未新增 skip'], ['需人确认的事项已确认']].map(([x], i) => ({ t: x, r: i === 4 && !needConfirm ? 'pass' : 'wait', s: i === 4 && !needConfirm ? '本任务没有' : '还没有提交' })),
      timeline: [{ t, kind: 'report', what: 'Router 新开任务', d: `来自${via}` }, ...(needConfirm ? [{ t, kind: 'flag', what: '需求单等你确认', d: `涉及${needConfirm}，Worker 先不开工` }] : [{ t, kind: 'box', what: '从模板快照恢复沙箱', d: `环境计划 ${plan.v}`, live: true }])],
      review: null, e2e: null, sandbox: needConfirm ? null : sandboxFor(plan, pid), cost: 0, by: ME, overlap: ov, mod: ov?.mod,
    };
    if (ov) tk.timeline.splice(1, 0, { t, kind: 'report', what: `和 ${ov.with} 改动范围重叠`, d: `两边都会改 ${ov.files}${needConfirm ? '，确认需求单时选并行、排在后面或并入' : '，默认并行，合并前自动变基'}` });
    if (queue().length >= limitOf(ME)) Object.assign(tk, { kind: 'wait', state: '排队中', why: `你的待处理到了上限 ${limitOf(ME)} 件，处理掉几件后自动开工`, sandbox: null, queued: { why: 'limit', who: ME, at: t }, action: null });
    else if (!needConfirm && TICKETS.filter(x => x.kind === 'run').length >= SETTINGS.workers) Object.assign(tk, { kind: 'wait', state: '排队中', why: `Worker 槽位满了（${SETTINGS.workers} 个），空出来按优先级和项目权重开工`, sandbox: null, queued: { why: 'slots', at: t } });
    TICKETS.unshift(tk);
    if (needConfirm) notify('mandate', `${id} ${tk.title}：需求单等你确认`, link.ticket(id, 'mandate'));
    ROUTING.unshift({ id: `R-${Math.max(...ROUTING.map(r => +r.id.slice(2))) + 1}`, t, msg: srcText, src: via, decision: '新开任务', ticket: id, project: pid, conf: '高', why: `命中 ${pname(pid)} 的别名` });
    return id;
  };

  /* ---------- routing ---------- */
  const pageRouting = () => {
    crumbs([['路由记录']]);
    main.innerHTML = `
      <div class="page-head"><div><h1>路由记录</h1><p>Router 每一次判断的依据。归错了项目，可以直接移过去；判断不对就标出来，会算进 <a href="#quality">质量</a>。没登记的发送人只会得到直接回答，不会开任务。</p></div>${demo === 'full' ? `<button class="btn btn--line" type="button" data-act="replay-all">用提示词 ${SETTINGS.routerPrompt.draft} 重放今天的 ${ROUTING.length} 条</button>` : ''}</div>
      ${replayAll && demo === 'full' ? `<section class="well stack-sm" role="status" aria-labelledby="ra-h"><h2 id="ra-h">提示词 ${esc(replayAll.prompt)} 的重放结果</h2><p class="ink">${replayAll.n} 条里 ${replayAll.n - replayAll.diff.length} 条和当时一致${replayAll.diff.length ? `，${replayAll.diff.length} 条不同：${replayAll.diff.map(id => cbtn(`#route-${id}`, `<span class="mono">${id}</span>`)).join(' ')}` : ''}。</p><p class="note">每条用当时存下的输入重放，模型 ${esc(SETTINGS.stages.router.model)} 不变；不同的那几条点开看字段差异。上线新提示词前，这一步也会在评测集上跑一遍。</p></section>` : ''}
      <section class="region" aria-label="路由记录">
      ${region({ what: '路由记录', emptyTitle: '还没有路由记录', emptyText: '你在对话、飞书或 GitHub 里发出的每条需求都会记录在这里。', rows: 8 }, () => table('', [{ t: '时间' }, { t: '消息' }, { t: '判断' }, { t: '项目' }, { t: '可信度' }, { t: '依据' }, { t: '<span class="visually-hidden">操作</span>' }], ROUTING.map((r, i) => {
        const tk = r.ticket && T(r.ticket), movable = tk && isOpen(tk) && r.decision.includes('新开');
        const fb = r.visitor ? (MEMBERS.some(m => m.name === r.visitor) ? '<span class="note">已登记为成员</span>' : `<button class="btn btn--text" type="button" data-act="visitor-add" data-i="${i}">登记为成员</button>`) : r.fb ? '<span class="note">你标了判断有误</span>' : `<button class="btn btn--text" type="button" data-act="route-fb" data-i="${i}">判断有误</button>`;
        return `<tr>${td('时间', r.t, 1)}${td('消息', `<span class="ink">${esc(r.msg)}</span><span class="sub">${esc(r.src)}${r.visitor ? `，发送人 ${esc(r.visitor)}（${MEMBERS.some(m => m.name === r.visitor) ? '当时未登记' : '未登记'}）` : ''}</span>`)}
          ${td('判断', `${esc(r.decision)}${r.ticket ? `<span class="sub">${cbtn(link.ticket(r.ticket), `<span class="mono">${r.ticket}</span>`)}</span>` : ''}`)}
          ${td('项目', r.project ? pLink(r.project) : '无')}${td('可信度', r.conf)}${td('依据', esc(r.why))}
          ${td('', `<div class="actions"><a class="btn btn--text" href="#route-${r.id}">重放</a>${movable ? selectWrap(`<select class="select" aria-label="把 ${r.ticket} 移到其他项目" data-act="move" data-i="${i}">${PROJECTS.map(p => `<option value="${p.id}"${p.id === r.project ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`) : ''}${fb}</div>`)}</tr>`;
      })))}
      </section>`;
  };

  /* ---------- projects ---------- */
  const pageProjects = () => {
    crumbs([['项目']]);
    main.innerHTML = `
      <div class="page-head"><div><h1>项目</h1><p>每个项目有自己的项目卡、规范、记忆和环境计划。Router 靠别名和渠道判断需求属于哪个项目。</p></div><button class="btn btn--line" type="button" data-act="add-project" aria-expanded="false" aria-controls="add-form">接入新项目</button></div>
      <form class="well stack-md" id="add-form" hidden data-form="project" data-endpoint="/api/projects">
        <h2>接入新项目</h2>
        <div class="field"><label for="repo">仓库地址</label><input class="input" id="repo" name="repo" type="url" inputmode="url" placeholder="https://github.com/org/repo" autocomplete="off" required aria-required="true" aria-describedby="repo-help"><span class="help" id="repo-help">扫描仓库后，生成项目卡、AGENTS.md 和环境计划的初稿，在总览里请你确认。</span></div>
        <div class="actions actions--start"><button class="btn" type="submit">开始扫描</button><button class="btn btn--line" type="button" data-act="add-project">取消</button></div>
      </form>
      ${ONBOARD.map(o => o.state === 'scanning' ? `<div class="well stack-sm" role="status"><h2>正在接入 ${esc(o.name)}</h2><p class="ink-2">${esc(o.repo)}：Env Planner 在读 CI 配置、compose 和代码依赖，并在沙箱里试跑环境。完成后会出现在总览里请你确认。</p></div>` : `
      <section class="well stack-md" aria-labelledby="onb-${o.id}">
        <h2 id="onb-${o.id}">接入 ${esc(o.name)}：初稿等你确认</h2>
        <div class="two"><dl class="facts"><dt>仓库</dt><dd>${esc(o.repo)}</dd><dt>识别结果</dt><dd>${esc(o.lang)}，${esc(o.found)}</dd><dt>别名</dt><dd>${esc(o.name)}<span class="sub">确认后可以在项目卡里补充</span></dd><dt>渠道</dt><dd>GitHub：${esc(o.slug)}</dd><dt>需你确认</dt><dd>数据库表结构<span class="sub">默认规则，确认后可改</span></dd></dl>
        <dl class="facts"><dt>AGENTS.md</dt><dd>初稿 3 节：架构、约定、命令<span class="sub">确认后以 PR 提交到仓库</span></dd><dt>环境计划 v1</dt><dd>单 VM：app、mysql<span class="sub">健康检查和冒烟用例一次跑通</span></dd></dl></div>
        <div class="actions actions--start"><button class="btn" type="button" data-act="onb-confirm" data-id="${o.id}">确认接入</button><button class="btn btn--line" type="button" data-act="onb-drop" data-id="${o.id}">放弃</button></div>
      </section>`).join('')}
      <section class="region" aria-label="项目列表">
      ${region({ what: '项目列表', emptyTitle: '还没有接入项目', emptyText: '接入一个仓库后，Router 才能把需求路由过去。', emptyAction: '<button class="btn btn--line" type="button" data-act="add-project">接入第一个项目</button>', rows: 6 }, () => table('', [{ t: '项目' }, { t: '仓库' }, { t: '未结束任务' }, { t: '记忆' }, { t: '环境计划' }], PROJECTS.map(p => {
        const cur = currentPlan(p.id), pend = plans(p.id).find(x => x.state === 'pending');
        return `<tr data-href="${link.project(p.id)}">${td('', `<a class="title" href="${link.project(p.id)}">${esc(p.name)}</a><span class="sub">${esc(p.summary)}</span>`)}${td('仓库', p.repos.map(r => `${esc(r[0])}（${r[1]}）`).join('<br>'))}
          ${td('未结束任务', countBtn(link.project(p.id, 'tickets'), TICKETS.filter(t => t.project === p.id && isOpen(t)).length, '个'))}${td('记忆', countBtn(link.project(p.id, 'memory'), p.memory.length, '条'))}
          ${td('环境计划', `<div class="cbtns">${cbtn(link.plan(p.id, cur.v), `<span class="mono">${cur.v}</span> ${esc(cur.form)}`)}${pend ? cbtn(link.plan(p.id, pend.v), `<span class="mono">${pend.v}</span> 等你确认`, 'accent') : ''}</div>`)}</tr>`;
      })))}
      </section>`;
  };

  const pageProject = (pid, params) => {
    const p = P(pid);
    if (!p) { crumbs([['项目', '#projects'], [pid]]); main.innerHTML = empty('找不到这个项目', '它可能还没接入。', '<a class="btn btn--line" href="#projects">回到项目</a>'); return; }
    const tab = params.get('tab') || 'card';
    crumbs([['项目', '#projects'], [p.name]]);
    const cur = currentPlan(pid), pend = plans(pid).find(x => x.state === 'pending');
    const pts = TICKETS.filter(t => t.project === pid);
    const props = MEMORY_PROPOSALS.filter(m => m.project === pid);
    main.innerHTML = `
      <div class="page-head"><div><h1>${esc(p.name)}</h1><p>${esc(p.summary)}。${p.onboarded} 接入。</p></div></div>
      ${tabs([['card', '项目卡'], ['rules', '规范'], ['memory', '记忆', p.memory.length], ['env', '环境计划', pend ? '待确认' : cur.v], ['tickets', '任务', pts.filter(isOpen).length]].map(([k, l, n]) => [link.project(pid, k), l, k, n]), tab, `${p.name} 的内容`)}
      <section class="region">${region({ what: '项目', emptyTitle: '这里还没有内容', emptyText: '接入完成后会自动生成。', rows: 6 }, () => projectTab(p, tab, { cur, pend, pts, props }))}</section>`;
  };
  const projectTab = (p, tab, { cur, pend, pts, props }) => {
    if (tab === 'card' && editingCard === p.id) {
      const opts = [...new Set(['计费与金额', '权限与登录', '数据库表结构', 'ClickHouse 表结构', 'Kafka 消息结构', '新增外部依赖', ...p.confirm])];
      return `<form class="stack-md form-narrow" data-form="card" data-pid="${p.id}" data-endpoint="/api/projects/${p.id}">
        <div class="field"><label for="c-alias">别名，用顿号或逗号分隔</label><input class="input" id="c-alias" name="aliases" value="${esc(p.aliases.join('、'))}" autocomplete="off" aria-describedby="c-alias-help"><span class="help" id="c-alias-help">Router 在消息里看到这些词，会考虑这个项目。和别的项目重名时会先问你。</span></div>
        <div class="field"><label for="c-ch">渠道，每行一个</label><textarea class="textarea" id="c-ch" name="channels" rows="3">${esc(p.channels.join('\n'))}</textarea><span class="help">从这些渠道来的消息直接归到这个项目。</span></div>
        <div class="field"><label for="c-prov">沙箱提供方</label><span class="select-wrap select-wrap--block"><select class="select" id="c-prov" name="provider">${[['inherit', '跟随默认'], ...CFG.providers.map(x => [x.id, x.name])].map(([v, l]) => `<option value="${v}"${v === p.provider ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${I.down}</span><label class="check"><input type="checkbox" name="internalOnly"${p.internalOnly ? ' checked' : ''}>沙箱只用自建（不用云沙箱）</label></div>
        <fieldset class="checks"><legend class="note">需求涉及这些时，需求单必须由审批角色确认</legend>${opts.map(o => `<label class="check"><input type="checkbox" name="confirm" value="${esc(o)}"${p.confirm.includes(o) ? ' checked' : ''}>${esc(o)}</label>`).join('')}</fieldset>
        <div class="actions actions--start"><button class="btn" type="submit">保存项目卡</button><button class="btn btn--line" type="button" data-act="card-cancel">取消</button></div>
      </form>`;
    }
    if (tab === 'card') return `<div class="region-head"><span></span><button class="btn btn--line" type="button" data-act="card-edit" data-pid="${p.id}">编辑项目卡</button></div><div class="two"><dl class="facts">
        <dt>仓库</dt><dd><div class="tags">${p.repos.map(r => `<span class="tag"><span class="mono">${esc(r[0])}</span>${esc(r[1])}</span>`).join('')}</div></dd>
        <dt>模块</dt><dd><div class="tags">${p.modules.map(m => `<span class="tag">${esc(m)}</span>`).join('')}</div></dd>
        <dt>别名</dt><dd><div class="tags">${p.aliases.map(a => `<span class="tag">${esc(a)}</span>`).join('')}</div><span class="sub">消息里出现这些词，Router 会考虑这个项目</span></dd>
        <dt>渠道</dt><dd><div class="tags">${p.channels.map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div><span class="sub">从这些渠道来的消息直接归到这个项目</span></dd>
        <dt>需你确认</dt><dd><div class="tags">${p.confirm.map(c => `<span class="tag tag--warm">${esc(c)}</span>`).join('')}</div><span class="sub">需求涉及这些时，需求单必须由审批角色确认</span></dd>
        <dt>审批角色</dt><dd><div class="tags">${ownersFor(p.id, '审批').map(m => `<span class="tag"><i class="avatar" aria-hidden="true">${esc(who(m).slice(0, 1))}</i>${esc(who(m))}</span>`).join('')}</div><span class="sub">在 <a href="#members">成员与权限</a> 里改</span></dd>
        <dt>沙箱</dt><dd>${p.provider === 'inherit' ? `跟随默认（${esc(provName(SETTINGS.sandbox.provider))}）` : esc(provName(p.provider))}${p.internalOnly ? '，沙箱只用自建' : ''}<span class="sub">实际会用：${esc(provName(providerFor(p.id, cur.form).id))}，${esc(providerFor(p.id, cur.form).why)}</span></dd>
      </dl>
      <div class="stack-md">
        <div class="well stack-sm"><h3>环境计划</h3><div class="cbtns">${cbtn(link.plan(p.id, cur.v), `<span class="mono">${cur.v}</span> 使用中`)}${pend ? cbtn(link.plan(p.id, pend.v), `<span class="mono">${pend.v}</span> 等你确认`, 'accent') : ''}</div><p class="ink-2">${esc(cur.form)}，${cur.services.length} 个服务：${cur.services.map(x => x.svc).join('、')}</p>${pend ? `<p class="note">${esc(pend.v)}：${esc(pend.note)}</p>` : ''}</div>
        ${p.index ? `<div class="well stack-sm"><h3>代码索引</h3><div class="tags"><span class="tag"><span class="mono">main@${p.index.commit}</span></span><span class="tag${p.index.behind ? ' tag--warm' : ' tag--ok'}">${p.index.behind ? `落后 ${p.index.behind} 个提交` : `${I.check}最新`}</span><span class="tag">${esc(p.index.built)} 建</span></div><p class="ink-2">访问关系：规则抽到 ${p.index.edges[0]} 条，链路里见过 ${p.index.edges[1]} 条，模型推断 ${p.index.edges[2]} 条。</p><p class="note">预判会改哪些模块的精确率 ${p.index.precision}%，召回率 ${p.index.recall}%。路由、重叠预判、架构图的“改动前”都靠它。</p></div>` : ''}
        <div class="well stack-sm"><h3>记忆</h3><div class="cbtns">${countBtn(link.project(p.id, 'memory'), p.memory.length, '条记忆')}${props.length ? cbtn('#memory', `<span class="mono">${props.length}</span> 条提议待审核`, 'accent') : ''}</div><p class="ink-2">Router 和 Worker 启动时都会读到。</p></div>
      </div></div>`;
    if (tab === 'rules') return `<p class="ink-2">来自仓库里的 <code>${esc(p.agents.source)}</code>，${esc(p.agents.version)}。Worker 启动时加载；要修改，在仓库里改这个文件并合并。</p>
      <div class="rules">${p.agents.sections.map(([h, items]) => `<section class="rules__card${h === '禁止' ? ' rules__card--no' : ''}"><h3>${esc(h)}</h3>${h === '命令' ? `<ul class="cmds">${items.map(x => `<li><code>${esc(x)}</code></li>`).join('')}</ul>` : `<ul class="spec__list ${h === '禁止' ? 'spec__list--no' : 'spec__list--in'}">${items.map(x => `<li>${h === '禁止' ? I.x : I.check}<span>${esc(x)}</span></li>`).join('')}</ul>`}</section>`).join('')}</div>
      <p class="note">规范写的是团队定下的约定；记忆记的是任务里学到、代码里看不出来的事。两者重复时，以规范为准。</p>`;
    if (tab === 'memory') return `
      ${props.length ? `<div class="well stack-sm"><p>${props.length} 条提议等你审核，采纳后会出现在下面。</p><div><a class="btn btn--line" href="#memory">去审核</a></div></div>` : ''}
      <p class="ink-2">这些是 ${esc(p.name)} 的项目记忆，Router 判断需求、Worker 开工时都会读到。</p>
      ${p.memory.length ? `<div>${p.memory.map(m => `<article class="proposal" id="mem-${m.id}">
          <div class="stack-sm"><blockquote>${esc(m.text)}</blockquote></div>
          <div class="actions"><button class="btn btn--text" type="button" data-act="mem-edit" data-pid="${p.id}" data-id="${m.id}">编辑</button><button class="btn btn--text" type="button" data-act="mem-delete" data-pid="${p.id}" data-id="${m.id}">删除</button></div>
          <p class="from">${m.id}，来自 ${/^T-/.test(m.from) ? `<a href="${link.ticket(m.from)}">${m.from}</a>` : esc(m.from)}，${esc(m.by)}在 ${esc(m.date)} 采纳，已被读取 ${m.reads} 次</p>
        </article>`).join('')}</div>` : empty('还没有记忆', '任务结束时，Worker 会把代码里看不出来的约定提议写进来，你审核后生效。')}`;
    if (tab === 'env') {
      const all = plans(p.id).slice().reverse();
      return `<p class="ink-2">规则：新增服务、新增外部依赖或改动 mock 时，要你确认；只改系统包、版本或启动参数时自动应用，并在触发它的任务里注明。</p>
        ${table('', [{ t: '版本' }, { t: '状态' }, { t: '形态' }, { t: '日期' }, { t: '触发' }, { t: '变更' }, { t: '方式' }], all.map(x => `<tr data-href="${link.plan(p.id, x.v)}">${td('', `<a class="title" href="${link.plan(p.id, x.v)}">${x.v}</a>`)}${td('状态', x.state === 'pending' ? `<span class="state state--you">${planState(x)}</span>` : planState(x))}${td('形态', esc(x.form))}${td('日期', esc(x.date))}${td('触发', /^T-/.test(x.trigger) ? cbtn(link.ticket(x.trigger), `<span class="mono">${x.trigger}</span>`) : esc(x.trigger))}${td('变更', esc(x.changes.length ? x.changes.join('；') : x.note))}${td('方式', esc(x.how))}</tr>`))}`;
    }
    if (tab === 'tickets') return pts.length ? table('', [{ t: '任务' }, { t: '状态' }, { t: '完成条件', num: 1 }, { t: '更新', num: 1 }], pts.map(t => `<tr data-href="${link.ticket(t.id)}">${td('', `<a class="title" href="${link.ticket(t.id)}">${t.id} ${esc(t.title)}</a>`)}${td('状态', `${stateWord(t.kind)}<span class="sub">${esc(t.state)}</span>`)}${td('完成条件', t.contract ? `${passCount(t.contract)} / 5` : '不适用', 1)}${td('更新', esc(t.updated), 1)}</tr>`)) : empty('这个项目还没有任务', '在对话里提到它的别名，Router 就会把需求路由过来。', '<a class="btn btn--line" href="#chat">去对话</a>');
    return '';
  };

  /* ---------- env ---------- */
  const pageEnv = () => {
    crumbs([['环境计划']]);
    main.innerHTML = `
      <div class="page-head"><div><h1>环境计划</h1><p>每个项目各有一份，按版本演进。Env Planner 生成并在沙箱里跑通；新增服务、外部依赖或 mock 时要你确认，其余改动自动应用。</p></div></div>
      <section class="region" aria-label="各项目的环境计划">
      ${region({ what: '环境计划', emptyTitle: '还没有环境计划', emptyText: '接入项目时，Env Planner 会生成第一版。', emptyAction: '<a class="btn btn--line" href="#projects">接入项目</a>', rows: 6 }, () => table('', [{ t: '项目' }, { t: '使用中' }, { t: '形态' }, { t: '服务', num: 1 }, { t: '最近变更' }, { t: '等你确认' }], PROJECTS.map(p => {
        const cur = currentPlan(p.id), last = plans(p.id).at(-1), pend = plans(p.id).find(x => x.state === 'pending');
        return `<tr data-href="${link.plan(p.id, (pend || cur).v)}">${td('', `<a class="title" href="${link.project(p.id, 'env')}">${esc(p.name)}</a>`)}${td('使用中', cbtn(link.plan(p.id, cur.v), `<span class="mono">${cur.v}</span>`))}${td('形态', esc(cur.form))}${td('服务', cur.services.length, 1)}${td('最近变更', `${esc(last.date)}<span class="sub">${esc(last.v)}：${esc(last.note)}（${esc(last.how)}）</span>`)}${td('等你确认', pend ? (pend.rejected ? `${pend.v} 已打回，修改中` : cbtn(link.plan(p.id, pend.v), `确认 <span class="mono">${pend.v}</span>`, 'accent')) : '无')}</tr>`;
      })))}
      </section>`;
  };

  const diagram = (plan, pid) => {
    const W = { 0: [24, 168], 1: [272, 200], 2: [552, 184] }, H = 40, gap = 56;
    const pos = s => ({ x: W[s.col][0], w: W[s.col][1], y: 24 + s.row * gap });
    const rows = Math.max(...plan.services.map(s => s.row)) + 1;
    const vh = 24 + (rows - 1) * gap + H + 24;
    const edges = [];
    plan.services.forEach(s => s.deps.forEach(d => { const t = plan.services.find(x => x.svc === d); if (t) edges.push([s, t]); }));
    const paths = edges.map(([a, b], k) => {
      const A = pos(a), B = pos(b), ay = A.y + H / 2, by = B.y + H / 2;
      if (a.col < b.col) { const x1 = A.x + A.w, x2 = B.x, mx = x1 + (x2 - x1) * 0.5; return `<path class="edge" d="M${x1} ${ay}H${mx}V${by}H${x2}" marker-end="url(#ea-${pid})"/>`; }
      const x1 = A.x, x2 = B.x + B.w, mx = x2 + (x1 - x2) * (0.3 + 0.2 * (k % 3)); return `<path class="edge" d="M${x1} ${ay}H${mx}V${by}H${x2}" marker-end="url(#ea-${pid})"/>`;
    }).join('');
    const boxes = plan.services.map(s => { const o = pos(s); return `<g><rect class="box${s.svc === 'app' ? ' box--app' : ''}${s.change ? ' box--new' : ''}${s.mock ? ' box--mock' : ''}" x="${o.x}" y="${o.y}" width="${o.w}" height="${H}" rx="4"/><text x="${o.x + 16}" y="${o.y + 25}">${esc(s.svc)}</text>${s.change ? `<text class="q" x="${o.x + o.w - 12}" y="${o.y + 25}" text-anchor="end">${esc(s.change === '新增' ? '新增' : '改动')}</text>` : s.mock ? `<text class="q" x="${o.x + o.w - 12}" y="${o.y + 25}" text-anchor="end">mock</text>` : ''}</g>`; }).join('');
    const label = `${pname(pid)} 环境计划 ${plan.v} 的服务关系图：${edges.map(([a, b]) => `${a.svc} 依赖 ${b.svc}`).join('，')}`;
    return `<svg class="diagram" viewBox="0 0 760 ${vh}" role="img" aria-label="${esc(label)}"><defs><marker id="ea-${pid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="head" d="M0 0L10 5L0 10z"/></marker></defs>${paths}${boxes}</svg>`;
  };
  const usersOf = (pid, v) => [
    ...TICKETS.filter(t => t.project === pid && t.sandbox?.env === v).map(t => `<a href="${link.ticket(t.id)}">${t.id}</a>（${t.sandbox.state === 'running' ? '运行中' : '已暂停'}）`),
    ...BASELINES.filter(b => b.project === pid && b.env === v).map(() => 'main 基线环境'),
  ];
  const pageEnvPlan = (pid, v) => {
    const p = P(pid), list = plans(pid), idx = list.findIndex(x => x.v === v), plan = list[idx];
    if (!p || !plan) { crumbs([['环境计划', '#env'], ['找不到']]); main.innerHTML = empty('找不到这个环境计划', '版本号可能写错了。', '<a class="btn btn--line" href="#env">回到环境计划</a>'); return; }
    crumbs([['项目', '#projects'], [p.name, link.project(pid)], [`环境计划 ${v}`]]);
    const prev = list[idx - 1];
    const diffOf = s => { if (!prev) return '首版'; const o = prev.services.find(x => x.svc === s.svc); if (!o) return '新增'; const add = s.deps.filter(d => !o.deps.includes(d)), del = o.deps.filter(d => !s.deps.includes(d)); return add.length || del.length ? [add.length ? `新增依赖 ${add.join('、')}` : '', del.length ? `去掉依赖 ${del.join('、')}` : ''].filter(Boolean).join('，') : '不变'; };
    const removed = prev ? prev.services.filter(o => !plan.services.find(s => s.svc === o.svc)) : [];
    const users = usersOf(pid, v);
    const head = { frozen: `使用中。${users.length ? `正在用它的：${users.join('、')}。` : ''}`, pending: plan.rejected ? `你打回了：${plan.rejected}。Env Planner 正在修改，改完会再请你确认；在那之前沙箱继续用 ${currentPlan(pid).v}。` : `等你确认：${plan.reason}${plan.revised ? '（已按你的意见改过）' : ''}。确认前，沙箱继续用 ${currentPlan(pid).v}。`, superseded: `已被 ${list[idx + 1]?.v || '新版本'} 取代，只读。` }[plan.state];
    main.innerHTML = `
      <div class="page-head"><div><h1>${esc(p.name)}的环境计划 ${v}</h1><p>${esc(plan.note)}。${esc(plan.date)}，由 ${/^T-/.test(plan.trigger) ? `<a href="${link.ticket(plan.trigger)}">${plan.trigger}</a>` : esc(plan.trigger)} 触发，${esc(plan.how)}。</p></div></div>
      ${tabs(list.map(x => [link.plan(pid, x.v), x.state === 'pending' ? `${x.v} 待确认` : x.v, x.v]), v, '版本')}
      <div class="ticket-state" role="status"><div>${plan.state === 'pending' && plan.rejected ? `<span class="state state--wait">${I.clock}修改中</span>` : plan.state === 'pending' ? stateWord('you') : plan.state === 'frozen' ? `<span class="state state--ok">${I.check}使用中</span>` : `<span class="state state--wait">${I.clock}已被取代</span>`}<p>${head}</p></div>${plan.state === 'pending' && !plan.rejected ? `<div class="actions"><button class="btn" type="button" data-act="env-quick" data-v="${v}">确认并冻结 ${v}</button><button class="btn btn--line" type="button" data-act="env-reject-jump">打回</button></div>` : ''}</div>
      ${region({ what: '环境计划', emptyTitle: '计划内容为空', emptyText: 'Env Planner 还没生成。', rows: 10 }, () => `
      <section class="region" aria-labelledby="g-h"><h2 id="g-h">服务关系</h2><div class="ticks diagram-wrap">${diagram(plan, pid)}</div><ul class="dep-list">${plan.services.map(x => `<li><code>${x.svc}</code>${x.deps.length ? ` 依赖 ${x.deps.join('、')}` : '，无依赖'}${x.change ? `<span class="attn">，${esc(x.change)}</span>` : ''}${x.mock ? '，mock' : ''}</li>`).join('')}</ul><p class="note">${esc(plan.form)}${plan.form === 'VM 组' ? '：每个服务一个 microVM，同一任务的 VM 在一个专用网段里，按服务名互相访问。' : '：所有服务作为进程跑在同一个 microVM 里。'}</p></section>
      <section class="region" aria-labelledby="s-h"><h2 id="s-h">服务</h2>
        ${table('', [{ t: '服务' }, { t: '来源' }, { t: '端口', num: 1 }, { t: '依赖' }, { t: '健康检查' }, { t: prev ? `相对 ${prev.v}` : '变化' }], plan.services.map(s => { const d = diffOf(s); return `<tr>${td('服务', `<code>${s.svc}</code>`)}${td('来源', esc(s.src))}${td('端口', s.port, 1)}${td('依赖', esc(s.deps.join('、')) || '无')}${td('健康检查', `<code>${esc(s.health)}</code>`)}${td(prev ? `相对 ${prev.v}` : '变化', d === '不变' || d === '首版' ? d : `<span class="state state--you">${esc(d)}</span>`)}</tr>`; }))}
        ${removed.length ? `<p class="note">相对 ${prev.v} 移除：${removed.map(r => r.svc).join('、')}</p>` : ''}
        ${plan.changes.length ? `<p class="note">这一版的变更：${plan.changes.map(esc).join('；')}</p>` : ''}
      </section>
      <section class="region" aria-labelledby="tp-h"><div class="region-head"><h2 id="tp-h">模板</h2><a class="note" href="#sandboxes-templates">全部模板</a></div>
        ${(() => { const tp = templates().find(x => x.id === tplId(pid, v)); if (!tp) return `<p class="ink-2">${v} 的模板已清理。需要时可以按这份计划重建。</p>`; return `<p class="ink-2"><code>${tp.id}</code>：${esc(tp.status)}。内存快照约 ${tp.snapGB}G，${tp.hosts.length ? `已分发到 ${tp.hosts.join('、')}` : '还没有分发到宿主机'}。</p>
          ${table('', [{ t: 'VM' }, { t: '镜像层（自下而上）' }, { t: '规格', num: 1 }], tp.vms.map(m => `<tr>${td('VM', `<code>${m.name}</code>`)}${td('镜像层（自下而上）', m.layers.map(esc).join('<br>'))}${td('规格', m.spec, 1)}</tr>`))}`; })()}
      </section>
      <div class="two">
        <section class="region" aria-labelledby="a-h"><h2 id="a-h">跑通过程</h2>${plan.attempts ? `<ol class="attempts">${plan.attempts.map(a => `<li><span>${a[0]}</span><span>${esc(a[1])}</span></li>`).join('')}</ol>` : '<p class="ink-2">一次跑通：健康检查和冒烟用例全部通过。</p>'}</section>
        <section class="region" aria-labelledby="m-h"><h2 id="m-h">替身与假设</h2><dl class="facts">${plan.mocks.map(m => `<dt>${esc(m[0])}</dt><dd>${esc(m[1])}</dd>`).join('')}</dl>${plan.assumptions ? `<ul class="plain-list ink-2">${plan.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}</section>
      </div>
      ${plan.state === 'pending' && !plan.rejected ? `<form class="well stack-md" data-form="env" data-pid="${pid}" data-v="${v}" data-endpoint="/api/env-plans/${pid}/${v}/confirm">
        <h2>确认 ${v}</h2>
        ${plan.question ? `<div class="field"><label for="env-q">${esc(plan.question)}</label><input class="input" id="env-q" name="answer" placeholder="例如：noeviction" autocomplete="off"><span class="help">留空就按 allkeys-lru。</span></div>` : ''}
        <div class="field"><label for="env-r">打回原因（打回时必填）</label><textarea class="textarea" id="env-r" name="reason" rows="2" placeholder="例如：Redis 用现成的共享实例，不要新起服务" aria-describedby="env-r-help"></textarea><span class="help" id="env-r-help">Env Planner 会按原因改计划、重新跑通，再请你确认。</span></div>
        <p class="ink-2">确认后冻结 ${v}，重建模板快照；${plan.trigger} 和 main 基线环境会切到 ${v}。</p>
        <div class="actions actions--start"><button class="btn" type="submit" name="decision" value="confirm">确认并冻结 ${v}</button><button class="btn btn--line" type="submit" name="decision" value="reject">打回</button></div>
      </form>` : ''}`)}`;
  };

  /* ---------- memory proposals ---------- */
  const pageMemory = () => {
    crumbs([['记忆审核']]);
    main.innerHTML = `
      <div class="page-head"><div><h1>项目记忆提议</h1><p>Worker 在任务交付或结束时，把代码里看不出来的约定提议成记忆。采纳后写进对应项目，在“项目 &gt; 记忆”里查看和修改。</p></div></div>
      <section class="region" aria-label="待审核">
      ${region({ what: '记忆提议', emptyTitle: '没有待审核的提议', emptyText: '任务交付或结束时，新的提议会出现在这里。', rows: 6 }, () => MEMORY_PROPOSALS.length ? `<div>${MEMORY_PROPOSALS.map(m => `
        <article class="proposal" data-mem="${m.id}">
          <div class="stack-sm"><h3>${pLink(m.project)}</h3><blockquote id="mp-${m.id}">${esc(m.text)}</blockquote></div>
          <div class="actions"><button class="btn btn--line" type="button" data-act="mem-accept" data-id="${m.id}">采纳</button><button class="btn btn--text" type="button" data-act="mem-edit-accept" data-id="${m.id}">改后采纳</button><button class="btn btn--text" type="button" data-act="mem-reject" data-id="${m.id}">驳回</button></div>
          <p class="from">来自 <a href="${link.ticket(m.from)}">${m.from}</a>：${esc(m.why)}</p>
        </article>`).join('')}</div>` : empty('都审核完了', '新的提议会出现在这里。'))}
      </section>
      <section class="region" aria-labelledby="pm-h"><h2 id="pm-h">各项目已有的记忆</h2>
        ${table('', [{ t: '项目' }, { t: '条数' }, { t: '最近采纳' }], PROJECTS.map(p => `<tr data-href="${link.project(p.id, 'memory')}">${td('', `<a class="title" href="${link.project(p.id, 'memory')}">${esc(p.name)}</a>`)}${td('条数', countBtn(link.project(p.id, 'memory'), p.memory.length, '条'))}${td('最近采纳', p.memory[0] ? esc(p.memory[0].date) : '无')}</tr>`))}
      </section>`;
  };

  /* ---------- members and roles ---------- */
  const ROLE_DESC = [['访客', '只能提问。Router 直接回答，不开任务，不读私有仓库的内容。没登记的发送人都按访客处理。'], ['提需求', '开任务、给自己的任务补充信息、重试自己失败的任务。'], ['审批', '确认需求单和环境计划、处理来回改、在项目上限内提高预算、采纳记忆、审批 PR、停止任何任务。'], ['管理', '设置、沙箱提供方、成员与角色、项目卡、沙箱只用自建、超过项目上限的预算。只能全局授予。']];
  const roleText = m => { const g = m.roles['*'] || '访客'; const per = PROJECTS.filter(p => m.roles[p.id] && m.roles[p.id] !== g).map(p => `${p.name}：${m.roles[p.id]}`); return `全局：${g}${per.length ? `；${per.join('；')}` : ''}`; };
  const pageMembers = () => {
    crumbs([['成员与权限']]);
    const visitors = [...new Set(ROUTING.filter(r => r.visitor && !MEMBERS.some(m => m.name === r.visitor)).map(r => r.visitor))];
    main.innerHTML = `
      <div class="page-head"><div><h1>成员与权限</h1><p>一个成员对应飞书、GitHub 和控制台三个账号。角色按项目授予，权限在 Engine 里检查，界面只显示有权限的操作。</p></div><button class="btn btn--line" type="button" data-act="add-member" aria-expanded="false" aria-controls="member-form">添加成员</button></div>
      <form class="well stack-md form-narrow" id="member-form" hidden novalidate data-form="member" data-endpoint="/api/members">
        <h2>添加成员</h2>
        <div class="field"><label for="nm">名字</label><input class="input" id="nm" name="name" autocomplete="off" required aria-required="true" aria-describedby="nm-help"><span class="help" id="nm-help">飞书账号在对方第一次 @ Auto-CodWorker 时自动关联。</span></div>
        <div class="field"><label for="gh">GitHub 用户名（可选）</label><input class="input" id="gh" name="github" autocomplete="off" spellcheck="false"></div>
        <div class="actions actions--start"><button class="btn" type="submit">添加，全局角色为“提需求”</button><button class="btn btn--line" type="button" data-act="add-member">取消</button></div>
      </form>
      <section class="region" aria-labelledby="mb-h"><h2 id="mb-h">成员</h2>
      ${region({ what: '成员', emptyTitle: '还没有成员', emptyText: '第一次部署时，部署人自动成为管理。', rows: 5 }, () => table('', [{ t: '成员' }, { t: '账号' }, { t: '角色' }, { t: '现在等他处理', num: 1 }, { t: '<span class="visually-hidden">操作</span>' }], MEMBERS.map(m => {
        const q = queue(m.id);
        if (editingMember === m.id) return `<tr><td colspan="5"><form class="stack-md" data-form="member-roles" data-id="${m.id}" data-endpoint="/api/members/${m.id}/roles">
          <h3>${esc(m.name)} 的角色</h3>
          <div class="form-grid">
            <div class="field"><label for="mr-${m.id}-g">全局</label>${selectWrap(`<select class="select" id="mr-${m.id}-g" name="*">${['提需求', '审批', '管理'].map(r => `<option${(m.roles['*'] || '提需求') === r ? ' selected' : ''}>${r}</option>`).join('')}</select>`)}</div>
            ${PROJECTS.map(p => `<div class="field"><label for="mr-${m.id}-${p.id}">${esc(p.name)}</label>${selectWrap(`<select class="select" id="mr-${m.id}-${p.id}" name="${p.id}"><option value="">跟随全局</option>${['提需求', '审批'].map(r => `<option${m.roles[p.id] === r ? ' selected' : ''}>${r}</option>`).join('')}</select>`)}</div>`).join('')}
          </div>
          <p class="note">全局是管理时，项目角色不再起作用。</p>
          <div class="actions actions--start"><button class="btn" type="submit">保存</button><button class="btn btn--line" type="button" data-act="member-cancel">取消</button></div></form></td></tr>`;
        return `<tr>${td('', `<span class="title">${esc(m.name)}${m.id === ME ? '<span class="note">（你）</span>' : ''}</span>`)}
          ${td('账号', `飞书${m.feishu ? '已关联' : '<span class="note">未关联</span>'}<span class="sub">${m.github ? `GitHub <code>${esc(m.github)}</code>` : '<span class="state state--warn">GitHub 未关联</span>：PR 上的评论对应不到这个人，只当作外部内容'}</span>`)}
          ${td('角色', esc(roleText(m)))}
          ${td('现在等他处理', q.length ? `${q.length}<span class="sub">${q.slice(0, 3).map(r => esc(r.title.split(' ')[0])).join('、')}${q.length > 3 ? ' 等' : ''}</span>` : '0', 1)}
          ${td('', m.id === ME ? '' : `<div class="actions"><button class="btn btn--text" type="button" data-act="member-edit" data-id="${m.id}">改角色</button></div>`)}</tr>`;
      })))}
      <p class="note">“现在等他处理”和他自己总览里的数一致：同一件事，有权限的人都能看到，谁先处理都可以。</p></section>
      <div class="two">
        <section class="region" aria-labelledby="rl-h"><h2 id="rl-h">四种角色</h2><dl class="facts">${ROLE_DESC.map(([r, d]) => `<dt>${r}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
          <p class="note">PR 的合并权限留在 GitHub，这里不复制分支保护，只读回结果。项目可以开“双人规则”：开任务的人不能自己确认需求单。</p></section>
        <section class="region" aria-labelledby="vs-h"><h2 id="vs-h">没登记的发送人</h2>
          ${visitors.length ? `<ul class="checklist">${visitors.map(v => { const r = ROUTING.find(x => x.visitor === v); return `<li data-r="wait">${I.hand}<div><span class="t">${esc(v)}</span><span class="s">${esc(r.t)} 在 ${esc(r.src)}：“${esc(r.msg)}”，只做了直接回答</span><div class="actions actions--start"><button class="btn btn--text" type="button" data-act="visitor-add" data-i="${ROUTING.indexOf(r)}">登记为成员</button></div></div></li>`; }).join('')}</ul>` : '<p class="ink-2">没有。没登记的人在飞书里 @ Auto-CodWorker 时会出现在这里。</p>'}
        </section>
      </div>`;
  };

  /* ---------- security ---------- */
  let secType = 'all';
  const pageSecurity = () => {
    crumbs([['安全']]);
    const types = ['all', ...new Set(SECURITY.map(x => x.type))];
    const list = SECURITY.filter(x => secType === 'all' || x.type === secType);
    main.innerHTML = `
      <div class="page-head"><div><h1>安全</h1><p>只靠 prompt 挡不住提示注入，所以分三层：标记内容来源，限制 Worker 的能力，限制沙箱的出口和凭证。</p></div></div>
      <section class="region" aria-labelledby="src-h"><h2 id="src-h">1. 标记来源</h2><dl class="facts">
          <dt>当作指令</dt><dd>成员的消息、已确认的需求单、main 上的 AGENTS.md、项目卡、已采纳的记忆</dd>
          <dt>只当数据</dt><dd>其他一切：非成员的 issue 和评论、网页、依赖里的文件、命令输出、fork 来的 PR<span class="sub">放进上下文时标为不可信，里面的指示一律不执行；进来时先过一遍指令检测</span></dd></dl></section>
      <section class="region" aria-labelledby="cap-h"><h2 id="cap-h">2. 能力分档</h2>
        ${table('', [{ t: '风险' }, { t: '例子' }, { t: '规则' }], [['低', '在沙箱里读、改、跑命令', '直接做，影响范围就是这台 VM'], ['中', '新增依赖、改 CI 配置或 workflow、改“需你确认”的路径、给沙箱加外网域名', '请审批人确认；审查员把这类改动列为必查项'], ['高', '推到任务分支以外、改环境计划、写项目记忆、在任务线程以外发消息', 'Worker 没有这些工具，只能提议，由 Engine 生成待确认事项']].map(([a, b, c]) => `<tr>${td('风险', `<span class="title">${a}</span>`)}${td('例子', esc(b))}${td('规则', esc(c))}</tr>`))}
        <p class="note">会话读过不可信内容（网页、非成员评论）之后，这次执行里的中风险动作即使原本不用问，也一律请人确认。</p></section>
      <section class="region" aria-labelledby="eg-h"><h2 id="eg-h">3. 出口与凭证</h2><dl class="facts">
          <dt>出站</dt><dd>默认关闭，只放行包镜像代理和 OrcaRouter；其他域名写进环境计划</dd>
          <dt>git</dt><dd>Worker 看不到 GitHub token，推送经 Engine 的 git 代理，只能推 acw/T-* 分支</dd>
          <dt>模型 key</dt><dd>由 VM 外的代理加上，VM 里没有</dd>
          <dt>fork 的 PR</dt><dd>不带任何凭证运行</dd>
          <dt>密钥扫描</dt><dd>diff、命令输出、产物存储前都扫，命中就打码并记录</dd></dl></section>
      <section class="region" aria-labelledby="rule-h"><div class="region-head"><h2 id="rule-h">常设规则</h2><p>同一类中风险动作被批准 3 次后，系统提议以后自动放行</p></div>
        ${table('', [{ t: '规则' }, { t: '范围' }, { t: '状态' }, { t: '<span class="visually-hidden">操作</span>' }], RULES.map(r => `<tr>${td('', `<span class="title">${esc(r.text)}</span><span class="sub">${r.st === 'proposed' ? `已批准 ${r.approvals} 次，最近一次：${esc(r.last)}` : r.st === 'on' ? `${esc(r.since)}起，自动放行 ${r.used} 次，每次都记事件` : '已停用，这类动作会再来问'}</span>`)}${td('范围', r.project ? esc(pname(r.project)) : '所有项目')}${td('状态', r.st === 'proposed' ? '<span class="tag tag--you">等管理员确认</span>' : r.st === 'on' ? `<span class="tag tag--ok">${I.check}已启用</span>` : '<span class="tag">已停用</span>')}${td('', `<div class="actions">${r.st === 'on' ? `<button class="btn btn--text" type="button" data-act="rule-off" data-id="${r.id}">停用</button>` : `<button class="btn btn--text" type="button" data-act="rule-on" data-id="${r.id}">启用</button>`}</div>`)}</tr>`))}</section>
      <section class="region" aria-labelledby="log-h"><div class="region-head"><h2 id="log-h">记录</h2><div class="chips" role="group" aria-label="按类型筛选">${types.map(k => `<button class="chip" type="button" data-act="sec-filter" data-f="${esc(k)}" aria-pressed="${secType === k}">${k === 'all' ? '全部' : esc(k)}<span class="n">${k === 'all' ? SECURITY.length : SECURITY.filter(x => x.type === k).length}</span></button>`).join('')}</div></div>
        ${region({ what: '安全记录', emptyTitle: '还没有记录', emptyText: '外部内容命中检测、能力或出口被拦、密钥扫描命中、权限不足时会记在这里。', rows: 6 }, () => table('', [{ t: '时间' }, { t: '任务' }, { t: '类型' }, { t: '谁' }, { t: '发生了什么' }, { t: '处理' }], list.map(x => `<tr>${td('时间', esc(x.t), 1)}${td('任务', x.ticket ? cbtn(link.ticket(x.ticket), `<span class="mono">${x.ticket}</span>`) : '<span class="note">无</span>')}${td('类型', `<span class="nowrap">${esc(x.type)}</span>`)}${td('谁', esc(x.who))}${td('发生了什么', `<span class="ink">${esc(x.what)}</span>`)}${td('处理', esc(x.result))}</tr>`)))}
      </section>`;
  };

  /* ---------- ops ---------- */
  const pageOps = () => {
    crumbs([['运维']]);
    const used = TICKETS.filter(t => t.kind === 'run').length;
    main.innerHTML = `
      <div class="page-head"><div><h1>运维</h1><p>控制面自己的健康状况。指标和日志在 ClickHouse，这里是摘要；告警推到飞书运维群。事件日志只记业务事实，不记这些指标。</p></div></div>
      ${drainNote()}
      <section class="region" aria-labelledby="en-h"><h2 id="en-h">Engine 节点</h2>
        ${table('', [{ t: '节点' }, { t: '角色' }, { t: '任期', num: 1 }, { t: '复制落后', num: 1 }], OPS.engine.map(n => `<tr>${td('', `<span class="title mono">${n.id}</span>`)}${td('角色', n.role === 'leader' ? `<span class="tag tag--ok">${I.check}leader，处理命令和副作用</span>` : '<span class="tag">follower，服务查询</span>')}${td('任期', n.term, 1)}${td('复制落后', n.lag, 1)}</tr>`))}
        <p class="note">事件日志在 3 个节点间复制，多数落盘才算成功。只有 leader 执行副作用，指令带任期号，旧 leader 发出的会被宿主机和代理拒绝。</p></section>
      <section class="region" aria-labelledby="cp-h"><h2 id="cp-h">控制面</h2>
        <dl class="figures">
          <div class="figure-item"><dt>命令耗时 p95</dt><dd class="num">${OPS.p95}<span class="u"> ms</span></dd></div>
          <div class="figure-item"><dt>副作用积压</dt><dd class="num">${OPS.effects}</dd></div>
          <div class="figure-item"><dt>异步投影最多落后</dt><dd class="num">${OPS.lag}<span class="u"> 秒</span></dd></div>
          <div class="figure-item"><dt>Worker 槽位</dt><dd class="num">${used}<span class="u"> / ${SETTINGS.workers}</span></dd></div>
        </dl>
        ${table('', [{ t: '投影' }, { t: '更新方式' }, { t: '落后' }], OPS.projections.map(([a, b, c]) => `<tr>${td('', `<code class="ink">${a}</code>`)}${td('更新方式', b)}${td('落后', c)}</tr>`))}
        <p class="note">同步投影和事件在同一事务里更新，不会落后；异步投影落后超过 1 分钟会告警，界面显示“更新中”。</p></section>
      <section class="region" aria-labelledby="dp-h"><h2 id="dp-h">外部依赖</h2>
        ${table('', [{ t: '依赖' }, { t: '近 1 小时错误率', num: 1 }, { t: '说明' }], OPS.deps.map(([a, b, c]) => `<tr>${td('', `<span class="title">${esc(a)}</span>`)}${td('近 1 小时错误率', b, 1)}${td('说明', esc(c) || '正常')}</tr>`))}
        <p class="note">模型全部不可用时，任务标为“等待：模型不可用”，恢复后自动继续，不算任务失败。</p></section>
      <div class="two">
        <section class="region" aria-labelledby="bk-h"><h2 id="bk-h">备份</h2>
          <dl class="facts"><dt>持续复制</dt><dd>${esc(OPS.backup.replica)}<span class="sub">Litestream 把 SQLite 复制到对象存储</span></dd><dt>每日快照</dt><dd>${esc(OPS.backup.daily)}</dd><dt>恢复演练</dt><dd>${esc(OPS.backup.drill)}${OPS.backup.drill === '进行中' ? '' : `<span class="sub">${esc(OPS.backup.drillResult)}</span>`}</dd></dl>
          <div class="actions actions--start"><button class="btn btn--line" type="button" data-act="drill"${OPS.backup.drill === '进行中' ? ' disabled' : ''}>现在做一次恢复演练</button></div>
          <p class="note">每月自动做一次：恢复到预发环境，重建全部投影，对比行数和校验和。</p></section>
        <section class="region" aria-labelledby="up-h"><h2 id="up-h">升级</h2>
          <p class="ink-2">升级 Engine 前先排空：Worker 做完当前这一步就停，不用等任务结束。重启后从停下的地方继续。投影结构变了，先在新表里重建，追上后再切换。</p>
          <div class="actions actions--start">${OPS.drain ? '<button class="btn" type="button" data-act="drain-off">结束排空</button>' : '<button class="btn btn--line" type="button" data-act="drain-on">进入排空</button>'}</div>
          <p class="note">升级宿主机上的 acw-node：逐台停止调度，等上面的任务结束或搬走后再升级。</p></section>
      </div>
      <section class="region" aria-labelledby="al-h"><h2 id="al-h">告警</h2>
        ${table('', [{ t: '时间' }, { t: '级别' }, { t: '内容' }, { t: '状态' }], OPS.alerts.map(a => `<tr>${td('时间', esc(a.t), 1)}${td('级别', a.level === '严重' ? `<span class="state state--fail">${a.level}</span>` : a.level === '警告' && alertOpen(a) ? `<span class="state state--warn">${a.level}</span>` : esc(a.level))}${td('内容', `<span class="ink">${esc(a.what)}</span>`)}${td('状态', `${esc(alertState(a))}${alertOpen(a) ? `<span class="sub"><a href="#sandboxes">去清理快照</a></span>` : ''}`)}</tr>`))}
      </section>
      <section class="region" aria-labelledby="fd-h"><h2 id="fd-h">故障时会怎样</h2>
        <p class="ink-2">任务的真实状态只有三样：事件日志、远端的任务分支（Worker 每次提交都推送）、模板。沙箱丢了，用“模板 + 分支”重建。</p>
        ${table('', [{ t: '故障' }, { t: '怎么发现' }, { t: '怎么处理' }], [
          ['模型服务不可用', '调用失败', 'OrcaRouter 先切到同类模型的其他上游；全都不可用时任务标为“等待：模型不可用”，恢复后自动继续'],
          ['Worker 卡住', '15 分钟没有新步骤；单条命令超时（默认 20 分钟，E2E 40 分钟）', '杀掉命令并告诉 Worker；进程挂了就从会话记录重启，最多 2 次，超过算失败'],
          ['Worker 原地打转', '同一条命令以相同输出失败 5 次', '强制汇报 blocked，转成待确认事项'],
          ['沙箱崩溃', 'acw-node 上报', '用模板加任务分支重建，正在跑的测试重跑'],
          ['宿主机宕机', '60 秒没有心跳', '标为下线，上面的沙箱按调度规则在其他宿主机重建；VM 组整组搬'],
          ['Engine 重启', '进程启动', '重发没有回执的副作用（都带幂等键），和各 acw-node 对账沙箱；不重放事件'],
          ['飞书或 GitHub 接口失败', '副作用回执失败', '退避重试；连续失败进告警，不影响任务本身'],
        ].map(([a, b, c]) => `<tr>${td('', `<span class="title">${a}</span>`)}${td('怎么发现', esc(b))}${td('怎么处理', esc(c))}</tr>`))}
        <p class="note">基础设施原因带来的重跑照样计入成本，但不占任务预算。</p>
        <div class="proto"><span>原型：模拟宿主机故障</span>${HOSTS.filter(h => h.disk >= 15).map(h => h.down ? `<button class="btn btn--text" type="button" data-act="host-up" data-host="${h.id}">${h.id} 恢复心跳</button>` : `<button class="btn btn--text" type="button" data-act="host-down" data-host="${h.id}">${h.id} 失联</button>`).join('')}</div>
      </section>`;
  };

  /* ---------- quality ---------- */
  const pct = ([a, b]) => (b ? `${Math.round(a / b * 100)}%` : '无');
  const frac = ([a, b]) => `${a} / ${b}`;
  const thisWeek = () => {
    const routed = ROUTING.filter(r => !r.visitor);
    const rounds = TICKETS.flatMap(t => t.review?.rounds || []).filter(r => typeof r.found === 'number');
    const findings = TICKETS.flatMap(t => t.review?.findings || []);
    const ended = TICKETS.filter(t => !isOpen(t) && (t.day !== 'earlier' || t.id === 'T-111'));
    const merged = ended.filter(t => t.kind === 'done');
    return { w: '本周（实时）', route: [routed.filter(r => r.fb || r.moved).length, routed.length], mandate: QUALITY.mandateNow, merged: [merged.length, ended.length], touches: QUALITY.touchesNow,
      valid: [rounds.reduce((a, r) => a + r.valid, 0), rounds.reduce((a, r) => a + r.found, 0)], fp: [findings.filter(f => f.fp).length, findings.length], flaky: QUALITY.flakyNow,
      cost: merged.length ? Math.round(merged.reduce((a, t) => a + t.cost, 0) / merged.length) : 0 };
  };
  const pageQuality = () => {
    crumbs([['质量']]);
    const now7 = thisWeek(), rows = [...QUALITY.weeks, now7];
    main.innerHTML = `
      <div class="page-head"><div><h1>质量</h1><p>都从事件算出来，用来判断路由、审查和 E2E 是不是在变好。你在路由记录里标“判断有误”、在审查里标“误报”，都会算进来。</p></div></div>
      ${region({ what: '质量度量', emptyTitle: '还没有数据', emptyText: '第一个任务结束后开始统计。', rows: 8 }, () => `
      <section class="region" aria-labelledby="qn-h"><h2 id="qn-h">本周</h2>
        <dl class="figures">
          <div class="figure-item"><dt>路由被改过</dt><dd class="num">${pct(now7.route)}<span class="u"> ${frac(now7.route)}</span></dd></div>
          <div class="figure-item"><dt>审查发现证实率</dt><dd class="num">${pct(now7.valid)}</dd></div>
          <div class="figure-item"><dt>审查误报率</dt><dd class="num">${pct(now7.fp)}<span class="u"> ${frac(now7.fp)}</span></dd></div>
          <div class="figure-item"><dt>每个合并 PR 的成本</dt><dd class="num">¥${now7.cost}</dd></div>
        </dl></section>
      <section class="region" aria-labelledby="qw-h"><h2 id="qw-h">按周</h2>
        ${table('', [{ t: '周' }, { t: '路由被改过', num: 1 }, { t: '需求单一次确认', num: 1 }, { t: '合并率', num: 1 }, { t: '每个合并 PR 人工介入', num: 1 }, { t: '审查证实率', num: 1 }, { t: '误报率', num: 1 }, { t: 'E2E flaky 率', num: 1 }, { t: '每个合并 PR 成本', num: 1 }], rows.map(r => `<tr>${td('', `<span class="title">${esc(r.w)}</span>`)}${td('路由被改过', pct(r.route), 1)}${td('需求单一次确认', pct(r.mandate), 1)}${td('合并率', pct(r.merged), 1)}${td('每个合并 PR 人工介入', `${r.touches} 次`, 1)}${td('审查证实率', pct(r.valid), 1)}${td('误报率', pct(r.fp), 1)}${td('E2E flaky 率', `${r.flaky}%`, 1)}${td('每个合并 PR 成本', `¥${r.cost}`, 1)}</tr>`))}
        <p class="note">flaky：同一提交先失败、重跑通过。人工介入：每个合并的 PR 平均回答了几次问题、做了几次决定。合并 14 天内被 revert 或被 issue 关联的 PR 会记为漏网。</p></section>
      <section class="region" aria-labelledby="ev-h"><div class="region-head"><h2 id="ev-h">回归评测</h2><button class="btn btn--line" type="button" data-act="eval-run"${EVALS[0]?.verdict === '等结果' ? ' disabled' : ''}>用当前设置跑一次</button></div>
        <p class="ink-2">换模型、改 prompt 或 skill 之前先跑评测，新旧配置跑同一批用例成对比较。“不比当前差”的把握到 90% 才上线，并且先对 10% 的新任务生效一周。</p>
        <div class="two two--even">
          <div class="stack-sm"><h3>评测集构成</h3>${table('', [{ t: '来源' }, { t: '用来评' }, { t: '用例', num: 1 }], EVALSET.sources.map(([a, b, n]) => `<tr>${td('', esc(a))}${td('用来评', esc(b))}${td('用例', n, 1)}</tr>`))}<p class="note">每周自动入库；${EVALSET.holdout}% 是留出集，只用于最终判定，不用来调 prompt。</p></div>
          <div class="stack-sm"><h3>当前配置在各阶段的结果</h3>${table('', [{ t: '阶段' }, { t: '指标' }, { t: '结果', num: 1 }, { t: '90% 区间', num: 1 }], EVALSET.stages.map(([a, b, v, ci]) => `<tr>${td('', `<span class="title">${esc(a)}</span>`)}${td('指标', esc(b))}${td('结果', v, 1)}${td('90% 区间', esc(ci), 1)}</tr>`))}<p class="note">Worker 用隐藏测试：在最终合并版本上写的 E2E，它看不到。</p></div>
        </div>
        <h3>端到端评测记录</h3>
        ${table('', [{ t: '时间' }, { t: '改了什么' }, { t: '完成条件通过', num: 1 }, { t: '平均成本', num: 1 }, { t: '平均审查轮数', num: 1 }, { t: '结论' }], EVALS.map(e => `<tr>${td('时间', esc(e.date))}${td('改了什么', `<span class="ink">${esc(e.change)}</span>`)}${td('完成条件通过', e.pass ? `${frac(e.pass)}<span class="sub">当前 ${frac(e.base)}</span>` : '运行中', 1)}${td('平均成本', e.cost ? `¥${e.cost[0]}<span class="sub">当前 ¥${e.cost[1]}</span>` : '', 1)}${td('平均审查轮数', e.rounds ? `${e.rounds[0]}<span class="sub">当前 ${e.rounds[1]}</span>` : '', 1)}${td('结论', esc(e.verdict))}</tr>`))}
      </section>`)}`;
  };

  /* ---------- notifications ---------- */
  const pageNotifications = () => {
    crumbs([['通知']]);
    main.innerHTML = `
      <div class="page-head"><div><h1>飞书通知记录</h1><p>需要你的事都会推送到 ${esc(SETTINGS.chat)}。推送哪几类，在 <a href="#config">设置</a> 里改；下面两项只对你自己生效。</p></div></div>
      ${demo === 'full' ? prefsPanel() : ''}
      <section class="region" aria-label="通知记录">
      ${region({ what: '通知记录', emptyTitle: '还没有推送过通知', emptyText: '有任务需要你时，会推送到飞书并记录在这里。', rows: 8 }, () => table('', [{ t: '时间' }, { t: '事项' }, { t: '类别' }, { t: '推送到' }, { t: '结果' }], NOTIFS.map(n => `<tr>${td('时间', esc(n.t), 1)}${td('事项', `<a href="${n.href}">${esc(n.title)}</a>`)}${td('类别', esc(NOTIFY_LABEL[n.type]))}${td('推送到', esc(n.to || '飞书群：Auto-CodWorker 通知'))}${td('结果', n.st.startsWith('没有') ? `<span class="note">${esc(n.st)}</span>` : esc(n.st))}</tr>`)))}
      </section>`;
  };

  /* ---------- sandboxes ---------- */
  const pageSandboxes = params => {
    crumbs([['沙箱']]);
    const tab = params.get('tab') || 'hosts';
    const head = `<div class="page-head"><div><h1>沙箱</h1><p>任务用哪种沙箱、哪个镜像，由项目的环境计划决定；放在哪台机器上，由调度规则决定。</p></div></div>
      ${tabs([['#sandboxes', '宿主机与沙箱', 'hosts'], ['#sandboxes-providers', '提供方', 'providers'], ['#sandboxes-templates', '镜像与模板', 'templates'], ['#sandboxes-config', '默认配置与调度', 'config']], tab, '沙箱')}`;
    if (tab === 'providers') {
      main.innerHTML = `${head}
        <section class="region" aria-labelledby="pv-h"><h2 id="pv-h">提供方</h2>
        ${region({ what: '提供方', emptyTitle: '没有提供方', emptyText: '至少需要一个沙箱提供方。', rows: 4 }, () => table('', [{ t: '提供方' }, { t: '支持的形态' }, { t: '快照' }, { t: '暂停' }, { t: '并发', num: 1 }, { t: '状态' }, { t: '<span class="visually-hidden">操作</span>' }], CFG.providers.map(x => `<tr>${td('', `<span class="title">${esc(x.name)}</span><span class="sub">${x.kind === 'self' ? esc(x.note) : x.key ? `API key ${esc(x.key)}` : '还没有 API key'}</span>`)}${td('支持的形态', x.forms.join('、'))}${td('快照', esc(x.snapshot))}${td('暂停', esc(x.pause))}${td('并发', x.kind === 'self' ? `${TICKETS.filter(t => t.sandbox && (t.sandbox.provider || 'firecracker') === 'firecracker' && t.sandbox.state === 'running').length} / ${SETTINGS.workers}` : `${cloudUsed(x.id)} / ${x.quota}`, 1)}${td('状态', x.state === 'ok' ? (x.kind === 'self' ? '正常' : '已连接') : '<span class="note">未连接</span>')}${td('', x.kind === 'self' ? '' : `<div class="actions">${x.state === 'ok' ? `<button class="btn btn--text" type="button" data-act="prov-test" data-id="${x.id}">测试连接</button><button class="btn btn--text" type="button" data-act="prov-off" data-id="${x.id}">断开</button>` : `<button class="btn btn--line" type="button" data-act="prov-on" data-id="${x.id}">连接</button>`}</div>`)}</tr>`)))}
        ${connecting ? `<form class="well stack-md form-narrow" data-form="prov" data-id="${connecting}" data-endpoint="/api/sandbox-providers/${connecting}"><h3>连接 ${esc(provName(connecting))}</h3><div class="field"><label for="pk">API key</label><input class="input" id="pk" name="key" type="password" autocomplete="off" required aria-required="true" aria-describedby="pk-help"><span class="help" id="pk-help">只存在 Engine 的密钥库里，不会进任何镜像或沙箱。</span></div><div class="actions actions--start"><button class="btn" type="submit">连接</button><button class="btn btn--line" type="button" data-act="prov-cancel">取消</button></div></form>` : ''}
        <p class="note">云沙箱是否能保留“服务都已启动”的快照、暂停后恢复要多久，都以提供方的能力为准，接入前要做 PoC。</p></section>
        <section class="region" aria-labelledby="pp-h"><div class="region-head"><h2 id="pp-h">各项目用哪个</h2><p class="note">默认 ${esc(provName(SETTINGS.sandbox.provider))}；${SETTINGS.sandbox.overflow ? `自建满载时单 VM 任务溢出到 ${esc(provName(SETTINGS.sandbox.overflowTo))}` : '不溢出到云端'}。在 <a href="#config">设置</a> 里改。</p></div>
        ${table('', [{ t: '项目' }, { t: '提供方' }, { t: '沙箱只用自建' }, { t: '实际会用' }, { t: '<span class="visually-hidden">操作</span>' }], PROJECTS.map(p => { const cur = currentPlan(p.id), eff = providerFor(p.id, cur.form); return `<tr>${td('', `<a class="title" href="${link.project(p.id)}">${esc(p.name)}</a>`)}${td('提供方', selectWrap(`<select class="select" aria-label="${esc(p.name)} 的沙箱提供方" data-pv="${p.id}">${[['inherit', '跟随默认'], ...CFG.providers.map(x => [x.id, x.name])].map(([v, l]) => `<option value="${v}"${v === p.provider ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`))}${td('沙箱只用自建', `<label class="check"><input type="checkbox" data-pi="${p.id}"${p.internalOnly ? ' checked' : ''}>只用自建</label>`)}${td('实际会用', `${esc(provName(eff.id))}<span class="sub">${esc(eff.why)}</span>`)}${td('', `<div class="actions"><button class="btn btn--text" type="button" data-act="prov-save" data-pid="${p.id}">保存</button></div>`)}</tr>`; }))}
        <p class="note">“实际会用”按当前环境计划的形态算：VM 组只能放在自建上；设了“沙箱只用自建”的项目不会用云沙箱。</p></section>`;
      return;
    }
    if (tab === 'templates') {
      const u = CFG.update, tps = templates();
      main.innerHTML = `${head}
        ${u.state !== 'done' ? `<div class="well stack-sm" role="status"><p class="${u.state === 'building' ? '' : 'warn-line'}">${u.state === 'building' ? '' : I.alert}基础镜像 ${u.id} 有更新（${esc(u.note)}），新 digest ${u.digest}</p><p class="ink-2">${u.state === 'building' ? `正在重建 ${tps.filter(x => x.plan.state === 'frozen').length} 个使用中的模板，完成后新任务和 main 基线自动用新模板；运行中的任务不受影响。` : `只改系统包，按规则自动应用：已排在${u.at} 低峰重建 ${tps.filter(x => x.plan.state === 'frozen').length} 个使用中的模板。`}</p>${u.state === 'building' ? '' : '<div><button class="btn btn--line" type="button" data-act="rebuild">现在重建</button></div>'}</div>` : ''}
        <section class="region" aria-labelledby="b-h"><h2 id="b-h">基础镜像与内核</h2>
        ${region({ what: '镜像', emptyTitle: '还没有基础镜像', emptyText: '首次部署时会构建 acw-base。', rows: 4 }, () => table('', [{ t: '名称' }, { t: '版本' }, { t: 'digest' }, { t: '用途' }, { t: '更新' }], [...CFG.base, CFG.kernel].map(b => `<tr>${td('', `<span class="title">${b.id}</span>`)}${td('版本', esc(b.tag))}${td('digest', `<code>${b.digest}</code>`)}${td('用途', esc(b.role))}${td('更新', esc(b.updated || '随宿主机发布'))}</tr>`)))}
        <p class="note">镜像全部锁定 digest，运行时不需要 Docker：OCI 镜像在构建阶段转成 ext4 rootfs。</p></section>
        <section class="region" aria-labelledby="t-h"><h2 id="t-h">模板</h2>
        ${region({ what: '模板', emptyTitle: '还没有模板', emptyText: '环境计划确认后会生成模板。', rows: 8 }, () => table('', [{ t: '模板' }, { t: '项目' }, { t: '环境计划' }, { t: 'VM', num: 1 }, { t: '快照', num: 1 }, { t: '已分发到' }, { t: '云端' }, { t: '状态' }], tps.map(x => `<tr>${td('', `<code class="ink">${x.id}</code>`)}${td('项目', pLink(x.pid))}${td('环境计划', cbtn(link.plan(x.pid, x.plan.v), `<span class="mono">${x.plan.v}</span>`))}${td('VM', x.vms.length, 1)}${td('快照', `${x.snapGB}G`, 1)}${td('已分发到', x.hosts.join('、') || '无')}${td('云端', esc(cloudSync(x)))}${td('状态', x.plan.state === 'pending' ? `<span class="attn">${esc(x.status)}</span>` : esc(x.status))}</tr>`)))}
        <p class="note">每个环境计划版本对应一个模板：基础镜像 + 仓库语言的工具链和依赖缓存 + 服务镜像 + 服务都起好之后的内存快照。镜像层明细在各环境计划页里。</p></section>`;
      return;
    }
    if (tab === 'config') {
      main.innerHTML = `${head}
        <div class="two">
          <section class="region" aria-labelledby="d-h"><h2 id="d-h">默认规格</h2>
            <dl class="facts"><dt>app VM</dt><dd>${SETTINGS.sandbox.app}<span class="sub">跑 PR 代码、Worker 和 Chromium</span></dd><dt>服务 VM</dt><dd>${SETTINGS.sandbox.svc}<span class="sub">VM 组里的 MySQL、Kafka 等</span></dd><dt>mock VM</dt><dd>1 核 1G</dd><dt>可写层</dt><dd>每个 VM 20G，写时复制</dd><dt>快照保留</dt><dd>${SETTINGS.sandbox.retention} 天<span class="sub">过期模板和暂停任务的快照到期清理</span></dd><dt>空闲暂停</dt><dd>${SETTINGS.idle} 分钟</dd></dl>
            <p class="note">环境计划里可以为单个服务单独指定规格；这里的值在 <a href="#config">设置</a> 里改，改动会进历史版本。</p>
          </section>
          <section class="region" aria-labelledby="s-h"><h2 id="s-h">调度规则</h2>
            <ol class="accept"><li data-s="ok"><span class="accept__n mono">1</span><div><p>只在本地 NVMe 剩余 15% 以上、在线的宿主机上新建沙箱</p></div></li><li data-s="ok"><span class="accept__n mono">2</span><div><p>优先选本地已有该模板快照的宿主机，可以直接恢复</p></div></li><li data-s="ok"><span class="accept__n mono">3</span><div><p>同等条件下选空闲内存最多的</p></div></li><li data-s="ok"><span class="accept__n mono">4</span><div><p>都没有快照时，先从已有快照的宿主机拷贝过去</p></div></li><li data-s="ok"><span class="accept__n mono">5</span><div><p>VM 组的所有 VM 放在同一台宿主机，共用一个专用网段</p></div></li></ol>
          </section>
        </div>
        <section class="region" aria-labelledby="n-h"><h2 id="n-h">网络</h2>
          <dl class="facts"><dt>出站</dt><dd>默认关闭，只放行包镜像代理（npm、Go proxy、PyPI、Maven）和 OrcaRouter<span class="sub">项目需要的其他域名写在环境计划里，例如 Casdoor 测试 realm；被拦下的访问记在 <a href="#security">安全</a></span></dd><dt>预览 URL</dt><dd>宿主机上的 nginx 按 pr-编号.preview.example.com 转到 app VM</dd><dt>凭证</dt><dd>不进镜像，也不进 VM<span class="sub">模型调用经 VM 外的代理加上任务子 key；git 推送经 Engine 的 git 代理，只能推这个任务的 acw/T-* 分支</span></dd></dl>
        </section>`;
      return;
    }
    const sb = sandboxes();
    main.innerHTML = `${head}
      <section class="region" aria-labelledby="h-h"><h2 id="h-h">宿主机</h2>
      ${region({ what: '宿主机', emptyTitle: '还没有宿主机', emptyText: '在宿主机上启动 acw-node 后会自动注册。', rows: 3 }, () => table('', [{ t: '宿主机' }, { t: '规格' }, { t: '空闲内存', num: 1 }, { t: '本地 NVMe 剩余', num: 1 }, { t: '运行中 VM', num: 1 }, { t: '已暂停 VM', num: 1 }, { t: '<span class="visually-hidden">操作</span>' }], HOSTS.map(h => { const on = sb.filter(x => x.host === h.id); return `<tr>${td('', `<span class="title">${h.id}</span>${h.down ? '<span class="sub"><span class="state state--fail">失联</span></span>' : ''}`)}${td('规格', h.spec)}${td('空闲内存', `${hostFree(h.id)}G`, 1)}${td('本地 NVMe 剩余', h.disk < 15 ? `<span class="state state--warn">${h.disk}%</span>` : `${h.disk}%`, 1)}${td('运行中 VM', on.filter(x => x.state === 'running').reduce((a, x) => a + x.count, 0), 1)}${td('已暂停 VM', on.filter(x => x.state === 'paused').reduce((a, x) => a + x.count, 0), 1)}${td('', h.disk < 15 ? `<div class="actions"><button class="btn btn--line" type="button" data-act="clean" data-host="${h.id}">清理过期快照</button></div>` : '')}</tr>`; })))}
      </section>
      <section class="region" aria-labelledby="s-h"><h2 id="s-h">沙箱</h2>
      ${region({ what: '沙箱', emptyTitle: '没有沙箱', emptyText: '任务开始时会从模板快照恢复。', rows: 8 }, () => table('', [{ t: '用途' }, { t: '项目' }, { t: '形态' }, { t: '模板' }, { t: '运行在' }, { t: 'VM', num: 1 }, { t: '状态' }, { t: '<span class="visually-hidden">操作</span>' }], sb.map(x => `<tr>${td('', x.owner === 'main' ? '<span class="title">main 基线</span>' : `<a class="title" href="${link.ticket(x.owner, 'sandbox')}">${x.owner}</a>`)}${td('项目', pLink(x.project))}${td('形态', esc(x.form))}${td('模板', cbtn(link.plan(x.project, x.env), `<span class="mono">${tplId(x.project, x.env)}</span>`))}${td('运行在', isCloud(x.provider) ? `<a href="#sandboxes-providers">${esc(x.host)}</a>` : x.host)}${td('VM', x.count, 1)}${td('状态', x.state === 'running' ? '运行中' : '已暂停')}${td('', x.owner === 'main' ? '<span class="note">常驻</span>' : `<div class="actions">${x.state === 'running' ? `<button class="btn btn--text" type="button" data-act="pause" data-id="${x.owner}">暂停</button>` : `<button class="btn btn--text" type="button" data-act="resume" data-id="${x.owner}">恢复</button>`}</div>`)}</tr>`)))}
      </section>`;
  };

  /* ---------- cost ---------- */
  const quota = (v, max, unit) => `<div class="bar-cell"${v / max >= 0.8 ? ' data-hot' : ''}><span class="track" aria-hidden="true"><span class="fill" style="transform:scaleX(${Math.min(1, v / max).toFixed(3)})"></span></span><span class="num">${unit}${Math.round(v)} / ${unit}${max}</span></div>`;
  const pageCost = params => {
    crumbs([['成本']]);
    const range = params.get('range') === '30d' ? '30d' : '7d';
    const inRange = t => range === '30d' || t.day !== 'earlier' || ['T-104', 'T-111'].includes(t.id);
    const rows = PROJECTS.map(p => { const ts = TICKETS.filter(t => t.project === p.id && inRange(t)); return [p.id, ts.length, ts.reduce((a, t) => a + t.cost, 0) + (range === '30d' ? { orcarouter: 312, 'orcax-analytics': 96, orcadub: 141, xbot: 18 }[p.id] : 0)]; });
    const total = rows.reduce((a, r) => a + r[2], 0), max = Math.max(...rows.map(r => r[2]));
    const roles = COST_BY_ROLE[range], rsum = roles.reduce((a, r) => a + r[2], 0);
    const top = TICKETS.filter(inRange).sort((a, b) => b.cost - a.cost).slice(0, 3);
    main.innerHTML = `
      <div class="page-head"><div><h1>成本</h1><p>来自 OrcaRouter 的调用记录，每个任务用自己的子 key，所以能按任务归属。单任务上限 ¥${SETTINGS.budget}，在设置里改。</p></div>
        ${tabs([['#cost', '近 7 天', '7d'], ['#cost-30d', '近 30 天', '30d']], range, '时间范围')}</div>
      ${region({ what: '成本', emptyTitle: '这段时间没有调用', emptyText: '任务开始调用模型后，费用会按项目和模型汇总在这里。', rows: 8 }, () => `
      <section class="region" aria-labelledby="qt-h"><div class="region-head"><h2 id="qt-h">额度</h2><a class="note" href="#config">在设置里改</a></div>
        <div class="two two--even">
          ${table('', [{ t: '项目' }, { t: `今天，上限 ¥${SETTINGS.projectDay}` }, { t: `本月，上限 ¥${SETTINGS.projectMonth}` }], PROJECTS.map(p => { const day = TICKETS.filter(t => t.project === p.id && t.day === 'today').reduce((a, t) => a + t.cost, 0), month = TICKETS.filter(t => t.project === p.id).reduce((a, t) => a + t.cost, 0) + ({ orcarouter: 312, 'orcax-analytics': 96, orcadub: 141, xbot: 18 }[p.id] || 0); return `<tr>${td('', `<a class="title" href="${link.project(p.id)}">${esc(p.name)}</a>`)}${td('今天', quota(day, SETTINGS.projectDay, '¥'))}${td('本月', quota(month, SETTINGS.projectMonth, '¥'))}</tr>`; }))}
          ${table('', [{ t: '成员' }, { t: `今天新任务，上限 ${SETTINGS.memberDay} 个` }], MEMBERS.map(m => `<tr>${td('', `<span class="title">${esc(who(m.id))}</span>`)}${td('今天新任务', quota(TICKETS.filter(t => t.day === 'today' && t.by === m.id).length, SETTINGS.memberDay, ''))}</tr>`))}
        </div>
        <p class="note">到 80% 通知，用完后新任务排队，在跑的任务不中断。Worker 槽位按项目轮转，单个项目最多占一半。</p></section>
      <section class="region" aria-labelledby="cp-h"><div class="region-head"><h2 id="cp-h">按项目</h2><p class="num">合计 ¥${total.toFixed(0)}</p></div>
        ${table('', [{ t: '项目' }, { t: '任务', num: 1 }, { t: '费用' }], rows.map(r => `<tr>${td('', `<a class="title" href="${link.project(r[0])}">${esc(pname(r[0]))}</a>`)}${td('任务', r[1], 1)}${td('费用', `<div class="bar-cell"><span class="track" aria-hidden="true"><span class="fill" style="transform:scaleX(${(r[2] / max).toFixed(3)})"></span></span><span class="num">¥${r[2].toFixed(0)}</span></div>`)}</tr>`))}
      </section>
      <div class="two">
        <section class="region" aria-labelledby="cm-h"><h2 id="cm-h">按阶段</h2>
          ${table('', [{ t: '阶段' }, { t: '模型' }, { t: '费用', num: 1 }], roles.map((m, i) => `<tr>${td('', `<span class="title">${esc(STAGE_NAME[m[0]])}</span>`)}${td('模型', `<code>${esc(SETTINGS.stages[m[0]].model)}</code><span class="sub">${esc(EP(SETTINGS.stages[m[0]].ep)?.name || '')}</span>`)}${td('费用', `¥${(m[2] / rsum * total).toFixed(0)}`, 1)}</tr>`))}
        </section>
        <section class="region" aria-labelledby="cs-h"><h2 id="cs-h">云沙箱</h2>
          ${(() => { const rows = CFG.providers.filter(c => c.kind === 'cloud').map(c => { const ts = TICKETS.filter(t => t.sandbox?.provider === c.id); const h = ts.reduce((a, t) => a + (t.sandbox.hours || 0), 0); return [c, ts.length, h]; }); return table('', [{ t: '提供方' }, { t: '沙箱', num: 1 }, { t: '机时', num: 1 }, { t: '费用', num: 1 }], rows.map(([c, n, h]) => `<tr>${td('', `<span class="title">${esc(c.name)}</span>`)}${td('沙箱', n, 1)}${td('机时', `${h.toFixed(1)} 小时`, 1)}${td('费用', `¥${(h * c.price).toFixed(1)}`, 1)}</tr>`)); })()}
          <p class="note">自建沙箱按机器折算，不计入任务费用。云端单价为示例值。</p>
        </section>
        <section class="region" aria-labelledby="ct-h"><h2 id="ct-h">最贵的任务</h2>
          <ol class="checklist ranked">${top.map(x => `<li data-r="wait"><span class="num ink-2">¥${x.cost.toFixed(0)}</span><div><a class="t" href="${link.ticket(x.id)}">${x.id} ${esc(x.title)}</a><span class="s">${esc(pname(x.project))}，${x.cost > SETTINGS.budget * 0.7 ? `已用单任务上限的 ${Math.round(x.cost / SETTINGS.budget * 100)}%` : stateWord(x.kind).replace(/<[^>]+>/g, '')}</span></div></li>`).join('')}</ol>
        </section>
      </div>`)}`;
  };

  /* ---------- settings ---------- */
  let draft = null;
  const STAGES = ['router', 'worker', 'reviewer', 'tester', 'env'];
  const STAGE_NAME = { router: '路由与需求单', worker: '开发', reviewer: '审查', tester: '写测试', env: '环境规划' };
  const STAGE_DO = { router: '判断需求归属、整理需求单、直接回答', worker: '读代码、改代码、跑命令', reviewer: '审查改动、验证发现', tester: '按验收标准写 PR-Test 和 E2E 用例', env: '读 CI 和 compose，生成并跑通环境计划' };
  const EP = id => SETTINGS.endpoints.find(e => e.id === id);
  /* the model list is whatever GET {base}/models returned; nobody types a model name */
  const modelOptions = (epId, cur) => { const list = EP(epId)?.models || [], gone = cur && !list.includes(cur);
    return `${gone ? `<option value="${esc(cur)}" selected>${esc(cur)}（接入里已经没有）</option>` : ''}${list.map(m => `<option${m === cur ? ' selected' : ''}>${esc(m)}</option>`).join('')}${list.length || gone ? '' : '<option value="">没有拉到模型</option>'}`; };
  const mockPull = base => /deepseek/.test(base) ? ['deepseek-chat', 'deepseek-reasoner'] : /anthropic/.test(base) ? ['claude-opus-4.1', 'claude-sonnet-4.5', 'claude-haiku-4.5'] : /moonshot|kimi/.test(base) ? ['kimi-k2', 'moonshot-v1-128k'] : ['gpt-5', 'gpt-5-mini', 'gpt-4.1'];
  const SKEYS = { ...Object.fromEntries(STAGES.flatMap(k => [[`stages.${k}.ep`, `${STAGE_NAME[k]}的接入`], [`stages.${k}.model`, `${STAGE_NAME[k]}的模型`], [`stages.${k}.fallback`, `${STAGE_NAME[k]}的备用模型`]])), queueLimit: '每人待处理上限', sched: '调度方式', ...Object.fromEntries(PROJECTS.map(p => [`weights.${p.id}`, `${p.name} 的调度权重`])), projectDay: '项目每日额度', projectMonth: '项目每月额度', memberDay: '成员每日新任务', workers: 'Worker 槽位', previews: '预览环境槽位', budget: '单任务预算上限', rounds: '审查轮数上限', idle: '沙箱空闲多久后暂停', chat: '推送到', 'sandbox.app': 'app VM 默认规格', 'sandbox.svc': '服务 VM 默认规格', 'sandbox.retention': '快照保留天数', 'sandbox.provider': '默认沙箱提供方', 'sandbox.overflow': '自建满载时溢出到云端', 'sandbox.overflowTo': '溢出到', 'notify.blocked': '推送：任务需要你回答或决定', 'notify.failed': '推送：任务失败', 'notify.mandate': '推送：需求单需要你确认', 'notify.pr': '推送：PR 等你审批', 'notify.env': '推送：环境计划等你确认', 'notify.memory': '推送：有新的记忆提议', 'artifacts.keep': '产物保留天数', 'artifacts.failKeep': '失败任务的产物保留天数' };
  const getK = (o, k) => k.split('.').reduce((a, x) => a?.[x], o);
  const setK = (o, k, v) => { const ks = k.split('.'), last = ks.pop(); ks.reduce((a, x) => a[x], o)[last] = v; };
  const fbName = v => { if (!v) return '不设'; const [ep, model] = v.split('|'); return `${EP(ep)?.name || ep} / ${model}`; };
  const fmtV = (k, v) => k === 'sched' ? (v === 'fair' ? '按项目权重公平分配' : '先来先做') : /\.fallback$/.test(k) ? fbName(v) : k === 'queueLimit' ? `${v} 件` : k === 'memberDay' ? `${v} 个` : /^project(Day|Month)$/.test(k) ? `¥${v}` : /\.ep$/.test(k) ? (EP(v)?.name || v) : typeof v === 'boolean' ? (v ? '开' : '关') : ['sandbox.provider', 'sandbox.overflowTo'].includes(k) ? provName(v) : k === 'budget' ? `¥${v}` : k === 'idle' ? `${v} 分钟` : /^artifacts/.test(k) ? `${v} 天` : v;
  const changeText = c => `${SKEYS[c.k]}：${fmtV(c.k, c.from)} → ${fmtV(c.k, c.to)}`;
  const diffSettings = (a, b) => Object.keys(SKEYS).filter(k => getK(a, k) !== getK(b, k)).map(k => ({ k, from: getK(a, k), to: getK(b, k) }));
  const snapshotAt = v => { const snap = JSON.parse(JSON.stringify({ stages: SETTINGS.stages, notify: SETTINGS.notify, sandbox: SETTINGS.sandbox, artifacts: SETTINGS.artifacts, weights: SETTINGS.weights, ...Object.fromEntries(['sched', 'workers', 'previews', 'budget', 'rounds', 'idle', 'chat', 'queueLimit', 'projectDay', 'projectMonth', 'memberDay'].map(k => [k, SETTINGS[k]])) })); SETTINGS.history.filter(h => h.v > v).forEach(h => h.changes.slice().reverse().forEach(c => setK(snap, c.k, c.from))); return snap; };
  const applySettings = (changes, note) => { changes.forEach(c => setK(SETTINGS, c.k, c.to)); SETTINGS.version += 1; SETTINGS.history.unshift({ v: SETTINGS.version, date: `今天 ${now()}`, who: '你', changes, note }); const hit = TICKETS.filter(t => overBudget(t)); return hit; };
  const pageSettings = () => {
    crumbs([['设置']]);
    const s = draft || SETTINGS;
    main.innerHTML = `
      <div class="page-head"><div><h1>设置</h1><p>保存后立即生效。每次保存留一个版本，当前第 ${SETTINGS.version} 版。</p></div></div>
      ${region({ what: '设置', emptyTitle: '设置还没初始化', emptyText: '第一次启动时会写入默认值。', rows: 8 }, () => `
      <section class="region" aria-labelledby="ep-h"><div class="region-head"><h2 id="ep-h">模型接入</h2><button class="btn btn--line" type="button" data-act="ep-add" aria-expanded="${addingEp}" aria-controls="ep-form">添加接入</button></div>
        <p class="ink-2">任何兼容 OpenAI 接口的服务都能接：填 Base URL 和 API key，模型列表从它的 <code>GET /v1/models</code> 拉取，不用手填模型名。</p>
        ${table('', [{ t: '名称' }, { t: 'Base URL' }, { t: 'API key' }, { t: '模型' }, { t: '用在' }, { t: '<span class="visually-hidden">操作</span>' }], SETTINGS.endpoints.map(e => { const used = STAGES.filter(k => SETTINGS.stages[k].ep === e.id); return `<tr>${td('', `<span class="title">${esc(e.name)}</span>`)}${td('Base URL', `<code>${esc(e.base)}</code>`)}${td('API key', e.key ? `<code>${esc(e.key)}</code>` : '<span class="note">不需要</span>')}${td('模型', e.models?.length ? `<span class="mlist"><button class="cbtn mlist__btn" type="button" data-ep="${e.id}" aria-haspopup="dialog" aria-expanded="false" aria-controls="mlpop" aria-label="${esc(e.name)} 拉到的 ${e.models.length} 个模型"><span class="mono">${e.models.length}</span> 个${I.down}</button><span class="note">${esc(e.pulled)} 拉取</span></span>` : '<span class="note">没有拉到</span>')}${td('用在', used.length ? used.map(k => STAGE_NAME[k]).join('、') : '<span class="note">没有阶段在用</span>')}${td('', `<div class="actions"><button class="btn btn--text" type="button" data-act="ep-pull" data-id="${e.id}">重新拉取</button>${used.length ? '' : `<button class="btn btn--text" type="button" data-act="ep-del" data-id="${e.id}">删除</button>`}</div>`)}</tr>`; }))}
        <form class="well stack-md form-narrow" id="ep-form" data-form="endpoint" data-endpoint="/api/model-endpoints"${addingEp ? '' : ' hidden'} novalidate>
          <h3>添加接入</h3>
          <div class="field"><label for="ep-name">名称</label><input class="input" id="ep-name" name="name" autocomplete="off" placeholder="例如：DeepSeek 官方"><span class="help" id="ep-name-help" data-orig="只是给自己看的名字">只是给自己看的名字</span></div>
          <div class="field"><label for="ep-base">Base URL</label><input class="input mono" id="ep-base" name="base" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1"><span class="help" id="ep-base-help" data-orig="OpenAI 兼容接口的根地址，一般以 /v1 结尾；添加时请求它的 /models">OpenAI 兼容接口的根地址，一般以 /v1 结尾；添加时请求它的 /models</span></div>
          <div class="field"><label for="ep-key">API key</label><input class="input" id="ep-key" name="key" type="password" autocomplete="off" aria-describedby="ep-key-help"><span class="help" id="ep-key-help" data-orig="只存在 Engine 的密钥库里，不进沙箱">只存在 Engine 的密钥库里，不进沙箱</span></div>
          <div class="actions actions--start"><button class="btn" type="submit">拉取模型并添加</button><button class="btn btn--line" type="button" data-act="ep-add">取消</button></div>
        </form>
      </section>
      <form id="settings" data-form="settings" data-endpoint="/api/settings" class="stack-xl">
        <section class="region" aria-labelledby="mo-h"><h2 id="mo-h">每个阶段用哪个模型</h2><p class="ink-2">不同阶段可以用不同的接入和模型。模型从所选接入拉到的列表里选，可以再配一个备用。</p>
          ${table('stage-table', [{ t: '阶段' }, { t: '接入' }, { t: '模型' }, { t: '备用模型' }], STAGES.map(k => `<tr>${td('', `<span class="title">${STAGE_NAME[k]}</span><span class="sub">${STAGE_DO[k]}</span>`)}${td('接入', selectWrap(`<select class="select" name="ep-${k}" aria-label="${STAGE_NAME[k]}的接入">${SETTINGS.endpoints.map(e => `<option value="${e.id}"${e.id === s.stages[k].ep ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`))}${td('模型', `${selectWrap(`<select class="select mono" id="md-${k}" name="md-${k}" aria-label="${STAGE_NAME[k]}的模型" aria-describedby="md-${k}-help">${modelOptions(s.stages[k].ep, s.stages[k].model)}</select>`)}<span class="help" id="md-${k}-help"></span>`)}${td('备用模型', selectWrap(`<select class="select mono" name="fb-${k}" aria-label="${STAGE_NAME[k]}的备用模型"><option value="">不设</option>${SETTINGS.endpoints.flatMap(e => (e.models || []).map(m => `<option value="${e.id}|${esc(m)}"${s.stages[k].fallback === `${e.id}|${m}` ? ' selected' : ''}>${esc(e.name)} / ${esc(m)}</option>`)).join('')}</select>`))}</tr>`))}
          <p class="note">主模型报过载或超时并重试失败后，这次请求切到备用模型；同一轮对话内保持同一个模型。主备都不可用，任务才进入等待。</p>
        </section>
        <section class="region" aria-labelledby="ex-h"><h2 id="ex-h">执行限制</h2>
          <div class="form-grid">
            ${numField('workers', 'Worker 槽位', s.workers, '另有 1 个固定留给你的消息')}
            ${numField('previews', '预览环境槽位', s.previews, '同时存在的 PR 预览环境上限')}
            ${numField('budget', '单任务预算上限（元）', s.budget, '超出后任务转为 blocked 并通知你')}
            ${numField('projectDay', '项目每日额度（元）', s.projectDay, '到 80% 通知审批人；用完后该项目的新任务排队')}
            ${numField('projectMonth', '项目每月额度（元）', s.projectMonth, '在跑的任务不会被中断')}
            ${numField('memberDay', '成员每日新任务（个）', s.memberDay, '用完后 Router 会告诉他今天的额度用完了')}
            ${numField('queueLimit', '每人待处理上限（件）', s.queueLimit, '超过后，会落到他身上的新任务先排队；建议值 5')}
            ${numField('rounds', '审查轮数上限', s.rounds, '超出后转给你，建议 3 到 5')}
            ${numField('idle', '沙箱空闲多久后暂停（分钟）', s.idle, '暂停会保存内存快照并释放内存')}
          </div></section>
        <section class="region" aria-labelledby="sc-h"><h2 id="sc-h">调度</h2><p class="ink-2">Worker 槽位不够时谁先开工。优先级高的总在前面；同一优先级再按这里的规则。</p>
          <div class="form-grid">
            <div class="field"><label for="s-sched">分配方式</label><span class="select-wrap select-wrap--block"><select class="select" id="s-sched" name="sched">${[['fair', '按项目权重公平分配'], ['fifo', '先来先做']].map(([v, l]) => `<option value="${v}"${v === s.sched ? ' selected' : ''}>${l}</option>`).join('')}</select>${I.down}</span><span class="help">公平分配：槽位按权重分给各项目，一个项目一下来很多任务也不会占满全部槽位</span></div>
            ${PROJECTS.map(p => numField(`w-${p.id}`, `${esc(p.name)} 的权重`, s.weights[p.id] || 1, '按比例分槽位，只在排队时起作用')).join('')}
          </div></section>
        <section class="region" aria-labelledby="sb-h"><h2 id="sb-h">沙箱默认值</h2><p class="ink-2">环境计划没有单独指定时用这些值。调度规则和镜像在 <a href="#sandboxes-config">沙箱</a> 里看。</p>
          <div class="form-grid">
            <div class="field"><label for="sb-app">app VM 规格</label><span class="select-wrap select-wrap--block"><select class="select" id="sb-app" name="sb-app">${['2 核 4G', '4 核 8G', '8 核 16G'].map(o => `<option${o === s.sandbox.app ? ' selected' : ''}>${o}</option>`).join('')}</select>${I.down}</span><span class="help">跑 PR 代码、Worker 和 Chromium</span></div>
            <div class="field"><label for="sb-svc">服务 VM 规格</label><span class="select-wrap select-wrap--block"><select class="select" id="sb-svc" name="sb-svc">${['1 核 2G', '2 核 4G', '4 核 8G'].map(o => `<option${o === s.sandbox.svc ? ' selected' : ''}>${o}</option>`).join('')}</select>${I.down}</span><span class="help">VM 组里的 MySQL、Kafka 等</span></div>
            ${numField('retention', '快照保留天数', s.sandbox.retention, '过期模板和暂停任务的快照到期清理')}
            <div class="field"><label for="sb-prov">默认提供方</label><span class="select-wrap select-wrap--block"><select class="select" id="sb-prov" name="sb-prov">${CFG.providers.filter(x => x.state === 'ok').map(x => `<option value="${x.id}"${x.id === s.sandbox.provider ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${I.down}</span><span class="help">项目没有单独指定时用这个；只列已连接的</span></div>
            <div class="field"><label for="sb-to">溢出到</label><span class="select-wrap select-wrap--block"><select class="select" id="sb-to" name="sb-to">${CFG.providers.filter(x => x.kind === 'cloud' && x.state === 'ok').map(x => `<option value="${x.id}"${x.id === s.sandbox.overflowTo ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${I.down}</span><label class="check"><input type="checkbox" name="sb-overflow"${s.sandbox.overflow ? ' checked' : ''}>自建满载时，把单 VM 任务溢出到云端</label></div>
          </div></section>
        <section class="region" aria-labelledby="rt-h"><h2 id="rt-h">数据保留</h2><p class="ink-2">事件里不存代码，长期保留；完整输出、截图、trace 和录像放对象存储，到期删除。存储前都做密钥扫描。</p>
          <div class="form-grid">${numField('keep', '产物保留天数', s.artifacts.keep, '完整命令输出、截图、trace、录像')}${numField('failKeep', '失败任务的产物保留天数', s.artifacts.failKeep, '失败任务留久一点，方便排查')}</div></section>
        <section class="region" aria-labelledby="nt-h"><h2 id="nt-h">飞书通知</h2>
          <div class="field field--narrow"><label for="chatname">推送到</label><span class="select-wrap select-wrap--block"><select class="select" id="chatname" name="chat">${['飞书群：Auto-CodWorker 通知', '飞书私聊：KaifengAn'].map(c => `<option${c === s.chat ? ' selected' : ''}>${c}</option>`).join('')}</select>${I.down}</span><span class="help"></span></div>
          <fieldset class="checks"><legend class="note">推送这些事项</legend>
            ${[['blocked', '任务需要你回答或决定'], ['failed', '任务失败'], ['mandate', '需求单需要你确认'], ['pr', 'PR 等你审批'], ['env', '环境计划等你确认'], ['memory', '有新的记忆提议']].map(([k, l]) => `<label class="check"><input type="checkbox" name="n-${k}"${s.notify[k] ? ' checked' : ''}>${l}</label>`).join('')}
          </fieldset>
          <figure class="feishu"><figcaption class="note">推送样例：需求单需要你确认时</figcaption>
            <div class="feishu-card"><p class="ink"><strong>T-134 子账号用量报表</strong></p><p class="ink-2">需求单等你确认：涉及计费与金额。</p><p class="ink-2">待确认：是否需要按子账号拆分账单金额，还是只展示用量？</p><div class="actions actions--start"><span class="feishu-btn">确认需求单</span><span class="feishu-btn">在控制台打开</span></div></div>
          </figure></section>
        <section class="region" aria-labelledby="hi-h"><h2 id="hi-h">历史版本</h2>
          ${table('', [{ t: '版本' }, { t: '时间' }, { t: '改了什么' }, { t: '<span class="visually-hidden">操作</span>' }], SETTINGS.history.map(h => `<tr>${td('版本', `第 ${h.v} 版${h.v === SETTINGS.version ? '<span class="sub">当前</span>' : ''}`)}${td('时间', `${esc(h.date)}<span class="sub">${esc(h.who)}</span>`)}${td('改了什么', `${h.note ? `<span class="ink">${esc(h.note)}</span><br>` : ''}${h.changes.map(c => esc(changeText(c))).join('<br>')}`)}${td('', h.v === SETTINGS.version ? '' : `<div class="actions"><button class="btn btn--text" type="button" data-act="rollback" data-v="${h.v}">回滚到这一版</button></div>`)}</tr>`))}
          <p class="note">回滚也会生成一个新版本，随时可以再改回来。</p>
        </section>
        <div class="savebar" id="savebar"${draft ? '' : ' hidden'}><span>有未保存的修改</span><div class="actions"><button class="btn btn--text" type="button" data-act="discard">放弃</button><button class="btn" type="submit">保存为第 ${SETTINGS.version + 1} 版</button></div></div>
      </form>`)}`;
    const f = $('#settings');
    if (!f) return;
    const validate = () => {
      let ok = true;
      f.querySelectorAll('.input[type=number]').forEach(inp => { const bad = inp.value === '' || +inp.value < 1; inp.setAttribute('aria-invalid', bad); const h = $(`#${inp.id}-help`); if (bad) { ok = false; h.dataset.error = ''; h.textContent = '需要填 1 或更大的整数'; } else { delete h.dataset.error; h.textContent = h.dataset.orig; } });
      const wk = $('#s-workers'), run = TICKETS.filter(t => t.kind === 'run').length, wh = $('#s-workers-help');
      if (wk.value !== '' && +wk.value < run) { ok = false; wk.setAttribute('aria-invalid', 'true'); wh.dataset.error = ''; wh.textContent = `现在有 ${run} 个 Worker 在跑，不能低于 ${run}`; }
      STAGES.forEach(k => { const inp = $(`#md-${k}`), h = $(`#md-${k}-help`), ep = EP(f.elements[`ep-${k}`].value); const bad = !inp.value.trim(), gone = !bad && !(ep?.models || []).includes(inp.value); inp.setAttribute('aria-invalid', bad); if (bad) { ok = false; h.dataset.error = ''; h.textContent = '这个接入没有拉到模型，先在上面重新拉取'; } else { delete h.dataset.error; h.textContent = gone ? `${ep.name} 的模型列表里已经没有它，换一个` : h.dataset.note || ''; } });
      const hr = $('#md-reviewer-help'); if (!hr.dataset.error && $('#md-reviewer').value.trim() === $('#md-worker').value.trim()) hr.textContent = '和开发用的是同一个模型，审查容易放过它自己的错误；可以保存';
      return ok;
    };
    f._validate = validate;
    if (draft) validate();
    f.addEventListener('input', e => {
      /* another connection: offer that connection's models, keep the same name when it has one */
      if (e.target.name?.startsWith('ep-')) { const k = e.target.name.slice(3), sel = $(`#md-${k}`), cur = sel.value, list = EP(e.target.value)?.models || [], keep = list.includes(cur); sel.innerHTML = modelOptions(e.target.value, keep ? cur : list[0]); $(`#md-${k}-help`).dataset.note = keep || !list.length ? '' : `换了接入，模型先选了 ${list[0]}`; }
      else if (e.target.name?.startsWith('md-')) $(`#${e.target.id}-help`).dataset.note = '';
      const fd = new FormData(f);
      draft = { sched: fd.get('sched'), weights: Object.fromEntries(PROJECTS.map(p => [p.id, +fd.get(`w-${p.id}`)])), queueLimit: +fd.get('queueLimit'), projectDay: +fd.get('projectDay'), projectMonth: +fd.get('projectMonth'), memberDay: +fd.get('memberDay'), workers: +fd.get('workers'), previews: +fd.get('previews'), budget: +fd.get('budget'), rounds: +fd.get('rounds'), idle: +fd.get('idle'), chat: fd.get('chat'), sandbox: { app: fd.get('sb-app'), svc: fd.get('sb-svc'), retention: +fd.get('retention'), provider: fd.get('sb-prov'), overflow: fd.get('sb-overflow') === 'on', overflowTo: fd.get('sb-to') || SETTINGS.sandbox.overflowTo }, stages: Object.fromEntries(STAGES.map(k => [k, { ep: fd.get(`ep-${k}`), model: (fd.get(`md-${k}`) || '').trim(), fallback: fd.get(`fb-${k}`) || '' }])), artifacts: { keep: +fd.get('keep'), failKeep: +fd.get('failKeep') }, notify: Object.fromEntries(['blocked', 'failed', 'mandate', 'pr', 'env', 'memory'].map(k => [k, fd.get(`n-${k}`) === 'on'])) };
      $('#savebar').hidden = false;
      validate();
    });
  };
  const numField = (name, label, val, help) => `<div class="field"><label for="s-${name}">${label}</label><input class="input num" id="s-${name}" name="${name}" type="number" inputmode="numeric" min="1" value="${val}" aria-describedby="s-${name}-help"><span class="help" id="s-${name}-help" data-orig="${esc(help)}">${esc(help)}</span></div>`;

  /* ---------- simulation: things keep moving ---------- */
  const setLiveDone = t => t.timeline.forEach(e => { e.live = false; });
  const push = (t, e) => { setLiveDone(t); t.timeline.push({ t: now(), ...e }); t.updated = now(); };
  const t133 = { review: false, e2e: false, envOk: false };
  const advanceT133 = () => {
    const t = T('T-133'); if (!t || !isOpen(t) || t.kind === 'you') return;
    if (t133.review && t133.e2e) {
      push(t, { kind: 'gate', what: '完成条件校验：5 项通过', d: 'Engine 按提交 8be04d2 查询' });
      t.pr = nextPR(repoOf(t)); t.prOpened = 'today';
      push(t, { kind: 'flag', what: `已开 PR ${prName(t)}，等你审批`, d: '沙箱已暂停' });
      Object.assign(t, { kind: 'you', since: now(), state: `等你审批 PR #${t.pr}`, why: '完成条件 5 项全部通过，不会自动合并', action: { label: `打开 PR #${t.pr}`, href: prLink(t) } });
      notify('pr', `${t.id} ${t.title}：PR #${t.pr} 等你审批`, link.ticket(t.id));
      t.sandbox.state = 'paused';
      MEMORY_PROPOSALS.push({ id: 'M-34', project: 'orcax-analytics', text: 'ClickHouse 批量写入必须带重试，批量失败不能整批丢弃。', from: 'T-133', why: '审查 F-2：写入失败整批丢弃' });
      notify('memory', 'T-133 提议 1 条 orcax 数据看板项目记忆', '#memory');
      return;
    }
    if (t133.review && !t133.envOk) { Object.assign(t, { kind: 'wait', state: '等环境计划 v2 确认', why: '确认后自动跑全量 E2E' }); }
  };
  const sim = [];
  const later = (ms, fn) => sim.push(setTimeout(() => { fn(); refresh(); }, ms));
  later(9000, () => {
    const t = T('T-133'); if (!t || t.kind === 'dropped') return;
    push(t, { kind: 'tool', what: 'review 第 2 轮：2 个发现，0 个已证实', d: '均为 P2，作为 PR 评论保留' });
    t.review.rounds[1] = { n: 2, commit: '8be04d2', found: 2, valid: 0, fixed: 0, verdict: '通过，2 条 P2 作为评论' };
    t.contract[2] = { t: t.contract[2].t, r: 'pass', s: '第 2 轮' };
    t133.review = true;
    if (!t133.envOk) push(t, { kind: 'report', what: '汇报 waiting', d: '等你确认环境计划 v2 后跑全量 E2E' });
    advanceT133();
  });

  const ciPass = t => { if (!t || t.kind !== 'wait' || !t.waitCI) return; push(t, { kind: 'gate', what: 'GitHub CI 通过', d: `PR #${t.pr}` }); Object.assign(t, { kind: 'you', since: now(), waitCI: false, state: `等你审批 PR #${t.pr}`, why: '完成条件 5 项和 CI 都通过，不会自动合并', action: { label: `打开 PR #${t.pr}`, href: prLink(t) } }); notify('pr', `${t.id} ${t.title}：PR #${t.pr} 等你审批`, link.ticket(t.id)); };
  later(20000, () => ciPass(T('T-125')));
  const refresh = () => {
    const a = document.activeElement;
    const typing = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox')) && a.value;
    if (typing || draft) { renderNav(parse().parts[0]); return; }
    const y = $('.main').scrollTop; render(true); $('.main').scrollTop = y;
  };

  /* ---------- autopilot: every running task advances one step at a time ---------- */
  let shaSeq = 0;
  const sha = () => ['5e1a7c2', 'd93b0f4', '0c7e2aa', 'a4f61d9', '7b2c8e5', 'e08d3b1'][shaSeq++ % 6];
  const C = (t, i, r, sTxt) => { t.contract[i] = { t: t.contract[i].t, r, s: sTxt }; };
  const STEP = {
    read: t => { const { p, dir, files, h, mod } = ctx(t); push(t, { kind: 'file', what: `读取 ${3 + h % 5} 个文件`, d: `${dir}/${files[h % 3]} 等；读了 ${p.memory.length} 条项目记忆` }); if (t.mandate?.scope?.[0] === 'Worker 读完代码后补充') Object.assign(t.mandate, { scope: [`${mod}模块（${dir}/）`], accept: [`${t.title}：主流程可用`, `${t.title}：空数据和出错时有提示`] }); t.state = `读代码，定位到${mod}模块`; },
    repro: t => { push(t, { kind: 'term', what: '复现成功：200 次里 3 次 500', d: 'Casdoor 回调超时后，会话写入空指针' }); t.state = '定位到原因，开始修复'; },
    edit: t => { const { dir, files, h } = ctx(t), c = sha(); t.commit = c; push(t, { kind: 'edit', what: `修改 ${2 + h % 4} 个文件`, d: `${dir}/${files[(h + 1) % 3]} 等，+${20 + h % 180} −${2 + h % 30}，提交 ${c}` }); C(t, 0, 'pass', `提交 ${c}`); C(t, 3, 'pass', '受保护的测试文件哈希一致'); t.state = '改完代码，准备测试'; },
    prtest: t => { const { dir } = ctx(t), acc = (t.mandate?.accept || []).slice(0, 2); t.e2e = t.e2e || { preview: null, tiers: [], fresh: [] }; t.e2e.fresh = acc.map(a => ({ name: `${dir}：${a}`, base: '失败', head: '通过', verdict: '有效' })); push(t, { kind: 'tool', what: `pr_test：Tester 按验收标准生成 ${acc.length} 个测试`, d: 'base 失败、head 通过，都有效' }); t.state = '测试已生成'; },
    review: t => { const { dir, files, h } = ctx(t); t.review = t.review || { rounds: [], findings: [] }; const n = t.review.rounds.length + 1, where = `${dir}/${files[h % 3]}:${40 + h % 120}`; push(t, { kind: 'tool', what: `review 第 ${n} 轮：无已证实的 P0 或 P1`, d: `1 条 P2 作为 PR 评论：${where} 失败分支没有打日志${n > SETTINGS.rounds ? `；超过上限 ${SETTINGS.rounds} 轮，由你放行` : ''}` }); t.review.rounds.push({ n, commit: t.commit || '最新', found: 1, valid: 0, fixed: 0, verdict: '通过，1 条 P2 作为评论' }); t.review.findings.push({ sev: 'P2', where, what: '失败分支没有打日志', ev: '代码阅读', st: '仅评论' }); C(t, 2, 'pass', `第 ${n} 轮`); t.state = '审查通过，跑全量 E2E'; },
    e2e: t => { const [crawl, smoke] = E2E_BASE[t.project] || [20, 10]; t.e2e = t.e2e || { preview: null, tiers: [], fresh: [] }; const f = t.e2e.fresh.length; push(t, { kind: 'tool', what: `run_e2e 全量：${smoke + f} 个用例全部通过`, d: `巡检 ${crawl} 个路由，冒烟与受影响 ${smoke}，新用例 ${f}` }); t.e2e.tiers = [{ name: '第 0 层巡检', pass: crawl, total: crawl, dur: `${18 + crawl % 30} 秒`, r: 'pass' }, { name: '冒烟与受影响用例', pass: smoke, total: smoke, dur: `${1 + smoke % 3} 分 ${10 + smoke % 40} 秒`, r: 'pass' }, ...(f ? [{ name: '本 PR 新用例', pass: f, total: f, dur: `${12 * f} 秒`, r: 'pass' }] : [])]; C(t, 1, 'pass', `${smoke + f} 个用例`); t.state = 'E2E 通过'; },
    rebase: t => { const c = sha(); t.commit = c; push(t, { kind: 'term', what: '变基到最新 main：没有冲突', d: `新提交 ${c}；range-diff 与变基前一致，沿用第 ${t.review?.rounds.length || 1} 轮审查结果` }); C(t, 0, 'pass', `提交 ${c}`); C(t, 3, 'pass', '受保护的测试文件哈希一致'); t.state = '变基完成，重跑全量 E2E'; },
    pr: t => {
      if (t.contract.some(c => c.r !== 'pass')) { push(t, { kind: 'gate', what: '完成条件校验未通过', d: t.contract.filter(c => c.r !== 'pass').map(c => c.t).join('、'), fail: true }); Object.assign(t, { kind: 'you', since: now(), state: '完成条件未通过', why: '请看右侧清单' }); notify('blocked', `${t.id} ${t.title}：完成条件未通过`, link.ticket(t.id)); return; }
      push(t, { kind: 'gate', what: '完成条件校验：5 项通过', d: `Engine 按提交 ${t.commit || '最新'} 查询` });
      if (t.group) { const nx = t.group.find(g => g.st === 'open'); push(t, { kind: 'flag', what: `PR 组已更新，${nx.repo}#${nx.pr} 等你审批`, d: '沙箱已暂停' }); Object.assign(t, { kind: 'you', since: now(), state: `等你审批 PR 组（还剩 ${t.group.filter(g => g.st === 'open').length} 个）`, why: `下一个合 ${nx.repo}#${nx.pr}`, action: { label: `打开 ${nx.repo}#${nx.pr}`, href: gLink(nx) } }); if (t.sandbox) t.sandbox.state = 'paused'; notify('pr', `${t.id} ${t.title}：PR 组等你审批`, link.ticket(t.id)); return; }
      if (t.quiet) { delete t.quiet; push(t, { kind: 'flag', what: `变基后完成条件重新通过，回到等你审批 PR #${t.pr}`, d: '不重复通知；沙箱已暂停' }); Object.assign(t, { kind: 'you', state: `等你审批 PR #${t.pr}`, why: '变基到最新 main 后 5 项重新通过，不会自动合并', action: { label: `打开 PR #${t.pr}`, href: prLink(t) } }); if (t.sandbox) t.sandbox.state = 'paused'; return; }
      if (!t.pr) { t.pr = nextPR(repoOf(t)); t.prOpened = 'today'; }
      push(t, { kind: 'flag', what: `已开 PR ${prName(t)}，等你审批`, d: '沙箱已暂停' });
      Object.assign(t, { kind: 'you', since: now(), state: `等你审批 PR #${t.pr}`, why: '完成条件 5 项全部通过，不会自动合并', action: { label: `打开 PR #${t.pr}`, href: prLink(t) } });
      if (t.sandbox) t.sandbox.state = 'paused';
      notify('pr', `${t.id} ${t.title}：PR #${t.pr} 等你审批`, link.ticket(t.id));
    },
  };
  const PIPE = { full: ['read', 'edit', 'prtest', 'review', 'e2e', 'pr'], fix: ['edit', 'review', 'e2e', 'pr'], retry: ['e2e', 'review', 'pr'], casdoor: ['repro', 'edit', 'prtest', 'review', 'e2e', 'pr'], open: ['pr'], rebase: ['rebase', 'e2e', 'pr'] };
  const overBudget = t => {
    const limit = t.budget || SETTINGS.budget;
    if (t.kind !== 'run' || t.cost <= limit) return false;
    const raise = Math.ceil(t.cost * 1.5 / 10) * 10;
    push(t, { kind: 'flag', what: '超出单任务预算，Worker 暂停', d: `已花 ¥${t.cost.toFixed(0)}，上限 ¥${limit}` });
    Object.assign(t, { kind: 'you', since: now(), state: '超出单任务预算', why: `已花 ¥${t.cost.toFixed(0)}，上限 ¥${limit}`, action: null,
      ask: { kind: 'budget', raise, text: `${t.id} 已花 ¥${t.cost.toFixed(0)}，超过单任务上限 ¥${limit}，Worker 已暂停。提高这个任务的上限继续，还是停下？`, help: '只改这个任务的上限，不影响设置里的默认值。', placeholder: '例如：这个任务值得，继续', options: [{ value: 'raise', label: `上限提高到 ¥${raise}，继续`, primary: true }, { value: 'stop', label: '停止任务' }] } });
    if (t.sandbox) t.sandbox.state = 'paused';
    notify('blocked', `${t.id} ${t.title}：超出单任务预算`, link.ticket(t.id));
    return true;
  };
  const startAuto = (t, pipe) => { t.auto = [...PIPE[pipe]]; };
  setInterval(() => { const lv = $('#live'); if (lv) lv.innerHTML = `${OPS.drain ? '排空中' : '实时'}<span class="mono">${now()}</span>`; }, 15000);
  setInterval(() => {
    if (OPS.drain) return;
    let moved = false;
    TICKETS.forEach(t => {
      if (t.kind !== 'run' || !t.auto?.length) return;
      const name = t.auto.shift(); STEP[name](t); t.cost += 4; t.updated = now(); if (t.sandbox && isCloud(t.sandbox.provider)) t.sandbox.hours = (t.sandbox.hours || 0) + 0.1;
      if (!t.auto.length) delete t.auto;
      overBudget(t); moved = true;
    });
    if (moved) refresh();
  }, 4500);

  /* ---------- router ---------- */
  const parse = () => {
    const h = decodeURIComponent(location.hash.replace(/^#/, '')) || 'overview';
    const params = new URLSearchParams(); let m;
    if ((m = h.match(/^ticket-(T-\d+)(?:-(review|e2e|mandate|sandbox|rollout))?$/))) { if (m[2]) params.set('tab', m[2]); return { parts: ['ticket', m[1]], params }; }
    if ((m = h.match(/^tickets(?:-(you|ended|all))?$/))) { if (m[1]) params.set('tab', m[1]); return { parts: ['tickets'], params }; }
    if ((m = h.match(/^envplan-(.+)-(v\d+)$/))) return { parts: ['envplan', m[1], m[2]], params };
    if ((m = h.match(/^plan-(P-\d+)$/))) return { parts: ['plan', m[1]], params };
    if ((m = h.match(/^report-(T-\d+)-(\d+)$/))) return { parts: ['report', m[1], m[2]], params };
    if ((m = h.match(/^route-(R-\d+)$/))) return { parts: ['route', m[1]], params };
    if (h.startsWith('project-')) {
      const rest = h.slice(8), p = PROJECTS.slice().sort((a, b) => b.id.length - a.id.length).find(x => rest === x.id || rest.startsWith(`${x.id}-`));
      if (p) { const tab = rest.slice(p.id.length + 1); if (tab) params.set('tab', tab); return { parts: ['project', p.id], params }; }
      return { parts: ['project', rest], params };
    }
    if ((m = h.match(/^sandboxes-(templates|config|providers)$/))) { params.set('tab', m[1]); return { parts: ['sandboxes'], params }; }
    if (h === 'cost-30d') { params.set('range', '30d'); return { parts: ['cost'], params }; }
    if (h === 'config') return { parts: ['settings'], params };
    return { parts: [h], params };
  };
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
  let mlBtn = null; const mlPop = document.createElement('div'); mlPop.className = 'dd__pop dd__pop--view'; mlPop.id = 'mlpop'; mlPop.hidden = true; mlPop.tabIndex = -1; mlPop.setAttribute('role', 'dialog'); document.body.append(mlPop);
  const mlHide = refocus => { if (!mlBtn) return; const b = mlBtn; mlBtn = null; mlPop.hidden = true; mlPop.innerHTML = ''; if (b.isConnected) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); } };
  const mlShow = btn => {
    ddHide(); mlHide(); const e = EP(btn.dataset.ep), search = e.models.length > 8;
    mlPop.setAttribute('aria-label', `${e.name} 拉到的模型`);
    mlPop.innerHTML = `${search ? `<div class="dd__find"><input class="dd__search input" type="text" aria-label="在 ${esc(e.name)} 的模型里搜索" placeholder="搜索" autocomplete="off" spellcheck="false"></div>` : ''}
      <ul class="dd__list mono">${e.models.map(m => { const used = STAGES.filter(k => SETTINGS.stages[k].ep === e.id && SETTINGS.stages[k].model === m); const ctx = SETTINGS.catalog[m], manual = SETTINGS.catalogManual[m]; return `<li class="dd__opt"><span>${esc(m)}</span><span class="dd__used">${used.map(k => `<span class="tag">${STAGE_NAME[k]}</span>`).join('')}${ctx || manual ? `<span class="dd__ctx">${ctx || manual}${ctx ? '' : ' 手填'}</span>` : '<span class="tag tag--bad">缺上下文窗口</span>'}</span></li>`; }).join('')}</ul>
      <p class="dd__none" hidden>没有匹配的模型</p>
      <p class="dd__foot"><span class="mono">GET ${esc(e.base)}/models</span><span>${esc(e.pulled)} 拉取</span><span>上下文窗口来自内置模型目录，目录里没有的要手填才能选</span></p>`;
    mlPop.hidden = false; btn.setAttribute('aria-expanded', 'true'); mlBtn = btn; ddPlace(mlPop, btn);
    ((!matchMedia('(pointer: coarse)').matches && $('.dd__search', mlPop)) || mlPop).focus({ preventScroll: true });
  };
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

  /* ---------- plans: one confirmation for a whole task graph ---------- */
  const planOf = id => TICKETS.find(t => t.plan?.id === id);
  const planTaskSt = x => { const t = x.ticket && T(x.ticket); return !t ? ['', '未开始'] : t.kind === 'done' ? ['ok', '已合并'] : needsYou(t) ? ['you', '等你处理'] : t.queued ? ['', '排队中'] : ['warm', '进行中']; };
  const planDepth = tasks => { const d = []; tasks.forEach((x, i) => { d[i] = x.deps.length ? Math.max(...x.deps.map(j => d[j - 1] ?? 0)) + 1 : 0; }); return d; };
  const planEst = tasks => tasks.reduce((a, x) => a + x.est, 0);
  /* rough width: CJK glyphs are one em, Latin about half */
  const fitText = (str, max, em) => { let w = 0, out = ''; for (const ch of str) { w += /[\u2E80-\uFFEF]/.test(ch) ? em : em * 0.55; if (w > max - em) return `${out}…`; out += ch; } return str; };
  const planSvg = (tasks, mark = {}) => {
    const d = planDepth(tasks), nw = 244, nh = 58, gx = 56, gy = 16, pad = 6, cols = Math.max(...d) + 1;
    const inCol = c => tasks.filter((_, i) => d[i] === c).length, rows = Math.max(...Array.from({ length: cols }, (_, c) => inCol(c)));
    const W = pad * 2 + cols * nw + (cols - 1) * gx, H = pad * 2 + rows * nh + (rows - 1) * gy, seen = {};
    const pos = tasks.map((_, i) => { const c = d[i], r = seen[c] = (seen[c] ?? -1) + 1, off = (rows - inCol(c)) * (nh + gy) / 2; return { x: pad + c * (nw + gx), y: pad + off + r * (nh + gy) }; });
    const edges = tasks.flatMap((x, i) => x.deps.map(j => { const a = pos[j - 1], b = pos[i], ay = a.y + nh / 2, by = b.y + nh / 2, ax = a.x + nw, bx = b.x - 7, mx = (ax + bx) / 2;
      return `<path class="pg__edge" d="M${ax} ${ay} C${mx} ${ay} ${mx} ${by} ${bx} ${by}"/><path class="pg__tip" d="M${bx} ${by - 4} L${bx + 7} ${by} L${bx} ${by + 4}z"/>`; })).join('');
    const nodes = tasks.map((x, i) => { const p = pos[i], [s, sw] = planTaskSt(x), m = mark[i], t = fitText(x.title, 196, 14);
      return `<g class="pg__node" data-s="${s}"${m ? ` data-m="${m}"` : ''}><title>${esc(x.title)}</title><rect x="${p.x}" y="${p.y}" width="${nw}" height="${nh}" rx="8"/><text class="pg__n" x="${p.x + 12}" y="${p.y + 23}">${i + 1}</text><text class="pg__t" x="${p.x + 28}" y="${p.y + 23}">${esc(t)}</text><text class="pg__s" x="${p.x + 28}" y="${p.y + 43}">${x.ticket ? `${x.ticket}，` : ''}${sw}，约 ¥${x.est}${m === 'new' ? '，新增' : m === 'changed' ? '，改动' : ''}</text></g>`; }).join('');
    return `<div class="pg-wrap"><svg class="pg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="任务依赖图：${tasks.map((x, i) => `${i + 1} ${esc(x.title)}${x.deps.length ? `，依赖 ${x.deps.join('、')}` : ''}`).join('；')}">${edges}${nodes}</svg></div>`;
  };
  const planDiff = (a, b) => {
    const key = x => x.title, old = new Map(a.map((x, i) => [key(x), { x, i }])), out = [], mark = {};
    b.forEach((x, i) => { const o = old.get(key(x));
      if (!o) { mark[i] = 'new'; out.push(['new', `新增任务 ${i + 1}：${x.title}`, `覆盖验收 ${x.covers.join('、') || '无'}，约 ¥${x.est}${x.deps.length ? `，依赖任务 ${x.deps.join('、')}` : '，没有依赖，确认后马上开工'}`]); return; }
      const ch = [];
      if (o.x.covers.join() !== x.covers.join()) ch.push(`覆盖验收从 ${o.x.covers.join('、') || '无'} 改成 ${x.covers.join('、') || '无'}`);
      const was = o.x.deps.map(j => a[j - 1].title), now2 = x.deps.map(j => b[j - 1].title), more = now2.filter(n => !was.includes(n)), less = was.filter(n => !now2.includes(n));
      if (more.length) ch.push(`多了依赖：${more.join('、')}`);
      if (less.length) ch.push(`不再依赖：${less.join('、')}`);
      if (o.x.est !== x.est) ch.push(`估算从 ¥${o.x.est} 改成 ¥${x.est}`);
      if (ch.length) { mark[i] = 'changed'; out.push(['changed', `任务 ${i + 1}：${x.title}`, ch.join('；')]); }
    });
    a.forEach(x => { if (!b.some(y => key(y) === key(x))) out.push(['removed', `去掉任务：${x.title}`, x.ticket ? `${x.ticket} 会停止` : '还没开工，直接去掉']); });
    return { out, mark };
  };
  const coverTable = (t, tasks) => table('', [{ t: '验收标准' }, { t: '类型' }, { t: '由哪些任务覆盖' }], t.mandate.accept.map((a, i) => { const by = tasks.map((x, j) => x.covers.includes(i + 1) ? j + 1 : 0).filter(Boolean);
    return `<tr>${td('验收标准', `<span class="mono">${i + 1}</span> ${esc(a)}`)}${td('类型', `<span class="tag">${KIND[t.mandate.kinds?.[i] || 'func']}</span>`)}${td('由哪些任务覆盖', by.length ? by.map(n => `任务 ${n}`).join('、') : '<span class="tag tag--bad">没有任务覆盖</span>')}</tr>`; }));
  const pagePlan = id => {
    const t = planOf(id);
    if (!t) { crumbs([['任务', '#tickets'], [id]]); main.innerHTML = `<div class="empty"><h1>找不到计划 ${esc(id)}</h1><p>编号可能写错了。</p><a class="btn btn--line" href="#tickets">回到任务列表</a></div>`; return; }
    const pl = t.plan, rp = pl.replan, est = planEst(pl.tasks), spent = pl.tasks.reduce((a, x) => a + (x.ticket ? T(x.ticket)?.cost || 0 : 0), 0);
    crumbs([['任务', '#tickets'], [`${t.id} ${t.title}`, link.ticket(t.id, 'mandate')], [`计划 ${pl.id}`]]);
    const st = rp ? ['you', '改动等你确认'] : pl.st === 'open' ? ['you', '等你确认'] : ['ok', '已确认'];
    const df = rp && planDiff(pl.tasks, rp.tasks), est2 = rp && planEst(rp.tasks);
    main.innerHTML = `
      <div class="page-head"><div><h1>计划 ${pl.id}：${esc(t.mandate.goal)}</h1><p>来自 ${cbtn(link.ticket(t.id, 'mandate'), `<span class="mono">${t.id}</span>`)}，${pLink(t.project)}，第 ${pl.v} 版。确认一次，任务按依赖自动开工；Worker 想改计划时要再确认一次。</p></div><span class="tag${st[0] === 'ok' ? ' tag--ok' : ' tag--you'}">${st[1]}</span></div>
      ${region({ what: '计划', emptyTitle: '这个任务没有拆成计划', emptyText: '小任务不拆计划，直接一个 PR。', rows: 6 }, () => `
      ${rp ? `<section class="well stack-md" aria-labelledby="rp-h"><div class="region-head"><h2 id="rp-h">Worker 提议改计划</h2><p>${esc(rp.t)} 提出，${esc(t.id)} 在这期间继续做不受影响的部分</p></div>
        <p class="ink">${esc(rp.why)}</p>
        <ul class="plandiff">${df.out.map(([k, a, b]) => `<li data-k="${k}"><span class="tag${k === 'new' ? ' tag--ok' : k === 'removed' ? ' tag--bad' : ' tag--warm'}">${{ new: '新增', changed: '改动', removed: '去掉' }[k]}</span><div><p class="ink">${esc(a)}</p><p class="note">${esc(b)}</p></div></li>`).join('')}</ul>
        ${planSvg(rp.tasks, df.mark)}
        <p class="ink-2">预算：估算从 ¥${est} 变成 ¥${est2}，计划上限从 ¥${Math.ceil(est * 1.2)} 变成 ¥${Math.ceil(est2 * 1.2)}。</p>
        <form class="stack-sm" data-form="replan" data-id="${pl.id}" data-endpoint="/api/plans/${pl.id}/replan">
          <div class="field field--narrow"><label for="rp-r">不同意时写原因（可选）</label><input class="input" id="rp-r" name="reason" autocomplete="off"></div>
          <div class="actions actions--start"><button class="btn" type="submit" name="d" value="ok">确认改动</button><button class="btn btn--line" type="submit" name="d" value="no">不改，按原计划</button></div>
        </form></section>` : ''}
      ${pl.st === 'open' ? `<div class="well well--row"><p class="ink">计划和需求单一起确认：确认需求单就确认了这份计划。</p><a class="btn" href="${link.ticket(t.id, 'mandate')}">去确认需求单</a></div>` : ''}
      <section class="region" aria-labelledby="pg-h"><div class="region-head"><h2 id="pg-h">任务图${rp ? '（现在）' : ''}</h2><p>箭头从被依赖的任务指向后做的任务</p></div>${planSvg(pl.tasks)}
        <ol class="accept accept--plan">${pl.tasks.map((x, i) => `<li data-s="${planTaskSt(x)[0] === 'ok' ? 'ok' : 'todo'}"><span class="accept__n mono">${i + 1}</span><div><p>${x.ticket ? `<a href="${link.ticket(x.ticket)}">${esc(x.title)}</a>` : esc(x.title)}</p><p class="note">${x.deps.length ? `依赖任务 ${x.deps.join('、')}` : '没有依赖'}${x.stacked ? '，用叠放 PR 提前开工' : ''}${x.after ? `，排在${esc(x.after)}` : ''}</p></div><span class="accept__side"><span class="tag">${planTaskSt(x)[1]}</span></span></li>`).join('')}</ol></section>
      <section class="region" aria-labelledby="cv-h"><div class="region-head"><h2 id="cv-h">验收覆盖</h2><p>每条验收标准至少要有一个任务覆盖，否则不能确认</p></div>${coverTable(t, pl.tasks)}</section>
      <section class="region" aria-labelledby="bd-h"><h2 id="bd-h">预算</h2>${kv([['各任务估算合计', `¥${est}`], ['计划上限', `¥${Math.ceil(est * 1.2)}`, '估算加 20%，超出后整份计划停下等你'], ['已花', `¥${spent.toFixed(0)}`, `${Math.round(spent / Math.ceil(est * 1.2) * 100)}%`]])}</section>
      <section class="region" aria-labelledby="ph-h"><h2 id="ph-h">记录</h2><dl class="facts">${pl.history.map(h => `<dt class="mono">${esc(h.t)}</dt><dd>${esc(h.what)}</dd>`).join('')}</dl></section>`)}`;
  };

  /* ---------- evidence reports: performance runs and stress runs ---------- */
  const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const runChart = r => {
    const max = Math.ceil((Math.max(...r.base, ...r.head, r.target) + 5) / 10) * 10, W = 640, L = 64, R = 16, H = 132, x = v => L + (v / max) * (W - L - R), rows = [['base', '改动前', r.base, 40], ['head', '改动后', r.head, 84]];
    const ticks = Array.from({ length: max / 10 + 1 }, (_, i) => i * 10);
    return `<figure class="rchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每轮${esc(r.metric)}：改动前 ${r.base.join('、')} ${r.unit}，改动后 ${r.head.join('、')} ${r.unit}，目标 ${r.target} ${r.unit}">
      ${ticks.map(v => `<line class="rchart__grid" x1="${x(v)}" x2="${x(v)}" y1="20" y2="104"/><text class="rchart__tick" x="${x(v)}" y="122">${v}</text>`).join('')}
      <line class="rchart__target" x1="${x(r.target)}" x2="${x(r.target)}" y1="14" y2="108"/><text class="rchart__lab" x="${x(r.target) + 6}" y="16">目标 ${r.target} ${r.unit}</text>
      ${rows.map(([k, name, vs, y]) => `<text class="rchart__row" x="0" y="${y + 4}">${name}</text>${vs.map((v, i) => `<circle class="rchart__dot rchart__dot--${k}" cx="${x(v)}" cy="${y}" r="5"><title>${name}第 ${i + 1} 轮：${v} ${r.unit}</title></circle>`).join('')}<line class="rchart__med rchart__med--${k}" x1="${x(median(vs))}" x2="${x(median(vs))}" y1="${y - 11}" y2="${y + 11}"/>`).join('')}
    </svg><figcaption><ul class="legend" aria-label="图例"><li><i class="sdot sdot--base"></i>改动前（base）</li><li><i class="sdot sdot--head"></i>改动后（head）</li><li><i class="sdot sdot--med"></i>竖线是 5 轮中位数</li></ul></figcaption></figure>`;
  };
  const pageReport = (id, n) => {
    const t = T(id), ev = t?.mandate?.evidence?.[n], r = ev?.report;
    if (!r) { crumbs([['任务', '#tickets'], [id]]); main.innerHTML = `<div class="empty"><h1>没有这份报告</h1><p>这条验收标准还没有取证。</p><a class="btn btn--line" href="${t ? link.ticket(t.id, 'mandate') : '#tickets'}">回到需求单</a></div>`; return; }
    const kind = t.mandate.kinds[n];
    crumbs([['任务', '#tickets'], [`${t.id} ${t.title}`, link.ticket(t.id, 'mandate')], [`验收 ${n + 1} 的报告`]]);
    const head = `<div class="page-head"><div><h1>验收 ${n + 1}：${esc(t.mandate.accept[n])}</h1><p>${KIND[kind]}取证，提交 <span class="mono">${esc(r.commit)}</span>，${esc(r.at)} 生成。报告由 Tester 在沙箱里跑出来，数字不经过模型改写。</p></div><span class="tag${ev.ok ? ' tag--ok' : ''}">${ev.ok ? `${I.check}通过` : '取证中'}</span></div>`;
    if (r.kind === 'perf') {
      const mb = median(r.base), mh = median(r.head);
      main.innerHTML = `${head}${region({ what: '报告', emptyTitle: '没有报告', emptyText: '', rows: 6 }, () => `
        <section class="region" aria-labelledby="rv-h"><h2 id="rv-h">结论</h2>
          <p class="ink">改动后中位数 ${mh} ${r.unit}，低于目标 ${r.target} ${r.unit}；比改动前的 ${mb} ${r.unit} 少 ${mb - mh} ${r.unit}，远大于噪声带 ${r.noise} ${r.unit}。</p>
          <p class="note">判定规则：改动后的中位数达到目标，并且和改动前的差距大于两边各自 5 轮的波动（噪声带）。只跑一轮的结果不算数。</p></section>
        <section class="region" aria-labelledby="rc-h"><h2 id="rc-h">每轮结果</h2>${runChart(r)}
          ${table('', [{ t: '轮次' }, { t: `改动前（${r.unit}）`, num: 1 }, { t: `改动后（${r.unit}）`, num: 1 }], r.base.map((v, i) => `<tr>${td('轮次', `第 ${i + 1} 轮`)}${td(`改动前（${r.unit}）`, v, 1)}${td(`改动后（${r.unit}）`, r.head[i], 1)}</tr>`))}</section>
        <section class="region" aria-labelledby="ro-h"><div class="region-head"><h2 id="ro-h">其他指标</h2><p>看有没有用别的资源换来这个结果</p></div>
          ${table('', [{ t: '指标' }, { t: '改动前' }, { t: '改动后' }, { t: '判定' }], r.other.map(([k, a, b, s]) => `<tr>${td('指标', esc(k))}${td('改动前', esc(a))}${td('改动后', esc(b))}${td('判定', s === 'ok' ? `<span class="tag tag--ok">${I.check}没有变差</span>` : s === 'warn' ? '<span class="tag tag--warm">变多，在允许的 20% 以内</span>' : '<span class="tag tag--bad">变差，超出允许范围</span>')}</tr>`))}</section>
        <section class="region" aria-labelledby="re-h"><h2 id="re-h">怎么跑的</h2>${kv([['脚本', `<code>${esc(r.script)}</code>`], ['负载', esc(r.load)], ['指标', esc(r.metric)], ['环境', esc(r.env)]])}</section>`)}`;
      return;
    }
    main.innerHTML = `${head}${region({ what: '报告', emptyTitle: '没有报告', emptyText: '', rows: 6 }, () => `
      <section class="region" aria-labelledby="rv-h"><h2 id="rv-h">进度</h2>
        <p class="ink">第 ${r.done + 1} / ${r.runs} 轮在跑。前 ${r.done} 轮每条不变量都成立；5 轮全部成立才算通过。</p>
        <div class="pbar" role="img" aria-label="已完成 ${r.done} / ${r.runs} 轮"><span style="width:${Math.round(r.done / r.runs * 100)}%"></span></div>
        <p class="note">故障按固定种子 ${r.seed} 注入，任何一轮出问题都能原样复现。</p></section>
      <section class="region" aria-labelledby="ri-h"><div class="region-head"><h2 id="ri-h">不变量</h2><p>每轮结束后对账检查，不看日志里有没有报错</p></div>
        ${table('', [{ t: '不变量' }, { t: '结果' }], r.invariants.map(([k, v]) => `<tr>${td('不变量', esc(k))}${td('结果', `<span class="tag tag--ok">${I.check}${esc(v)}</span>`)}</tr>`))}</section>
      <section class="region" aria-labelledby="rf-h"><div class="region-head"><h2 id="rf-h">故障注入</h2><p>每轮注入一种故障</p></div>
        ${table('', [{ t: '轮次' }, { t: '注入的故障' }, { t: '结果' }], r.faults.map(([k, s, v], i) => `<tr>${td('轮次', `第 ${i + 1} 轮`)}${td('注入的故障', esc(k))}${td('结果', s === 'done' ? `<span class="tag tag--ok">${I.check}通过</span><span class="sub">${esc(v)}</span>` : s === 'now' ? '<span class="tag tag--warm">进行中</span>' : '<span class="note">未开始</span>')}</tr>`))}</section>
      <section class="region" aria-labelledby="re-h"><h2 id="re-h">怎么跑的</h2>${kv([['脚本', `<code>${esc(r.script)}</code>`], ['负载', esc(r.load)], ['种子', `<span class="mono">${r.seed}</span>`]])}</section>`)}`;
  };

  /* ---------- Router replay: each decision is a pure function of a stored input ---------- */
  const DEC = { 新开任务: 'new_ticket', 直接回答: 'answer', 发给已有任务: 'route_to_ticket', '先问你，再新开任务': 'ask_then_new' };
  const routeOf = id => ROUTING.find(r => r.id === id);
  const routeIn = r => {
    const lead = r.visitor ? `${r.visitor}（没有登记，按访客）` : /^飞书/.test(r.src) ? '林舟（OrcaRouter 审批）' : '你（管理）';
    const threadT = r.project ? TICKETS.filter(t => t.project === r.project && isOpen(t) && t.id !== r.ticket && t.created <= r.t).slice(0, 3).map(t => t.id) : [];
    const hash = [...`${r.t}${r.msg}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0');
    return { sender: lead, channel: r.src, bound: /^飞书群：(.+)$/.test(r.src) ? `绑定项目 ${pname(r.project)}` : '没有绑定项目', thread: threadT, alias: r.project ? P(r.project).modules.filter(m => r.msg.includes(m) || r.why.includes(m)) : [], model: r.model || SETTINGS.stages.router.model, prompt: r.prompt || SETTINGS.routerPrompt.cur, hash };
  };
  const routeOut = r => ({ decision: DEC[r.decision] || r.decision, project: r.project || null, ticket: r.decision === '发给已有任务' ? r.ticket : null, confidence: r.conf, ask: r.decision.startsWith('先问') ? '看板指哪个项目' : null });
  /* the mock: a smaller model guesses on ambiguous wording; prompt v8 sends cross-project words back to you */
  const replayOut = (r, model, prompt) => {
    const o = routeOut(r);
    if (r.visitor) return o;
    const vague = /看板|报表|进度/.test(r.msg) && r.conf !== '高';
    if (vague && prompt === 'v7' && /mini|deepseek-chat/.test(model)) return { ...o, decision: 'new_ticket', project: 'orcarouter', confidence: '中', ask: null };
    if (/deepseek-chat/.test(model) && r.decision === '发给已有任务') return { ...o, decision: 'new_ticket', ticket: null, confidence: '中' };
    if (prompt === 'v8' && /偶发|偶尔/.test(r.msg) && o.decision === 'new_ticket') return { ...o, ask: '最近一次出错的时间和账号' };
    return o;
  };
  const replays = {};
  let replayAll = null;
  const pageRoute = id => {
    const r = routeOf(id);
    if (!r) { crumbs([['路由记录', '#routing'], [id]]); main.innerHTML = `<div class="empty"><h1>找不到这条路由记录</h1><p>编号可能写错了。</p><a class="btn btn--line" href="#routing">回到路由记录</a></div>`; return; }
    const inp = routeIn(r), out = routeOut(r), rp = replays[id], same = rp && Object.keys(out).every(k => out[k] === rp.out[k]);
    crumbs([['路由记录', '#routing'], [`${r.id} ${r.msg.length > 14 ? `${r.msg.slice(0, 13)}…` : r.msg}`]]);
    const models = SETTINGS.endpoints.flatMap(e => (e.models || []).map(m => [`${e.id}|${m}`, `${e.name} / ${m}`]));
    const json = o => `<pre class="json"><code>${esc(JSON.stringify(o, null, 2))}</code></pre>`;
    main.innerHTML = `
      <div class="page-head"><div><h1>${esc(r.msg)}</h1><p>${esc(r.t)}，来自${esc(r.src)}。Router 不记上下文：每次判断只读下面这份输入，所以换个模型或提示词重放，结果可以直接比较。</p></div><span class="mono">${r.id}</span></div>
      ${region({ what: '路由输入', emptyTitle: '没有输入快照', emptyText: '', rows: 6 }, () => `
      <div class="two two--even">
        <section class="region" aria-labelledby="ri-h"><div class="region-head"><h2 id="ri-h">输入</h2><p>哈希 <span class="mono">${inp.hash}</span></p></div>
          ${kv([['消息', esc(r.msg)], ['发送人', esc(inp.sender)], ['渠道', esc(inp.channel), esc(inp.bound)], ['线程里的未结束任务', inp.thread.length ? inp.thread.map(x => cbtn(link.ticket(x), `<span class="mono">${x}</span>`)).join(' ') : '无'], ['命中的模块', inp.alias.length ? esc(inp.alias.join('、')) : '无'], ['模型', `<span class="mono">${esc(inp.model)}</span>`], ['提示词', `<span class="mono">${esc(inp.prompt)}</span>`, '当前版本']])}</section>
        <section class="region" aria-labelledby="ro-h"><div class="region-head"><h2 id="ro-h">当时的判断</h2><p>${esc(r.why)}</p></div>${json(out)}
          ${r.visitor ? '<p class="note">访客只能得到回答：这一条由代码决定，不经过模型，换模型重放也不会变。</p>' : ''}</section>
      </div>
      <section class="well stack-md" aria-labelledby="rr-h"><h2 id="rr-h">重放</h2>
        <form class="stack-md" data-form="replay" data-id="${r.id}" data-endpoint="/api/router/replay">
          <div class="form-grid">
            <div class="field"><label for="rr-m">模型</label><span class="select-wrap select-wrap--block"><select class="select" id="rr-m" name="model">${models.map(([v, l]) => `<option value="${esc(v)}"${(rp ? rp.model : `${SETTINGS.stages.router.ep}|${inp.model}`) === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${I.down}</span></div>
            <div class="field"><label for="rr-p">提示词</label><span class="select-wrap select-wrap--block"><select class="select" id="rr-p" name="prompt">${[[SETTINGS.routerPrompt.cur, `${SETTINGS.routerPrompt.cur}（当前）`], [SETTINGS.routerPrompt.draft, `${SETTINGS.routerPrompt.draft}（草稿）`]].map(([v, l]) => `<option value="${v}"${(rp ? rp.prompt : inp.prompt) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>${I.down}</span></div>
          </div>
          <p class="note">提示词 ${esc(SETTINGS.routerPrompt.draft)} 的改动：${esc(SETTINGS.routerPrompt.note.replace(/^v\d+ /, ''))}</p>
          <div class="actions actions--start"><button class="btn" type="submit">用同一份输入重放</button></div>
        </form>
        ${rp ? `<div class="stack-sm" role="status"><p class="ink">${same ? `${I.check}和当时的判断一致` : `${I.alert}和当时的判断不同`}：${esc(rp.model.split('|')[1])}，提示词 ${esc(rp.prompt)}，${esc(rp.at)} 重放</p>
          ${table('', [{ t: '字段' }, { t: '当时' }, { t: '重放' }], Object.keys(out).map(k => `<tr>${td('字段', `<code>${k}</code>`)}${td('当时', esc(out[k] ?? '无'))}${td('重放', `${esc(rp.out[k] ?? '无')}${out[k] !== rp.out[k] ? ' <span class="tag tag--warm">不同</span>' : ''}`)}</tr>`))}
          ${r.inEval ? '<p class="note">已加入评测集，标准答案是当时被确认的归属。</p>' : `<div class="actions actions--start"><button class="btn btn--line" type="button" data-act="eval-add" data-id="${r.id}">把这条加入评测集</button></div>`}</div>` : '<p class="note">重放不会改动任何任务，也不会给任何人发消息。</p>'}
      </section>`)}`;
  };

  /* ---------- queue: priority first, then each project's weight; queued tasks start by themselves ---------- */
  const PRIO = { 高: 0, 普通: 1, 低: 2 };
  const limitOf = mid => M(mid)?.queueLimit || SETTINGS.queueLimit;
  const fairKey = t => SETTINGS.sched === 'fair' ? TICKETS.filter(x => x.kind === 'run' && x.project === t.project).length / (SETTINGS.weights[t.project] || 1) : 0;
  const queuedOrder = () => TICKETS.filter(t => t.queued).sort((a, b) => (PRIO[a.prio || '普通'] - PRIO[b.prio || '普通']) || (fairKey(a) - fairKey(b)) || a.created.localeCompare(b.created));
  const queuedWhy = t => t.queued.why === 'limit' ? `${who(t.queued.who)}的待处理 ${queue(t.queued.who).length} / ${limitOf(t.queued.who)} 件` : `Worker 槽位 ${TICKETS.filter(x => x.kind === 'run').length} / ${SETTINGS.workers}`;
  const canStart = t => t.queued.why === 'limit' ? queue(t.queued.who).length < limitOf(t.queued.who) : TICKETS.filter(x => x.kind === 'run').length < SETTINGS.workers;
  const drainQueue = () => {
    if (demo !== 'full') return [];
    return queuedOrder().filter(t => {
      if (!canStart(t)) return false;
      const plan = currentPlan(t.project), why = queuedWhy(t);
      t.queued = null;
      push(t, { kind: 'box', what: '排队结束，自动开工', d: `${why}，有空位了；从模板快照恢复沙箱，环境计划 ${plan.v}`, live: true });
      Object.assign(t, { kind: 'run', state: '从模板快照恢复沙箱', why: `环境计划 ${plan.v}`, sandbox: sandboxFor(plan, t.project) });
      startAuto(t, 'full');
      return true;
    }).map(t => t.id);
  };
  const queuedPanel = () => { const qs = queuedOrder(); return demo === 'full' && qs.length ? `<section class="region" aria-labelledby="qd-h"><div class="region-head"><h2 id="qd-h">排队中</h2><p>${SETTINGS.sched === 'fair' ? '先看优先级，再按项目权重' : '先看优先级，再按先来后到'}</p></div>
    <ol class="qlist">${qs.map((t, i) => `<li><span class="qlist__n mono">${i + 1}</span><div class="qlist__main"><a class="title" href="${link.ticket(t.id)}">${t.id} ${esc(t.title)}</a><span class="note">${esc(queuedWhy(t))}，空出来就自动开工</span></div>
      ${selectWrap(`<select class="select" data-act="prio" data-id="${t.id}" aria-label="${t.id} 的优先级">${Object.keys(PRIO).map(p => `<option${p === (t.prio || '普通') ? ' selected' : ''}>${p}</option>`).join('')}</select>`)}</li>`).join('')}</ol></section>` : ''; };

  /* ---------- batch handling in the inbox ---------- */
  const batchSel = new Set();
  const canApprove = t => !!t?.action?.href && t.kind === 'you' && t.contract.every(c => c.r === 'pass');
  const batchBar = q => {
    const rows = q.filter(r => batchSel.has(r.key) && r.act), ok = rows.filter(r => canApprove(r.act));
    const to = MEMBERS.filter(m => m.id !== ME);
    return `<div class="batchbar" id="batchbar"${rows.length ? '' : ' hidden'} role="region" aria-label="批量处理"><span class="ink">已选 <b class="mono">${rows.length}</b> 件</span>
      <button class="btn" type="button" data-act="batch-approve"${ok.length ? '' : ' disabled'}>批准 ${ok.length} 个 PR</button>
      <span class="batchbar__to">${selectWrap(`<select class="select" id="batch-to" aria-label="转给谁">${to.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>`)}<button class="btn btn--line" type="button" data-act="batch-hand">转给他</button></span>
      <button class="btn btn--text" type="button" data-act="batch-clear">取消选择</button>
      <p class="note batchbar__note">只有完成条件全部通过的 PR 能批量批准，会在 GitHub 上以你的名义提交 Approve 审查；需求单、提问和失败的任务要一件件看。</p></div>`;
  };
  const syncBatch = () => { const bar = $('#batchbar'); if (!bar) return; const q = queue(); bar.outerHTML = batchBar(q); ddEnhance(); };

  /* ---------- personal: delegate and daily digest ---------- */
  const digestBody = () => {
    const q = queue(), od = q.filter(r => r.act && overdue(r.act)).length, today = TICKETS.filter(t => t.day === 'today');
    const spend = today.reduce((a, t) => a + t.cost, 0), rollNext = TICKETS.filter(t => t.rollout?.phases.some(p => p.st === 'ready')).length;
    const held = [['memory', `记忆提议 ${MEMORY_PROPOSALS.length} 条`], ['env', `环境计划 ${pendingPlans().length} 份`], ['pr', `PR 审批 ${TICKETS.filter(t => t.kind === 'you' && t.action?.href).length} 个`]].filter(([k]) => PREFS.digest.only[k]).map(([, v]) => v);
    return [`今天新任务 ${today.length} 个，开出 PR ${TICKETS.filter(t => t.prOpened === 'today').length} 个，合并 ${today.filter(t => t.kind === 'done').length} 个，花费 ¥${spend.toFixed(0)}`,
      `还在等你 ${q.length} 件${od ? `，其中 ${od} 件超时` : ''}`, ...(rollNext ? [`有 ${rollNext} 个任务的上线阶段可以推进`] : []), ...(queuedOrder().length ? [`排队中 ${queuedOrder().length} 个任务`] : []), ...(held.length ? [`只进汇总的事项：${held.join('，')}`] : [])];
  };
  const prefsPanel = () => {
    const d = PREFS.delegate, g = PREFS.digest, cands = MEMBERS.filter(m => m.id !== ME);
    const days = ['11 月 14 日', '11 月 15 日', '11 月 17 日', '11 月 20 日', '11 月 27 日'];
    return `<div class="two two--even">
      <section class="well stack-md" aria-labelledby="dl-h"><h2 id="dl-h">我不在时</h2>
        <form class="stack-md" data-form="delegate" data-endpoint="/api/me/delegate">
          <label class="check"><input type="checkbox" name="on"${d.on ? ' checked' : ''}>把我的待处理交给代理人</label>
          <div class="form-grid">
            <div class="field"><label for="dl-to">代理人</label><span class="select-wrap select-wrap--block"><select class="select" id="dl-to" name="to">${cands.map(m => `<option value="${m.id}"${m.id === d.to ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>${I.down}</span></div>
            <div class="field"><label for="dl-until">到哪天为止</label><span class="select-wrap select-wrap--block"><select class="select" id="dl-until" name="until">${days.map(x => `<option${x === d.until ? ' selected' : ''}>${x}</option>`).join('')}</select>${I.down}</span></div>
          </div>
          <p class="note">期间你的待处理同时推给代理人，他临时有你在这些项目上的审批权限；他代你处理的每一件都记在安全日志里，到期自动收回。</p>
          <div class="actions actions--start"><button class="btn btn--line" type="submit">保存</button></div>
        </form></section>
      <section class="well stack-md" aria-labelledby="dg-h"><h2 id="dg-h">每日汇总</h2>
        <form class="stack-md" data-form="digest" data-endpoint="/api/me/digest">
          <label class="check"><input type="checkbox" name="on"${g.on ? ' checked' : ''}>每天推一条汇总</label>
          <div class="form-grid">
            <div class="field"><label for="dg-time">推送时间</label><span class="select-wrap select-wrap--block"><select class="select" id="dg-time" name="time">${['12:00', '18:00', '21:00'].map(x => `<option${x === g.time ? ' selected' : ''}>${x}</option>`).join('')}</select>${I.down}</span></div>
          </div>
          <fieldset class="checks"><legend class="note">这些事项不即时推送，只进汇总</legend>
            ${[['memory', '记忆提议'], ['env', '环境计划'], ['pr', 'PR 审批']].map(([k, l]) => `<label class="check"><input type="checkbox" name="only-${k}"${g.only[k] ? ' checked' : ''}>${l}</label>`).join('')}</fieldset>
          <div class="actions actions--start"><button class="btn btn--line" type="submit">保存</button></div>
        </form>
        <figure class="feishu"><figcaption class="note">${g.on ? `今天 ${g.time} 会推送的内容` : '汇总已关闭；打开后会推送这样的内容'}</figcaption>
          <div class="feishu-card"><p class="ink"><strong>Auto-CodWorker 今日汇总</strong></p>${digestBody().map(x => `<p class="ink-2">${esc(x)}</p>`).join('')}<p class="note">超时和失败的事项不等汇总，照常即时推送。</p></div></figure>
      </section></div>`;
  };
  const delegateNote = () => PREFS.delegate.on && demo === 'full' ? `<div class="well well--row"><p class="ink">你的待处理同时交给了${esc(who(PREFS.delegate.to))}，到 ${esc(PREFS.delegate.until)}。</p><a class="btn btn--line" href="#notifications">改代理人</a></div>` : '';

  const PAGES = { members: pageMembers, security: pageSecurity, ops: pageOps, quality: pageQuality, notifications: pageNotifications, overview: pageOverview, tickets: pageTickets, chat: pageChat, routing: pageRouting, projects: pageProjects, env: pageEnv, memory: pageMemory, sandboxes: pageSandboxes, cost: pageCost, settings: pageSettings };
  const render = keepFocus => {
    const ddKeep = keepFocus && ddOpen && main.contains(ddOpen) ? { i: $$('select', main).indexOf(ddOpen), id: ddOpen.id, name: ddOpen.name, q: $('.dd__search', ddOpen._dd.pop)?.value || '' } : null;
    const { parts, params } = parse();
    $('#demo').value = demo;
    /* queued tasks start the moment there is room for them */
    const started = drainQueue();
    /* an action's own toast carries the news; with no action toast, say it on its own */
    if (started.length) { startedQ.push(...started); setTimeout(() => { if (startedQ.length) { const ids = startedQ; startedQ = []; toast(`${ids.join('、')} 排队结束，已自动开工`, { link: ['查看', link.ticket(ids[0])] }); } }, 0); }
    renderNav(parts[0]);
    if (parts[0] === 'ticket') pageTicket(parts[1], params);
    else if (parts[0] === 'project') pageProject(parts[1], params);
    else if (parts[0] === 'envplan') pageEnvPlan(parts[1], parts[2]);
    else if (parts[0] === 'plan') pagePlan(parts[1]);
    else if (parts[0] === 'report') pageReport(parts[1], +parts[2]);
    else if (parts[0] === 'route') pageRoute(parts[1]);
    else (PAGES[parts[0]] || pageOverview)(params);
    const lv = $('#live'); if (lv) lv.innerHTML = `${OPS.drain ? '排空中' : '实时'}<span class="mono">${now()}</span>`;
    document.title = `${$('h1', main)?.textContent || '控制台'}，Auto-CodWorker`;
    mlHide(); if (ddOpen && !ddOpen.isConnected) ddOpen = null; ddEnhance();
    /* a background refresh must not shut a list someone is choosing from */
    if (ddKeep) { const again = $$('select', main)[ddKeep.i]; if (again && again.id === ddKeep.id && again.name === ddKeep.name) { ddShow(again); const q = $('.dd__search', again._dd.pop); if (q && ddKeep.q) { q.value = ddKeep.q; q.dispatchEvent(new Event('input', { bubbles: true })); } } }
    closeMenu();
    if (!keepFocus) main.focus({ preventScroll: true });
  };
  const go = h => { if (location.hash === h) render(true); else location.hash = h; };
  main.addEventListener('mouseover', e => mapHover(e.target.closest('.mchip')?.dataset.id || null));
  main.addEventListener('mouseleave', () => mapHover(null));
  main.addEventListener('focusin', e => mapHover(e.target.closest('.mchip')?.dataset.id || null));
  main.addEventListener('focusout', () => mapHover(null));
  window.addEventListener('hashchange', () => { $('.main').scrollTop = 0; draft = null; addingEp = false; editingCard = null; editingMember = null; tlFilter = 'all'; connecting = null; render(); });
  $('#demo').addEventListener('change', e => { demo = e.target.value; render(true); });

  /* ---------- menu ---------- */
  const shell = $('#shell'), menuBtn = $('#menu-btn');
  const closeMenu = () => { shell.dataset.menu = ''; menuBtn.setAttribute('aria-expanded', 'false'); $('.scrim')?.remove(); };
  menuBtn.addEventListener('click', () => {
    if (shell.dataset.menu === 'open') return closeMenu();
    shell.dataset.menu = 'open'; menuBtn.setAttribute('aria-expanded', 'true');
    const s = document.createElement('div'); s.className = 'scrim'; s.addEventListener('click', closeMenu); document.body.append(s);
    $('#side a').focus();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && shell.dataset.menu === 'open') { closeMenu(); menuBtn.focus(); } });

  /* ---------- actions ---------- */
  const nextUp = skip => { const r = queue().find(x => x.key !== skip); return r ? { link: [`下一件：${r.title.length > 18 ? `${r.title.slice(0, 17)}…` : r.title}`, r.href] } : {}; };
  const acceptMemory = (m, text) => {
    const p = P(m.project), entry = { id: memIdNext(), text, from: m.from, by: '你', date: `今天 ${now()}`, reads: 0 };
    p.memory.unshift(entry);
    MEMORY_PROPOSALS.splice(MEMORY_PROPOSALS.indexOf(m), 1);
    render(true);
    toast(`已写入 ${p.name} 的项目记忆（${entry.id}）`, { link: ['查看', link.project(p.id, 'memory')], undo: () => { p.memory.splice(p.memory.indexOf(entry), 1); MEMORY_PROPOSALS.push(m); render(true); } });
  };
  const ACT_LABEL = { 'batch-approve': '批准中', 'batch-hand': '转交中', 'eval-add': '加入中', 'replay-all': '重放中', 'roll-next': '处理中', 'roll-back': '处理中', 'pm-fix': '开任务中', handover: '处理中', handback: '处理中', 'rule-on': '启用中', 'rule-off': '停用中', 'ep-pull': '拉取中', 'ep-del': '删除中', fp: '记录中', 'route-fb': '记录中', 'visitor-add': '登记中', 'host-down': '处理中', 'host-up': '处理中', 'drain-on': '排空中', 'drain-off': '恢复中', drill: '演练中', 'eval-run': '排队中', 'gh-gmerge': '处理中', 'gh-gchanges': '处理中', 'gh-main': '处理中', 'prov-test': '测试中', 'prov-off': '断开中', 'prov-save': '保存中', rebuild: '排队中', rollback: '回滚中', 'gh-merge': '处理中', 'gh-changes': '处理中', 'gh-ci': '处理中', 'onb-confirm': '接入中', 'onb-drop': '处理中', retry: '排队中', clean: '清理中', 'mem-accept': '写入中', 'mem-reject': '驳回中', pause: '暂停中', resume: '恢复中', 'create-ticket': '创建中', pick: '发送中', 'reject-env': '提交中', stop: '停止中', 'mem-delete': '删除中' };

  document.addEventListener('click', async e => {
    const row = e.target.closest('tr[data-href], li[data-href]');
    if (row && !e.target.closest('a, button, select, input, label')) { location.hash = row.dataset.href; return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT') return;
    const act = b.dataset.act;
    if (act === 'reload') { render(); return; }
    if (act === 'batch-clear') { batchSel.clear(); render(true); $('#q-h')?.focus?.(); return; }
    if (act === 'clear-filter') { ticketQuery = ''; ticketProject = 'all'; render(true); return; }
    if (act === 'focus-say') { $('#say')?.focus(); return; }
    if (act === 'discard') { draft = null; render(true); return; }
    if (act === 'card-edit') { editingCard = b.dataset.pid; render(true); $('#c-alias').focus(); return; }
    if (act === 'card-cancel') { editingCard = null; render(true); return; }
    if (act === 'member-edit') { editingMember = b.dataset.id; render(true); $(`#mr-${editingMember}-g`)?.focus(); return; }
    if (act === 'ep-add') { addingEp = !addingEp; render(true); if (addingEp) $('#ep-name')?.focus(); return; }
    if (act === 'member-cancel') { editingMember = null; render(true); return; }
    if (act === 'add-member') { const f = $('#member-form'); f.hidden = !f.hidden; b.setAttribute('aria-expanded', String(!f.hidden)); if (!f.hidden) $('#nm').focus(); return; }
    if (act === 'prov-on') { connecting = b.dataset.id; render(true); $('#pk').focus(); return; }
    if (act === 'prov-cancel') { connecting = null; render(true); return; }
    if (act === 'env-quick') { const f = $('form[data-form="env"]'); if (f) f.requestSubmit(f.querySelector('button[value="confirm"]')); return; }
    if (act === 'env-reject-jump') { const r = $('#env-r'); if (r) { r.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); r.focus({ preventScroll: true }); } return; }
    if (act === 'sec-filter') { secType = b.dataset.f; render(true); $(`[data-act="sec-filter"][data-f="${secType}"]`)?.focus(); return; }
    if (act === 'tl-filter') { tlFilter = b.dataset.f; render(true); $(`[data-act="tl-filter"][data-f="${tlFilter}"]`)?.focus(); return; }
    if (act === 'add-project') { const f = $('#add-form'); f.hidden = !f.hidden; $$('[data-act=add-project][aria-expanded]').forEach(x => x.setAttribute('aria-expanded', String(!f.hidden))); if (!f.hidden) $('#repo').focus(); return; }
    if (act === 'mem-edit' || act === 'mem-edit-accept') {
      const isProp = act === 'mem-edit-accept';
      const m = isProp ? MEMORY_PROPOSALS.find(x => x.id === b.dataset.id) : P(b.dataset.pid).memory.find(x => x.id === b.dataset.id);
      const host = isProp ? $(`#mp-${m.id}`) : $(`#mem-${m.id} blockquote`);
      host.outerHTML = `<form class="stack-sm" data-form="${isProp ? 'mem-accept-edit' : 'mem-save'}" data-id="${m.id}" data-pid="${b.dataset.pid || ''}" data-endpoint="/api/memory"><label class="visually-hidden" for="me-${m.id}">记忆内容</label><textarea class="textarea" id="me-${m.id}" name="text">${esc(m.text)}</textarea><div class="actions actions--start"><button class="btn btn--line" type="submit">${isProp ? '采纳' : '保存'}</button><button class="btn btn--text" type="button" data-act="reload">取消</button></div></form>`;
      $(`#me-${m.id}`).focus();
      return;
    }
    busy(b, true, ACT_LABEL[act]);
    try {
      await api('POST', `/api/${act}`, { ...b.dataset });
      busy(b, false);
      if (act === 'batch-approve') {
        const ts = queue().filter(r => batchSel.has(r.key) && canApprove(r.act)).map(r => r.act), keep = ts.map(t => ({ t, prev: { kind: t.kind, state: t.state, why: t.why, since: t.since } }));
        ts.forEach(t => { push(t, { kind: 'gate', what: '你在控制台批量批准', d: `已在 GitHub 以你的名义提交 Approve 审查${t.group ? `（${t.group.filter(g => g.st === 'open').length} 个 PR）` : ''}；合并由你或合并队列完成` }); Object.assign(t, { kind: 'wait', state: '已批准，等合并', why: 'GitHub 上已有你的 Approve', since: null, waitMerge: true }); batchSel.delete(t.id); });
        render(true);
        toast(`已批准 ${ts.map(t => t.id).join('、')}`, { undo: () => { keep.forEach(({ t, prev }) => { Object.assign(t, prev, { waitMerge: false }); t.timeline.pop(); }); render(true); } });
      }
      if (act === 'batch-hand') {
        const to = $('#batch-to').value, rows = queue().filter(r => batchSel.has(r.key) && r.act), ok = rows.filter(r => can(to, '审批', r.act.project) || r.act.by === to), no = rows.filter(r => !ok.includes(r));
        ok.forEach(r => { r.act.handTo = to; push(r.act, { kind: 'report', what: `你把这件事转给了${who(to)}`, d: '已通过飞书通知他；时限按转交时重新计算' }); r.act.since = now(); batchSel.delete(r.key); });
        render(true);
        toast(`${ok.length ? `已转给${who(to)}：${ok.map(r => r.act.id).join('、')}` : '没有转出'}${no.length ? `；${no.map(r => r.act.id).join('、')} 他没有审批权限，留在你这里` : ''}`, ok.length ? { undo: () => { ok.forEach(r => { r.act.handTo = null; r.act.timeline.pop(); }); render(true); } } : {});
      }
      if (act === 'eval-add') { const r = routeOf(b.dataset.id); r.inEval = true; EVALSET.sources[0][2] += 1; render(true); toast(`${r.id} 已加入评测集，Router 部分现在 ${EVALSET.sources[0][2]} 条`, { link: ['看评测集', '#quality'] }); }
      if (act === 'replay-all') { const pr = SETTINGS.routerPrompt.draft, m = SETTINGS.stages.router.model; replayAll = { prompt: pr, n: ROUTING.length, diff: ROUTING.filter(r => { const a = routeOut(r), o = replayOut(r, m, pr); return Object.keys(a).some(k => a[k] !== o[k]); }).map(r => r.id) }; render(true); }
      if (act === 'retry') {
        const t = T(b.dataset.id), plan = currentPlan(t.project);
        push(t, { kind: 'box', what: `你点了重试，用环境计划 ${plan.v} 重建沙箱`, d: plan.changes.join('；'), live: true });
        Object.assign(t, { kind: 'run', state: '用新模板重跑 E2E', why: `环境计划 ${plan.v}`, sandbox: sandboxFor(plan, t.project) });
        t.contract[1] = { t: t.contract[1].t, r: 'wait', s: '重跑中' };
        startAuto(t, 'retry');
        render(true);
      }
      if (act === 'rollback') { const v = +b.dataset.v, changes = diffSettings(SETTINGS, snapshotAt(v)); const hit = applySettings(changes, `回滚到第 ${v} 版`); draft = null; render(true); toast(`已回滚到第 ${v} 版的设置，记为第 ${SETTINGS.version} 版${hit.length ? `；${hit.map(t => t.id).join('、')} 超出上限，已暂停` : ''}`); }
      if (act === 'rebuild') { CFG.update.state = 'building'; render(true); later(8000, () => { const old = baseOf('acw-base').digest; templates().filter(x => x.plan.state === 'frozen').forEach(x => { TPL_BASE[x.id] = CFG.update.digest; }); Object.assign(baseOf('acw-base'), { digest: CFG.update.digest, updated: `今天 ${now()}` }); CFG.update.state = 'done'; toast(`acw-base 已更新（${old} → ${CFG.update.digest}），使用中的模板已重建`); }); }
      if (act === 'prov-test') toast(`${provName(b.dataset.id)} 连接正常（示例延迟 180ms）`);
      if (act === 'prov-off') { const id = b.dataset.id, n = TICKETS.filter(t => t.sandbox?.provider === id && isOpen(t)).length; if (SETTINGS.sandbox.provider === id || SETTINGS.sandbox.overflowTo === id) throw new Error(`${provName(id)} 是默认提供方或溢出目标，先在设置里换掉`); if (n) throw new Error(`还有 ${n} 个未结束任务的沙箱在 ${provName(id)} 上，结束后再断开`); PROV(id).state = 'off'; render(true); toast(`已断开 ${provName(id)}`); }
      if (act === 'prov-save') { const pid = b.dataset.pid, p = P(pid), sel = $(`[data-pv="${pid}"]`), chk = $(`[data-pi="${pid}"]`); if (chk.checked && isCloud(sel.value)) throw new Error('设了“沙箱只用自建”的项目不能指定云端，改成自建或跟随默认'); Object.assign(p, { provider: sel.value, internalOnly: chk.checked }); render(true); const eff = providerFor(pid, currentPlan(pid).form); toast(`${p.name}：之后新建的沙箱用 ${provName(eff.id)}${eff.id !== (p.provider === 'inherit' ? SETTINGS.sandbox.provider : p.provider) ? `（${eff.why}）` : ''}，已有沙箱不迁移`); }
      if (act === 'gh-merge') { const t = T(b.dataset.id); push(t, { kind: 'gate', what: `PR #${t.pr} 已在 GitHub 合并，任务结束`, d: '沙箱已回收' }); Object.assign(t, { kind: 'done', state: `PR #${t.pr} 已合并`, why: `今天 ${now()} 合并`, action: null, since: null, sandbox: null }); const next = startDependents(t); render(true); toast(`${t.id} 已结束${next.length ? `，排在它后面的 ${next.join('、')} 已开工` : ''}`, { link: ['看项目', link.project(t.project)] }); }
      if (act === 'gh-main') { const t = T(b.dataset.id); push(t, { kind: 'report', what: 'main 有新提交，完成条件要按新提交重验', d: '别人的 PR 合并进了 main；先自动变基' }); C(t, 0, 'wait', 'main 前进，等变基'); C(t, 1, 'wait', '等变基后重跑'); C(t, 3, 'wait', '等变基'); if (t.sandbox) t.sandbox.state = 'running'; Object.assign(t, { kind: 'run', state: 'main 前进，自动变基并重验', why: '通过后回到等你审批，不再重复通知', action: null, quiet: true }); startAuto(t, 'rebase'); render(true); }
      if (act === 'gh-gmerge') { const t = T(b.dataset.id), g = t.group.find(x => x.st === 'open'); g.st = 'merged'; const nx = t.group.find(x => x.st === 'open');
        if (!nx) { push(t, { kind: 'gate', what: `${g.repo}#${g.pr} 已合并，PR 组全部合并，任务结束`, d: '沙箱已回收' }); Object.assign(t, { kind: 'done', state: 'PR 组已全部合并', why: `今天 ${now()} 合并最后一个`, action: null, since: null, sandbox: null }); }
        else { push(t, { kind: 'gate', what: `${g.repo}#${g.pr} 已合并`, d: `${nx.repo}#${nx.pr} 已自动变基到新的 main；内容与验证过的中间状态一致，沿用结果` }); Object.assign(t, { state: `等你审批 PR 组（还剩 ${t.group.filter(x => x.st === 'open').length} 个）`, why: `下一个合 ${nx.repo}#${nx.pr}`, action: { label: `打开 ${nx.repo}#${nx.pr}`, href: gLink(nx) }, since: now() }); }
        render(true); }
      if (act === 'gh-gchanges') { const t = T(b.dataset.id), g = t.group.find(x => x.st === 'open'); push(t, { kind: 'report', what: `${g.repo}#${g.pr} 收到修改意见`, d: '审批人：渠道列表改成从接口读取（示例）' }); C(t, 0, 'wait', '等新提交'); C(t, 1, 'wait', '等新提交'); C(t, 2, 'wait', '等新提交'); if (t.sandbox) t.sandbox.state = 'running'; Object.assign(t, { kind: 'run', state: `按 ${g.repo}#${g.pr} 的评论修改`, why: '只改这个仓库；改完重新跑组合与中间状态 E2E', action: null, since: null }); startAuto(t, 'fix'); render(true); }
      if (act === 'ep-pull') { const e = EP(b.dataset.id), add = e.fresh || []; e.models = [...e.models, ...add]; e.fresh = []; e.pulled = now(); render(true); toast(`${e.name}：/v1/models 返回 ${e.models.length} 个模型${add.length ? `，多了 ${add.join('、')}` : '，和上次一样'}`); }
      if (act === 'ep-del') { const i = SETTINGS.endpoints.findIndex(e => e.id === b.dataset.id); const [e] = SETTINGS.endpoints.splice(i, 1); render(true); toast(`已删除接入 ${e.name}`, { undo: () => { SETTINGS.endpoints.splice(i, 0, e); render(true); } }); }
      if (act === 'fp') { const t = T(b.dataset.id), f = t.review.findings[+b.dataset.i]; f.fp = true; f.st = `你标为误报（${now()}）`; render(true); toast('已记为误报，会算进审查误报率', { link: ['看质量', '#quality'] }); }
      if (act === 'route-fb') { const r = ROUTING[+b.dataset.i]; r.fb = true; render(true); toast('已记录：这次路由判断有误', { link: ['看质量', '#quality'] }); }
      if (act === 'visitor-add') { const r = ROUTING[+b.dataset.i]; MEMBERS.push({ id: `m${MEMBERS.length + 1}`, name: r.visitor, feishu: true, github: null, roles: { '*': '提需求' } }); render(true); toast(`${r.visitor} 已登记为成员，全局角色“提需求”`, { link: ['看成员', '#members'] }); }
      if (act === 'host-down') { const n = failHost(b.dataset.host); render(true); toast(`${b.dataset.host} 失联：${n} 个沙箱已在其他宿主机重建`, { link: ['看沙箱', '#sandboxes'] }); }
      if (act === 'host-up') { const h = HOSTS.find(x => x.id === b.dataset.host); h.down = false; OPS.alerts.unshift({ t: now(), level: '提示', what: `${h.id} 恢复心跳`, st: '新沙箱可以再放上去；已经搬走的不迁回' }); render(true); }
      if (act === 'drain-on' || act === 'drain-off') { OPS.drain = act === 'drain-on'; render(true); toast(OPS.drain ? 'Engine 进入排空：当前步骤做完后不再开始新步骤' : '已结束排空，任务继续推进'); }
      if (act === 'drill') { later(6000, () => { Object.assign(OPS.backup, { drill: `今天 ${now()}`, drillResult: '通过：重建 21 个投影，行数与校验和一致' }); toast('恢复演练通过'); }); OPS.backup.drill = '进行中'; render(true); }
      if (act === 'eval-run') { const row = { date: `今天 ${now()}`, change: `当前设置（第 ${SETTINGS.version} 版）`, pass: null, base: [27, 30], cost: null, rounds: null, verdict: '等结果' }; EVALS.unshift(row); render(true); later(9000, () => Object.assign(row, { pass: [27, 30], cost: [32, 33], rounds: [1.7, 1.7], verdict: '和当前一致' })); }
      if (act === 'gh-changes') { const t = T(b.dataset.id); push(t, { kind: 'report', what: `PR #${t.pr} 收到修改意见`, d: '审批人：错误提示文案改成和控制台其他页面一致（示例）' }); C(t, 0, 'wait', '等新提交'); C(t, 1, 'wait', '等新提交'); C(t, 2, 'wait', '等新提交'); if (t.sandbox) t.sandbox.state = 'running'; Object.assign(t, { kind: 'run', state: '按 PR 评论修改', why: '改完重新审查和跑 E2E', action: null, since: null }); startAuto(t, 'fix'); render(true); }
      if (act === 'gh-ci') { const t = T(b.dataset.id); ciPass(t); render(true); }
      if (act === 'onb-confirm') {
        const o = ONBOARD.find(x => x.id === b.dataset.id); ONBOARD.splice(ONBOARD.indexOf(o), 1);
        PROJECTS.push({ id: o.id, name: o.name, summary: '新接入的项目', repos: [[o.name, o.lang]], modules: ['待补充'], aliases: [o.name], channels: [`GitHub：${o.slug}`], confirm: ['数据库表结构'], onboarded: `今天 ${now()}`, agents: { source: `${o.name}/AGENTS.md`, version: `第 1 版，今天 ${now()} 由你确认`, sections: [['架构', ['单服务，入口 cmd/server']], ['约定', ['数据库访问统一走 store 包']], ['命令', ['go test ./...']]] }, memory: [] });
        ENV_PLANS[o.id] = [{ v: 'v1', state: 'frozen', date: `今天 ${now()}`, trigger: '接入项目', how: '你确认', form: '单 VM', note: '接入时生成', services: [{ svc: 'app', src: `PR 代码：${o.name}`, port: '8080', deps: ['mysql'], health: 'curl /health', col: 0, row: 0 }, { svc: 'mysql', src: 'CI 的 services.mysql', port: '3306', deps: [], health: 'mysqladmin ping', col: 1, row: 0 }], mocks: [], changes: [] }];
        BASELINES.push({ project: o.id, env: 'v1', host: 'node-1', vms: 1 });
        go(link.project(o.id)); toast(`${o.name} 已接入，Router 现在会把提到“${o.name}”的需求路由过来`);
      }
      if (act === 'onb-drop') { const i = ONBOARD.findIndex(x => x.id === b.dataset.id); const [o] = ONBOARD.splice(i, 1); render(true); toast(`已放弃接入 ${o.name}`, { undo: () => { ONBOARD.splice(i, 0, o); render(true); } }); }
      if (act === 'clean') { const h = HOSTS.find(x => x.id === b.dataset.host); h.disk = 31; render(true); toast(`${h.id} 清理了 23 个过期快照，剩余 31%`); }
      if (act === 'mem-accept') acceptMemory(MEMORY_PROPOSALS.find(x => x.id === b.dataset.id), MEMORY_PROPOSALS.find(x => x.id === b.dataset.id).text);
      if (act === 'mem-reject') { const i = MEMORY_PROPOSALS.findIndex(x => x.id === b.dataset.id); const [m] = MEMORY_PROPOSALS.splice(i, 1); render(true); toast('已驳回这条提议', { undo: () => { MEMORY_PROPOSALS.splice(i, 0, m); render(true); } }); }
      if (act === 'mem-delete') { const p = P(b.dataset.pid), i = p.memory.findIndex(x => x.id === b.dataset.id); const [m] = p.memory.splice(i, 1); render(true); toast(`已删除 ${m.id}`, { undo: () => { p.memory.splice(i, 0, m); render(true); } }); }
      if (act === 'pause' || act === 'resume') { const t = T(b.dataset.id); t.sandbox.state = act === 'pause' ? 'paused' : 'running';
        if (act === 'pause' && t.kind === 'run') Object.assign(t, { kind: 'wait', resumeTo: [t.state, t.why], state: '你暂停了沙箱', why: '恢复后 Worker 接着做' });
        if (act === 'resume' && t.resumeTo) { Object.assign(t, { kind: 'run', state: t.resumeTo[0], why: t.resumeTo[1] }); delete t.resumeTo; } push(t, { kind: 'box', what: act === 'pause' ? '你暂停了沙箱' : '你恢复了沙箱', d: act === 'pause' ? '内存快照已保存' : '从内存快照恢复' }); render(true); }
      if (act === 'roll-next') { const t = T(b.dataset.id), ph = t.rollout.phases, r = ph.findIndex(x => x.st === 'ready'); ph[r].st = 'done'; const nx = ph[r + 1]; if (nx) { nx.st = 'now'; nx.when = `今天 ${now()} 开始`; t.state = `已合并，上线中（第 ${r + 2} / ${ph.length} 阶段）`; } else t.state = '已合并，上线完成'; render(true); toast(nx ? `${t.id} 进入第 ${r + 2} 阶段：${nx.action}` : `${t.id} 上线完成`); }
      if (act === 'roll-back') { const t = T(b.dataset.id), ph = t.rollout.phases, r = ph.findIndex(x => x.st === 'ready'); ph[r].st = 'todo'; ph[r].when = `今天 ${now()} 提议回退`; t.state = `已合并，第 ${r + 1} 阶段回退中`; render(true); toast(`回退动作已备好：${ph[r].back}。等你在配置仓库合并`); }
      if (act === 'pm-fix') { const t = T(b.dataset.id), x = t.postMerge[+b.dataset.i]; x.fix = createTicket(t.project, `修复：${x.title}`, `${x.src} 回传：${x.title}（${x.where}），来自 ${t.id}`, null, '合并后问题'); render(true); toast(`已开 ${x.fix}，带上了 ${t.id} 的需求单`, { link: ['打开', link.ticket(x.fix)] }); }
      if (act === 'handover') { const t = T(b.dataset.id); t.handed = { kind: t.kind, state: t.state, auto: t.auto }; delete t.auto; push(t, { kind: 'flag', what: '你接手了任务', d: 'Worker 在这一轮结束后停下，沙箱保留作预览' }); Object.assign(t, { kind: 'wait', state: '你在处理，Worker 已停', why: '改完后点“交还给 Worker”，它会先重读你的改动' }); render(true); toast(`${t.id} 由你接手，Worker 已停`); }
      if (act === 'handback') { const t = T(b.dataset.id), h = t.handed; delete t.handed; if (h.auto) t.auto = h.auto; push(t, { kind: 'report', what: '你把任务交还给 Worker', d: '先重读分支上的差异，完成条件在新的分支头上重跑' }); Object.assign(t, { kind: h.kind, state: '重读你的改动，然后继续', why: '' }); render(true); toast(`${t.id} 已交还，Worker 从当前分支头继续`); }
      if (act === 'rule-on') { const r = RULES.find(x => x.id === b.dataset.id); Object.assign(r, { st: 'on', since: `今天 ${now()}`, used: 0 }); render(true); toast(`常设规则已启用：${r.text}`); }
      if (act === 'rule-off') { const r = RULES.find(x => x.id === b.dataset.id); r.st = 'off'; render(true); toast(`已停用：${r.text}，以后这类动作会再来问`); }
      if (act === 'stop') { const t = T(b.dataset.id); const prev = JSON.parse(JSON.stringify(t)); push(t, { kind: 'flag', what: '你停止了任务', d: '沙箱暂停，保留 24 小时' }); Object.assign(t, { kind: 'dropped', state: '已被你停止', why: '沙箱暂停，保留 24 小时' }); if (t.sandbox) t.sandbox.state = 'paused'; render(true); toast(`${t.id} 已停止`, { undo: () => { Object.assign(t, prev); render(true); } }); }
      if (act === 'reject-env') { CHAT.push({ who: 'router', t: now(), text: `你打回了 ${pname(b.dataset.pid)} 的环境计划 ${b.dataset.v}。说一下哪里不对，我转给 Env Planner。` }); location.hash = '#chat'; }
      if (act === 'pick') {
        const msg = CHAT[+b.dataset.msg], v = b.dataset.val; msg.chosen = v;
        CHAT.push({ who: 'me', t: now(), text: v });
        if (/^发给 /.test(v)) CHAT.push(routerReply(`${v.slice(3)} ${msg.src}`));
        else { const p = PROJECTS.find(x => x.name === v); CHAT.push({ who: 'router', t: now(), text: `好的，按 ${v} 整理了需求单草稿：`, draft: { project: p.id, conf: '高（你选的）', why: '你在候选项里选择了它', goal: (msg.src || '').slice(0, 60), needConfirm: p.confirm.find(c => confirmKeywords[c]?.test(msg.src || '')) }, src: msg.src }); }
        render(true);
      }
      if (act === 'create-ticket') {
        const m = CHAT[+b.dataset.msg];
        m.created = createTicket(m.draft.project, m.draft.goal, m.src, m.draft.needConfirm);
        const t = T(m.created);
        if (t.kind === 'run') startAuto(t, 'full');
        render(true);
      }
    } catch (err) { busy(b, false); inlineError(b.closest('.actions') || b.parentElement, err); }
  });

  document.addEventListener('change', e => {
    const pick = e.target.closest('input[data-pick]');
    if (pick) { if (pick.checked) batchSel.add(pick.dataset.pick); else batchSel.delete(pick.dataset.pick); syncBatch(); return; }
    const ps = e.target.closest('select[data-act="prio"]');
    if (ps) { const t = T(ps.dataset.id); t.prio = ps.value; push(t, { kind: 'report', what: `你把优先级改成${ps.value}`, d: '排队顺序已重新计算' }); render(true); toast(`${t.id} 的优先级改成${ps.value}`); }
  });
  document.addEventListener('change', async e => {
    const sel = e.target.closest('select[data-act="move"]');
    if (!sel) return;
    const r = ROUTING[+sel.dataset.i], t = T(r.ticket), from = r.project;
    sel.disabled = true;
    try {
      await api('POST', `/api/tickets/${r.ticket}/move`, { project: sel.value });
      r.project = sel.value; t.project = sel.value; r.moved = true;
      push(t, { kind: 'report', what: `你把任务移到了 ${pname(sel.value)}`, d: '原沙箱回收，按新项目的环境计划重建' });
      if (t.sandbox) { const plan = currentPlan(sel.value); t.sandbox = { ...t.sandbox, env: plan.v, form: plan.form }; }
      render(true);
      toast(`${r.ticket} 已移到 ${pname(sel.value)}`, { undo: () => { r.project = from; t.project = from; r.moved = false; t.timeline.pop(); render(true); } });
    } catch (err) { sel.disabled = false; sel.value = r.project; inlineError(sel.closest('.actions'), err); }
  });

  document.addEventListener('submit', async e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const kind = f.dataset.form, btn = e.submitter || f.querySelector('[type=submit]');
    f.querySelector('.inline-error')?.remove();
    if (['replay', 'replan', 'delegate', 'digest'].includes(kind)) {
      const fd = new FormData(f), dv = e.submitter?.value;
      busy(btn, true, { replay: '重放中', replan: '提交中', delegate: '保存中', digest: '保存中' }[kind]);
      try {
        await api('POST', f.dataset.endpoint, Object.fromEntries(fd));
        busy(btn, false);
        if (kind === 'replay') { const r = routeOf(f.dataset.id), model = fd.get('model'), prompt = fd.get('prompt'); replays[r.id] = { model, prompt, at: now(), out: replayOut(r, model.split('|')[1], prompt) }; render(true); $('[data-form="replay"] button[type=submit]')?.focus(); }
        if (kind === 'replan') {
          const t = planOf(f.dataset.id), pl = t.plan, rp = pl.replan, why = fd.get('reason')?.trim();
          if (dv === 'ok') {
            pl.tasks = rp.tasks.map(({ isNew, ...x }) => x); pl.v += 1; pl.replan = null; pl.history.push({ t: now(), what: `你确认了改动，计划变成第 ${pl.v} 版` });
            push(t, { kind: 'flag', what: `你确认了计划 ${pl.id} 第 ${pl.v} 版`, d: rp.why });
            const born = pl.tasks.map((x, i) => [x, i]).filter(([x]) => !x.ticket && !x.deps.some(j => { const d = pl.tasks[j - 1]; return !d.ticket || T(d.ticket)?.kind !== 'done'; })).map(([x]) => { x.ticket = createTicket(t.project, x.title, `计划 ${pl.id} 的任务：${x.title}`, null, `计划 ${pl.id}`); return x.ticket; });
            render(true); toast(`计划 ${pl.id} 已改成第 ${pl.v} 版${born.length ? `，${born.join('、')} 已开工` : ''}`, born.length ? { link: ['查看', link.ticket(born[0])] } : {});
          } else {
            pl.replan = null; pl.history.push({ t: now(), what: `你没有同意改动${why ? `：${why}` : ''}，按原计划` });
            push(t, { kind: 'flag', what: `你没有同意改计划 ${pl.id}`, d: why || '按原计划继续；验收 1 的高峰场景由 Worker 在任务 1 里另想办法' });
            render(true); toast(`计划 ${pl.id} 保持第 ${pl.v} 版`);
          }
        }
        if (kind === 'delegate') { Object.assign(PREFS.delegate, { on: fd.get('on') === 'on', to: fd.get('to'), until: fd.get('until') }); if (PREFS.delegate.on) SECURITY.unshift({ t: now(), ticket: null, type: '代理', who: '你', what: `把待处理交给${who(PREFS.delegate.to)}，到 ${PREFS.delegate.until}`, result: '期间他有你的审批权限，代你处理的事项单独记录' }); render(true); toast(PREFS.delegate.on ? `到 ${PREFS.delegate.until} 为止，你的待处理同时交给${who(PREFS.delegate.to)}` : '已收回代理'); }
        if (kind === 'digest') { Object.assign(PREFS.digest, { on: fd.get('on') === 'on', time: fd.get('time'), only: { memory: fd.get('only-memory') === 'on', env: fd.get('only-env') === 'on', pr: fd.get('only-pr') === 'on' } }); render(true); toast(PREFS.digest.on ? `每天 ${PREFS.digest.time} 推送汇总` : '已关闭每日汇总'); }
      } catch (err) { busy(btn, false); inlineError(f.querySelector('.actions'), err); }
      return;
    }
    if (kind === 'chat') {
      const ta = $('#say'), text = ta.value.trim(), help = $('#say-help');
      if (!text) { ta.setAttribute('aria-invalid', 'true'); help.dataset.error = ''; help.textContent = '先写一句需求再发送'; ta.focus(); return; }
      ta.removeAttribute('aria-invalid');
      CHAT.push({ who: 'me', t: now(), text }); ta.value = ''; render(true);
      $('#thread')?.insertAdjacentHTML('beforeend', '<div class="msg msg--router" id="thinking"><span class="who">Router</span><div class="bubble note">正在判断归属</div></div>');
      $('#thinking')?.scrollIntoView({ block: 'nearest' });
      try { await api('POST', f.dataset.endpoint, { text }); CHAT.push(routerReply(text)); render(true); $('#say').focus(); }
      catch (err) { CHAT.pop(); render(true); $('#say').value = text; const h = $('#say-help'); h.dataset.error = ''; h.textContent = `${err.message}。消息没有发出，内容已保留。`; $('#say').focus(); }
      return;
    }
    if (kind === 'project') { const repo = $('#repo'); if (!repo.checkValidity()) { repo.setAttribute('aria-invalid', 'true'); const h = $('#repo-help'); h.dataset.error = ''; h.textContent = '需要一个完整的仓库地址，例如 https://github.com/org/repo'; repo.focus(); return; } }
    if (kind === 'settings' && !f._validate()) { f.querySelector('[aria-invalid="true"]')?.focus(); return; }
    if (kind === 'env' && e.submitter?.value === 'reject') {
      const r = $('#env-r'), h = $('#env-r-help');
      if (!r.value.trim()) { r.setAttribute('aria-invalid', 'true'); h.dataset.error = ''; h.textContent = '打回时要写原因，Env Planner 才知道怎么改'; r.focus(); return; }
      busy(btn, true, '提交中');
      try {
        await api('POST', `/api/env-plans/${f.dataset.pid}/${f.dataset.v}/reject`, { reason: r.value });
        const plan = plans(f.dataset.pid).find(x => x.v === f.dataset.v), reason = r.value.trim();
        plan.rejected = reason; render(true);
        later(7000, () => { plan.attempts = [...(plan.attempts || []), [`尝试 ${(plan.attempts || []).length + 1}`, `按你的意见修改（${reason}），健康检查与冒烟用例重新通过。`]]; plan.rejected = null; plan.revised = true; plan.date = `今天 ${now()}`; plan.changes = [...plan.changes, `按你的意见修改：${reason}`]; notify('env', `${pname(f.dataset.pid)}：环境计划 ${plan.v} 已按你的意见修改，等你确认`, link.plan(f.dataset.pid, plan.v)); });
      } catch (err) { busy(btn, false); inlineError(f.querySelector('.actions'), err); }
      return;
    }
    if (kind === 'endpoint') {
      const n = $('#ep-name'), u = $('#ep-base'), k = $('#ep-key'); let bad = null;
      [[n, '#ep-name-help', !n.value.trim(), '写一个名字'], [u, '#ep-base-help', !/^https:\/\/\S+$/.test(u.value.trim()), '需要 https 开头的完整地址，例如 https://api.example.com/v1'], [k, '#ep-key-help', !k.value.trim(), '填这个服务的 API key']].forEach(([el, hid, isBad, msg]) => { const h = $(hid); el.setAttribute('aria-invalid', isBad); if (isBad) { h.dataset.error = ''; h.textContent = msg; bad = bad || el; } else { delete h.dataset.error; h.textContent = h.dataset.orig; } });
      if (bad) { bad.focus(); return; }
    }
    if (kind === 'member' && !$('#nm').value.trim()) { const n = $('#nm'), h = $('#nm-help'); n.setAttribute('aria-invalid', 'true'); h.dataset.error = ''; h.textContent = '写一个名字'; n.focus(); return; }
    busy(btn, true, { endpoint: '测试中', member: '添加中', 'member-roles': '保存中', prov: '连接中', mandate: '确认中', env: '冻结中', card: '保存中', project: '扫描中', settings: '保存中', answer: '提交中', 'mem-accept-edit': '写入中', 'mem-save': '保存中' }[kind]);
    try {
      const body = Object.fromEntries(new FormData(f));
      await api('POST', f.dataset.endpoint, body);
      busy(btn, false);
      if (kind === 'mandate') {
        const t = T(f.dataset.id), plan = currentPlan(t.project), ans = body.answer?.trim(), rel = body.rel || 'par', o = t.overlap && T(t.overlap.with);
        t.mandate.confirmedBy = `${t.mandate.needConfirm}：你 ${now()} 在控制台确认${ans ? `，补充“${ans}”` : '，按假设推进'}`;
        if (t.plan?.st === 'open') { t.plan.st = 'confirmed'; t.plan.history.push({ t: now(), what: '你确认了需求单，计划一起确认' }); }
        t.mandate.open = null; t.contract[4] = { t: t.contract[4].t, r: 'pass', s: `你 ${now()} 确认` };
        push(t, { kind: 'flag', what: '你确认了需求单', d: ans || '按假设推进' });
        if (o && rel === 'after') {
          t.dependsOn = o.id; push(t, { kind: 'report', what: `排在 ${o.id} 后面`, d: `${o.id} 合并后自动开工，分支基于合并后的 main` });
          Object.assign(t, { kind: 'wait', state: `排在 ${o.id} 后面`, why: `${o.id} 合并后自动开工`, action: null, since: null });
          go(link.ticket(t.id)); toast(`${t.id} 已确认，排在 ${o.id} 后面`, nextUp(t.id)); return;
        }
        if (o && rel === 'merge') {
          push(t, { kind: 'report', what: `并入 ${o.id}`, d: '本任务结束，需求写进它的需求单' });
          Object.assign(t, { kind: 'dropped', state: `已并入 ${o.id}`, why: `需求写进了 ${o.id} 的需求单`, action: null, since: null });
          o.mandate.scope.push(`${t.mandate.goal}（并入自 ${t.id}）`);
          push(o, { kind: 'report', what: `并入 ${t.id} 的需求`, d: `${t.mandate.goal}；PR #${o.pr || ''} 继续用，改完重新审查和跑 E2E` });
          C(o, 0, 'wait', '等新提交'); C(o, 1, 'wait', '等新提交'); C(o, 2, 'wait', '等新提交');
          if (o.sandbox) o.sandbox.state = 'running';
          Object.assign(o, { kind: 'run', state: `按并入的需求继续改`, why: `并入了 ${t.id}`, action: null, since: null }); startAuto(o, 'fix');
          go(link.ticket(o.id)); return;
        }
        push(t, { kind: 'box', what: '从模板快照恢复沙箱', d: `环境计划 ${plan.v}`, live: true });
        Object.assign(t, { kind: 'run', state: '从模板快照恢复沙箱', why: `环境计划 ${plan.v}`, action: null, sandbox: sandboxFor(plan, t.project) });
        t.contract.slice(0, 4).forEach(c => { c.s = '还没有提交'; });
        startAuto(t, 'full');
        go(link.ticket(t.id)); toast(`${t.id} 的需求单已确认，Worker 开工了`, nextUp(t.id));
      }
      if (kind === 'answer') {
        const t = T(f.dataset.id), dec = e.submitter?.value || t.ask.options[0].value, note = body.note?.trim(), ask = t.ask, label = ask.options.find(o => o.value === dec)?.label;
        push(t, { kind: 'flag', what: `你的决定：${label}`, d: note || '' });
        Object.assign(t, { ask: null, action: null, since: null });
        if (ask.kind === 'casdoor' && dec === 'allow') {
          const list = ENV_PLANS.orcarouter, last = list.find(x => x.state === 'frozen'), v = `v${list.length + 1}`;
          last.state = 'superseded';
          list.push({ ...JSON.parse(JSON.stringify(last)), v, state: 'frozen', date: `今天 ${now()}`, trigger: t.id, how: '你在 T-131 里确认', note: 'Casdoor 登录从 mock 换成测试 realm', mocks: [['Casdoor 登录', '真实测试 realm（出站白名单已加）'], ['上游模型厂商', '录制回放']], changes: ['Casdoor 登录：mock 换成测试 realm'], attempts: undefined });
          BASELINES.filter(b => b.project === 'orcarouter').forEach(b => { b.env = v; });
          push(t, { kind: 'tool', what: `env_plan：生成 orcarouter ${v}`, d: 'Casdoor 登录走测试 realm，按你的答复直接冻结' });
          t.sandbox = { ...t.sandbox, env: v, state: 'running' };
          Object.assign(t, { kind: 'run', state: '用真实回调复现中', why: `环境计划 ${v}` }); startAuto(t, 'casdoor');
        } else if (ask.kind === 'casdoor') {
          push(t, { kind: 'file', what: '改为在单元测试里模拟回调超时', d: '不访问外部服务' });
          t.sandbox.state = 'running'; Object.assign(t, { kind: 'run', state: '改用单元测试复现', why: '不访问外部服务' }); startAuto(t, 'fix');
        } else if (ask.kind === 'oscillation' && dec === 'accept') {
          C(t, 2, 'pass', '你接受当前实现，F-3 记为已知问题');
          t.review.findings[0].st = '你接受，写进 PR 的已知问题';
          Object.assign(t, { kind: 'run', state: '开 PR', why: 'F-3 写进 PR 描述的已知问题' }); startAuto(t, 'open');
        } else if (ask.kind === 'oscillation') {
          C(t, 2, 'wait', `第 ${t.review.rounds.length + 1} 轮，由你放行`);
          t.sandbox.state = 'running'; Object.assign(t, { kind: 'run', state: '按审查意见再改一轮', why: `超过 ${SETTINGS.rounds} 轮上限，由你放行` }); startAuto(t, 'fix');
        } else if (ask.kind === 'budget' && dec === 'raise') {
          t.budget = ask.raise; if (t.sandbox) t.sandbox.state = 'running';
          Object.assign(t, { kind: 'run', state: '继续', why: `本任务上限 ¥${ask.raise}` });
        } else if (ask.kind === 'budget') {
          Object.assign(t, { kind: 'dropped', state: '因超出预算被你停止', why: '沙箱暂停，保留 24 小时' }); delete t.auto;
        }
        render(true); toast(`已把你的决定交给 ${t.id}：${label}`, nextUp(t.id));
      }
      if (kind === 'env') {
        const { pid, v } = f.dataset, list = plans(pid), plan = list.find(x => x.v === v);
        list.filter(x => x.state === 'frozen').forEach(x => { x.state = 'superseded'; });
        Object.assign(plan, { state: 'frozen', how: `你 ${now()} 确认${body.answer ? `，Redis 淘汰策略 ${body.answer}` : ''}` });
        BASELINES.filter(b => b.project === pid).forEach(b => { b.env = v; b.vms = plan.services.length; });
        const t = T(plan.trigger);
        if (t && isOpen(t)) {
          t133.envOk = true;
          push(t, { kind: 'tool', what: `环境计划 ${v} 已确认，重建模板快照`, d: `新增 ${plan.changes.join('、')}` });
          t.sandbox = { ...t.sandbox, env: v, vms: [...t.sandbox.vms.slice(0, 1), ['redis', '去重缓存，不持久化', '1 核 1G'], ...t.sandbox.vms.slice(1)] };
          push(t, { kind: 'tool', what: 'run_e2e 全量', d: 'UI 层与黄金用例', live: true });
          Object.assign(t, { kind: 'run', state: '全量 E2E 运行中', why: `环境计划 ${v}` });
          t.contract[1] = { t: t.contract[1].t, r: 'wait', s: '运行中' };
          later(7000, () => {
            push(t, { kind: 'tool', what: 'run_e2e 全量：79 个全部通过', d: '组件 46，管道 12，UI 18，黄金 3' });
            t.e2e.tiers = t.e2e.tiers.map(x => x.r === 'wait' ? { ...x, pass: x.total, dur: x.name === 'UI 层' ? '4 分 02 秒' : '1 分 30 秒', r: 'pass' } : x);
            t.contract[1] = { t: t.contract[1].t, r: 'pass', s: '79 个用例' };
            t133.e2e = true; advanceT133();
          });
        }
        go(link.plan(pid, v));
        toast(`${pname(pid)} 环境计划 ${v} 已冻结`);
      }
      if (kind === 'project') {
        const slug = body.repo.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, ''), name = slug.split('/').pop() || slug, id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (P(id) || ONBOARD.find(o => o.id === id)) { inlineError(f.querySelector('.actions'), new Error(`${name} 已经接入或正在接入`)); return; }
        const o = { id, name, repo: body.repo, slug, state: 'scanning', lang: 'Go', found: '依赖 MySQL，CI 里有 services.mysql' };
        ONBOARD.push(o); f.reset(); f.hidden = true; render(true);
        later(6000, () => { o.state = 'ready'; o.since = now(); notify('env', `接入 ${o.name}：项目卡和环境计划初稿等你确认`, '#projects'); });
      }
      if (kind === 'settings') {
        const changes = diffSettings(SETTINGS, draft); draft = null;
        if (!changes.length) { render(true); toast('没有改动，不生成新版本'); }
        else { const hit = applySettings(changes); render(true); toast(`已保存为第 ${SETTINGS.version} 版${hit.length ? `，${hit.map(t => t.id).join('、')} 超出新上限，已暂停等你决定` : ''}`); }
      }
      if (kind === 'prov') { const pv = PROV(f.dataset.id); pv.building = true; later(6000, () => { pv.building = false; }); PROV(f.dataset.id).state = 'ok'; PROV(f.dataset.id).key = `${f.dataset.id}_••••${String(body.key).slice(-4)}`; connecting = null; render(true); toast(`已连接 ${provName(f.dataset.id)}`); }
      if (kind === 'card') {
        const p = P(f.dataset.pid), fd = new FormData(f);
        if (fd.get('internalOnly') === 'on' && isCloud(body.provider)) throw new Error('设了“沙箱只用自建”的项目不能指定云端，改成自建或跟随默认');
        const aliases = body.aliases.split(/[、,，]/).map(x => x.trim()).filter(Boolean), clash = aliases.filter(a => PROJECTS.some(q => q.id !== p.id && q.aliases.some(b => b.toLowerCase() === a.toLowerCase())));
        Object.assign(p, { aliases: aliases.length ? aliases : p.aliases, channels: body.channels.split('\n').map(x => x.trim()).filter(Boolean), confirm: fd.getAll('confirm'), provider: body.provider, internalOnly: fd.get('internalOnly') === 'on' });
        editingCard = null; render(true);
        toast(clash.length ? `已保存。“${clash.join('、')}”也是别的项目的别名，遇到时 Router 会先问你` : '项目卡已保存，Router 立即按新的别名和渠道路由');
      }
      if (kind === 'endpoint') { const name = body.name.trim(), id = `ep${SETTINGS.endpoints.length + 1}`; const models = mockPull(body.base); SETTINGS.endpoints.push({ id, name, base: body.base.trim(), key: body.key ? `••••${String(body.key).slice(-4)}` : null, models, pulled: now(), fresh: [] }); addingEp = false; render(true); toast(`已添加 ${name}，/v1/models 返回 ${models.length} 个模型，可以在下面给任意阶段选用`); }
      if (kind === 'member') { const name = body.name.trim(); if (MEMBERS.some(m => m.name === name)) throw new Error(`${name} 已经是成员`); MEMBERS.push({ id: `m${MEMBERS.length + 1}`, name, feishu: false, github: body.github.trim() || null, roles: { '*': '提需求' } }); f.reset(); f.hidden = true; render(true); toast(`已添加 ${name}，全局角色“提需求”`); }
      if (kind === 'member-roles') { const m = M(f.dataset.id), fd = new FormData(f), roles = { '*': fd.get('*') }; PROJECTS.forEach(p => { const v = fd.get(p.id); if (v) roles[p.id] = v; }); m.roles = roles; editingMember = null; render(true); toast(`${m.name} 的角色已更新：${roleText(m)}`); }
      if (kind === 'mem-accept-edit') { const m = MEMORY_PROPOSALS.find(x => x.id === f.dataset.id); acceptMemory(m, body.text.trim() || m.text); }
      if (kind === 'mem-save') { const m = P(f.dataset.pid).memory.find(x => x.id === f.dataset.id); m.text = body.text.trim() || m.text; m.date = `今天 ${now()}`; render(true); toast(`已更新 ${m.id}`); }
    } catch (err) { busy(btn, false); inlineError(f.querySelector('.actions') || f, err); }
  });

  sandboxes(); // fix baseline VM specs at start
  render();
})();
