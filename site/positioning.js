/* Macro Desk — Positioning tab. Reads public.dash_positioning (one row per positioning, flow,
   sentiment or implied-vol series in the market database) and dash_positioning_series (3-year
   history for the chart). Every number is computed in SQL from the latest data; nothing here
   re-derives a percentile or a signal. app.js calls MacroDeskPositioning.render(el, deps). */
(() => {
  const GROUPS = ['All', 'FX', 'Rates', 'Equities', 'Commodities', 'Vol'];
  const KIND = { spec: 'futures positioning', retail: 'retail', flow: 'flow', sentiment: 'sentiment', skew: 'skew', leverage: 'leverage',
    basis: 'basis trade', vol: 'implied vol', oi: 'open interest', official: 'official', pricing: 'pricing' };
  const DIRECTIONAL = new Set(['spec', 'retail', 'flow', 'sentiment', 'skew', 'leverage', 'pricing']);
  let board = null; let boardAt = 0; let gen = 0; const hist = {}; const open = new Set();

  const num = (v) => (v == null || v === '' ? null : Number(v));
  // Compact numbers: contracts and currency flows run from fractions to tens of billions.
  const fmt = (v, signed = false) => {
    const x = num(v); if (x == null || Number.isNaN(x)) return '—';
    const a = Math.abs(x), s = signed && x > 0 ? '+' : '';
    const body = a >= 1e9 ? `${(x / 1e9).toFixed(1)}bn` : a >= 1e6 ? `${(x / 1e6).toFixed(2)}m` : a >= 1e4 ? `${(x / 1e3).toFixed(1)}k`
      : a >= 100 ? x.toFixed(0) : a >= 1 ? x.toFixed(2) : x.toFixed(3);
    return s + body;
  };
  const fmtPx = (v) => { const x = num(v); if (x == null) return '—'; const a = Math.abs(x); return a >= 1000 ? x.toFixed(1) : a >= 10 ? x.toFixed(2) : x.toFixed(4); };
  const pctTxt = (p) => (num(p) == null ? '—' : String(Math.round(num(p) * 100)));
  const move = (r, v) => { const x = num(v); if (x == null) return '—'; return r.rates ? `${x > 0 ? '+' : ''}${x.toFixed(0)}bp` : `${x > 0 ? '+' : ''}${x.toFixed(1)}%`; };
  const notable = (r) => (num(r.ext) || 0) !== 0 || (num(r.div) || 0) !== 0 || (r.rec && r.kind !== 'oi' && r.kind !== 'official');
  const periods = (r) => (r.f === 'M' ? ['1m', '3m'] : r.f === 'Q' ? ['1 period', '2 periods'] : ['1w', '4w']);

  function pills(r, esc) {
    const out = [];
    const e = num(r.ext) || 0;
    if (r.rec && r.kind !== 'oi' && r.kind !== 'official') out.push(`<span class="pill missed" title="beyond its full history (${esc(String(r.yrs_all ?? ''))} years)">RECORD ${esc(r.rec.toUpperCase())}</span>`);
    if (e && (DIRECTIONAL.has(r.kind) || r.kind === 'basis')) out.push(`<span class="pill missed" title="at or beyond the ${e > 0 ? '90th' : '10th'} percentile of its own last 3 years">EXTREME</span>`);
    else if (e && r.kind === 'vol') out.push(`<span class="pill ${e > 0 ? 'missed' : 'closed'}">VOL ${e > 0 ? 'HIGH' : 'LOW'}</span>`);
    else if (e && r.kind === 'oi') out.push(`<span class="pill closed">OI ${e > 0 ? 'HIGH' : 'LOW'}</span>`);
    if (num(r.div)) out.push(`<span class="pill open" title="positioning moved at least half a standard deviation over the window while price moved at least 0.5 sigma the other way">DIVERGENCE</span>`);
    if (r.stale) out.push('<span class="pill void" title="older than its usual publication lag">STALE</span>');
    return out.join(' ');
  }

  // 0-100 bar with the 10th and 90th percentile marks and a dot at today's reading.
  function pctBar(r) {
    const p = num(r.pct); if (p == null) return '<span class="muted small" title="needs two-thirds of a 3-year history">short history</span>';
    const prev = num(r.pct_prev);
    const col = p >= 0.9 || p <= 0.1 ? 'var(--warn)' : 'var(--accent)';
    return `<div style="display:flex;align-items:center;gap:6px"><svg width="70" height="12" viewBox="0 0 70 12" aria-hidden="true">
      <rect x="0" y="5" width="70" height="2" fill="currentColor" opacity=".18"/><line x1="7" y1="2" x2="7" y2="10" stroke="currentColor" opacity=".35"/><line x1="63" y1="2" x2="63" y2="10" stroke="currentColor" opacity=".35"/>
      ${prev != null ? `<circle cx="${(prev * 70).toFixed(1)}" cy="6" r="2.2" fill="none" stroke="currentColor" opacity=".5"/>` : ''}
      <circle cx="${(p * 70).toFixed(1)}" cy="6" r="3.2" fill="${col}"/></svg>
      <span class="mono">${pctTxt(p)}</span>${prev != null ? `<span class="muted small" title="percentile ${periods(r)[1]} ago, against today's 3-year window">from ${pctTxt(prev)}</span>` : ''}</div>`;
  }

  function leanTxt(r) {
    const a = r.asset || 'the market';
    const bond = r.market && r.market.startsWith('RT_') ? ' (bond prices up, yields down)' : '';
    if (r.kind === 'basis') return `Higher = leveraged funds longer ${a} futures. Mostly the cash-futures basis trade (short futures against long cash), so not a view on yields.`;
    if (!num(r.lean)) return 'No direction: participation, implied vol or an official balance.';
    return num(r.lean) > 0 ? `Higher = the crowd or the flow is more on the side of ${a} rising${bond}.` : `Higher = the crowd or the flow is more on the side of ${a} falling${bond}.`;
  }

  function row(r, esc) {
    const id = `pos-${r.id}`; const isOpen = open.has(id);
    const [p1, p4] = periods(r);
    const latest = r.basis === 'change' ? `<span title="change over ${p4}">${fmt(r.x, true)}</span> <span class="muted small">chg ${p4}</span>` : fmt(r.v);
    const chg = r.kind === 'flow' && r.basis !== 'change'
      ? `<span title="cumulative flow over ${p4}">${fmt(r.mv, true)}</span> <span class="muted small">${p4} cum</span>`
      : `${fmt(r.c1, true)} · ${fmt(r.c4, true)}`;
    const px = r.px_lbl && r.move_win != null
      ? `${move(r, r.move_win)}<span class="muted small"> ${p4}</span>${r.move_since != null ? ` · ${move(r, r.move_since)}<span class="muted small"> since</span>` : ''}`
      : '<span class="muted">—</span>';
    return `<tr class="click" data-id="${esc(id)}" data-series="${esc(r.id)}">
      <td><b>${esc(r.asset || r.market)}</b><div class="muted small">${esc(r.px_lbl || '')}</div></td>
      <td style="min-width:220px">${esc(r.label)}<div class="muted small"><span class="pill closed"${r.caveat ? ` title="${esc(r.caveat)}"` : ''}>${esc(KIND[r.kind] || r.kind)}${r.caveat ? ' ⓘ' : ''}</span>${r.kind === 'basis' ? ' not a view on yields' : ''}</div></td>
      <td class="num">${latest}<div class="muted small">${esc(r.d || '')}${r.age != null ? ` · ${esc(String(r.age))}d` : ''}</div></td>
      <td class="num">${chg}<div class="muted small">${r.kind === 'flow' && r.basis !== 'change' ? '' : `${p1} · ${p4}`}</div></td>
      <td>${pctBar(r)}</td>
      <td class="num">${num(r.z) == null ? '—' : `${num(r.z) > 0 ? '+' : ''}${num(r.z).toFixed(1)}`}</td>
      <td class="num">${r.pct_all == null ? '—' : pctTxt(r.pct_all)}${r.yrs_all ? `<div class="muted small">${esc(String(r.yrs_all))}y</div>` : ''}</td>
      <td class="num">${px}</td>
      <td>${esc(r.read || '')} ${pills(r, esc)}</td>
    </tr>${isOpen ? `<tr class="detail"><td colspan="9" id="pd-${esc(r.id.replace(/[^A-Za-z0-9_]/g, '_'))}"><span class="muted">Loading…</span></td></tr>` : ''}`;
  }

  // History chart: the ranked reading over 3 years with today's 10th/50th/90th percentile lines,
  // and the market's close on its own scale (thin line).
  function chart(h, r, esc) {
    const pts = (h.pts || []).map(([d, v]) => [Date.parse(d), Number(v)]).filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
    if (pts.length < 2) return '<span class="muted">Not enough history to chart.</span>';
    const px = (h.px || []).map(([d, v]) => [Date.parse(d), Number(v)]).filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
    const W = 760, H = 220, L = 54, R = 54, T = 10, B = 22;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const ys = pts.map((p) => p[1]).concat([h.p10, h.p90].map(Number).filter(Number.isFinite));
    const y0 = Math.min(...ys), y1 = Math.max(...ys), yr = y1 - y0 || 1;
    const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const Y = (v) => T + (1 - (v - y0) / yr) * (H - T - B);
    const line = (arr, f) => arr.map(([t, v]) => `${X(t).toFixed(1)},${f(v).toFixed(1)}`).join(' ');
    const pxIn = px.filter(([t]) => t >= t0 && t <= t1);
    let pxLine = '', pxAxis = '';
    if (pxIn.length > 1) {
      const c0 = Math.min(...pxIn.map((p) => p[1])), c1 = Math.max(...pxIn.map((p) => p[1])), cr = c1 - c0 || 1;
      const YP = (v) => T + (1 - (v - c0) / cr) * (H - T - B);
      pxLine = `<polyline points="${line(pxIn, YP)}" fill="none" stroke="currentColor" stroke-width="1" opacity=".45"/>`;
      pxAxis = `<text x="${W - R + 4}" y="${T + 8}" font-size="10" fill="currentColor" opacity=".6">${esc(fmtPx(c1))}</text><text x="${W - R + 4}" y="${H - B}" font-size="10" fill="currentColor" opacity=".6">${esc(fmtPx(c0))}</text>`;
    }
    const band = (v, dash, lbl) => (Number.isFinite(Number(v)) ? `<line x1="${L}" x2="${W - R}" y1="${Y(Number(v)).toFixed(1)}" y2="${Y(Number(v)).toFixed(1)}" stroke="currentColor" opacity=".35" stroke-dasharray="${dash}"/><text x="${L - 4}" y="${(Y(Number(v)) + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">${lbl}</text>` : '');
    const yr0 = new Date(t0).getUTCFullYear(), yr1 = new Date(t1).getUTCFullYear();
    let ticks = '';
    for (let y = yr0 + 1; y <= yr1; y++) { const t = Date.UTC(y, 0, 1); ticks += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="currentColor" opacity=".08"/><text x="${X(t).toFixed(1)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".6">${y}</text>`; }
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto" role="img" aria-label="${esc(h.label || '')}, last 3 years">
      ${ticks}${band(h.p90, '4 3', 'p90')}${band(h.p50, '1 3', 'p50')}${band(h.p10, '4 3', 'p10')}${pxLine}${pxAxis}
      <polyline points="${line(pts, Y)}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
      <circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3" fill="var(--accent)"/>
      <text x="${L - 4}" y="${T + 8}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">${esc(fmt(y1))}</text>
      <text x="${L - 4}" y="${H - B}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">${esc(fmt(y0))}</text>
    </svg>
    <div class="muted small">Coloured: ${esc(h.basis === 'change' ? `the ${periods(r)[1]} change` : 'the reading')}, with today's 10th, 50th and 90th percentiles of its last 3 years. Grey: ${esc(h.px_lbl || 'price')}${h.rates ? ' (yield, %)' : ''} on its own scale.</div>`;
  }

  function detail(r, h, esc) {
    const kv = (k, v) => `<div>${esc(k)}</div><div>${v}</div>`;
    return `<div class="dgrid"><div>${h ? chart(h, r, esc) : '<span class="muted">Loading chart…</span>'}</div>
      <div><h4>How to read it</h4><div class="kv">
        ${kv('Direction', esc(leanTxt(r)))}
        ${r.sign_note ? kv('Source note', esc(r.sign_note)) : ''}
        ${r.caveat ? kv('Caveat', esc(r.caveat)) : ''}
        ${kv('Ranked on', esc(r.basis === 'change' ? `its ${periods(r)[1]} change` : 'the reading itself'))}
        ${kv('3-year range', `${esc(fmt(r.p10))} (p10) · ${esc(fmt(r.p50))} (p50) · ${esc(fmt(r.p90))} (p90), n ${esc(String(r.n3 ?? '—'))}`)}
        ${kv('Window', `${esc(r.d4 || '—')} → ${esc(r.d || '—')}${r.de && r.de !== r.d ? ` (covers to ${esc(r.de)})` : ''}`)}
        ${r.px_lbl ? kv('Price', `${esc(r.px_lbl)} ${r.px != null ? esc(fmtPx(r.px)) : '—'} on ${esc(r.px_d || '—')}${r.z_win != null ? ` · window move ${esc((num(r.z_win) > 0 ? '+' : '') + num(r.z_win).toFixed(1))} sigma` : ''}`) : ''}
        ${kv('Series', `<span class="mono">${esc(r.id)}</span> · ${esc(r.status || '')}${r.gap_note ? ` · ${esc(r.gap_note)}` : ''}`)}
      </div></div></div>`;
  }

  function render(el, deps) {
    // deps: rpc(fn, args), esc(s), store(k, v), active() — true while this tab is still showing.
    const { rpc, esc, store, active } = deps;
    const my = ++gen;
    const live = () => gen === my && active();
    const draw = () => {
      if (!live() || !board) return;
      const grp = GROUPS.includes(store('posgrp')) ? store('posgrp') : 'All';
      const only = store('posonly') === '1';
      const sort = store('possort') === 'ext' ? 'ext' : 'grp';
      const all = board.rows || [];
      let rows = all.filter((r) => (grp === 'All' || r.grp === grp) && (!only || notable(r)));
      if (sort === 'ext') rows = rows.slice().sort((a, b) => Math.abs((num(b.pct) ?? 0.5) - 0.5) - Math.abs((num(a.pct) ?? 0.5) - 0.5));
      const dir = all.filter((r) => !r.dup_of && !r.stale && DIRECTIONAL.has(r.kind));
      const ext = dir.filter((r) => num(r.ext));
      const div = dir.filter((r) => num(r.div));
      const vol = all.filter((r) => r.kind === 'vol' && num(r.ext) && !r.stale);
      const cftc = all.filter((r) => /^CFTC/.test(r.label || '')).map((r) => r.d).sort().pop();
      const stale = all.filter((r) => r.stale);
      const stand = all.filter((r) => !r.dup_of && !r.stale && notable(r) && r.kind !== 'oi' && r.kind !== 'official');
      const stat = (k, v, s) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
      el.innerHTML = `
        <div class="analytics">
          ${stat('Crowd and flow extremes', ext.length, `of ${dir.length} directional series at a 3-year 90th/10th percentile`)}
          ${stat('Divergences', div.length, 'positioning moving against price over the window')}
          ${stat('Implied vol extremes', vol.length, 'top or bottom decile of 3 years')}
          ${stat('CFTC as of', esc(cftc || '—'), 'Tuesday positions, released Friday 15:30 ET')}
          ${stat('Stale', stale.length, stale.length ? esc(stale.map((r) => r.asset + ' ' + (KIND[r.kind] || r.kind)).slice(0, 3).join(', ')) : 'every series on time')}
        </div>
        <p class="note">Each series is ranked against its own last 3 years (percentile 0-100, the 3-year low to the high); "10y" ranks it against its full history since 2015. Everything is in market terms: for USDJPY "long JPY", for bonds "long" means long the bond (yields lower). EXTREME = at or beyond the 90th or 10th percentile. DIVERGENCE = over the last 4 weeks (20 sessions, or 3 months for monthly data) the positioning moved at least half its usual amount one way while the price moved at least 0.5 sigma the other. Leveraged funds' Treasury futures are the cash-futures basis trade, shown but never read as a view on yields. Click a row for the 3-year chart.</p>
        ${stand.length ? `<h2 class="sec" style="margin-top:14px">What stands out</h2>
        <div class="tablewrap"><table class="grid"><thead><tr><th>Market</th><th>Series</th><th>Read</th><th title="percentile in its own last 3 years">3y pct</th><th title="percentile in its full history">10y pct</th><th>As of</th><th>Price since</th></tr></thead><tbody>
          ${stand.map((r) => `<tr class="click" data-jump="${esc(r.id)}"><td><b>${esc(r.asset || r.market)}</b></td><td>${esc(r.label)}</td><td>${esc(r.read || '')} ${pills(r, esc)}</td><td class="num">${pctTxt(r.pct)}</td><td class="num">${pctTxt(r.pct_all)}</td><td class="mono" style="white-space:nowrap">${esc(r.d || '')}</td><td class="num">${r.move_since != null ? `${esc(r.px_lbl || '')} ${move(r, r.move_since)}` : '—'}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
        <div class="toolbar" style="margin-top:16px"><h2 class="sec" style="margin:0">All series</h2>
          <div class="seg" id="posGrp">${GROUPS.map((g) => `<button data-g="${g}" class="${g === grp ? 'active' : ''}">${g}</button>`).join('')}</div>
          <div class="seg" id="posOnly"><button data-o="0" class="${only ? '' : 'active'}">all</button><button data-o="1" class="${only ? 'active' : ''}" title="extremes, records and divergences only">notable</button></div>
          <div class="seg" id="posSort"><button data-s="grp" class="${sort === 'grp' ? 'active' : ''}">by market</button><button data-s="ext" class="${sort === 'ext' ? 'active' : ''}" title="furthest from the 3-year median first">most extreme</button></div>
          <span class="muted small">${rows.length} series · computed ${esc(new Date(board.asof).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }))} SGT</span>
          <button id="posRefresh" class="ghost small">Refresh</button></div>
        <div class="tablewrap"><table class="grid"><thead><tr>
          <th>Market</th><th>Series</th><th title="latest reading (for 'chg' series, its change over the window)">Latest</th><th title="change over 1 and 4 periods; flows show the cumulative flow over the window">Change</th>
          <th title="percentile in its own last 3 years; the hollow dot is where it was one window ago">3y pct</th><th title="z-score against the last 3 years">z</th><th title="percentile in its full history">10y pct</th>
          <th title="the market over the same window, then since the reading's date">Price</th><th>Read</th></tr></thead>
          <tbody>${rows.map((r) => row(r, esc)).join('') || '<tr><td colspan="9" class="muted">Nothing notable in this group.</td></tr>'}</tbody></table></div>
        <h2 class="sec" style="margin-top:18px">Not covered</h2>
        <p class="note">No free source: ${(board.blank || []).map((b) => `${esc(b.market)} ${esc(b.measure)}${b.note ? ` (${esc(b.note)})` : ''}`).join('; ') || 'none'}.</p>
        <p class="note">Wanted from the market database: ${(board.wanted || []).map(esc).join('; ')}.</p>`;
      el.querySelectorAll('#posGrp button').forEach((b) => (b.onclick = () => { store('posgrp', b.dataset.g); draw(); }));
      el.querySelectorAll('#posOnly button').forEach((b) => (b.onclick = () => { store('posonly', b.dataset.o); draw(); }));
      el.querySelectorAll('#posSort button').forEach((b) => (b.onclick = () => { store('possort', b.dataset.s); draw(); }));
      el.querySelector('#posRefresh').onclick = () => { board = null; render(el, deps); };
      el.querySelectorAll('tr.click[data-jump]').forEach((tr) => (tr.onclick = () => {
        const id = `pos-${tr.dataset.jump}`; open.add(id);
        const r = all.find((x) => x.id === tr.dataset.jump);
        if (r && grp !== 'All' && r.grp !== grp) store('posgrp', 'All');
        if (r && only && !notable(r)) store('posonly', '0');
        draw();
        const target = el.querySelector(`tr[data-id="${CSS.escape(id)}"]`); if (target) target.scrollIntoView({ block: 'center' });
      }));
      el.querySelectorAll('tr.click[data-series]').forEach((tr) => (tr.onclick = () => { const id = tr.dataset.id; open.has(id) ? open.delete(id) : open.add(id); draw(); }));
      // Fill open detail rows, fetching each series' history once.
      rows.filter((r) => open.has(`pos-${r.id}`)).forEach(async (r) => {
        const cell = el.querySelector(`#pd-${r.id.replace(/[^A-Za-z0-9_]/g, '_')}`); if (!cell) return;
        cell.innerHTML = detail(r, hist[r.id], esc);
        if (hist[r.id]) return;
        try { hist[r.id] = await rpc('dash_positioning_series', { p_series: r.id }); }
        catch (e) { cell.innerHTML = detail(r, null, esc) + `<div class="muted small">Chart unavailable: ${esc(e.message || e)}</div>`; return; }
        const again = el.querySelector(`#pd-${r.id.replace(/[^A-Za-z0-9_]/g, '_')}`); if (again && live()) again.innerHTML = detail(r, hist[r.id], esc);
      });
    };
    // The page is cheap to recompute but the data changes at most a few times a day.
    if (board && Date.now() - boardAt < 30 * 60 * 1000) return draw();
    el.innerHTML = '<div class="muted">Loading…</div>';
    rpc('dash_positioning').then((d) => { board = d; boardAt = Date.now(); draw(); })
      .catch((e) => { if (live()) el.innerHTML = `<div class="card empty">Could not load: ${esc(e.message || e)}</div>`; });
  }

  window.MacroDeskPositioning = { render };
})();
