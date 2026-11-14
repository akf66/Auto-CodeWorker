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

