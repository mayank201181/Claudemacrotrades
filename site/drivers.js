/* Macro Desk — Drivers tab. Reads public.dash_drivers: the latest (or a chosen) snapshot of the FX
   drivers engine (the drivers pack: 21 USD pairs against their macro driver groups), loaded through
   dash.put_drivers. Only the parts whose holdout verdict passed are shown; the rest are listed with
   their verdict. Every number is the engine's own; this page only formats it.
   app.js calls MacroDeskDrivers.render(el, deps). */
(() => {
  const PARTS = ['driving_now', 'rich_cheap', 'waking_up', 'levels', 'tactical'];
  const PART_NAME = { driving_now: "What's driving now", rich_cheap: 'Rich / cheap', waking_up: 'Waking up (alerts)', levels: 'Chart levels', tactical: 'Tactical signals' };
  const cache = {}; let gen = 0; let openPair = null;

  const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
  const fnum = (x, dp) => { const v = num(x); return v == null ? 'NA' : v.toFixed(dp); };
  const sgn = (x, dp) => { const v = num(x); return v == null ? 'NA' : (v > 0 ? '+' : '') + v.toFixed(dp); };
  const pct = (x) => { const v = num(x); return v == null ? 'NA' : `${Math.round(Math.abs(v) <= 1.5 ? v * 100 : v)}%`; };
  const flag = (x) => x === true || ['1', '1.0', 'true', 't', 'y', 'yes'].includes(String(x ?? '').toLowerCase());
  const sign = (x) => { const s = String(x ?? '').toLowerCase(); return ['1', '1.0', '+1', '+', 'pos', 'positive'].includes(s) ? '+' : ['-1', '-1.0', '-', 'neg', 'negative'].includes(s) ? '−' : (x == null ? '' : String(x)); };
  const list = (x) => { if (Array.isArray(x)) return x; if (x == null || x === '') return []; try { const v = JSON.parse(x); return Array.isArray(v) ? v : [String(v)]; } catch { return [String(x)]; } };
  const sgt = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }) + ' SGT' : '—');

  function injectStyle() {
    if (document.getElementById('drivers-css')) return;
    const s = document.createElement('style');
    s.id = 'drivers-css';
    s.textContent = `
      .dv-parts { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; font-size: 12.5px; }
      .dv-parts .pill.pass { color: var(--pos); border-color: var(--pos); }
      .dv-parts .pill.fail { color: var(--neg); border-color: var(--neg); }
      tr.dv-grey td { color: var(--muted); }
      tr.dv-grey td b { color: var(--muted); font-weight: 500; }
      .dv-drv { display: inline-block; margin: 1px 6px 1px 0; white-space: nowrap; }
      .dv-drv .sh { font-family: var(--mono); font-size: 11.5px; color: var(--muted); }
      .dv-pos { color: var(--pos); } .dv-neg { color: var(--neg); }
      .dv-detail { background: var(--panel-2); }
      .dv-detail table.grid { font-size: 12.5px; } .dv-detail table.grid th { position: static; }
      .dv-alert { color: var(--warn); font-weight: 600; }
      .dv-line { font-family: var(--mono); font-size: 12px; white-space: pre-wrap; margin: 0; }`;
    document.head.appendChild(s);
  }

  const verdictPill = (p, esc) => {
    const v = String(p.verdict || '').toUpperCase();
    return `<span class="pill ${v === 'PASS' ? 'pass' : v === 'FAIL' ? 'fail' : 'closed'}" title="${esc(p.note || '')}">${esc(p.verdict || 'NA')}</span>`;
  };
  const drv = (name, s, share, pips, esc) => {
    if (!name) return '<span class="muted">—</span>';
    const sg = sign(s);
    return `<span class="dv-drv" title="${esc(`${name}: share of explained variance ${pct(share)}, contribution to the 20-session move ${sgn(pips, 0)} pips`)}"><span class="${sg === '+' ? 'dv-pos' : sg === '−' ? 'dv-neg' : ''}">${esc(sg)}</span> ${esc(name)} <span class="sh">${esc(pct(share))}</span></span>`;
  };

  function pairDetail(r, drivers, esc) {
    const rows = (src) => drivers.filter((d) => d.pair_id === r.pair_id && d.source === src)
      .sort((a, b) => (num(a.rank) ?? 99) - (num(b.rank) ?? 99) || (num(b.share) ?? 0) - (num(a.share) ?? 0));
    const table = (src, label) => {
      const xs = rows(src);
      if (!xs.length) return `<p class="note" style="margin:4px 0">${esc(label)}: no driver rows.</p>`;
      return `<div style="margin:6px 0"><b class="small">${esc(label)}</b>${xs[0].r2_window != null ? ` <span class="muted small">window R² ${esc(fnum(xs[0].r2_window, 2))}${xs[0].method ? ` · ${esc(xs[0].method)}` : ''}</span>` : ''}
        <div class="tablewrap"><table class="grid"><thead><tr><th>#</th><th>Driver</th><th>Sign</th><th class="num" title="share of the explained variance">Share</th><th class="num" title="beta in natural units">Beta</th><th class="num" title="the driver's own move over 20 sessions, natural units">Driver 20d</th><th class="num" title="contribution to the pair's 20-session move">Pips 20d</th><th>Core</th></tr></thead><tbody>
        ${xs.map((d) => `<tr><td class="num">${esc(String(d.rank ?? ''))}</td><td><b>${esc(d.name || d.group_id)}</b>${d.name ? ` <span class="muted small">${esc(d.group_id)}</span>` : ''}</td>
          <td class="${sign(d.sign) === '+' ? 'dv-pos' : sign(d.sign) === '−' ? 'dv-neg' : ''}">${esc(sign(d.sign))}</td><td class="num">${esc(pct(d.share))}</td>
          <td class="num">${esc(fnum(d.beta_nat, 1))}${d.nat_unit ? ` <span class="muted small">${esc(d.nat_unit)}</span>` : ''}</td><td class="num">${esc(sgn(d.driver_chg20_nat, 2))}</td>
          <td class="num">${esc(sgn(d.contribution_pips20, 0))}</td><td>${flag(d.in_core) ? 'core' : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
    };
    const labels = list(r.labels_json), greys = list(r.grey_reasons_json);
    return `<tr class="dv-detail"><td colspan="9">
      ${labels.length ? `<div class="small" style="margin-bottom:4px">Labels: ${labels.map((l) => `<span class="pill closed">${esc(String(l))}</span>`).join(' ')}</div>` : ''}
      ${greys.length ? `<div class="small" style="margin-bottom:4px">Greyed: ${esc(greys.join(', '))}</div>` : ''}
      ${table('3m', 'Last 3 months (daily data)')}${table('1y', 'Last year')}
      ${r.digest_line ? `<p class="dv-line" style="margin-top:6px">${esc(r.digest_line)}</p>` : ''}
    </td></tr>`;
  }

  function render(el, deps) {
    // deps: rpc(fn, args), esc(s), store(k, v), active() — true while this tab is still showing.
    const { rpc, esc, store, active } = deps;
    injectStyle();
    const my = ++gen;
    const live = () => gen === my && active();
    const want = store('driversdate') || ''; // '' = the latest snapshot
    const draw = (d) => {
      if (!live()) return;
      const run = d.run, parts = d.parts || [], pairs = d.pairs || [], drivers = d.drivers || [], items = d.items || [], dates = d.dates || [];
      const toolbar = `<div class="toolbar"><h2 class="sec" style="margin:0">Drivers</h2>
        <select id="dvDate" style="font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink)">
          <option value="">Latest</option>${dates.map((x) => `<option value="${esc(x)}"${x === (want || run?.as_of) ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <button id="dvRefresh" class="ghost small">Refresh</button></div>`;
      if (!run) {
        el.innerHTML = toolbar + `<div class="card empty">${want ? `No drivers snapshot stored for ${esc(want)}.` : 'No drivers snapshot loaded yet. The engine runs on the owner\'s Mac; its output is loaded here per as-of date.'}</div>`;
        return wire(d);
      }
      const shown = (p) => parts.some((x) => x.part === p && x.show);
      const partsHtml = `<div class="dv-parts">${PARTS.map((p) => { const x = parts.find((y) => y.part === p); return `<span>${esc(PART_NAME[p])} ${x ? verdictPill(x, esc) : '<span class="pill closed">no verdict</span>'}${x?.show ? '' : ' <span class="muted small">hidden</span>'}</span>`; }).join('')}</div>`;
      const hidden = parts.filter((x) => !x.show);
      const stat = (k, v, s) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
      const head = `<div class="card" style="margin-bottom:12px">
        <div class="row"><b>Data as of ${esc(run.as_of)}</b> <span class="muted small">run ${esc(run.run_id)}${run.version ? ` · ${esc(run.version)}` : ''}${run.source ? ` · ${esc(run.source)}` : ''} · loaded ${esc(sgt(run.loaded_at))}</span></div>
        ${partsHtml}
        ${hidden.length ? `<p class="note">Not shown (holdout verdict): ${hidden.map((x) => `${esc(PART_NAME[x.part] || x.part)} ${esc(x.verdict)}${x.note ? ` (${esc(x.note)})` : ''}`).join('; ')}.</p>` : ''}
        ${run.meta && Object.keys(run.meta).length ? `<details><summary class="small">Run notes</summary><ul class="small" style="margin:6px 0 0;padding-left:18px">${Object.entries(run.meta).map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(typeof v === 'string' ? v : JSON.stringify(v))}</li>`).join('')}</ul></details>` : ''}
      </div>`;

      let body = '';
      if (shown('driving_now')) {
        const rc = shown('rich_cheap'), wk = shown('waking_up');
        const greyN = pairs.filter((r) => r.grey).length, infoN = pairs.filter((r) => !r.grey && flag(r.informative_3m)).length;
        const alerts = wk ? pairs.filter((r) => r.alert_kind && r.alert_kind !== 'none') : [];
        const stats = `<div class="analytics">
          ${stat('Pairs', `${pairs.length - greyN}/${pairs.length}`, greyN ? `greyed: ${esc(pairs.filter((r) => r.grey).map((r) => r.pair_id).join(', '))}` : 'no pair greyed')}
          ${stat('Informative 3m', `${infoN}`, 'fits that beat the noise null')}
          ${wk ? stat('Alerts', `${alerts.length}`, alerts.length ? esc(alerts.map((r) => `${r.pair_id} ${r.alert_group || ''}`.trim()).slice(0, 4).join(', ')) : 'no driver waking up') : ''}
        </div>`;
        const rows = pairs.map((r) => {
          const on = openPair === r.pair_id;
          const greys = list(r.grey_reasons_json);
          return `<tr class="click${r.grey ? ' dv-grey' : ''}${on ? ' on' : ''}" data-p="${esc(r.pair_id)}" title="${esc(r.grey ? `no read: ${greys.join(', ') || 'greyed'}` : 'tap for the driver rows')}">
            <td><b>${esc(r.pair_id)}</b>${r.grey ? '<div class="muted small">no read</div>' : ''}${r.top_source ? `<div class="muted small">${esc(r.top_source)}</div>` : ''}</td>
            <td class="num">${esc(sgn(r.pips20, 0))}<div class="muted small">z ${esc(sgn(r.z20, 1))}</div></td>
            <td>${drv(r.top1_name || r.top1_group, r.top1_sign, r.top1_share, r.top1_pips20, esc)}</td>
            <td>${drv(r.top2_name || r.top2_group, r.top2_sign, r.top2_share, r.top2_pips20, esc)}</td>
            <td>${drv(r.top3_name || r.top3_group, r.top3_sign, r.top3_share, r.top3_pips20, esc)}</td>
            <td class="num">${esc(fnum(r.r2_3m, 2))}${flag(r.informative_3m) ? '*' : ''}</td>
            <td class="num hide-sm">${esc(fnum(r.oos_r2_1y, 2))}</td>
            <td class="num hide-sm">${rc ? `${esc(sgn(r.z60, 1))}${r.methodB_label ? `<div class="muted small">${esc(r.methodB_label)}</div>` : ''}` : '<span class="muted">—</span>'}</td>
            <td>${wk ? (r.alert_kind && r.alert_kind !== 'none' ? `<span class="dv-alert" title="${esc(r.alert_sentence || '')}">${esc(String(r.alert_kind).toUpperCase())}</span> ${esc(r.alert_group || '')}${r.alert_first_date ? `<div class="muted small">since ${esc(r.alert_first_date)}</div>` : ''}` : '<span class="muted">none</span>') : '<span class="muted">—</span>'}${r.trend_state_noon ? `<div class="muted small">trend ${esc(r.trend_state_noon)}${r.trend_age != null ? ` ${esc(String(r.trend_age))}` : ''}</div>` : ''}</td>
          </tr>${on ? pairDetail(r, drivers, esc) : ''}`;
        }).join('');
        body += stats + `<h2 class="sec">What's driving now</h2>
          <p class="note" style="margin:0 0 8px">Per pair, the macro driver groups explaining its moves over the last 3 months (daily data) and 1 year. Share = share of the explained variance; sign = how the pair moves when the driver rises; R² 3m with * beat a noise null. Greyed pairs have no informative fit (managed or thin): the engine has no read for them. Tap a row for all its drivers, both windows.</p>
          <div class="tablewrap"><table class="grid"><thead><tr><th>Pair</th><th class="num" title="the pair's move over the last 20 sessions, pips, and its z-score">20d pips</th><th>Driver 1</th><th>Driver 2</th><th>Driver 3</th><th class="num" title="R² of the 3-month window; * = informative against a noise null">R² 3m</th><th class="num hide-sm" title="out-of-sample R² of the 1-year window">oos R² 1y</th><th class="num hide-sm" title="rich/cheap: z-score of the 60-session residual">Rich/cheap z60</th><th>Alert · trend</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9" class="muted">No pair rows in this snapshot.</td></tr>'}</tbody></table></div>`;
        const lines = pairs.filter((r) => r.digest_line).map((r) => `${r.pair_id}: ${r.digest_line}`);
        if (lines.length) body += `<details style="margin-top:10px"><summary>Digest lines (${lines.length})</summary><pre class="dv-line" style="margin-top:6px">${esc(lines.join('\n'))}</pre></details>`;
      } else {
        body += `<div class="card empty">The "what's driving now" part is not shown for this snapshot${parts.find((x) => x.part === 'driving_now') ? ` (verdict ${esc(parts.find((x) => x.part === 'driving_now').verdict)})` : ''}.</div>`;
      }
      // Levels and tactical rows, when their parts are shown: a generic table of the columns present.
      for (const p of ['levels', 'tactical']) {
        if (!shown(p)) continue;
        const xs = items.filter((x) => x.part === p);
        const pref = p === 'levels'
          ? ['asset_id', 'level_kind', 'level_px', 'side', 'dist_pips', 'dist_atrc', 'verdict', 'confidence', 'relation_if_triggered', 'trigger_px', 'stop_px_if_triggered', 'instrument_hint']
          : ['asset_id', 'rule_id', 'label', 'relation', 'side', 'verdict', 'confidence', 'horizon_sessions', 'stop_atr', 'instrument_hint', 'show_mode', 'note'];
        const cols = xs.length ? pref.filter((c) => xs.some((x) => x[c] != null && x[c] !== '')) : [];
        body += `<h2 class="sec" style="margin-top:16px">${esc(PART_NAME[p])} (${xs.length})</h2>` + (xs.length
          ? `<div class="tablewrap"><table class="grid"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${xs.map((x) => `<tr>${cols.map((c) => `<td class="${typeof x[c] === 'number' ? 'num' : ''}">${esc(x[c] == null ? '' : typeof x[c] === 'number' ? String(Math.round(x[c] * 1000) / 1000) : String(x[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
          : '<div class="card empty">Part shown, but no rows loaded for it yet.</div>');
      }
      el.innerHTML = toolbar + head + body;
      el.querySelectorAll('tr.click[data-p]').forEach((tr) => (tr.onclick = () => { openPair = openPair === tr.dataset.p ? null : tr.dataset.p; draw(d); }));
      wire(d);
    };
    const wire = () => {
      const sel = el.querySelector('#dvDate');
      if (sel) sel.onchange = () => { store('driversdate', sel.value || ''); render(el, deps); };
      el.querySelector('#dvRefresh').onclick = () => { delete cache[want || 'latest']; render(el, deps); };
    };
    // A snapshot is loaded once a day at most; keep it for 30 minutes.
    const key = want || 'latest', hit = cache[key];
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return draw(hit.d);
    el.innerHTML = '<div class="muted">Loading…</div>';
    rpc('dash_drivers', { p_as_of: want || null }).then((d) => { cache[key] = { d, at: Date.now() }; draw(d); })
      .catch((e) => { if (live()) el.innerHTML = `<div class="card empty">Could not load: ${esc(e.message || e)}</div>`; });
  }

  window.MacroDeskDrivers = { render };
})();
