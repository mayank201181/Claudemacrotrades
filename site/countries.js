/* Macro Desk — Countries tab (28 Nov 2026). Twenty economies from free official sources, refreshed daily by the
   GitHub workflow "countries" (Astra A29 source map and fetch, countries/ in this repo) into countries.json on the
   branch countries-data. For the top-down view, not a trade signal. Each line: latest value, its date, the change
   over three months and where it sits in its own ten-year history (percentile, when ten years of data exist).
   app.js calls MacroDeskCountries.render(el, deps). */
(() => {
  const URL = 'https://raw.githubusercontent.com/mayank201181/Claudemacrotrades/countries-data/countries.json';
  const COUNTRIES = ['United States', 'Euro area', 'United Kingdom', 'Japan', 'Canada', 'Australia', 'New Zealand', 'Switzerland',
    'China', 'South Korea', 'Taiwan', 'India', 'Indonesia', 'Philippines', 'Malaysia', 'Singapore', 'Thailand', 'Brazil', 'Mexico', 'South Africa'];
  const CODE = { 'United States': 'US', 'Euro area': 'EA', 'United Kingdom': 'UK', Japan: 'JP', Canada: 'CA', Australia: 'AU', 'New Zealand': 'NZ',
    Switzerland: 'CH', China: 'CN', 'South Korea': 'KR', Taiwan: 'TW', India: 'IN', Indonesia: 'ID', Philippines: 'PH', Malaysia: 'MY',
    Singapore: 'SG', Thailand: 'TH', Brazil: 'BR', Mexico: 'MX', 'South Africa': 'ZA' };
  const BLOCKS = [['growth_fast', 'Growth, fast'], ['growth_slow', 'Growth'], ['inflation', 'Inflation'], ['policy', 'Policy'],
    ['fiscal', 'Fiscal'], ['external', 'External and flows'], ['markets', 'Markets']];
  const LABEL = {
    fast_tracker: 'Port calls (PortWatch)', nowcast: 'Official nowcast', nyfed_nowcast: 'NY Fed nowcast', jobless_claims: 'Initial jobless claims',
    fed_wei: 'Weekly economic index', advance_monthly_gdp: 'Advance monthly GDP', early_exports_10d: 'Exports, first 10 days',
    early_exports_20d: 'Exports, first 20 days', real_gdp_qoq: 'Real GDP q/q', real_gdp_yoy: 'Real GDP y/y', industrial_production: 'Industrial production',
    retail_sales: 'Retail sales', unemployment: 'Unemployment rate', employment: 'Employment', exports: 'Exports', pmi: 'Manufacturing PMI',
    business_confidence: 'Business confidence', consumer_confidence: 'Consumer confidence', cpi_yoy: 'CPI y/y', cpi_mom: 'CPI m/m',
    core_cpi_yoy: 'Core CPI y/y', core_cpi_mom: 'Core CPI m/m', biweekly_cpi_yoy: 'CPI y/y, fortnightly', biweekly_core_cpi_yoy: 'Core CPI y/y, fortnightly',
    ppi: 'Producer prices', inflation_expectations: 'Inflation expectations', wages: 'Wages', policy_rate: 'Policy rate',
    last_rate_change: 'Last rate change', next_meeting: 'Next decision', cb_balance_sheet: 'Central bank balance sheet',
    budget_balance_gdp: 'Budget balance, % GDP', budget_forecast_gdp: 'Budget forecast, % GDP', government_debt_gdp: 'Government debt, % GDP',
    monthly_fiscal: 'Monthly fiscal balance', current_account_gdp: 'Current account, % GDP', current_account: 'Current account',
    trade_balance: 'Trade balance', fx_reserves: 'FX reserves', portfolio_bop: 'Portfolio inflows (BoP)', foreign_equity_flow: 'Foreign equity flow',
    foreign_bond_flow: 'Foreign bond flow', yield_2y: '2y yield', yield_10y: '10y yield', equity_index: 'Equity index', fx_usd: 'FX per USD',
  };
  const ord = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const lbl = (i) => LABEL[i] || i.replace(/_/g, ' ');
  let data = null, loading = null, gen = 0;

  function injectStyle() {
    if (document.getElementById('countries-css')) return;
    const s = document.createElement('style');
    s.id = 'countries-css';
    s.textContent = `
      .cty-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
      .cty-chips button { padding: 4px 9px; font-size: 12.5px; border-radius: 999px; }
      .cty-chips button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
      .cty-block { margin-bottom: 14px; }
      .cty-block h3 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); }
      .cty-row { display: grid; grid-template-columns: minmax(130px, 1.4fr) minmax(110px, 1fr) 92px 96px 110px; gap: 8px; align-items: center;
        padding: 6px 8px; border-top: 1px solid var(--line); cursor: pointer; }
      .cty-row:first-of-type { border-top: none; }
      .cty-row .v { font-family: var(--mono); font-size: 13px; }
      .cty-row .u { color: var(--muted); font-size: 11px; display: block; font-family: var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cty-row .d { font-size: 12px; color: var(--muted); }
      .cty-row .chg { font-family: var(--mono); font-size: 12px; white-space: nowrap; }
      .cty-row.kept .v { color: var(--muted); }
      .cty-row.stale .d { color: var(--warn); }
      .pctbar { position: relative; height: 8px; border-radius: 4px; background: var(--line); }
      .pctbar i { position: absolute; top: -3px; width: 4px; height: 14px; border-radius: 2px; background: var(--accent); margin-left: -2px; }
      .pctbar.hi i { background: var(--neg); } .pctbar.lo i { background: var(--pos); }
      .pcttxt { font-size: 11px; color: var(--muted); font-family: var(--mono); }
      .cty-more { grid-column: 1 / -1; font-size: 12px; color: var(--muted); background: var(--panel-2); border-radius: 6px; padding: 8px 10px; cursor: auto; }
      .cty-head { display: grid; grid-template-columns: minmax(130px, 1.4fr) minmax(110px, 1fr) 92px 96px 110px; gap: 8px; padding: 0 8px 4px;
        font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; }
      @media (max-width: 640px) {
        .cty-row, .cty-head { grid-template-columns: 1fr auto; gap: 2px 10px; }
        .cty-head { display: none; }
        .cty-row .d { grid-column: 1; } .cty-row .chg { grid-column: 2; text-align: right; }
        .cty-row .pc { grid-column: 1 / -1; }
      }`;
    document.head.appendChild(s);
  }

  const fmt = (v) => {
    if (v == null || v === '') return '—';
    if (typeof v === 'string') return v;
    const a = Math.abs(v);
    const dp = a >= 1000 ? 0 : a >= 100 ? 1 : 2;
    return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  };
  const ddate = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }) : '—');
  // A line is old for its frequency when it is well past its next expected print.
  const staleDays = (f) => (/week/i.test(f) ? 21 : /daily|business|trading/i.test(f) ? 7 : /month/i.test(f) ? 75 : /quarter/i.test(f) ? 200 : 500);

  function rowHtml(r, esc, withCountry) {
    const arrow = r.dir === 'up' ? '▲' : r.dir === 'down' ? '▼' : r.dir === 'flat' ? '■' : '';
    const chg = r.chg == null ? '' : `${arrow} ${r.chg > 0 ? '+' : ''}${fmt(r.chg)}`;
    const pc = r.pct == null ? '<span class="pcttxt">no 10y base</span>'
      : `<div class="pctbar ${r.pct >= 90 ? 'hi' : r.pct <= 10 ? 'lo' : ''}"><i style="left:${r.pct}%"></i></div><span class="pcttxt">${ord(Math.round(r.pct))} pct, 10y</span>`;
    const kept = r.st !== 'ok';
    const stale = r.age != null && r.age > staleDays(r.f);
    const name = withCountry ? `${esc(CODE[r.c] || r.c)} · ${esc(r.c)}` : esc(lbl(r.i));
    return `<div class="cty-row${kept ? ' kept' : ''}${stale ? ' stale' : ''}" data-k="${esc(r.c + '|' + r.i)}">
      <div>${name}</div>
      <div class="v">${esc(fmt(r.v))}<span class="u">${esc(r.u)}</span></div>
      <div class="d">${esc(ddate(r.d))}${kept ? ' · kept' : ''}</div>
      <div class="chg ${r.dir === 'up' ? 'pos' : r.dir === 'down' ? 'neg' : ''}">${esc(chg)}</div>
      <div class="pc">${pc}</div></div>`;
  }
  const moreHtml = (r, esc) => `<div class="cty-more">${esc(r.ag)} · ${esc(r.f)}${r.st !== 'ok' ? ' · last fetch failed, value kept from the last good run' : ''}
    ${r.note ? `<br>${esc(r.note)}` : ''}${r.src ? `<br><a href="${esc(r.src)}" target="_blank" rel="noopener">source</a>` : ''}</div>`;

  async function load() {
    if (data) return data;
    if (!loading) loading = fetch(URL, { cache: 'no-cache' }).then((x) => { if (!x.ok) throw new Error(`HTTP ${x.status}`); return x.json(); })
      .then((j) => (data = j)).finally(() => { loading = null; });
    return loading;
  }

  async function render(el, { esc, store, active }) {
    injectStyle();
    const my = ++gen;
    el.innerHTML = '<div class="empty">Loading…</div>';
    let d;
    try { d = await load(); } catch (e) {
      if (my === gen && active()) el.innerHTML = `<div class="empty">Countries data not available yet (${esc(String(e.message || e))}). It is written each morning at 05:40 SGT.</div>`;
      return;
    }
    if (my !== gen || !active()) return;
    let view = 'country', sel = 'United States', ind = 'cpi_yoy';
    try { view = localStorage.getItem('md.cty.view') || view; sel = localStorage.getItem('md.cty.sel') || sel; ind = localStorage.getItem('md.cty.ind') || ind; } catch (_) {}
    const indicators = [...new Set(d.rows.map((r) => r.i))];
    const draw = () => {
      const head = `<div class="toolbar"><div class="seg" id="ctyView"><button data-v="country" class="${view === 'country' ? 'active' : ''}">By country</button>
        <button data-v="indicator" class="${view === 'indicator' ? 'active' : ''}">By indicator</button></div>
        ${view === 'indicator' ? `<select id="ctyInd">${BLOCKS.map(([b, n]) => `<optgroup label="${esc(n)}">${indicators.filter((i) => d.rows.some((r) => r.i === i && r.b === b))
          .map((i) => `<option value="${esc(i)}"${i === ind ? ' selected' : ''}>${esc(lbl(i))}</option>`).join('')}</optgroup>`).join('')}</select>` : ''}
        <span class="small muted">as of ${esc(d.as_of)} · ${d.ok} of ${d.total} lines fresh today · free official sources</span></div>`;
      const colHead = (first) => `<div class="cty-head"><div>${first}</div><div>Latest</div><div>Date</div><div>3m change</div><div>10y range</div></div>`;
      let body;
      if (view === 'country') {
        const rows = d.rows.filter((r) => r.c === sel);
        body = `<div class="cty-chips">${COUNTRIES.map((c) => `<button data-c="${esc(c)}" class="${c === sel ? 'on' : ''}" title="${esc(c)}">${esc(CODE[c])}</button>`).join('')}</div>
          <h2 class="sec">${esc(sel)}</h2>` + BLOCKS.map(([b, n]) => {
          const rs = rows.filter((r) => r.b === b);
          return rs.length ? `<div class="card cty-block"><h3>${esc(n)}</h3>${colHead('Indicator')}${rs.map((r) => rowHtml(r, esc, false)).join('')}</div>` : '';
        }).join('');
      } else {
        const rs = COUNTRIES.map((c) => d.rows.find((r) => r.c === c && r.i === ind)).filter(Boolean);
        const missing = COUNTRIES.filter((c) => !rs.some((r) => r.c === c));
        body = `<div class="card cty-block"><h3>${esc(lbl(ind))}</h3>${colHead('Economy')}${rs.map((r) => rowHtml(r, esc, true)).join('')}
          ${missing.length ? `<p class="note">No free official series: ${missing.map((c) => esc(CODE[c])).join(', ')}.</p>` : ''}</div>`;
      }
      el.innerHTML = head + body + `<p class="note">Percentile is the latest value's place in its own last ten years (shown only with ten years of data; red at 90th and above, green at 10th and below, whatever the indicator). "kept" means today's fetch failed and the last good value is shown. Dates in amber are older than the series' usual release gap. Tap a line for its source.</p>`;
      el.querySelectorAll('#ctyView button').forEach((b) => (b.onclick = () => { view = b.dataset.v; try { localStorage.setItem('md.cty.view', view); } catch (_) {} draw(); }));
      el.querySelectorAll('.cty-chips button').forEach((b) => (b.onclick = () => { sel = b.dataset.c; try { localStorage.setItem('md.cty.sel', sel); } catch (_) {} draw(); }));
      const s = el.querySelector('#ctyInd'); if (s) s.onchange = () => { ind = s.value; try { localStorage.setItem('md.cty.ind', ind); } catch (_) {} draw(); };
      el.querySelectorAll('.cty-row').forEach((row) => (row.onclick = () => {
        const nx = row.nextElementSibling;
        if (nx && nx.classList.contains('cty-more')) { nx.remove(); return; }
        const [c, i] = row.dataset.k.split('|');
        const r = d.rows.find((x) => x.c === c && x.i === i);
        if (r) row.insertAdjacentHTML('afterend', moreHtml(r, esc));
      }));
    };
    draw();
  }

  window.MacroDeskCountries = { render };
})();
