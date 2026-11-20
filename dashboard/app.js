// Token launch radar: the dashboard script.
//
// Everything on the page comes from window.RADAR, the dataset main.ts writes
// beside this folder as data.js: the ranked pre-token board, the live-token
// set aside from it, the peer pricing and the model's constants. The page
// never touches the network. It draws the board with its filters, a detail
// drawer per protocol carrying the model's own inputs and the protocol's
// farm plan, and a small sandbox that recomputes the board live when its
// two knobs are turned.
(() => {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;
  const root = document.getElementById('board');
  const onWatch = new Set(DATA.rows.filter((r) => r.watchlist).map((r) => r.slug));
  const ui = {
    q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token',
    sort: 'implied', dir: -1, picked: null,
    growthWeight: DATA.model.growth_weight, breadthOn: true,
  };

  const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFormat.format(n);
  };
  const pct = (n) => (n === null || n === undefined || !isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%');
  const ageText = (days) => {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  };
  const multText = (n) => (Math.round(n * 10000) / 10000).toFixed(2) + 'x';
  const fourText = (n) => (Math.round(n * 10000) / 10000).toFixed(4);

  // One row repriced in the page: the growth score board.json used is
  // recovered from its multiplier, then re-weighted with the sandbox's
  // weight, and the breadth factor is dropped when the sandbox says so.
  // With the knobs at rest the page lands on the very number board.json
  // carries, which is the point: the page and the board are one arithmetic.
  const impliedOf = (row) => {
    const score = (row.growth_multiplier - 1) / DATA.model.growth_weight;
    const growthMult = 1 + score * ui.growthWeight;
    const breadth = ui.breadthOn ? row.breadth_multiplier : 1;
    return Math.max(1, Math.round(row.tvl_usd * row.base_multiple * growthMult * row.maturity_multiplier * breadth));
  };
  const sandboxDirty = () => ui.growthWeight !== DATA.model.growth_weight || !ui.breadthOn;

  // A tiny element builder: attributes in, children after; `text` and
  // `html` set content, `on*` keys listen, everything else is an attribute.
  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    const add = (child) => {
      if (child === null || child === undefined) return;
      if (Array.isArray(child)) {
        child.forEach((c) => { if (c) add(c); });
        return;
      }
      node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    };
    kids.forEach(add);
    return node;
  }

  // The farm plan, derived in the page exactly as lib/model.ts derives it
  // for board.json: the category picks the sentences, the chains pick the
  // places, the TVL picks the stake, the age picks the hold. A protocol's
  // name is data here, never a branch.
  const firstChainOf = (p) => (p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain');
  const secondChainOf = (p) => (p.chains && p.chains.length > 1 ? p.chains[1] : null);
  const stakeFor = (p) => {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  };
  const GAS_LABELS = { ethereum: 'about $8 of gas', solana: 'about $0.05 of gas', binance: 'about $0.30 of gas', bsc: 'about $0.30 of gas', avalanche: 'about $1 of gas' };
  const CHEAP_GAS = ['arbitrum', 'optimism', 'base', 'polygon', 'zksync era', 'blast', 'mode'];
  const gasLabel = (chain) => {
    const key = (chain || '').toLowerCase();
    if (CHEAP_GAS.indexOf(key) >= 0) return 'about $0.50 of gas';
    return Object.prototype.hasOwnProperty.call(GAS_LABELS, key) ? GAS_LABELS[key] : 'about $2 of gas';
  };
  const holdSpan = (age) => {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  };
  const OPENERS = [
    [['lend', 'cdp', 'collateral'], (p, capital, chain) => 'Supply $' + capital + ' of USDC to ' + p.name + ' on ' + chain + ' and keep the position open.'],
    [['dex', 'yield', 'leveraged farm'], (p, capital, chain) => 'Provide $' + capital + ' of liquidity to ' + p.name + "'s main pool on " + chain + ' and keep the position open.'],
    [['bridge'], (p, capital, chain) => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + p.name + ' and use the bridged funds in its app.'],
    [['staking', 'restak'], (p, capital) => 'Stake $' + capital + " of the chain's staking asset through " + p.name + ' and keep the receipt token.'],
    [['perpetual', 'derivative'], (p, capital) => 'Deposit $' + capital + ' of USDC as margin on ' + p.name + ' and open one small hedged trade.'],
    [['prediction'], (p, capital) => 'Fund $' + capital + ' and place one market position on ' + p.name + '.'],
    [['curator', 'allocator'], (p, capital, chain) => 'Deposit $' + capital + ' into a ' + p.name + ' vault on ' + chain + ' and keep the shares.'],
    [['stable'], (p, capital, chain) => 'Mint or deposit $' + capital + ' of the stable asset through ' + p.name + ' on ' + chain + '.'],
    [['rwa'], (p, capital, chain) => 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.'],
    [['insurance'], (p, capital, chain) => 'Buy $' + capital + ' of cover from ' + p.name + ' on ' + chain + ' and keep the policy active.'],
  ];
  const openerFor = (p, capital, chain) => {
    const category = (p.category || '').toLowerCase();
    for (const [needles, say] of OPENERS) {
      if (needles.some((needle) => category.indexOf(needle) >= 0)) return say(p, capital, chain);
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  };
  const WEEKLIES = [
    [['dex', 'yield'], (p, chain) => 'Swap $25 through ' + p.name + ' on ' + chain + ' once a week, in either direction.'],
    [['lend', 'cdp', 'collateral'], (p) => 'Borrow $20 against the deposit on ' + p.name + ' once a week, then repay it the same day.'],
    [['bridge'], (p) => 'Bridge $25 through ' + p.name + ' once a week, even a small amount, and use the funds on the other side.'],
    [['staking', 'restak'], (p) => 'Add $10 to the stake on ' + p.name + ' once a week and keep every receipt.'],
    [['perpetual', 'derivative'], (p) => 'Place one small trade on ' + p.name + ' once a week and close it the same day.'],
    [['prediction'], (p) => 'Place one small market position on ' + p.name + ' once a week.'],
    [['stable'], (p) => 'Move $25 in and out of the stable asset on ' + p.name + ' once a week.'],
    [['rwa'], (p) => 'Check the yield accrual on ' + p.name + ' once a week and record the balance in the farm log.'],
  ];
  const weeklyFor = (p, chain) => {
    const category = (p.category || '').toLowerCase();
    for (const [needles, say] of WEEKLIES) {
      if (needles.some((needle) => category.indexOf(needle) >= 0)) return say(p, chain);
    }
    return 'Use ' + p.name + ' once a week: a deposit, a swap, a vote or any action its app offers.';
  };
  const stepLine = (step) => {
    let line = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (line.length > 600) line = line.slice(0, 596) + '...';
    if (line.length < 20) line += " Hold the position and check the protocol's own page.";
    return line;
  };
  const planStrings = (p) => {
    const chain = firstChainOf(p);
    const second = secondChainOf(p);
    const capital = stakeFor(p);
    const hold = holdSpan(p.age_days);
    const gas = gasLabel(chain);
    const steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: openerFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: weeklyFor(p, chain), cost: gas + ' a week', time: '10 minutes a week' },
    ];
    if (second !== null) {
      steps.push({ text: 'Repeat the same position on ' + second + ", the protocol's second chain, so the activity is visible on both chains.", cost: '$' + Math.round(capital / 2) + ' of capital and ' + gasLabel(second), time: '15 minutes' });
    } else {
      steps.push({ text: "Open the protocol's own points or rewards page once a week and finish one listed quest or task.", cost: 'no fee to check', time: '10 minutes a week' });
    }
    steps.push(
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    );
    return steps.map(stepLine);
  };

  // The view lives in the hash, so a filtered board or an open protocol can
  // be linked and the back button stays honest.
  const readHash = () => {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw);
    if (params.get('q')) ui.q = params.get('q');
    if (params.get('p')) ui.picked = params.get('p');
    if (params.get('category')) ui.category = params.get('category');
    if (params.get('chain')) ui.chain = params.get('chain');
    if (params.get('scope')) ui.scope = params.get('scope');
    if (params.get('tab')) ui.tab = params.get('tab');
  };
  const writeHash = () => {
    const params = new URLSearchParams();
    if (ui.q) params.set('q', ui.q);
    if (ui.category !== 'all') params.set('category', ui.category);
    if (ui.chain !== 'all') params.set('chain', ui.chain);
    if (ui.scope !== 'all') params.set('scope', ui.scope);
    if (ui.tab !== 'pre-token') params.set('tab', ui.tab);
    if (ui.picked) params.set('p', ui.picked);
    const next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  };

  const visibleRows = () => {
    const q = ui.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (ui.category !== 'all' && r.category !== ui.category) return false;
      if (ui.chain !== 'all' && !(r.chains || []).includes(ui.chain)) return false;
      if (ui.scope === 'watchlist' && !onWatch.has(r.slug)) return false;
      if (ui.scope === 'early' && onWatch.has(r.slug)) return false;
      if (!q) return true;
      const haystack = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return haystack.indexOf(q) >= 0;
    });
  };
  const sortKeyOf = (r, key) => {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
    return impliedOf(r);
  };
  const orderedRows = (list) => list.slice().sort((a, b) => {
    const av = sortKeyOf(a, ui.sort);
    const bv = sortKeyOf(b, ui.sort);
    if (av < bv) return -ui.dir;
    if (av > bv) return ui.dir;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  const topBar = () => h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
    h('div', { class: 'top-meta' },
      h('span', { text: 'Snapshot ' + DATA.as_of }),
      h('span', { text: 'DefiLlama protocol index' }),
      h('span', { text: DATA.model_version + ' model' }),
    ),
  );

  const intro = () => {
    const top = DATA.rows[0];
    const fact = (label, value) => h('div', { class: 'fact' }, h('span', { text: label }), h('b', { text: value }));
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds all ' + DATA.early_size + ' rankable pre-token protocols below that floor, so the board holds ' + DATA.board_size + ' rows. Implied value is a model, not a promise.' }),
        h('p', { class: 'sub', text: top ? 'Top of the board: ' + top.name + ' at ' + money(top.implied_value_usd) + ' implied.' : '' }),
      ),
      h('div', { class: 'facts' },
        fact('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
        fact('Pre-token rows scored', String(DATA.board_size)),
        fact('Early rows below the floor', String(DATA.early_size)),
        fact('Live-token protocols set aside', String(DATA.live_size)),
      ),
    );
  };

  const filterBar = () => {
    const categories = [...new Set(DATA.rows.map((r) => r.category || 'Other'))].sort();
    const chains = [...new Set(DATA.rows.flatMap((r) => r.chains || []))].sort();
    const search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: ui.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => { ui.q = search.value; writeHash(); render(); });
    const categorySelect = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => h('option', { value: c, text: c, selected: c === ui.category ? 'selected' : null })),
    );
    categorySelect.addEventListener('change', () => { ui.category = categorySelect.value; writeHash(); render(); });
    const chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map((c) => h('option', { value: c, text: c, selected: c === ui.chain ? 'selected' : null })),
    );
    chainSelect.addEventListener('change', () => { ui.chain = chainSelect.value; writeHash(); render(); });
    const scopeBtn = (value, label) => h('button', {
      type: 'button', 'aria-pressed': ui.scope === value ? 'true' : 'false', text: label,
      onclick: () => { ui.scope = value; writeHash(); render(); },
    });
    const tabBtn = (value, label) => h('button', {
      type: 'button', 'aria-pressed': ui.tab === value ? 'true' : 'false', text: label,
      onclick: () => { ui.tab = value; render(); },
    });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), categorySelect),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Scope' }), h('div', { class: 'tabs' }, scopeBtn('all', 'All'), scopeBtn('watchlist', 'Watchlist'), scopeBtn('early', 'Early'))),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'))),
      h('span', { class: 'count', text: ui.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }),
    );
  };

  const headCell = (key, label) => h('th', { scope: 'col' },
    h('button', {
      type: 'button',
      onclick: () => {
        if (ui.sort === key) ui.dir = -ui.dir;
        else { ui.sort = key; ui.dir = -1; }
        render();
      },
    }, label, ui.sort === key ? h('span', { 'aria-hidden': 'true', text: ui.dir < 0 ? ' v' : ' ^' }) : null),
  );

  const chainLine = (r) => (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain');

  const boardPanel = () => {
    const list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', {
          class: 'button primary', type: 'button', text: 'Clear filters',
          onclick: () => { ui.q = ''; ui.category = 'all'; ui.chain = 'all'; ui.scope = 'all'; writeHash(); render(); },
        }),
      ));
    }
    const peak = Math.max(1, ...list.map((r) => impliedOf(r)));
    const body = h('tbody');
    for (const r of list) {
      const value = impliedOf(r);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      body.appendChild(h('tr', {
        'data-selected': ui.picked === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: chainLine(r) }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: r.change_7d === null ? 'n/a' : pct(r.change_7d) }),
        h('td', { class: 'num', text: ageText(r.age_days) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((value / peak) * 100)) + '%' })),
          h('span', { class: 'num', text: money(value) }),
        )),
        h('td', null, h('span', { class: onWatch.has(r.slug) ? 'badge watch' : 'badge early', text: onWatch.has(r.slug) ? 'Watchlist' : 'Early' })),
      ));
    }
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            headCell('implied', 'Rank'),
            headCell('name', 'Protocol'),
            headCell('tvl', 'TVL'),
            headCell('growth', '7d'),
            headCell('age', 'Age'),
            headCell('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Scope' }),
          )),
          body,
        ),
      ),
    );
  };

  const livePanel = () => {
    const body = h('tbody');
    for (const r of DATA.live) {
      body.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: chainLine(r) }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', null, h('span', { class: 'status live', text: 'already trades' })),
      ));
    }
    const head = h('thead', null, h('tr', null,
      ['Status', 'Protocol', 'TVL', '7d', 'Market cap', 'Token'].map((label) => h('th', { scope: 'col', text: label })),
    ));
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their median price per TVL calibrates it.' }),
          head,
          body,
        ),
      ),
    );
  };

  const modelPanel = () => {
    const m = DATA.model;
    const weight = h('input', { type: 'number', id: 'sb-weight', min: '0', max: '1', step: '0.1', value: String(ui.growthWeight), 'aria-label': 'Growth weight' });
    weight.addEventListener('change', () => {
      const v = parseFloat(weight.value);
      ui.growthWeight = isFinite(v) ? Math.min(1, Math.max(0, v)) : m.growth_weight;
      render();
    });
    const breadth = h('select', { id: 'sb-breadth', 'aria-label': 'Chain breadth factor' },
      h('option', { value: 'on', text: 'Breadth on', selected: ui.breadthOn ? 'selected' : null }),
      h('option', { value: 'off', text: 'Breadth off', selected: !ui.breadthOn ? 'selected' : null }),
    );
    breadth.addEventListener('change', () => { ui.breadthOn = breadth.value === 'on'; render(); });
    const reset = h('button', {
      class: 'button', type: 'button', text: 'Reset model',
      onclick: () => { ui.growthWeight = m.growth_weight; ui.breadthOn = true; render(); },
    });
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The category multiple is the median market-cap / TVL of the live-token protocols in the same category (at least 4 of them), else the whole snapshot live median of ' + multText(DATA.global_median) + '; it is read from the snapshot, not assumed.' }),
      h('div', { class: 'formula' }, 'implied = round( tvl_usd x category_multiple x (1 + log_growth(change_7d) x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x breadth )'),
      h('p', { class: 'sub', text: 'Growth is log-dampened, so a 120% week scores 1.00 and a 4,448% week about 1.75 instead of being clipped flat. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Breadth adds 3% per extra chain, up to four.' }),
      h('div', { class: 'peers' }, DATA.live_medians.slice(0, 8).map((pm) => h('div', { class: 'peer' }, h('span', { text: pm.category + ' (n=' + pm.count + ')' }), h('b', { text: multText(pm.median) })))),
      h('div', { class: 'sandbox' },
        h('div', { class: 'field' }, h('label', { for: 'sb-weight', text: 'Sandbox: growth weight' }), weight),
        h('div', { class: 'field' }, h('label', { for: 'sb-breadth', text: 'Sandbox: chain breadth' }), breadth),
        reset,
        h('span', { class: 'sub', text: sandboxDirty() ? 'Sandbox changed: the board above is recomputed live; board.json keeps the model as published.' : 'Change a sandbox value and the board recomputes live.' }),
      ),
    );
  };

  const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { ui.picked = null; writeHash(); });

  const openDetail = (slug) => {
    const row = DATA.rows.find((r) => r.slug === slug);
    if (!row) return;
    ui.picked = slug;
    writeHash();
    dialog.textContent = '';
    const steps = planStrings(row);
    const capital = stakeFor(row);
    const recomputed = impliedOf(row);
    const base = Math.round(row.tvl_usd * row.base_multiple);
    const eqRow = (label, value, cls) => h('div', cls ? { class: cls } : null, h('span', { text: label }), h('b', { class: 'num', text: value }));
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (onWatch.has(row.slug) ? ' · Watchlist' : ' · Early') }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() }),
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        eqRow('TVL', money(row.tvl_usd)),
        eqRow('Category multiple (' + (row.category || 'Other') + ')', multText(row.base_multiple)),
        eqRow('Base value', money(base)),
        eqRow('Seven-day growth', pct(row.change_7d)),
        eqRow('Growth multiplier', fourText(row.growth_multiplier)),
        eqRow('Age with no token', ageText(row.age_days)),
        eqRow('Maturity multiplier', fourText(row.maturity_multiplier)),
        eqRow('Chain breadth (' + (row.chains || []).length + ' chains)', fourText(row.breadth_multiplier)),
        eqRow('Implied value', money(row.implied_value_usd), 'total'),
      ),
      h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ' under the current sandbox settings; board.json keeps ' + money(row.implied_value_usd) + '.') + ' This is an estimate, not a price.' }),
      h('p', { class: 'sub', text: row.live_peer_count > 0
        ? 'Live-token peers in ' + (row.category || 'Other') + ' trade at a median ' + multText(row.live_peer_median) + ' of TVL (' + row.live_peer_count + ' peers).'
        : 'No live-token peer group of 4 or more exists for this category, so the whole-snapshot live median of ' + multText(DATA.global_median) + ' prices it.' }),
      h('p', { class: 'sub', text: 'The snapshot records no token for this protocol; that is not proof it has none.' }),
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map((s) => {
        const at = s.indexOf(' Cost: ');
        const action = at >= 0 ? s.slice(0, at) : s;
        const tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      })),
      h('div', { class: 'note', text: 'Plan total: about $' + capital + ' of capital, plus gas on each step. Never pay to claim an airdrop, and only follow links the protocol itself publishes.' }),
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  };

  function render() {
    root.textContent = '';
    const shell = h('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    shell.appendChild(filterBar());
    shell.appendChild(ui.tab === 'pre-token' ? boardPanel() : livePanel());
    if (ui.tab === 'pre-token') shell.appendChild(modelPanel());
    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) root.appendChild(dialog);
    if (ui.picked) openDetail(ui.picked);
  }

  readHash();
  render();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();




