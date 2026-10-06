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
  // Carded levels print exactly as written; only computed prices (live marks) are rounded.
  const lvl = (v) => { const x = n(v); if (x == null) return '—'; return String(+x.toPrecision(10)); };
  const px = (v) => { const x = n(v); if (x == null) return '—'; const a = Math.abs(x); return a >= 1000 ? x.toFixed(1) : a >= 10 ? x.toFixed(2) : a >= 1 ? x.toFixed(3) : x.toFixed(4); };
  const avg = (arr, f) => (arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : null);
  let seq = 0; // guards against a slow response overwriting a newer view
  const dirTxt = (d) => (d == null ? '—' : Number(d) > 0 ? 'Long' : 'Short');
  const dayLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ago = (ts) => { if (!ts) return ''; const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000); return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };

  // ---------- theme (light/dark) ----------
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; adaptAll(); };
  // Light is the default so the page reads exactly like the emails; the toggle remembers a dark choice.
  $('#themeToggle').onclick = () => { const t = isDark() ? 'light' : 'dark'; store('theme2', t); applyTheme(t); };

  // The digests colour highlights and text for a white page. On the dark theme a light inline
  // background becomes a translucent tint of the same hue (text stays light) and a dark inline
  // text colour is lifted; the original style is kept, so the light theme shows the email as sent.
  const ctx = document.createElement('canvas').getContext('2d');
  const rgbOf = (v) => {
    ctx.fillStyle = '#000'; ctx.fillStyle = v.trim(); const s = ctx.fillStyle;
    if (s[0] === '#') return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const m = s.match(/[\d.]+/g); return m && !(m[3] === '0') ? m.slice(0, 3).map(Number) : null;
  };
  const hsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  };
  function adapt(el) {
    if (el.dataset.s0 === undefined) el.dataset.s0 = el.getAttribute('style') || '';
    el.setAttribute('style', el.dataset.s0);
    el.classList.remove('hl');
    if (!isDark()) return;
    const bg = el.style.backgroundColor || el.style.background;
    const c = bg && rgbOf(bg);
    if (c) {
      const [h, s, l] = hsl(c);
      // A light highlight becomes coloured text on a faint tint of the same hue: the meaning
      // (green = stance change, yellow = odds moved, red = new scenario, blue = read) stays, the block goes.
      if (l > 0.5) {
        el.style.background = '';
        if (s < 0.15) { el.style.backgroundColor = 'rgba(255,255,255,0.04)'; } else {
          const hh = h.toFixed(0), ss = Math.round(Math.min(0.8, s) * 100);
          el.style.backgroundColor = `hsla(${hh}, ${ss}%, 55%, 0.09)`;
          if (!el.style.color) el.style.color = `hsl(${hh}, ${ss}%, 80%)`;
          el.classList.add('hl');
        }
      }
    }
    const fg = el.style.color && rgbOf(el.style.color);
    if (fg) {
      const [h, s, l] = hsl(fg);
      if (l < 0.6) el.style.color = s < 0.15 ? (l < 0.35 ? '' : `hsl(0, 0%, ${Math.round((1 - l) * 100)}%)`) : `hsl(${h.toFixed(0)}, ${Math.round(s * 100)}%, 72%)`;
    }
  }
  const SEL = '[style*="background"], [style*="color"]';
  const adaptIn = (root) => { if (root.matches?.(SEL)) adapt(root); root.querySelectorAll?.(SEL).forEach(adapt); };
  function adaptAll() { if (document.body) adaptIn(document.body); }
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && adaptIn(n))))
    .observe(document.body, { childList: true, subtree: true });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', adaptAll);
  applyTheme(store('theme2') || 'light');

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
    $('#view-scores').hidden = !SCORES[state.tab];
    $('#view-feed').hidden = !FEEDS[state.tab];
    $('#modelSeg').hidden = !!FEEDS[state.tab] || state.tab === 'voices' || state.tab === 'review';
    const bk = state.index?.book?.[state.model];
    $('#freshness').textContent = bk ? `book ${bk.updated || ''} · synced ${ago(bk.ingested_at)}` : '';
  }
  document.querySelectorAll('#mainTabs button').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; store('tab', state.tab); syncChrome(); render(); }));
  document.querySelectorAll('#modelSeg button').forEach((b) => (b.onclick = () => { state.model = b.dataset.model; store('model', state.model); state.date = null; state.open.clear(); syncChrome(); render(); }));
  document.querySelectorAll('#tradeSeg button').forEach((b) => (b.onclick = () => { state.sub = b.dataset.sub; store('sub', state.sub); state.open.clear(); syncChrome(); render(); }));

  function render() {
    if (FEEDS[state.tab]) return renderFeed(state.tab);
    if (SCORES[state.tab]) return renderScores(state.tab);
    return state.tab === 'themes' ? renderThemes() : renderTrades();
  }

  // ---------- feed tabs (YouTube / Podcast / Grok / Substack) ----------
  const FEEDS = {
    youtube: { name: 'YouTube Digest', open: /take|overview/i },
    podcast: { name: 'Podcast Digest', open: /take|overview|synthesis/i },
    grok: { name: 'Grok Full Consolidated', open: /network pulse a|markets intel/i },
    substack: { name: 'Newsletters (from the Email Digest)', open: /market/i },
  };
  const SOURCE_NAME = { fable: 'Fable 5.1', opus: 'Opus 5.5', chatgpt: 'ChatGPT', claude: 'Claude' };
  const feedState = {};

  async function renderFeed(family) {
    const fs = (feedState[family] ||= { index: null, date: null, source: null, rows: {} });
    // An empty index is not cached: the first backfill may land while the page is open.
    try {
      if (!fs.index?.length) fs.index = await rpc('dash_feed_index', { p_family: family });
    } catch (e) {
      $('#feedBody').innerHTML = `<div class="card empty">Could not load ${esc(FEEDS[family].name)}: ${esc(e.message || e)}</div>`;
      return;
    }
    if (state.tab !== family) return;
    const ds = fs.index.map((x) => x.d);
    if (!ds.length) { $('#feedBody').innerHTML = `<div class="card empty">No ${esc(FEEDS[family].name)} emails ingested yet.</div>`; $('#feedDate').innerHTML = ''; $('#sourceSeg').innerHTML = ''; return; }
    if (!fs.date || !ds.includes(fs.date)) fs.date = ds[0];
    $('#feedDate').innerHTML = ds.map((d) => `<option value="${d}" ${d === fs.date ? 'selected' : ''}>${dayLabel(d)}${d === ds[0] ? ' · latest' : ''}</option>`).join('');
    $('#feedDate').onchange = (e) => { fs.date = e.target.value; renderFeed(family); };
    $('#feedPrev').onclick = () => { const i = ds.indexOf(fs.date); if (i + 1 < ds.length) { fs.date = ds[i + 1]; renderFeed(family); } };
    $('#feedNext').onclick = () => { const i = ds.indexOf(fs.date); if (i > 0) { fs.date = ds[i - 1]; renderFeed(family); } };
    $('#feedBody').innerHTML = '<div class="muted">Loading…</div>';
    const key = fs.date;
    const my = ++seq;
    try {
      if (!fs.rows[key]) fs.rows[key] = await rpc('dash_feed', { p_family: family, p_d: key });
    } catch (e) {
      if (my === seq) $('#feedBody').innerHTML = `<div class="card empty">Could not load this date: ${esc(e.message || e)}</div>`;
      return;
    }
    if (my !== seq || state.tab !== family) return;
    const rows = fs.rows[key] || [];
    const sources = [...new Set(rows.map((r) => r.source))];
    const pref = [fs.source, state.model, 'opus', 'fable', 'chatgpt', 'claude'];
    const src = pref.find((s) => s && sources.includes(s)) || sources[0];
    fs.source = src;
    $('#sourceSeg').innerHTML = sources.length > 1 ? sources.map((s) => `<button data-src="${s}" class="${s === src ? 'active' : ''}">${esc(SOURCE_NAME[s] || s)}</button>`).join('') : '';
    $('#sourceSeg').hidden = sources.length < 2;
    document.querySelectorAll('#sourceSeg button').forEach((b) => (b.onclick = () => { fs.source = b.dataset.src; renderFeed(family); }));
    const parts = rows.filter((r) => r.source === src);
    $('#feedMeta').textContent = `${SOURCE_NAME[src] || src} · ${parts.length > 1 ? parts.length + ' emails' : (parts[0]?.subject || '').replace(/^.*?—\s*/, '').slice(0, 80)}`;
    const openRe = FEEDS[family].open;
    $('#feedBody').innerHTML = parts.map((r) => `
      ${parts.length > 1 ? `<h2 class="sec">${esc(r.subject)}</h2>` : ''}
      ${r.intro ? `<div class="card rich small" style="margin-bottom:12px">${r.intro}</div>` : ''}
      ${(r.sections || []).map((s, i) => `<div class="card" style="margin-bottom:10px"><details ${openRe.test(s.title) || (i === 0 && !r.sections.some((x) => openRe.test(x.title))) ? 'open' : ''}>
        <summary><b>${esc(s.title || 'Digest')}</b></summary><div class="rich">${s.html}</div></details></div>`).join('')}
    `).join('') || '<div class="card empty">Nothing for this date.</div>';
  }

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
    const my = ++seq;
    const g = await rpc('dash_digest', { p_model: state.model, p_d: state.date });
    if (my !== seq) return;
    if (!g) { $('#themesBody').innerHTML = '<div class="card empty">Not found.</div>'; return; }
    $('#digestMeta').textContent = `built ${g.built || '—'} SGT`;
    const sub = (g.subject || '').split('|').slice(1).join('|').trim();
    const secs = (g.sections || []).filter((s) => ['radar', 'tape', 'ledger', 'synthesis', 'stances'].includes(s.key));
    const nameOf = { radar: 'Radar', tape: 'Tape', ledger: 'Ledger', synthesis: 'Cross-theme synthesis & caveats', stances: 'Stance shifts' };
    $('#themesBody').innerHTML = `
      ${sub ? `<div class="subject">Odds moved: ${esc(sub)}</div>` : ''}
      <div class="card sixty"><h2 class="sec">The last 24h in 60 seconds</h2>${(g.sections || []).filter((s) => s.key === 'sixty_intro').map((s) => `<div class="rich small">${s.html}</div>`).join('')}<ol class="rich">${(g.sixty || []).map((li) => `<li>${li}</li>`).join('')}</ol></div>
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
    const my = ++seq;
    const data = await loadTrades(state.model);
    if (my !== seq || state.tab !== 'trades') return;
    renderAnalytics(data);
    if (state.sub === 'entered') renderEntered(data); else renderTested(data);
  }

  const isClosed = (t) => /^closed/.test(t.status || '');
  const curR = (t) => {
    if (isClosed(t)) return n(t.result_r);
    if (t.status !== 'open') return null; // pending, missed, void, vetoed carry no R
    if (t.live?.r != null) return n(t.live.r);
    return t.marks?.length ? n(t.marks[t.marks.length - 1].r) : null;
  };

  function renderAnalytics(data) {
    const trades = data.trades || [], tested = data.tested || [];
    const closed = trades.filter(isClosed), open = trades.filter((t) => t.status === 'open'), pending = trades.filter((t) => t.status === 'pending');
    const missed = trades.filter((t) => /missed|void|vetoed/.test(t.status || ''));
    const wins = closed.filter((t) => n(t.result_r) > 0).length;
    const cum = closed.reduce((a, t) => a + (n(t.result_r) || 0), 0);
    const openR = open.reduce((a, t) => a + (curR(t) || 0), 0);
    const notCarded = tested.filter((x) => x.verdict === 'not carded');
    const priced = notCarded.filter((x) => x.outcome && n(x.outcome.ret5) != null);
    const near = priced.filter((x) => n(x.ev) != null && n(x.ev) >= 0.15), far = priced.filter((x) => n(x.ev) != null && n(x.ev) < 0.15);
    const dayset = new Set(tested.map((x) => x.d));
    const ideaDays = dayset.size;
    const proposed = trades.filter((t) => t.opened && dayset.has(String(t.opened).slice(0, 10))).length;
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

  function statusPill(t) { const s = t.status || ''; const c = s === 'open' || s === 'pending' ? 'open' : /missed|void|vetoed/.test(s) ? 'missed' : 'closed'; return `<span class="pill ${c}">${esc(s || '—')}</span>`; }

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
          <td class="num">${t.status === 'open' && lv ? px(lv.price) : isClosed(t) ? 'closed' : '—'}<div class="muted small">${t.status === 'open' && lv ? ago(lv.as_of) : esc((t.closed || '').slice(0, 10))}</div></td>
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
        ${lv ? `<div>Live</div><div class="mono">${px(lv.price)} (${ago(lv.as_of)}) · daily ${px(lv.daily_close)} on ${esc(lv.daily_close_d || '')} = ${fmtR(lv.daily_r)}</div>
        <div>Since fill</div><div class="mono">hi ${px(lv.hi_since_fill)} · lo ${px(lv.lo_since_fill)}</div>` : ''}
      </div></div>
      <div><h4>Marks (book)</h4>${marks ? `<table class="grid"><tbody>${marks}</tbody></table>` : '<div class="muted">—</div>'}
        ${log ? `<h4 style="margin-top:10px">Log</h4><ul class="small" style="margin:0;padding-left:16px">${log}</ul>` : ''}</div>
    </div>`;
  }

  // THE TRADE TEST (trade_book_spec): an idea that is not carded names the first letter it failed.
  const GATES = {
    a: 'no priceable proxy',
    b: 'stop and target not at levels with meaning',
    c: 'expectancy below the gate (EV < +0.30R, or r/r < 1.0)',
    d: 'no dated catalyst or mechanism in motion',
    e: 'already priced by the model\u2019s own judgement (for a washout: crowding shown only by price)',
    f: 'book caps full',
    g: 'vetoed by you in the last 60 days',
  };
  const gateKey = (x) => {
    if (x.verdict === 'covered') return 'covered';
    if (x.verdict !== 'not carded') return null;
    const c = x.fail_code || '?';
    if (c !== 'c') return c;
    if (n(x.rr) != null && n(x.rr) < 1) return 'c-rr';
    return n(x.ev) != null && n(x.ev) >= 0.15 ? 'c-near' : 'c-far';
  };
  const GATE_ROWS = [
    ['c-near', '(c) near miss: EV +0.15 to +0.30R'], ['c-far', '(c) EV below +0.15R'], ['c-rr', '(c) r/r below 1.0'],
    ['a', '(a) ' + GATES.a], ['b', '(b) ' + GATES.b], ['d', '(d) ' + GATES.d], ['e', '(e) ' + GATES.e],
    ['f', '(f) ' + GATES.f], ['g', '(g) ' + GATES.g], ['covered', 'covered by an open trade'], ['?', 'no letter given'],
  ];

  // Did each gate reject ideas that then worked? Shadow outcomes per gate, in ATR(20) units in the
  // idea's own direction. Ideas overlap across days and models, so the effective sample is smaller than n.
  function gateAudit(tested) {
    const rows = GATE_ROWS.map(([k, label]) => {
      const xs = tested.filter((x) => gateKey(x) === k);
      if (!xs.length) return '';
      const p5 = xs.filter((x) => x.outcome && n(x.outcome.ret5) != null), pl = xs.filter((x) => x.outcome && n(x.outcome.ret_last) != null);
      const a5 = avg(p5, (x) => n(x.outcome.ret5)), al = avg(pl, (x) => n(x.outcome.ret_last));
      const hit = p5.length ? p5.filter((x) => n(x.outcome.ret5) > 0).length / p5.length : null;
      const read = p5.length < 20 ? '<span class="muted">too few to judge</span>'
        : a5 > 0.25 && hit >= 0.6 ? '<span class="warn">worth a look: rejected ideas went on to work</span>'
        : a5 < 0 ? '<span class="pos">rejections look right</span>' : '<span class="muted">no clear signal</span>';
      return `<tr><td>${esc(label)}</td><td class="num">${xs.length}</td><td class="num">${p5.length}</td>
        <td class="num ${cls(a5)}">${a5 == null ? '—' : fmt(a5)}</td><td class="num">${hit == null ? '—' : Math.round(hit * 100) + '%'}</td>
        <td class="num ${cls(al)}">${al == null ? '—' : fmt(al)}</td><td class="small">${read}</td></tr>`;
    }).join('');
    return `<div class="card" style="margin-bottom:14px"><h2 class="sec">Gate audit — what each rejection rule turned away</h2>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Gate failed</th><th>Ideas</th><th title="Ideas with 5 sessions of outcome">Priced +5d</th>
      <th title="Average move in the idea's direction 5 sessions later, ATR(20) units">Avg +5d ATR</th><th title="Share that moved the idea's way by +5d">Moved their way</th>
      <th title="Average move in the idea's direction to the latest close">Avg to date</th><th>Read</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">A gate that keeps turning away ideas that then work is a candidate to loosen in the weekly rule review; one whose rejections drift against the idea is doing its job. Read needs 20+ priced ideas, and ideas repeat across days and models, so treat early numbers as anecdote.</p></div>`;
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
    $('#tradesBody').innerHTML = gateAudit(tested) + `<div class="tablewrap"><table class="grid"><thead><tr>
      <th>Idea & reason not carded</th><th class="hide-sm">Proxy</th><th class="hide-sm">Dir</th><th>R:R</th><th class="hide-sm">p vs p0</th><th>EV</th><th>Verdict</th><th title="Move in the idea's direction 5 sessions later, in ATR(20) units">+5d ATR</th><th title="Move in the idea's direction to the latest daily close, in ATR(20) units">To date</th>
      </tr></thead><tbody>${out.join('')}</tbody></table></div>
      <p class="note">Gate: r/r ≥ 1.0 and EV = p·r/r − (1−p) ≥ +0.3R. Fail codes (trade_book_spec, the first letter failed): (a) no priceable proxy · (b) stop/target without meaning · (c) expectancy · (d) no catalyst · (e) already priced, or a washout whose crowding is price only · (f) caps · (g) vetoed. Outcome columns are shadow-tracked by the hourly job from the first price a reader could deal at after the digest (the last live hourly close before 08:00 SGT, or the next open if the market was shut); they are not trades.</p>`;
    bindRows();
  }

  // The gate is on EV, not on p: EV = p·rr − (1−p) ≥ +0.3R. Solved for p at the idea's own r/r it
  // reads p ≥ 1.3 / (1 + rr) in 5% steps — 55% at 1.45, 35% at 3, 25% at 5 — so asymmetric ideas pass at low p.
  function gateLine(x) {
    const rr = n(x.rr);
    if (rr == null || rr <= 0) return '';
    if (rr < 1) return `r/r ${fmt(rr)} is below the 1.0 floor`;
    const need = Math.min(100, Math.ceil((130 / (1 + rr)) / 5 - 1e-9) * 5);
    return `EV ${fmtR(x.ev)} vs the +0.30R gate${x.p != null ? ` (p ${fmt(x.p, 0)}% at r/r ${fmt(rr)}; random walk ${fmt(x.p0, 0)}%)` : ''} — at this r/r EV clears only with p ≥ ${need}%`;
  }

  function ideaDetail(x) {
    const o = x.outcome;
    const g = x.verdict === 'covered' ? `already covered by ${x.covered_by || 'an open trade'}`
      : x.verdict !== 'not carded' ? '' : x.fail_code === 'c' ? `(c) ${gateLine(x)}`
      : x.fail_code && GATES[x.fail_code] ? `(${x.fail_code}) ${GATES[x.fail_code]}` : 'no gate letter recorded';
    const ref = !o ? '' : o.ref == null
      ? `<div>Graded from</div><div class="muted">pending: the market was shut when the digest landed, so grading starts at its first print after that</div>`
      : `<div>Graded from</div><div class="mono">${px(o.ref)} on ${esc(o.ref_d)} · ATR20 ${px(o.atr20)}</div>
      <div>Forward (ATR)</div><div class="mono">+1d ${fmt(o.ret1)} · +5d ${fmt(o.ret5)} · +10d ${fmt(o.ret10)} · +20d ${fmt(o.ret20)} · to ${esc(o.last_d || '—')} ${fmt(o.ret_last)}</div>`;
    return `<div class="kv">
      <div>Reason</div><div>${esc(x.reason || '—')}</div>
      ${g ? `<div>Why not entered</div><div>${esc(g)}</div>` : ''}
      <div>Source</div><div>${x.source === 'ledger' ? 'trade_book_current ledger (complete list)' : 'digest email (printed lines)'}</div>
      ${o ? ref : '<div>Outcome</div><div class="muted">not priced (no proxy or direction)</div>'}
    </div>`;
  }

  function bindRows() {
    document.querySelectorAll('#tradesBody tr.click').forEach((tr) => (tr.onclick = (e) => {
      if (e.target.closest('a')) return;
      const id = tr.dataset.id; state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      state.sub === 'entered' ? renderEntered(state.trades[state.model]) : renderTested(state.trades[state.model]);
    }));
  }


  // ---------- learning loop: Questions / Voices / Review ----------
  const SCORES = { questions: 'dash_questions', voices: 'dash_voices', review: 'dash_review' };
  const vscope = () => (store('vscope') === 'live' ? 'live' : 'all');
  const scoreCache = {};
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  const zf = (v) => (n(v) == null ? '—' : `${n(v) >= 0 ? '+' : ''}${n(v).toFixed(2)}`);
  const sgt = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }) + ' SGT' : '—');
  const ARROW = { UU: '↑↑', U: '↑', N: '↔', D: '↓', DD: '↓↓' };
  const arrowOf = (v) => ({ 2: '↑↑', 1: '↑', 0: '↔', '-1': '↓', '-2': '↓↓' }[String(v)] ?? '');
  const verdictPill = (v) => (v ? `<span class="pill ${v === 'HIT' ? 'open' : v === 'MISS' ? 'missed' : 'closed'}">${esc(v)}</span>` : '<span class="muted">—</span>');
  const statBox = (k, v, s, c = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;

  async function renderScores(tab) {
    const body = $('#scoresBody');
    body.innerHTML = '<div class="muted">Loading…</div>';
    const my = ++seq;
    const key = tab === 'voices' ? `voices:${vscope()}` : tab;
    try { if (!scoreCache[key]) scoreCache[key] = await rpc(SCORES[tab], tab === 'voices' ? { p_scope: vscope() } : undefined); }
    catch (e) { if (my === seq) body.innerHTML = `<div class="card empty">Could not load: ${esc(e.message || e)}</div>`; return; }
    if (my !== seq || state.tab !== tab) return;
    const d = scoreCache[key];
    if (tab === 'questions') renderQuestions(d); else if (tab === 'voices') renderVoices(d); else renderReview(d);
  }

  // Questions: the odds engine's yes/no questions, scored three ways — as printed (sign of all arrows),
  // on arrows written at least two days before the resolve date (late arrows often just watch the
  // outcome arrive), and against an "always NO" baseline (most level questions resolve NO).
  function renderQuestions(d) {
    const qs = (d.questions || []).filter((q) => q.model === state.model);
    const res = qs.filter((q) => q.status === 'resolved' && q.outcome);
    const cnt = (arr, v, f = 'verdict') => arr.filter((q) => q[f] === v).length;
    const hit = cnt(res, 'HIT'), miss = cnt(res, 'MISS'), flat = cnt(res, 'FLAT');
    const noBase = res.filter((q) => q.outcome === 'NO').length;
    const lead = res.filter((q) => q.verdict_lead2);
    const lh = cnt(lead, 'HIT', 'verdict_lead2'), lm = cnt(lead, 'MISS', 'verdict_lead2');
    const arrowsAll = res.reduce((a, q) => a + (q.arrows_all || 0), 0), arrowsLate = res.reduce((a, q) => a + (q.arrows_late || 0), 0);
    const am = res.filter((q) => q.against_market), amh = am.filter((q) => q.verdict === 'HIT').length;
    const sc = d.scorecards?.[state.model];
    const read = res.length < 10 ? 'Too few resolved questions to read yet.'
      : `The arrows called ${hit} of ${res.length}; always saying NO would have called ${noBase}. On arrows written at least two days before resolution: ${lh} hit, ${lm} miss of ${lead.length} with an early lean.`;
    const open = qs.filter((q) => q.status === 'open' || q.status === 'awaiting').sort((a, b) => String(a.resolves).localeCompare(String(b.resolves)));
    const done = qs.filter((q) => q.status !== 'open' && q.status !== 'awaiting').sort((a, b) => String(b.closed || '').localeCompare(String(a.closed || '')));
    const qrow = (q, resolved) => {
      const id = `q-${q.model}-${q.qid}`; const isOpen = state.open.has(id);
      return `<tr class="click" data-id="${id}">
        <td class="mono">${esc(q.qid)}</td>
        <td>${esc(q.question || '')}<div class="muted small">${esc(q.bucket || '')}${q.rule ? ' · rule: ' + esc(q.rule).slice(0, 160) : ''}</div></td>
        <td class="num">${esc(q.resolves || '—')}</td>
        <td class="num ${cls(q.net_total)}">${q.net_total == null ? '—' : (q.net_total > 0 ? '+' : '') + q.net_total}</td>
        ${resolved ? `<td>${q.status === 'resolved' ? `<b>${esc(q.outcome || '')}</b>` : `<span class="muted">${esc(q.status)}</span>`}</td><td>${verdictPill(q.verdict)}</td><td>${verdictPill(q.verdict_lead2)}</td>`
                   : `<td class="small">${esc(q.last_implied || 'n/a')}</td><td class="num">${esc(q.last_move || q.first_arrow || '—')}</td>`}
      </tr>${isOpen ? `<tr class="detail"><td colspan="7">${questionDetail(q)}</td></tr>` : ''}`;
    };
    const ev = (d.evidence || []).filter((e) => e.n >= 2);
    $('#scoresBody').innerHTML = `
      <div class="analytics">
        ${statBox('Resolved', res.length, `${hit} hit · ${miss} miss · ${flat} flat`)}
        ${statBox('Hit rate', pct(hit, res.length), `always-NO baseline ${pct(noBase, res.length)}`)}
        ${statBox('Early lean (≥2 days out)', lead.length ? pct(lh, lead.length) : '—', `${lh} hit · ${lm} miss of ${lead.length}`)}
        ${statBox('Arrows in the last 2 days', pct(arrowsLate, arrowsAll), 'share of all arrows on resolved questions')}
        ${statBox('Against the market', am.length ? `${amh}/${am.length}` : '0', 'calls leaning away from the implied odds')}
        ${statBox('Open', open.length, sc ? `routine scorecard: ${sc.hit}/${sc.resolved} hit` : '')}
      </div>
      <p class="note">${esc(read)} Every arrow is the routine's own, lifted from the digests and the brief-state file; nothing is re-judged here.</p>
      <h2 class="sec" style="margin-top:16px">Open questions</h2>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Q</th><th>Question</th><th>Resolves</th><th>Net</th><th>Last implied</th><th>Last arrow</th></tr></thead>
        <tbody>${open.map((q) => qrow(q, false)).join('') || '<tr><td colspan="6" class="muted">none</td></tr>'}</tbody></table></div>
      <h2 class="sec" style="margin-top:18px">Resolved and retired</h2>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Q</th><th>Question</th><th>Resolves</th><th>Net</th><th>Outcome</th><th title="sign of all arrows vs the outcome">Verdict</th><th title="sign of arrows written at least two days before the resolve date">Early</th></tr></thead>
        <tbody>${done.map((q) => qrow(q, true)).join('') || '<tr><td colspan="7" class="muted">none</td></tr>'}</tbody></table></div>
      <h2 class="sec" style="margin-top:18px">Which evidence was right (both models, resolved questions)</h2>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Type</th><th>Access</th><th>Arrows</th><th>Right</th><th title="excluding arrows written in the last two days before resolution">Right, ≥2 days out</th></tr></thead>
        <tbody>${ev.map((e) => `<tr><td>${esc(e.type)}</td><td>${esc(e.access)}</td><td class="num">${e.n}</td><td class="num">${pct(e.correct, e.n)}</td><td class="num">${e.n_early ? `${pct(e.correct_early, e.n_early)} <span class="muted">(${e.n_early})</span>` : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">no resolved arrows yet</td></tr>'}</tbody></table></div>
      <h2 class="sec" style="margin-top:18px">New-scenario themes printed (red blocks)</h2>
      <div class="tablewrap"><table class="grid"><thead><tr><th>T</th><th>Theme</th><th>First</th><th>Last</th><th>Printed</th><th>Indep. sources</th></tr></thead>
        <tbody>${(d.themes || []).filter((t) => t.model === state.model).map((t) => `<tr><td class="mono">${esc(t.tid)}</td><td>${esc(t.label || '')}${t.becomes_if ? `<div class="muted small">becomes a question if: ${esc(t.becomes_if)}</div>` : ''}</td><td class="num">${esc(t.first)}</td><td class="num">${esc(t.last)}</td><td class="num">${t.printed}</td><td class="num">${t.indep ?? '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">none</td></tr>'}</tbody></table></div>`;
    bindScoreRows();
  }

  function questionDetail(q) {
    const days = (q.days || []).slice().reverse().map((x) => `<tr><td class="mono">${esc(x.d)}</td><td class="num"><b>${ARROW[x.net] || esc(x.net || '')}</b></td>
      <td class="small">${esc(x.implied || '')}</td>
      <td class="small">${(x.evidence || []).map((e) => `<div>${e.echo ? '<span class="muted">echo</span>' : `<b>${arrowOf(e.val)}</b>`} ${esc(e.text)} ${e.type ? `<span class="muted">(${esc(e.type)}${e.access ? ' · ' + esc(e.access) : ''})</span>` : ''} ${(e.links || []).slice(0, 2).map((l, i) => `<a href="${esc(l)}" target="_blank" rel="noopener">link${i ? i + 1 : ''}</a>`).join(' ')}</div>`).join('')}${x.priced ? `<div class="muted">priced: ${esc(x.priced)}</div>` : ''}</td></tr>`).join('');
    const early = (q.state_days || []).map((x) => `${esc(x.d)} ${arrowOf(x.net_val)}`).join(' · ');
    return `<div class="kv" style="margin-bottom:8px">
        <div>Opened</div><div>${esc(q.opened || '—')}</div>
        <div>Rule</div><div>${esc(q.rule || '—')}</div>
        <div>Implied</div><div>${esc(q.open_implied || 'n/a')} at open → ${esc(q.last_implied || 'n/a')} last</div>
        ${q.outcome ? `<div>Outcome</div><div>${esc(q.outcome)} — ${esc(q.outcome_source || '')}</div>` : ''}
        ${q.retired_why ? `<div>Retired</div><div>${esc(q.retired_why)}</div>` : ''}
        <div>Arrows</div><div>net ${q.net_total ?? '—'} · ${q.arrows_late || 0} of ${q.arrows_all || 0} in the last 2 days${early ? ` · from the brief-state file: ${early}` : ''}</div>
      </div>
      ${days ? `<table class="grid"><thead><tr><th>Day</th><th>Net</th><th>Implied</th><th>Evidence</th></tr></thead><tbody>${days}</tbody></table>` : '<div class="muted small">No tagged days in the ingested digests.</div>'}`;
  }

  // Voices: each speaker's own directional views, mapped to one market and graded 10 and 42 sessions
  // after the view as z = move / (daily vol x sqrt(sessions)). Market calls (conviction 2-3) are ranked;
  // forecasts (a central-bank action scored on the 2y yield, or a move implied by a mechanism) are shown
  // apart. Conditional and same-day two-sided views are kept for reference but never graded or counted.
  function renderVoices(d) {
    const c = d.coverage || {};
    const minN = Number(store('vmin') || 3);
    const scope = d.scope === 'live' ? 'live' : 'all';
    const rows = (d.leaders || []).map((v) => ({ ...v, shr10: v.n10 ? (v.hit10 + 5) / (v.n10 + 10) : null }))
      .filter((v) => v.n10 >= minN || (minN === 0 && (v.calls > 0 || v.f_n10 > 0)))
      .sort((a, b) => (b.shr10 ?? -1) - (a.shr10 ?? -1) || b.calls - a.calls);
    const vrow = (v) => {
      const id = `v-${v.voice}`; const isOpen = state.open.has(id);
      return `<tr class="click" data-id="${esc(id)}" data-voice="${esc(v.voice)}">
        <td><b>${esc(v.name)}</b><div class="muted small">${esc(v.affiliation || '')}${v.retro ? ` · ${v.retro} backfilled` : ''}</div></td>
        <td class="num">${v.calls}</td>
        <td class="num">${v.n10}${v.n10 ? ` <span class="muted small" title="independent clusters: distinct market group and week">(${v.clusters10})</span>` : ''}</td>
        <td class="num">${pct(v.hit10, v.n10)}</td><td class="num"><b>${v.shr10 == null ? '—' : Math.round(v.shr10 * 100) + '%'}</b></td>
        <td class="num ${cls(v.avg_z10)}">${zf(v.avg_z10)}</td><td class="num">${pct(v.trend_hit10, v.trend_n10)}</td>
        <td class="num">${v.n42}</td><td class="num">${pct(v.hit42, v.n42)}</td><td class="num ${cls(v.avg_z42)}">${zf(v.avg_z42)}</td>
        <td class="num">${v.contra_n ? `${v.contra_hit}/${v.contra_n}` : '—'}</td>
        <td class="num">${v.f_n10 ? `${v.f_hit10}/${v.f_n10}` : '—'}</td>
        <td class="num ${cls(v.live_z)}">${v.live ? `${v.live} · ${zf(v.live_z)}` : '—'}</td>
      </tr>${isOpen ? `<tr class="detail"><td colspan="13" id="vd-${esc(v.voice)}"><span class="muted">Loading…</span></td></tr>` : ''}`;
    };
    const crowd = (d.crowd || []).filter((x) => x.voices30 > 0);
    const spark = (path) => {
      if (!path || !path.length) return '';
      const w = 90, h = 22, vals = path.map((p) => p[1] - p[2]), mx = Math.max(1, ...vals.map(Math.abs));
      const pts = vals.map((v, i) => `${((i / Math.max(1, vals.length - 1)) * w).toFixed(1)},${(h / 2 - (v / mx) * (h / 2 - 2)).toFixed(1)}`).join(' ');
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>net up minus down, last 30 days · scale ±${mx}</title><line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="currentColor" opacity=".2"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.4"/></svg><span class="muted small"> ±${mx}</span>`;
    };
    const side = (x) => (x.bulls > x.bears ? `${x.bulls} ${esc(x.up_lbl || 'up')} v ${x.bears}` : `${x.bears} ${esc(x.dn_lbl || 'down')} v ${x.bulls}`);
    const flags = d.flags || [];
    const done = flags.filter((x) => x.fwd10_z != null);
    const paid = done.filter((x) => x.fwd10_z > 0).length;
    const regime = c.graded10 ? `Market calls were right ${pct(Math.round(c.hit10 * c.graded10), c.graded10)} of the time at 2 weeks (${c.graded10} graded); simply following each market's prior 20-session trend on the same calls would have been right ${c.trend_hit10 == null ? '—' : Math.round(c.trend_hit10 * 100) + '%'}. Forecasts, ranked nowhere: ${c.f_graded10 ? `${Math.round(c.f_hit10 * 100)}% of ${c.f_graded10}` : 'none graded yet'}.` : 'No market call has reached its 2-week grade yet.';
    $('#scoresBody').innerHTML = `
      <div class="analytics">
        ${statBox('Views read', `${c.classified ?? 0}/${c.entries ?? 0}`, `${c.with_calls ?? 0} hold a market view`)}
        ${statBox('Market calls', c.episodes ?? 0, `from ${c.market ?? 0} priced market mentions · ${c.forecasts ?? 0} forecasts kept apart`)}
        ${statBox('Graded at 2 weeks', c.graded10 ?? 0, '10 sessions after the view')}
        ${statBox('Graded at 2 months', c.graded42 ?? 0, '42 sessions after the view')}
        ${statBox('Prices to', esc(c.last_bar || '—'), (c.stale || []).length ? `stale feed: ${esc(c.stale.join(', '))}` : 'msd daily closes')}
      </div>
      <p class="note"><b>${esc(regime)}</b></p>
      <p class="note">A call is the speaker's own directional view on one market; the same view held and restated is graded at most once per 15 days (2-week grade) and once per 60 days (2-month grade), and a view on several related markets the same day (2y and 10y yields, S&amp;P and Nasdaq) counts once. Days/weeks views are graded at 2 weeks, months/long views at 2 months. z = move ÷ (daily vol × √sessions) from the first close after the view: |z| ≈ 1 is a one-sigma move over that horizon. "Trend" = how often following the market's prior 20-session trend (up to the day before the view) would have been right on the same calls. Forecasts (conviction 1: a central-bank action scored on the 2y yield, or a move implied by a stated mechanism), conditional views (${c.conditional ?? 0}) and same-day two-sided views (${c.conflicted ?? 0}) are not ranked.</p>
      <div class="toolbar" style="margin-top:12px"><h2 class="sec" style="margin:0">Scoreboard — market calls</h2>
        <div class="seg" id="vminSeg">${[0, 3, 5, 10].map((k) => `<button data-k="${k}" class="${k === minN ? 'active' : ''}">${k ? `n ≥ ${k}` : 'all'}</button>`).join('')}</div>
        <div class="seg" id="vscopeSeg"><button data-s="all" class="${scope === 'all' ? 'active' : ''}" title="every entry">all entries</button><button data-s="live" class="${scope === 'live' ? 'active' : ''}" title="only entries logged within 3 days of the view (${c.retro ?? 0} backfilled entries excluded)">logged live</button></div></div>
      <div class="tablewrap"><table class="grid"><thead><tr>
        <th>Voice</th><th title="market calls (episodes)">Calls</th><th title="graded at 2 weeks (independent clusters)">2w n</th><th>2w hit</th><th title="(hits+5)/(n+10)">2w shrunk</th><th title="average z at 2 weeks, in 10-session sigmas">2w avg z</th><th title="hit rate of following the prior 20-session trend on the same calls">Trend</th>
        <th>2m n</th><th>2m hit</th><th title="average z at 2 months, in 42-session sigmas">2m avg z</th><th title="calls against the prior trend: hits / graded">Contrarian</th><th title="conviction-1 forecasts graded at 2 weeks: right / graded (not ranked)">Forecasts</th><th title="calls still inside their first 10 sessions: count · z so far">Live</th>
      </tr></thead><tbody>${rows.map(vrow).join('') || `<tr><td colspan="13" class="muted">No voice has ${minN} graded market calls yet. Grades accrue as views reach 10 and 42 sessions; the live ledger began on 16 Sep 2026.</td></tr>`}</tbody></table></div>
      <h2 class="sec" style="margin-top:18px">Crowding — distinct voices per market, last 7 days</h2>
      <p class="note">Market calls only. Each voice counts once per market, on its latest view inside the window. Up/Down is the direction of the quoted number: for yields Up means higher yields (bond-bearish); for USDJPY Up means a stronger dollar. Participation is this market's share of all voices active that week, ranked against its own trailing year once it has 60 such days; until then a crowd of 5+ voices that is 80%+ on one side is shown as ONE-SIDED, and EXTREME needs top-decile participation as well.</p>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Market</th><th>Up</th><th>Down</th><th>Voices 7d</th><th>Voices 30d</th><th>One-sided</th><th title="this market's share of all voices active this week">Share</th><th title="percentile of the share against this market's own past (needs 60 days)">Participation pct</th><th>Net, 30d</th><th></th></tr></thead>
        <tbody>${crowd.map((x) => `<tr><td>${esc(x.name || x.series)}<div class="muted small mono">${esc(x.series)}</div></td><td class="num">${x.bulls} <span class="muted small">${esc(x.up_lbl || 'up')}</span></td><td class="num">${x.bears} <span class="muted small">${esc(x.dn_lbl || 'down')}</span></td><td class="num">${x.voices}</td><td class="num">${x.voices30}</td><td class="num">${x.one_sided == null ? '—' : Math.round(x.one_sided * 100) + '%'}</td><td class="num">${x.share == null ? '—' : Math.round(x.share * 100) + '%'}</td><td class="num">${x.pct == null ? '<span class="muted small">history &lt; 60d</span>' : Math.round(x.pct * 100)}</td><td>${spark(x.path)}</td><td>${x.extreme ? '<span class="pill missed">EXTREME</span>' : x.one_sided_flag ? '<span class="pill closed">ONE-SIDED</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No market calls yet.</td></tr>'}</tbody></table></div>
      <h2 class="sec" style="margin-top:18px">One-sided crowds and what followed</h2>
      <p class="note">${done.length ? `After ${done.length} one-sided reading${done.length === 1 ? '' : 's'} with 10 sessions of prices since, the crowd was paid ${paid} time${paid === 1 ? '' : 's'} (average ${zf(avg(done, (x) => n(x.fwd10_z)))} in 10-session sigmas, in the crowd's direction).` : 'No one-sided reading has 10 sessions of prices after it yet.'}</p>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Day</th><th>Market</th><th>Crowd</th><th title="top-decile participation against the market's own history">Extreme</th><th title="next 10 sessions, in the crowd's direction, in 10-session sigmas">Next 10 sessions</th></tr></thead>
        <tbody>${flags.map((x) => `<tr><td class="mono">${esc(x.d)}</td><td>${esc(x.name || x.series)}</td><td>${side(x)}</td><td>${x.extreme ? '<span class="pill missed">yes</span>' : x.pct == null ? '<span class="muted small">history &lt; 60d</span>' : 'no'}</td><td class="num ${cls(x.fwd10_z)}">${x.fwd10_z != null ? zf(x.fwd10_z) + (x.fwd10_z > 0 ? ' paid' : ' washed') : x.fwd_na ? '<span class="muted" title="too little price history to scale the move">n/a</span>' : 'pending'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">none yet</td></tr>'}</tbody></table></div>
      <h2 class="sec" style="margin-top:18px">Attention — distinct voices per topic per week</h2>
      ${attentionTable(d.attention || [])}`;
    document.querySelectorAll('#vminSeg button').forEach((b) => (b.onclick = () => { store('vmin', b.dataset.k); renderVoices(d); }));
    document.querySelectorAll('#vscopeSeg button').forEach((b) => (b.onclick = () => { store('vscope', b.dataset.s); state.open.clear(); renderScores('voices'); }));
    bindScoreRows();
    document.querySelectorAll('#scoresBody tr.click[data-voice]').forEach(async (tr) => {
      if (!state.open.has(tr.dataset.id)) return;
      const cell = document.getElementById(`vd-${tr.dataset.voice}`);
      try { const calls = await rpc('dash_voice', { p_voice: tr.dataset.voice }); if (cell) cell.innerHTML = voiceDetail(calls); }
      catch (e) { if (cell) cell.textContent = String(e.message || e); }
    });
  }

  function attentionTable(rows) {
    const wks = [...new Set(rows.map((r) => r.wk))].sort().slice(-8), topics = [...new Set(rows.map((r) => r.topic))].sort();
    const get = (w, t) => rows.find((r) => r.wk === w && r.topic === t)?.voices ?? 0;
    if (!wks.length) return '<div class="muted">No entries yet.</div>';
    return `<div class="tablewrap"><table class="grid"><thead><tr><th>Topic</th>${wks.map((w) => `<th class="num">${esc(w.slice(5))}</th>`).join('')}</tr></thead>
      <tbody>${topics.map((t) => `<tr><td>${esc(t)}</td>${wks.map((w) => `<td class="num">${get(w, t) || ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function voiceDetail(calls) {
    if (!calls?.length) return '<span class="muted">No priced calls.</span>';
    const tags = (x) => [x.tier === 'forecast' ? 'forecast (not ranked)' : `conviction ${x.conv}`, x.cond ? 'conditional (not graded)' : '', x.conflicted ? 'two-sided that day (not graded)' : '',
      x.retro ? 'backfilled' : '', x.hz && x.hz !== 'unstated' ? `horizon ${x.hz}` : '', x.contrarian ? 'against the prior trend' : '',
      !x.cond && !x.conflicted && !x.start ? 'restated (graded with its first mention)' : ''].filter(Boolean).join(' · ');
    return `<table class="grid"><thead><tr><th>Date</th><th>Call</th><th>View</th><th title="10-session sigmas">2w z</th><th title="42-session sigmas">2m z</th><th title="z to the latest close · sessions since the reference close">So far</th></tr></thead><tbody>${calls.map((x) => `<tr>
      <td class="mono">${esc(x.d)}</td>
      <td><b>${esc(x.instr || (x.dir > 0 ? x.up_lbl : x.dn_lbl) + ' ' + (x.name || x.series))}</b><div class="muted small">${esc(x.name || x.series)}: ${esc(x.dir > 0 ? x.up_lbl : x.dn_lbl)} · ${esc(tags(x))}</div></td>
      <td class="small">${esc(x.stance || '')}</td>
      <td class="num ${x.grade10 ? cls(x.z10) : ''}">${x.grade10 ? zf(x.z10) : '<span class="muted small">—</span>'}</td><td class="num ${x.grade42 ? cls(x.z42) : ''}">${x.grade42 ? zf(x.z42) : '<span class="muted small">—</span>'}</td>
      <td class="num ${cls(x.z_now)}">${x.z_now == null ? '—' : `${zf(x.z_now)} <span class="muted">(${x.elapsed} sess${x.stale ? ', stale feed' : ''})</span>`}</td></tr>`).join('')}</tbody></table>`;
  }

  // Review: what the weekly review learned, and the rule changes it proposed. A proposal goes in
  // force at its apply time unless it is opposed by email reply ("oppose Rnn").
  function renderReview(d) {
    const rules = d.rules || [], lessons = d.lessons || [];
    const rpill = (s) => `<span class="pill ${s === 'in_force' ? 'open' : s === 'proposed' ? 'missed' : 'closed'}">${esc(s.replace('_', ' '))}</span>`;
    const para = (t) => esc(t || '').split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    $('#scoresBody').innerHTML = `
      <h2 class="sec">Rule changes</h2>
      <p class="note">Proposed by the weekly review (Saturday) and put in force on Sunday 20:00 SGT unless you reply "oppose Rnn" to the review email. Both pipelines read the rules in force at the start of every run.</p>
      ${rules.map((r) => `<div class="card" style="margin-bottom:10px">
          <div class="row"><b class="mono">${esc(r.rid)}</b> ${rpill(r.status)} <b>${esc(r.title)}</b>
            <span class="muted small">${r.status === 'proposed' ? `applies ${esc(sgt(r.apply_after))}` : r.decided_at ? `${esc(r.status.replace('_', ' '))} ${esc(sgt(r.decided_at))}` : ''} · scope ${esc(r.scope)}</span></div>
          <div class="rich">${para(r.body)}</div>
          <details><summary>Why, evidence and revert condition</summary><div class="kv">
            <div>Why</div><div>${esc(r.rationale || '—')}</div><div>Evidence</div><div>${esc(r.evidence || '—')}</div>
            <div>Revert if</div><div>${esc(r.revert_if || '—')}</div>${r.decided_note ? `<div>Note</div><div>${esc(r.decided_note)}</div>` : ''}</div></details>
        </div>`).join('') || '<div class="card empty">No rule changes yet.</div>'}
      <h2 class="sec" style="margin-top:18px">Weekly lessons</h2>
      ${lessons.map((l) => `<div class="card" style="margin-bottom:10px"><div class="row"><b>Week of ${esc(l.wk)}</b> <span class="muted">${esc(l.title || '')}</span></div><div class="rich">${para(l.body)}</div></div>`).join('') || '<div class="card empty">The first weekly review runs on Saturday.</div>'}`;
  }

  function bindScoreRows() {
    document.querySelectorAll('#scoresBody tr.click').forEach((tr) => (tr.onclick = (e) => {
      if (e.target.closest('a')) return;
      const id = tr.dataset.id; state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      const d = scoreCache[state.tab === 'voices' ? `voices:${vscope()}` : state.tab];
      if (state.tab === 'questions') renderQuestions(d); else if (state.tab === 'voices') renderVoices(d);
    }));
  }

  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
  boot();
})();
