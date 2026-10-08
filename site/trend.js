/* Macro Desk — Trend tab. Reads public.dash_trend: the latest (or a chosen) run of the Trend
   Monitor (monitor-v2, TM1) that the dash-trend edge function computes each morning — the state
   board per class, the day's events and the FX barrier board. Every number is the stored run's own;
   this page only formats it, with the report's number formats (round half away from zero).
   app.js calls MacroDeskTrend.render(el, deps). */
(() => {
  const CLASSES = ['fx', 'rates', 'commodities', 'equities'];
  const CLASS_NAME = { fx: 'FX', rates: 'Rates', commodities: 'Commodities', equities: 'Equities' };
  const STATES = ['STRONG_UP', 'UP', 'NEUTRAL', 'DOWN', 'STRONG_DOWN'];
  const STATE_NAME = { STRONG_UP: 'Strong up', UP: 'Up', NEUTRAL: 'Neutral', DOWN: 'Down', STRONG_DOWN: 'Strong down' };
  const cache = {}; let gen = 0; const open = {};

  // Round half away from zero on the number's shortest decimal form, as the report does (2.675 → 2.68).
  const fnum = (x, dp) => {
    if (x == null || x === '' || !Number.isFinite(Number(x))) return 'NA';
    const v = Number(x);
    const [mant, ex] = String(Math.abs(v)).split('e');
    const [ip, fp = ''] = mant.split('.');
    let digits = ip + fp, point = ip.length + (ex ? Number(ex) : 0);
    if (point <= 0) { digits = '0'.repeat(1 - point) + digits; point = 1; }
    if (digits.length < point + dp + 1) digits += '0'.repeat(point + dp + 1 - digits.length);
    let kept = BigInt(digits.slice(0, point + dp));
    if (digits[point + dp] >= '5') kept += 1n;
    let s = kept.toString().padStart(dp + 1, '0');
    if (dp > 0) s = s.slice(0, s.length - dp) + '.' + s.slice(s.length - dp);
    return v < 0 && kept !== 0n ? '-' + s : s;
  };
  const sgn = (x, dp) => { const s = fnum(x, dp); return s !== 'NA' && Number(x) > 0 && /[1-9]/.test(s) ? '+' + s : s; };
  const sig = (x) => (x == null ? 'NA' : Number(x) > 0 ? '+1' : Number(x) < 0 ? '−1' : '0');
  const sgt = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }) + ' SGT' : '—');

  // Styles for this tab only (chips coloured by state; the palette follows the site's light/dark tokens).
  function injectStyle() {
    if (document.getElementById('trend-css')) return;
    const s = document.createElement('style');
    s.id = 'trend-css';
    s.textContent = `
      .tr-class { margin-bottom: 12px; }
      .tr-class h3 { margin: 0 0 8px; font-size: 14px; }
      .tr-row { display: grid; grid-template-columns: 96px 1fr; gap: 8px; align-items: start; padding: 5px 0; border-top: 1px solid var(--line); }
      .tr-row:first-of-type { border-top: none; }
      .tr-lbl { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; padding-top: 6px; }
      .tr-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .tr-chip { display: grid; gap: 1px; text-align: left; padding: 5px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel-2); min-width: 116px; }
      .tr-chip b { font-size: 13px; } .tr-chip span { font-size: 11px; color: var(--muted); font-family: var(--mono); white-space: nowrap; }
      .tr-chip.on { outline: 2px solid var(--accent); outline-offset: 1px; }
      .st-STRONG_UP { background: color-mix(in srgb, var(--pos) 24%, var(--panel)); border-color: var(--pos); }
      .st-UP { background: color-mix(in srgb, var(--pos) 9%, var(--panel)); border-color: color-mix(in srgb, var(--pos) 55%, var(--line)); }
      .st-DOWN { background: color-mix(in srgb, var(--neg) 9%, var(--panel)); border-color: color-mix(in srgb, var(--neg) 55%, var(--line)); }
      .st-STRONG_DOWN { background: color-mix(in srgb, var(--neg) 24%, var(--panel)); border-color: var(--neg); }
      .tr-chip .susp { color: var(--warn); }
      .tr-none { color: var(--muted); font-size: 12px; padding-top: 6px; }
      .tr-detail { margin-top: 8px; padding: 10px 12px; border-radius: 8px; background: var(--panel-2); }
      .tr-sigs { font-family: var(--mono); font-size: 12px; }
      .tr-mark { color: var(--warn); font-weight: 600; }
      tr.tr-diff td { background: color-mix(in srgb, var(--warn) 10%, transparent); }
      pre.tr-report { white-space: pre; overflow-x: auto; font-size: 11.5px; line-height: 1.45; background: var(--panel-2); padding: 10px; border-radius: 8px; margin: 8px 0 0; }
      @media (max-width: 640px) { .tr-row { grid-template-columns: 1fr; gap: 4px; } .tr-lbl { padding-top: 0; } .tr-chip { min-width: 0; flex: 1 1 128px; } }`;
    document.head.appendChild(s);
  }

  const statusPill = (s, esc) => `<span class="pill ${s === 'OK' ? 'open' : s === 'PARTIAL' || s === 'SUSPECT' ? 'missed' : 'void'}">${esc(s)}</span>`;
  const usable = (r) => r.status === 'OK' || r.status === 'SUSPECT';
  const rvUnit = (r) => (r.asset_class === 'rates' ? 'bp/yr' : '%');

  function chip(r, esc, on) {
    const hit = r.oos_hit21 == null ? 'NA' : fnum(r.oos_hit21, 3);
    return `<button class="tr-chip st-${esc(r.state || 'NEUTRAL')}${on ? ' on' : ''}" data-a="${esc(r.asset_id)}" title="${esc(`${r.asset_id}: ${r.state || 'NA'} for ${r.state_age ?? 'NA'} sessions (from ${r.prev_state || 'NA'} at t-1); out-of-sample 21-session hit rate ${hit}; dist200 ${fnum(r.dist200_sig, 2)} sigma; rv20 percentile ${fnum(r.rv20_pct3y, 0)} of 3 years`)}">
      <b>${esc(r.asset_id)}${r.status === 'SUSPECT' ? ' <span class="susp" title="a move over 6 sigma, unverified">⚠</span>' : ''}</b>
      <span>age ${esc(String(r.state_age ?? 'NA'))} · hit ${esc(hit)}</span>
      <span>d200 ${esc(sgn(r.dist200_sig, 2))} · rv p${esc(fnum(r.rv20_pct3y, 0))}</span></button>`;
  }

  function detail(r, esc) {
    const kv = (k, v) => `<div>${esc(k)}</div><div>${v}</div>`;
    const px = (x) => esc(fnum(x, r.px_dp));
    const rates = r.asset_class === 'rates';
    return `<div class="tr-detail"><div class="kv">
      ${kv('Asset', `<b>${esc(r.asset_id)}</b> · ${esc(r.asset_class)} · ${statusPill(r.status, esc)}${r.bar_final === 'N' ? ' <span class="muted small">last bar not confirmed final</span>' : ''}`)}
      ${kv('Last bar', `${esc(r.last_date || 'NA')} · ${rates ? 'yield' : 'close'} ${px(r.level)}${rates ? '%' : ''}`)}
      ${kv('State', `${esc(r.state || 'NA')} for ${esc(String(r.state_age ?? 'NA'))} sessions · t-1 ${esc(r.prev_state || 'NA')} · oos_hit21 ${esc(fnum(r.oos_hit21, 3))}`)}
      ${kv('Ensembles', `<span class="tr-sigs">all ${esc(sgn(r.all_ens, 2))} = mean(MA ${esc(sgn(r.ma_ens, 2))}, TS ${esc(sgn(r.ts_ens, 2))}, Donchian ${esc(sgn(r.don_ens, 2))})</span>`)}
      ${kv('MA', `<span class="tr-sigs">10/50 ${sig(r.ma_10_50)} · 20/100 ${sig(r.ma_20_100)} · 50/200 ${sig(r.ma_50_200)}</span>`)}
      ${kv('Momentum', `<span class="tr-sigs">21 ${sig(r.ts_21)} · 63 ${sig(r.ts_63)} · 126 ${sig(r.ts_126)} · 252 ${sig(r.ts_252)}</span>`)}
      ${kv('Donchian', `<span class="tr-sigs">20 ${sig(r.don_20)} · 55 ${sig(r.don_55)} · 120 ${sig(r.don_120)} · 250 ${sig(r.don_250)}</span>`)}
      ${kv('Stretch', `dist200 ${esc(sgn(r.dist200_sig, 2))} sigma <span class="muted small">(distance from the 200-session average in 21-session sigmas)</span>`)}
      ${kv('Realised vol', `rv20 ${esc(fnum(r.rv20, 1))} · rv60 ${esc(fnum(r.rv60, 1))} ${rvUnit(r)} · rv20 percentile ${esc(fnum(r.rv20_pct3y, 0))} of 3 years (${esc(sgn(r.rv20_pct_chg5d, 0))} in 5 sessions)`)}
      ${kv('52 weeks', `high ${px(r.high_52w)} · low ${px(r.low_52w)}${r.new_52w_high ? ' · <b>new high</b>' : ''}${r.new_52w_low ? ' · <b>new low</b>' : ''}${rates ? ' <span class="muted small">(in bond-price terms: the high is the lowest yield)</span>' : ''}`)}
      ${r.xcheck_move != null ? kv('Cross-check', esc(fnum(r.xcheck_move, 2))) : ''}
    </div></div>`;
  }

  // An event's prev / value in the units of its type, as in the report.
  function evVal(e, r, which) {
    if (which === 'value' && e.value_date) return e.value_date;
    const x = e[which];
    switch (e.event_type) {
      case 'STATE_CHANGE': case 'STRETCH_UP': case 'STRETCH_DN': case 'STRETCH_END': case 'DATA_SUSPECT': return fnum(x, 2);
      case 'MA_CROSS': case 'TS_FLIP': case 'DON_FLIP': return x == null ? 'NA' : String(x);
      case 'NEW_52W_HIGH': case 'NEW_52W_LOW': return fnum(x, r ? r.px_dp : 2);
      case 'VOL_HIGH': case 'VOL_JUMP': return fnum(x, 0);
      default: return x == null ? 'NA' : String(x);
    }
  }

  function render(el, deps) {
    // deps: rpc(fn, args), esc(s), store(k, v), active() — true while this tab is still showing.
    const { rpc, esc, store, active } = deps;
    injectStyle();
    const my = ++gen;
    const live = () => gen === my && active();
    const want = store('trenddate') || ''; // '' = the latest run
    const draw = (d) => {
      if (!live()) return;
      const run = d.run, states = d.states || [], events = d.events || [], barriers = d.barriers || [];
      const toolbar = `<div class="toolbar"><h2 class="sec" style="margin:0">Trend Monitor</h2>
        <input type="date" id="trDate" value="${esc(want || run?.run_date || '')}" style="font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink)">
        <button id="trLatest" class="ghost small"${want ? '' : ' disabled'}>Latest</button>
        <button id="trRefresh" class="ghost small">Refresh</button></div>`;
      if (!run) {
        el.innerHTML = toolbar + `<div class="card empty">${want ? `No run stored for ${esc(want)}.` : 'No Trend Monitor run stored yet. The dash-trend job runs at 08:30 SGT, Tuesday to Saturday.'}</div>`;
        return wire(d);
      }
      const byId = Object.fromEntries(states.map((r) => [r.asset_id, r]));
      const nUsable = states.filter(usable).length;
      const errs = Object.entries(run.fetch_errors || {});
      const asOf = CLASSES.map((c) => `${CLASS_NAME[c]} ${esc(run.as_of?.[c] || 'NA')}`).join(' · ');
      const stat = (k, v, s) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
      const stale = states.filter((r) => r.status === 'STALE'), susp = states.filter((r) => r.status === 'SUSPECT' || r.status === 'REJECTED');

      const board = CLASSES.map((c) => {
        const rows = states.filter((r) => r.asset_class === c);
        const ok = rows.filter(usable), bad = rows.filter((r) => !usable(r));
        const sel = open[c] && ok.find((r) => r.asset_id === open[c]);
        return `<div class="card tr-class"><h3>${CLASS_NAME[c]} <span class="muted small">as of ${esc(run.as_of?.[c] || 'NA')}</span></h3>
          ${STATES.map((s) => {
            const xs = ok.filter((r) => r.state === s);
            return `<div class="tr-row"><div class="tr-lbl">${STATE_NAME[s]}</div><div class="tr-chips">${xs.map((r) => chip(r, esc, sel && sel.asset_id === r.asset_id)).join('') || '<span class="tr-none">–</span>'}</div></div>`;
          }).join('')}
          ${bad.length ? `<div class="note">Not usable: ${bad.map((r) => `${esc(r.asset_id)} (${esc(r.status)}${r.last_date ? `, last ${esc(r.last_date)}` : ''})`).join(', ')}.</div>` : ''}
          ${sel ? detail(sel, esc) : ''}</div>`;
      }).join('');

      const evRows = events.map((e) => {
        const r = byId[e.asset_id];
        return `<tr><td><b>${esc(e.asset_id)}</b></td><td>${esc(e.event_type)}${e.detail ? `<div class="muted small">${esc(e.detail)}</div>` : ''}</td>
          <td class="num">${esc(evVal(e, r, 'prev'))} → ${esc(evVal(e, r, 'value'))}</td>
          <td>${r?.state ? `<span class="pill closed">${esc(r.state)}</span> <span class="muted small">age ${esc(String(r.state_age ?? 'NA'))}</span>` : '<span class="muted">NA</span>'}</td>
          <td class="num hide-sm">${esc(sgn(r?.dist200_sig, 2))}</td><td class="num hide-sm">${esc(fnum(r?.rv20_pct3y, 0))}</td>
          <td class="num hide-sm">${esc(fnum(r?.oos_hit21, 3))}</td><td>${r ? statusPill(r.status, esc) : ''}</td></tr>`;
      }).join('');

            const cell = (b, dp) => {
        if (!b) return '<td class="num">—</td>';
        const adj = Number(b.vol_mult) !== 1;
        const t = `barrier ${fnum(b.barrier, dp)} (${b.side} ${fnum(b.k, 1)} sigma over 21 sessions); touch probability ${fnum(b.p_model, 3)} on rv60, ${fnum(b.p_adj, 3)} with vol_mult ${fnum(b.vol_mult, 2)}${b.lookup_hit === 'Y' ? '' : ' (no lookup line)'}`;
        return `<td class="num" title="${esc(t)}">${esc(fnum(b.barrier, dp))}<div class="muted small">${esc(fnum(b.fair_per100, 1))}${adj ? ` <span class="tr-mark" title="vol_mult ${esc(fnum(b.vol_mult, 2))}">×${esc(fnum(b.vol_mult, 2))}</span>` : ''}</div></td>`;
      };
      const rowsOf = (bars, dpOf) => [...new Set(bars.map((b) => b.pair))].map((p) => {
        const bs = bars.filter((b) => b.pair === p), dp = dpOf[p] ?? 4, b0 = bs[0];
        const f = (side, k) => bs.find((b) => b.side === side && Number(b.k) === k);
        return `<tr><td><b>${esc(p)}</b><div class="muted small">${esc(b0.last_date || '')}</div></td><td class="num">${esc(fnum(b0.spot, dp))}</td><td class="num">${esc(fnum(b0.rv60, 1))}</td>
          ${cell(f('up', 1), dp)}${cell(f('up', 2), dp)}${cell(f('down', 1), dp)}${cell(f('down', 2), dp)}</tr>`;
      }).join('');
      const barHead = '<thead><tr><th>Pair</th><th class="num">Spot</th><th class="num" title="60-session realised vol, % a year">rv60</th><th class="num">UP 1σ</th><th class="num">UP 2σ</th><th class="num">DN 1σ</th><th class="num">DN 2σ</th></tr></thead>';
      const barRows = rowsOf(barriers, Object.fromEntries(states.map((r) => [r.asset_id, r.px_dp])));

      // TM1.1 shadow (FX at the 17:00 New York close), shown beside TM1 until a switch is decided.
      const sh = d.shadow;
      let shadowHtml = '';
      if (sh && Array.isArray(sh.states)) {
        const sById = Object.fromEntries(sh.states.map((r) => [r.asset_id, r]));
        const fxRows = states.filter((r) => r.asset_class === 'fx');
        const agree = fxRows.filter((r) => sById[r.asset_id] && sById[r.asset_id].state === r.state).length;
        const cmpRows = fxRows.map((r) => {
          const s = sById[r.asset_id], dp = r.px_dp ?? 4;
          const diff = s && s.state !== r.state;
          const bp = s && Number(r.level) > 0 && Number(s.level) > 0 ? 1e4 * Math.log(Number(s.level) / Number(r.level)) : null;
          const st = (x) => (x?.state ? `${esc(STATE_NAME[x.state] || x.state)} <span class="muted small">${esc(String(x.state_age ?? 'NA'))}</span>` : '<span class="muted">NA</span>');
          return `<tr${diff ? ' class="tr-diff"' : ''}><td><b>${esc(r.asset_id)}</b>${diff ? ' <span class="tr-mark" title="TM1 and TM1.1 states differ">≠</span>' : ''}</td>
            <td>${st(r)}</td><td class="num">${esc(fnum(r.level, dp))}<div class="muted small">${esc(r.last_date || 'NA')}</div></td>
            <td>${st(s)}</td><td class="num">${esc(fnum(s?.level, dp))}<div class="muted small">${esc(s?.last_date || 'NA')}${s && s.status !== 'OK' ? ` · ${esc(s.status)}` : ''}</div></td>
            <td class="num">${esc(sgn(bp, 0))}</td></tr>`;
        }).join('');
        const shEvents = (sh.events || []).map((e) => `<li><b>${esc(e.asset_id)}</b> ${esc(e.event_type)}${e.detail ? ` ${esc(e.detail)}` : ''} ${esc(evVal(e, sById[e.asset_id], 'prev'))} → ${esc(evVal(e, sById[e.asset_id], 'value'))}</li>`).join('');
        const shErrs = Object.entries(sh.fetch_errors || {});
        shadowHtml = `
        <h2 class="sec" style="margin-top:16px">FX at the 5pm New York close <span style="text-transform:none;letter-spacing:0">(${esc(sh.params_version)} shadow)</span></h2>
        <p class="note" style="margin:0 0 8px">Same rules and parameters as ${esc(run.params_version)}, but each FX close is the 17:00 New York price, built from hourly bars, so at the morning run the spot is a few hours old instead of about a day. It runs beside ${esc(run.params_version)} for two weeks before any switch; ${esc(run.params_version)} stays the board above. States agree on <b>${agree} of ${fxRows.length}</b> pairs; computed ${esc(sgt(sh.run_utc))}, ${statusPill(sh.status, esc)}.</p>
        <div class="tablewrap"><table class="grid"><thead><tr><th>Pair</th><th>${esc(run.params_version)} state</th><th class="num">${esc(run.params_version)} spot</th><th>${esc(sh.params_version)} state</th><th class="num">${esc(sh.params_version)} spot</th><th class="num" title="${esc(sh.params_version)} spot vs ${esc(run.params_version)} spot, basis points">Δ bp</th></tr></thead>
          <tbody>${cmpRows}</tbody></table></div>
        <div class="tablewrap" style="margin-top:10px"><table class="grid">${barHead}
          <tbody>${rowsOf(sh.barriers || [], Object.fromEntries(sh.states.map((r) => [r.asset_id, r.px_dp]))) || '<tr><td colspan="7" class="muted">No usable FX pair in the shadow run.</td></tr>'}</tbody></table></div>
        <p class="note">The ${esc(sh.params_version)} barrier board, from the 17:00 New York spot; same formulas as above.</p>
        ${shEvents ? `<details><summary>${esc(sh.params_version)} events (${(sh.events || []).length})</summary><ul class="small" style="margin:6px 0 0;padding-left:18px">${shEvents}</ul></details>` : ''}
        ${shErrs.length ? `<details><summary>${esc(sh.params_version)} fetch notes (${shErrs.length})</summary><ul class="small" style="margin:6px 0 0;padding-left:18px">${shErrs.map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(v)}</li>`).join('')}</ul></details>` : ''}`;
      }

      const hits = d.hit_rates || [];
      const hitTable = `<div class="tablewrap" style="margin-top:8px"><table class="grid"><thead><tr><th>Class</th>${STATES.map((s) => `<th class="num">${STATE_NAME[s]}</th>`).join('')}</tr></thead><tbody>
        ${CLASSES.map((c) => `<tr><td>${CLASS_NAME[c]}</td>${STATES.map((s) => { const h = hits.find((x) => x.asset_class === c && x.state === s); return `<td class="num">${esc(fnum(h?.hit21, 3))}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>`;

      el.innerHTML = toolbar + `
        <div class="card" style="margin-bottom:12px">
          <div class="row"><b>Run ${esc(run.run_date)}</b> ${statusPill(run.status, esc)} <span class="muted small">params ${esc(run.params_version)} · computed ${esc(sgt(run.run_utc))} from ${esc(run.data_path)} fetches</span></div>
          <div class="muted small" style="margin-top:4px">as of ${asOf} · usable ${nUsable}/${esc(String(run.n_assets))} · events ${esc(String(run.n_events))}${run.last_bar_utc ? ` · last FX bar ${esc(sgt(run.last_bar_utc))}` : ''}</div>
          ${errs.length ? `<details><summary>Fetch notes (${errs.length})</summary><ul class="small" style="margin:6px 0 0;padding-left:18px">${errs.map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(v)}</li>`).join('')}</ul></details>` : ''}
        </div>
        <div class="analytics">
          ${stat('Usable', `${nUsable}/${esc(String(run.n_assets))}`, 'OK or SUSPECT; 90%+ = run OK')}
          ${stat('Events', esc(String(run.n_events)), 'state changes, crosses, flips, breaks, vol, stretch')}
          ${stat('Stale', stale.length, stale.length ? esc(stale.map((r) => r.asset_id).slice(0, 4).join(', ')) : 'every asset on time')}
          ${stat('Suspect', susp.length, susp.length ? esc(susp.map((r) => r.asset_id).slice(0, 4).join(', ')) : 'no move over 6 sigma')}
        </div>
        <h2 class="sec">State board</h2>
        <p class="note" style="margin:0 0 8px">State = the mean of three ensembles (moving-average crosses, time-series momentum, Donchian breakouts) on the log price, or on minus the yield for rates, so "up" for a rate means bonds rallying. On each chip: sessions in the state, the out-of-sample 21-session hit rate for the class and state (NA for neutral), the stretch from the 200-session average in sigmas, and the rv20 percentile of 3 years. Tap a chip for its signals.</p>
        ${board}
        <h2 class="sec" style="margin-top:16px">Events (${esc(String(events.length))})</h2>
        <div class="tablewrap"><table class="grid"><thead><tr><th>Asset</th><th>Event</th><th class="num">Prev → now</th><th>State</th><th class="num hide-sm">dist200</th><th class="num hide-sm" title="rv20 percentile of 3 years">rv20 pct</th><th class="num hide-sm">oos hit21</th><th>Status</th></tr></thead>
          <tbody>${evRows || '<tr><td colspan="8" class="muted">No events in this run.</td></tr>'}</tbody></table></div>
        <h2 class="sec" style="margin-top:16px">FX barrier board <span style="text-transform:none;letter-spacing:0">(21 sessions, rv60, zero drift)</span></h2>
        <div class="tablewrap"><table class="grid">${barHead}
          <tbody>${barRows || '<tr><td colspan="7" class="muted">No usable FX pair in this run.</td></tr>'}</tbody></table></div>
        <p class="note">Each cell: the one-touch barrier, and below it the fair value per 100 paid at touch: 100 × 2Φ(−k ÷ vol_mult). <span class="tr-mark">×1.15</span> marks a cell where the touch lookup scales the rv60 vol (vol_mult ≠ 1). Zero drift: the forward is ignored, so USDINR and USDIDR are not dealer-comparable without a forward adjustment.</p>
        ${shadowHtml}
        <details style="margin-top:10px"><summary>Hit rates (${esc(run.params_version)})</summary>${hitTable}</details>
        <details style="margin-top:6px"><summary>Text report</summary><pre class="tr-report mono">${esc(run.report || '')}</pre></details>`;
      el.querySelectorAll('.tr-chip').forEach((b) => (b.onclick = () => {
        const r = byId[b.dataset.a]; if (!r) return;
        open[r.asset_class] = open[r.asset_class] === r.asset_id ? null : r.asset_id;
        draw(d);
      }));
      wire(d);
    };
    const wire = () => {
      const inp = el.querySelector('#trDate');
      if (inp) inp.onchange = () => { store('trenddate', inp.value || ''); render(el, deps); };
      const latest = el.querySelector('#trLatest');
      if (latest) latest.onclick = () => { store('trenddate', ''); render(el, deps); };
      el.querySelector('#trRefresh').onclick = () => { delete cache[want || 'latest']; render(el, deps); };
    };
    // A run is written once a day; keep it for 30 minutes.
    const key = want || 'latest', hit = cache[key];
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return draw(hit.d);
    el.innerHTML = '<div class="muted">Loading…</div>';
    rpc('dash_trend', { p_run_date: want || null }).then((d) => { cache[key] = { d, at: Date.now() }; draw(d); })
      .catch((e) => { if (live()) el.innerHTML = `<div class="card empty">Could not load: ${esc(e.message || e)}</div>`; });
  }

  window.MacroDeskTrend = { render };
})();
