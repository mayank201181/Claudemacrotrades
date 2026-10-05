/* Macro Desk — reads only the email-gated dash_* RPCs. Everything shown is what the
   routines wrote at the time; live marks come from the hourly dash-mark job. */
(() => {
  const cfg = window.DASH_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true } });
  const $ = (s) => document.querySelector(s);
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

  const state = { tab: store('tab') || 'themes', model: store('model') || 'fable', sub: store('sub') || 'entered', index: null, date: null, trades: {}, open: new Set() };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v) => (v == null || v === '' ? null : Number(v));
  const fmt = (v, d = 2) => (n(v) == null || Number.isNaN(n(v)) ? '—' : n(v).toFixed(d));
  const fmtR = (v) => (n(v) == null ? '—' : `${n(v) >= 0 ? '+' : ''}${n(v).toFixed(2)}R`);
  const cls = (v) => (n(v) == null ? '' : n(v) > 0 ? 'pos' : n(v) < 0 ? 'neg' : '');
  const lvl = (v) => { const x = n(v); if (x == null) return '—'; const a = Math.abs(x); return a >= 1000 ? x.toFixed(1) : a >= 10 ? x.toFixed(2) : a >= 1 ? x.toFixed(3) : x.toFixed(4); };
  const dirTxt = (d) => (d == null ? '—' : Number(d) > 0 ? 'Long' : 'Short');
  const dayLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ago = (ts) => { if (!ts) return ''; const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000); return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };

  // ---------- theme (light/dark) ----------
  const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme(store('theme'));
  $('#themeToggle').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const t = dark ? 'light' : 'dark'; store('theme', t); applyTheme(t);
  };

  // ---------- auth ----------
  async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) { $('#login').hidden = false; $('#app').hidden = true; return; }
    $('#login').hidden = true; $('#app').hidden = false;
    try {
      state.index = await rpc('dash_index');
    } catch (e) {
      $('#themesBody').innerHTML = `<div class="card empty">Signed in as ${esc(data.session.user.email)}, but this account is not on the allow-list.</div>`;
      return;
    }
    syncChrome(); render();
  }
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    $('#loginMsg').textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
    $('#loginMsg').textContent = error ? error.message : '';
    if (!error) boot();
  };
  $('#signupBtn').onclick = async () => {
    const email = $('#email').value.trim(), password = $('#password').value;
    if (!email || password.length < 8) { $('#loginMsg').textContent = 'Enter your email and a password of 8+ characters first.'; return; }
    const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
    $('#loginMsg').textContent = error ? error.message : 'Account created. If a confirmation email arrives, open its link once, then sign in here.';
  };
  $('#signout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

  // ---------- chrome ----------
  function syncChrome() {
    document.querySelectorAll('#mainTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    document.querySelectorAll('#modelSeg button').forEach((b) => b.classList.toggle('active', b.dataset.model === state.model));
    document.querySelectorAll('#tradeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.sub === state.sub));
    $('#view-themes').hidden = state.tab !== 'themes';
    $('#view-trades').hidden = state.tab !== 'trades';
    const bk = state.index?.book?.[state.model];
    $('#freshness').textContent = bk ? `book ${bk.updated || ''} · synced ${ago(bk.ingested_at)}` : '';
  }
  document.querySelectorAll('#mainTabs button').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; store('tab', state.tab); syncChrome(); render(); }));
  document.querySelectorAll('#modelSeg button').forEach((b) => (b.onclick = () => { state.model = b.dataset.model; store('model', state.model); state.date = null; state.open.clear(); syncChrome(); render(); }));
  document.querySelectorAll('#tradeSeg button').forEach((b) => (b.onclick = () => { state.sub = b.dataset.sub; store('sub', state.sub); state.open.clear(); syncChrome(); render(); }));

  function render() { return state.tab === 'themes' ? renderThemes() : renderTrades(); }

  // ---------- themes ----------
  const datesFor = (m) => (state.index?.digests || []).filter((x) => x.model === m).map((x) => x.d);
  $('#dateSel').onchange = (e) => { state.date = e.target.value; renderThemes(); };
  $('#prevDay').onclick = () => step(1);
  $('#nextDay').onclick = () => step(-1);
  function step(k) { const ds = datesFor(state.model); const i = ds.indexOf(state.date); const j = i + k; if (j >= 0 && j < ds.length) { state.date = ds[j]; renderThemes(); } }

  async function renderThemes() {
    const ds = datesFor(state.model);
    if (!ds.length) { $('#themesBody').innerHTML = '<div class="card empty">No digests ingested for this model yet.</div>'; $('#dateSel').innerHTML = ''; return; }
    if (!state.date || !ds.includes(state.date)) state.date = ds[0];
    $('#dateSel').innerHTML = ds.map((d) => `<option value="${d}" ${d === state.date ? 'selected' : ''}>${dayLabel(d)}${d === ds[0] ? ' · latest' : ''}</option>`).join('');
    $('#themesBody').innerHTML = '<div class="muted">Loading…</div>';
    const g = await rpc('dash_digest', { p_model: state.model, p_d: state.date });
    if (!g) { $('#themesBody').innerHTML = '<div class="card empty">Not found.</div>'; return; }
    $('#digestMeta').textContent = `built ${g.built || '—'} SGT`;
    const sub = (g.subject || '').split('|').slice(1).join('|').trim();
    const secs = (g.sections || []).filter((s) => ['radar', 'tape', 'ledger', 'synthesis', 'stances'].includes(s.key));
    const nameOf = { radar: 'Radar', tape: 'Tape', ledger: 'Ledger', synthesis: 'Cross-theme synthesis & caveats', stances: 'Stance shifts' };
    $('#themesBody').innerHTML = `
      ${sub ? `<div class="subject">Odds moved: ${esc(sub)}</div>` : ''}
      <div class="card sixty"><h2 class="sec">The last 24h in 60 seconds</h2><ol class="rich">${(g.sixty || []).map((li) => `<li>${li}</li>`).join('')}</ol></div>
      <h2 class="sec">Themes</h2>
      ${(g.themes || []).map((t) => `
        <article class="card theme">
          <h3>${t.n}. ${esc(t.title)}</h3>
          ${t.breadth ? `<div class="breadth">${esc(t.breadth)}</div>` : ''}
          ${t.lean_html ? `<div class="lean rich">${t.lean_html}</div>` : ''}
          <details><summary>Full theme — what happened, voices, positioning, sources</summary><div class="rich">${t.html}</div></details>
        </article>`).join('')}
      <div class="section-grid">
        ${secs.map((s) => `<div class="card"><details ${s.key === 'synthesis' ? 'open' : ''}><summary><b>${esc(nameOf[s.key] || s.title)}</b></summary><div class="rich">${s.html}</div></details></div>`).join('')}
      </div>`;
  }

  // ---------- trades ----------
  async function loadTrades(m) { if (!state.trades[m]) state.trades[m] = await rpc('dash_trades', { p_model: m }); return state.trades[m]; }

  async function renderTrades() {
    $('#tradesBody').innerHTML = '<div class="muted">Loading…</div>';
    const data = await loadTrades(state.model);
    renderAnalytics(data);
    if (state.sub === 'entered') renderEntered(data); else renderTested(data);
  }

  const isClosed = (t) => /^closed/.test(t.status || '');
  const curR = (t) => (isClosed(t) ? n(t.result_r) : t.live?.r != null ? n(t.live.r) : t.marks?.length ? n(t.marks[t.marks.length - 1].r) : null);

  function renderAnalytics(data) {
    const trades = data.trades || [], tested = data.tested || [];
    const closed = trades.filter(isClosed), open = trades.filter((t) => t.status === 'open'), pending = trades.filter((t) => t.status === 'pending');
    const missed = trades.filter((t) => /missed|void|vetoed/.test(t.status || ''));
    const wins = closed.filter((t) => n(t.result_r) > 0).length;
    const cum = closed.reduce((a, t) => a + (n(t.result_r) || 0), 0);
    const openR = open.reduce((a, t) => a + (curR(t) || 0), 0);
    const notCarded = tested.filter((x) => x.verdict === 'not carded');
    const priced = notCarded.filter((x) => x.outcome && n(x.outcome.ret5) != null);
    const avg = (arr, f) => (arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : null);
    const near = priced.filter((x) => n(x.ev) != null && n(x.ev) >= 0.15), far = priced.filter((x) => n(x.ev) != null && n(x.ev) < 0.15);
    const ideaDays = new Set(tested.map((x) => x.d)).size;
    const proposed = trades.filter((t) => t.opened).length;
    const passRate = proposed + notCarded.length ? (100 * proposed) / (proposed + notCarded.length) : null;
    const stat = (k, v, s, c = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;
    $('#analytics').innerHTML = [
      stat('Closed', `${closed.length}`, `${wins} win${wins === 1 ? '' : 's'} · ${missed.length} missed`),
      stat('Realised', fmtR(cum), 'sum of closed trades, 1R each', cls(cum)),
      stat('Open', `${open.length}${pending.length ? ` +${pending.length}p` : ''}`, `marked ${fmtR(openR)} now`, cls(openR)),
      stat('Gate pass rate', passRate == null ? '—' : `${passRate.toFixed(0)}%`, `${proposed} carded vs ${notCarded.length} rejected (${ideaDays} days)`),
      stat('Rejected ideas, +5d', avg(priced, (x) => n(x.outcome.ret5)) == null ? '—' : `${fmt(avg(priced, (x) => n(x.outcome.ret5)))} ATR`, `n=${priced.length} · ${priced.filter((x) => n(x.outcome.ret5) > 0).length} moved their way`),
      stat('Near-misses (EV ≥ +0.15R)', avg(near, (x) => n(x.outcome.ret5)) == null ? '—' : `${fmt(avg(near, (x) => n(x.outcome.ret5)))} ATR`, `n=${near.length} vs rest ${avg(far, (x) => n(x.outcome.ret5)) == null ? '—' : fmt(avg(far, (x) => n(x.outcome.ret5)))} ATR (n=${far.length})`),
    ].join('');
    const bk = data.book;
    $('#tradeMeta').textContent = bk?.scorecard ? `Book scorecard: ${bk.scorecard}` : '';
  }

  function statusPill(t) { const s = t.status || ''; const c = s === 'open' || s === 'pending' ? 'open' : /missed|void|vetoed/.test(s) ? s.split('-')[0] : 'closed'; return `<span class="pill ${c}">${esc(s || '—')}</span>`; }

  function renderEntered(data) {
    const trades = data.trades || [];
    if (!trades.length) { $('#tradesBody').innerHTML = '<div class="card empty">No trades in the book yet.</div>'; return; }
    const rows = trades.map((t) => {
      const r = curR(t); const lv = t.live;
      const flags = lv && t.status === 'open' ? [lv.stop_closed ? '<span class="neg">stop closed</span>' : lv.stop_touched ? '<span class="warn">stop touched intraday</span>' : '', lv.target_closed ? '<span class="pos">target closed</span>' : lv.target_touched ? '<span class="pos">target touched intraday</span>' : ''].filter(Boolean).join(' · ') : '';
      const id = `${t.model}-${t.pid}`; const isOpen = state.open.has(id);
      return `<tr class="click" data-id="${id}">
          <td class="mono">${esc(t.pid)}</td>
          <td><b>${esc(t.title)}</b><div class="muted small">${esc(t.asset_class || '')} · ${esc(t.tclass || '')}${flags ? ' · ' + flags : ''}</div></td>
          <td>${statusPill(t)}</td>
          <td class="num hide-sm">${esc((t.opened || '').slice(0, 10))}</td>
          <td class="num">${lvl(t.entry)}</td><td class="num">${lvl(t.stop)}</td><td class="num">${lvl(t.target)}</td>
          <td class="num hide-sm">${fmt(t.rr)}</td>
          <td class="num hide-sm">${t.p != null ? `${fmt(t.p, 0)}%` : '—'} / ${fmtR(t.ev)}</td>
          <td class="num">${t.status === 'open' && lv ? lvl(lv.price) : isClosed(t) ? 'closed' : '—'}<div class="muted small">${t.status === 'open' && lv ? ago(lv.as_of) : esc((t.closed || '').slice(0, 10))}</div></td>
          <td class="num ${cls(r)}"><b>${fmtR(r)}</b></td>
        </tr>${isOpen ? `<tr class="detail"><td colspan="11">${tradeDetail(t)}</td></tr>` : ''}`;
    }).join('');
    $('#tradesBody').innerHTML = `<div class="tablewrap"><table class="grid"><thead><tr>
      <th>P</th><th>Trade</th><th>Status</th><th class="hide-sm">Opened</th><th>Entry</th><th>Stop</th><th>Target</th><th class="hide-sm">R:R</th><th class="hide-sm">p / EV</th><th>Mark</th><th>R</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Levels are exactly as carded and never edited except by a logged roll. R on open trades is the latest hourly mark; the book's official exits use daily closes (trade_book_spec), so an intraday touch is flagged, not booked.</p>`;
    bindRows();
  }

  function tradeDetail(t) {
    const marks = (t.marks || []).slice().reverse().map((m) => `<tr><td class="mono">${esc(m.d)}</td><td class="num">${lvl(m.mark)}</td><td class="num ${cls(m.r)}">${fmtR(m.r)}</td><td>${esc(m.note || '')}</td></tr>`).join('');
    const log = (t.log || []).slice().reverse().map((l) => `<li><span class="mono">${esc(l.d)}</span> — ${esc(l.text)}</li>`).join('');
    const meta = t.meta || {};
    const lv = t.live;
    return `<div class="dgrid">
      <div><h4>Why — thesis</h4><div>${esc(t.thesis || '—')}</div>
        <h4 style="margin-top:10px">Invalidation</h4><div>${esc(t.invalidation || '—')}</div>
        ${t.structure ? `<h4 style="margin-top:10px">Real structure (unscored)</h4><div>${esc(t.structure)}</div>` : ''}</div>
      <div><h4>Card</h4><div class="kv">
        <div>Direction</div><div>${dirTxt(t.direction)}</div><div>Proxy</div><div class="mono">${esc(t.proxy || '—')}</div>
        <div>Ref / entry</div><div class="mono">${lvl(t.ref)} / ${lvl(t.entry)}</div><div>Filled</div><div>${esc(t.filled || '—')}</div>
        <div>p vs p0</div><div>${t.p != null ? fmt(t.p, 0) + '%' : '—'} vs ${t.p0 != null ? fmt(t.p0, 0) + '%' : '—'}</div>
        <div>Factor</div><div>${esc(meta.factor || '—')}</div><div>Crowd / priced</div><div>${esc(meta.crowd || '—')} / ${esc(meta.priced || '—')}</div>
        <div>Review</div><div>${esc(t.review || '—')}</div><div>Linked</div><div>${esc(meta.linked || '—')}</div>
        ${isClosed(t) ? `<div>Exit</div><div>${esc(t.exit_reason || '—')} · ${fmtR(t.result_r)}</div>` : ''}
        ${lv ? `<div>Live</div><div class="mono">${lvl(lv.price)} (${ago(lv.as_of)}) · daily ${lvl(lv.daily_close)} on ${esc(lv.daily_close_d || '')} = ${fmtR(lv.daily_r)}</div>
        <div>Since fill</div><div class="mono">hi ${lvl(lv.hi_since_fill)} · lo ${lvl(lv.lo_since_fill)}</div>` : ''}
      </div></div>
      <div><h4>Marks (book)</h4>${marks ? `<table class="grid"><tbody>${marks}</tbody></table>` : '<div class="muted">—</div>'}
        ${log ? `<h4 style="margin-top:10px">Log</h4><ul class="small" style="margin:0;padding-left:16px">${log}</ul>` : ''}</div>
    </div>`;
  }

  function renderTested(data) {
    const tested = (data.tested || []);
    if (!tested.length) { $('#tradesBody').innerHTML = '<div class="card empty">No tested ideas recorded yet.</div>'; return; }
    let lastD = null; const out = [];
    for (const x of tested) {
      if (x.d !== lastD) { lastD = x.d; const cnt = tested.filter((y) => y.d === x.d).length; out.push(`<tr class="daygroup"><td colspan="9">${dayLabel(x.d)} · ${cnt} tested${x.source === 'email' ? ' · from the email (top lines only)' : ''}</td></tr>`); }
      const o = x.outcome; const id = `${x.d}|${x.idea}`; const isOpen = state.open.has(id);
      const verdict = x.verdict === 'covered' ? `covered by ${esc(x.covered_by)}` : x.verdict === 'not carded' ? `not carded (${esc(x.fail_code || '?')})` : esc(x.verdict);
      out.push(`<tr class="click" data-id="${esc(id)}">
        <td><b>${esc(x.idea)}</b><div class="muted small">${esc(x.reason || '')}</div></td>
        <td class="mono hide-sm">${esc(x.proxy || '—')}</td>
        <td class="hide-sm">${dirTxt(x.direction)}</td>
        <td class="num">${fmt(x.rr)}</td>
        <td class="num hide-sm">${x.p != null ? `${fmt(x.p, 0)}% vs ${fmt(x.p0, 0)}%` : '—'}</td>
        <td class="num ${cls(x.ev)}">${fmtR(x.ev)}</td>
        <td class="small">${verdict}</td>
        <td class="num ${cls(o?.ret5)}">${o?.ret5 != null ? fmt(o.ret5) : '—'}</td>
        <td class="num ${cls(o?.ret_last)}">${o?.ret_last != null ? fmt(o.ret_last) : '—'}</td>
      </tr>${isOpen ? `<tr class="detail"><td colspan="9">${ideaDetail(x)}</td></tr>` : ''}`);
    }
    $('#tradesBody').innerHTML = `<div class="tablewrap"><table class="grid"><thead><tr>
      <th>Idea & reason not carded</th><th class="hide-sm">Proxy</th><th class="hide-sm">Dir</th><th>R:R</th><th class="hide-sm">p vs p0</th><th>EV</th><th>Verdict</th><th title="Move in the idea's direction 5 sessions later, in ATR(20) units">+5d ATR</th><th title="Move in the idea's direction to the latest daily close, in ATR(20) units">To date</th>
      </tr></thead><tbody>${out.join('')}</tbody></table></div>
      <p class="note">Gate: r/r ≥ 1.0 and EV = p·r/r − (1−p) ≥ +0.3R. Fail codes per trade_book_spec — (a) no priceable proxy, (c) expectancy below the gate, (e) washout without crowding evidence beyond price. Outcome columns are shadow-tracked by the hourly job from the idea's 08:00 SGT reference; they are not trades.</p>`;
    bindRows();
  }

  function ideaDetail(x) {
    const o = x.outcome;
    return `<div class="kv">
      <div>Reason</div><div>${esc(x.reason || '—')}</div>
      <div>Source</div><div>${x.source === 'ledger' ? 'trade_book_current ledger (complete list)' : 'digest email (printed lines)'}</div>
      ${o ? `<div>Reference</div><div class="mono">${lvl(o.ref)} on ${esc(o.ref_d)} · ATR20 ${lvl(o.atr20)}</div>
      <div>Forward (ATR)</div><div class="mono">+1d ${fmt(o.ret1)} · +5d ${fmt(o.ret5)} · +10d ${fmt(o.ret10)} · +20d ${fmt(o.ret20)} · to ${esc(o.last_d || '—')} ${fmt(o.ret_last)}</div>` : '<div>Outcome</div><div class="muted">not priced (no proxy or direction)</div>'}
    </div>`;
  }

  function bindRows() {
    document.querySelectorAll('#tradesBody tr.click').forEach((tr) => (tr.onclick = (e) => {
      if (e.target.closest('a')) return;
      const id = tr.dataset.id; state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      state.sub === 'entered' ? renderEntered(state.trades[state.model]) : renderTested(state.trades[state.model]);
    }));
  }

  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
  boot();
})();
