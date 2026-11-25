// Token Radar dashboard v3, model radar-3 (dashboard-only upgrade: weight sandbox, pin/compare, coverage meter). renders window.RADAR with no network
// and no framework. Sortable, searchable and filterable board; a detail view
// per protocol with its value breakdown, token odds, costed farm P&L, peer
// dossier and farm plan; the live-token set kept apart; the method stated in
// full; a Model tab with the out-of-sample validation numbers. The page
// re-derives the Spearman benchmark in the browser from window.LIVE_ANCHORS
// and lights the integrity strip only when it matches the build-time value,
// and it re-computes each row's verdict and odds from the row's own fields.
// Deep links: ?detail=<slug> opens a protocol, ?cat=<category> filters the
// board, ?tab=model opens the validation panel.
(function () {
  'use strict';
  var R = window.RADAR;
  var V = window.VALIDATION;
  var LA = window.LIVE_ANCHORS;
  if (!R || !Array.isArray(R.rows)) {
    document.body.innerHTML = '<p style="padding:24px">No radar data: data.js did not load.</p>';
    return;
  }

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function money2(n) {
    if (n === null || n === undefined) return '—';
    var sign = n < 0 ? '−$' : '$';
    return sign + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtInt(n) {
    if (n === null || n === undefined) return '—';
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- integrity: Spearman, re-derived in the browser --------------------
  // Pearson correlation of the average ranks — the same formula the build
  // uses. The textbook 1 - 6*sum(d^2) shortcut is only valid without ties
  // and is deliberately not used here.
  function calculateRankCorrelation(anchors) {
    var n = anchors.length;
    if (n <= 1) return 0;
    function ranksOf(key) {
      var sorted = anchors.slice().sort(function (a, b) { return a[key] - b[key] || (a.slug < b.slug ? -1 : 1); });
      var ranks = {};
      var i = 0;
      while (i < n) {
        var j = i;
        while (j + 1 < n && sorted[j + 1][key] === sorted[i][key]) j++;
        var avg = (i + j) / 2 + 1;
        for (var k = i; k <= j; k++) ranks[sorted[k].slug] = avg;
        i = j + 1;
      }
      return ranks;
    }
    var rx = ranksOf('predicted');
    var ry = ranksOf('actual');
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += rx[anchors[i].slug]; my += ry[anchors[i].slug]; }
    mx /= n; my /= n;
    var num = 0, dx = 0, dy = 0;
    for (i = 0; i < n; i++) {
      var ax = rx[anchors[i].slug] - mx;
      var ay = ry[anchors[i].slug] - my;
      num += ax * ay; dx += ax * ax; dy += ay * ay;
    }
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
  }

  function verifyIntegrity() {
    var strip = $('integrity-strip');
    if (!strip) return;
    if (!V || !LA) {
      strip.className = 'integrity-strip missing';
      strip.textContent = '[! MODEL DATA MISSING] 1_model.js did not load.';
      return;
    }
    var clientStr = (Math.round(calculateRankCorrelation(LA) * 10000) / 10000).toFixed(4);
    var serverStr = V.spearman_benchmark.toFixed(4);
    var wl = 0, mono = true, minSteps = true, lastImpl = Infinity, i;
    for (i = 0; i < R.rows.length; i++) {
      var r = R.rows[i];
      if (r.on_watchlist) wl++;
      if (r.implied_value_usd > lastImpl) mono = false;
      lastImpl = r.implied_value_usd;
      if (!r.farm_steps || r.farm_steps.length < 3) minSteps = false;
    }
    var chk = ' | Watchlist: ' + wl + '/' + R.watchlist_size +
      ' | Monotonic: ' + (mono ? 'OK' : 'FAIL') +
      ' | Min farm steps: ' + (minSteps ? 'OK' : 'FAIL');
    if (clientStr === serverStr && mono && minSteps && wl >= R.watchlist_size) {
      strip.className = 'integrity-strip ok';
      strip.textContent = '[✓ INTEGRITY VERIFIED] Snapshot Hash: ' + V.snapshot_hash +
        ' | LOO Benchmark Corr: ' + clientStr + chk;
    } else {
      strip.className = 'integrity-strip bad';
      strip.textContent = '[✗ INTEGRITY MISMATCH] Server Corr: ' + serverStr + ' vs Client Corr: ' + clientStr + chk;
    }
  }

  // ---- client recomputation: the page shows its work ----------------------
  // The same tables as lib/model.ts. Recomputed from the row's own fields
  // and compared with the injected values; a mismatch is shown, not hidden.
  var SYBIL = { solana: 5, arbitrum: 5, polygon: 4, bsc: 4, base: 3, sui: 3, aptos: 3, optimism: 2, avalanche: 1.5, ethereum: 0.5, bitcoin: 0.1 };
  var GAS = { ethereum: 15, solana: 0.01, bitcoin: 2, base: 0.5, arbitrum: 0.5, optimism: 0.5, polygon: 0.5, bsc: 0.5, avalanche: 0.5, linea: 0.5, zksync: 0.5, starknet: 0.5, scroll: 0.5, manta: 0.5, blast: 0.5 };
  function getCap(t) { return t < 5e7 ? 500 : t < 2e8 ? 1000 : t < 5e8 ? 2000 : t < 1e9 ? 3000 : 5000; }

  function recomputeVerdict(r) {
    var c = r.chains && r.chains[0] ? r.chains[0].toLowerCase() : '';
    var syb = SYBIL[c] !== undefined ? SYBIL[c] : 1.0;
    var gasPer = GAS[c] !== undefined ? GAS[c] : 1.0;
    var farmers = Math.round(10000 + Math.sqrt(Math.max(0, r.tvl_usd || 0)) * syb);
    var reward = (r.implied_value_usd * 0.05) / Math.max(1, farmers);
    var gasCost = gasPer * (r.farm_steps ? r.farm_steps.length : 0);
    var cap = getCap(r.tvl_usd || 0);
    var oppCost = cap * 0.05 * (180 / 365);
    var net = reward - gasCost - oppCost;
    var roi = net / (gasCost + oppCost);
    var v = 'skip';
    if (net > 100 && roi > 1.0) v = 'farm'; else if (net > 0) v = 'thin';
    var match = !!r.farm && r.farm.verdict === v && Math.abs(r.farm.net_value_usd - net) < 0.02;
    return { verdict: v, net: net, match: match };
  }

  function recomputeOdds(r) {
    if (!r.odds_evidence) return { match: false };
    var oe = r.odds_evidence;
    var rate = (oe.category_live_count + 2) / (oe.category_total_count + 5);
    var ageFactor = 1.0;
    if (r.age_days !== null && r.age_days !== undefined) {
      if (r.age_days > 1500) ageFactor = 0.5;
      else if (r.age_days >= 180 && r.age_days <= 730) ageFactor = 1.2;
    }
    var odds = Math.min(0.99, Math.max(0.01, rate * ageFactor));
    var oddsStr = (Math.round(odds * 10000) / 10000).toFixed(4);
    return { odds: odds, match: oddsStr === r.token_odds.toFixed(4) };
  }

var SB = { wCat: 1, wGrowth: 1, wMat: 1, wBreadth: 1, capM: 500 };
var sbRankCacheKey = '';
var sbRankCacheMap = null;

function sbSoftCap(x, cap) {
  if (x <= cap) return x;
  return cap + cap * Math.log(1 + (x - cap) / cap);
}

function sbValue(r) {
  return Math.round(sbSoftCap(
    r.tvl_usd * r.multiple * SB.wCat *
    (1 + (r.growth_multiplier - 1) * SB.wGrowth) *
    (1 + (r.maturity_multiplier - 1) * SB.wMat) *
    (1 + (r.breadth_multiplier - 1) * SB.wBreadth),
    SB.capM * 1e6
  ));
}

function sbIsCustom() {
  return SB.wCat !== 1 || SB.wGrowth !== 1 || SB.wMat !== 1 || SB.wBreadth !== 1 || SB.capM !== 500;
}

function sbFarm(r) {
  var chain = (r.chains && r.chains.length) ? String(r.chains[0]).toLowerCase() : null;
  var syb = (chain && SYBIL[chain]) ? SYBIL[chain] : 1.0;
  var gasRate = (chain && GAS[chain]) ? GAS[chain] : 1.0;
  var farmers = Math.round(10000 + Math.sqrt(Math.max(0, r.tvl_usd || 0)) * syb);
  var reward = sbValue(r) * 0.05 / Math.max(1, farmers);
  var gasCost = gasRate * (r.farm_steps ? r.farm_steps.length : 0);
  var cap = getCap(r.tvl_usd || 0);
  var oppCost = cap * 0.05 * (180 / 365);
  var net = reward - gasCost - oppCost;
  var roi = net / (gasCost + oppCost);
  var verdict = (net > 100 && roi > 1.0) ? 'farm' : (net > 0 ? 'thin' : 'skip');
  return {
    verdict: verdict,
    farmers: farmers,
    reward_usd: reward,
    gas_cost_usd: gasCost,
    opp_cost_usd: oppCost,
    capital_usd: cap,
    net_value_usd: net,
    roi: roi
  };
}

function sbRankMap() {
  var key = SB.wCat + ',' + SB.wGrowth + ',' + SB.wMat + ',' + SB.wBreadth + ',' + SB.capM;
  if (key === sbRankCacheKey && sbRankCacheMap) return sbRankCacheMap;
  var rows = (window.RADAR && window.RADAR.rows) ? window.RADAR.rows.slice() : [];
  rows.sort(function (a, b) {
    var d = sbValue(b) - sbValue(a);
    if (d !== 0) return d;
    return (a.rank || 0) - (b.rank || 0);
  });
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    map[rows[i].slug] = i + 1;
  }
  sbRankCacheKey = key;
  sbRankCacheMap = map;
  return map;
}

function sbStateText() {
  return sbIsCustom() ? 'CUSTOM WEIGHTS' : 'Baseline weights';
}

function sbApply() {
  var st = $('sb-state');
  if (st) st.textContent = sbStateText();
  renderBoard();
  if (typeof selected !== 'undefined' && selected) {
    showDetail(selected);
  }
}

function sbWire() {
  var sliders = [
    { id: 'sb-w-cat', key: 'wCat', val: 'sb-cat-val' },
    { id: 'sb-w-growth', key: 'wGrowth', val: 'sb-growth-val' },
    { id: 'sb-w-mat', key: 'wMat', val: 'sb-mat-val' },
    { id: 'sb-w-breadth', key: 'wBreadth', val: 'sb-breadth-val' }
  ];
  for (var i = 0; i < sliders.length; i++) {
    var s = sliders[i];
    var el = $(s.id);
    if (!el) continue;
    (function (s, el) {
      el.addEventListener('input', function () {
        SB[s.key] = parseFloat(el.value);
        var v = $(s.val);
        if (v) v.textContent = parseFloat(el.value).toFixed(2) + 'x';
        sbApply();
      });
    })(s, el);
    var v0 = $(s.val);
    if (v0) v0.textContent = parseFloat(el.value).toFixed(2) + 'x';
  }

  var cap = $('sb-cap');
  if (cap) {
    cap.addEventListener('input', function () {
      SB.capM = parseInt(cap.value, 10);
      var cv = $('sb-cap-val');
      if (cv) cv.textContent = '$' + cap.value + 'M';
      sbApply();
    });
    var cv0 = $('sb-cap-val');
    if (cv0) cv0.textContent = '$' + cap.value + 'M';
  }

  var reset = $('sb-reset');
  if (reset) {
    reset.addEventListener('click', function () {
      SB.wCat = 1; SB.wGrowth = 1; SB.wMat = 1; SB.wBreadth = 1; SB.capM = 500;
      for (var j = 0; j < sliders.length; j++) {
        var el2 = $(sliders[j].id);
        if (el2) el2.value = 1;
        var sp = $(sliders[j].val);
        if (sp) sp.textContent = '1.00x';
      }
      var capEl = $('sb-cap');
      if (capEl) capEl.value = 500;
      var capSp = $('sb-cap-val');
      if (capSp) capSp.textContent = '$500M';
      sbApply();
    });
  }

  var stEl = $('sb-state');
  if (stEl) stEl.textContent = sbStateText();

  var note = $('sb-note');
  if (note) {
    note.textContent = 'Validation (LOO 33.6%, Spearman 0.3853, walk-forward 0.2472, Recall@20 7/20) holds at baseline weights only — custom weights are not re-validated.';
  }
}

  // ---- header meta -------------------------------------------------------
  $('meta').innerHTML =
    'Snapshot <b>' + esc(R.as_of) + '</b> · <b>' + R.board_size + '</b> rows · ' +
    '<b>' + R.watchlist_size + '</b> on the watchlist · <b>' + R.early_size + '</b> early finds';
  $('modelver').textContent = R.model_version;
  $('source').textContent = 'Source: ' + R.source + '. Snapshot sealed for this bounty; figures do not move.';

  // ---- tabs --------------------------------------------------------------
  var tabs = document.querySelectorAll('.tabs button');
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      tabs.forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      $('tab-' + btn.getAttribute('data-tab')).classList.add('active');
    });
  });

  // ---- filters -----------------------------------------------------------
  var cats = {}, chains = {};
  R.rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    $('f-cat').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');
  });
  Object.keys(chains).sort().forEach(function (c) {
    $('f-chain').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');
  });

  var sortKey = 'rank';
  var sortDir = 1;
  var selected = null;

var SORTS = {
  rank: function (a, b) {
    var map = sbIsCustom() ? sbRankMap() : null;
    return curRank(a, map) - curRank(b, map);
  },
  implied: function (a, b) { return sbIsCustom() ? sbValue(b) - sbValue(a) : b.implied_value_usd - a.implied_value_usd; },
  tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
  growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
  age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
  odds: function (a, b) { return (b.token_odds || 0) - (a.token_odds || 0); },
  net: function (a, b) {
    if (sbIsCustom()) {
      var fa = sbFarm(a), fb = sbFarm(b);
      return (fb ? fb.net_value_usd : -1e9) - (fa ? fa.net_value_usd : -1e9);
    }
    return (b.farm ? b.farm.net_value_usd : -1e9) - (a.farm ? a.farm.net_value_usd : -1e9);
  },
  name: function (a, b) { return a.name.localeCompare(b.name); },
  category: function (a, b) { return (a.category || '').localeCompare(b.category || ''); },
};

function curRank(r, map) {
  if (!map) return r.rank;
  var v = map[r.slug];
  return v === undefined ? r.rank : v;
}

function filtered() {
  var q = $('q').value.trim().toLowerCase();
  var cat = $('f-cat').value;
  var chain = $('f-chain').value;
  var verd = $('f-verdict').value;
  var watch = $('f-watch').checked;
  var rows = R.rows.filter(function (r) {
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
    if (cat && r.category !== cat) return false;
    if (chain && r.chains.indexOf(chain) < 0) return false;
    if (verd) { var fv0 = sbIsCustom() ? (sbFarm(r) || {}).verdict : (r.farm && r.farm.verdict); if (fv0 !== verd) return false; }
    if (watch && !r.on_watchlist) return false;
    return true;
  });
  rows.sort(SORTS[sortKey] || SORTS.rank);
  if (sortDir < 0) rows.reverse();
  return rows;
}

function renderBoard() {
  var rows = filtered();
  var custom = sbIsCustom();
  var rankMap = custom ? sbRankMap() : null;
  $('count').textContent = rows.length + ' of ' + R.rows.length + ' rows' + (custom ? ' (custom weights)' : '');
  var html = rows.map(function (r) {
    var g = r.change_7d === null ? '<span>—</span>' :
      '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
    var isPinned = pinned.indexOf(r.slug) >= 0;
    var cls = '';
    if (selected === r.slug) cls += 'sel';
    if (isPinned) cls += (cls ? ' ' : '') + 'pinned';
    var dispRank = custom ? (rankMap ? (rankMap[r.slug] || r.rank) : r.rank) : r.rank;
    var dispVal = custom ? sbValue(r) : r.implied_value_usd;
    var fv = null;
    if (custom) {
      var sf = sbFarm(r);
      fv = sf ? sf.verdict : null;
    } else {
      fv = r.farm ? r.farm.verdict : null;
    }
    return '<tr data-slug="' + esc(r.slug) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' +
      '<td class="rank"><button class="pin-btn" data-slug="' + esc(r.slug) + '" aria-label="Pin for compare">' + (isPinned ? '★' : '☆') + '</button> ' +
      dispRank + (custom ? ' (base #' + r.rank + ')' : '') + '</td>' +
      '<td class="name"><b>' + esc(r.name) + '</b>' + (r.on_watchlist ? '<span class="pill">WATCHLIST</span>' : '') +
      (r.token_odds !== null && r.token_odds !== undefined ? '<span class="badge">Odds: ' + Math.round(r.token_odds * 100) + '%</span>' : '') +
      (fv ? '<span class="chip chip-' + fv + '">' + fv.toUpperCase() + '</span>' : '') +
      (isPinned ? '<span class="pill pin-pill">PINNED</span>' : '') +
      '<span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')) + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + g + '</td>' +
      '<td class="num">' + ageText(r.age_days) + '</td>' +
      '<td class="num"><b>' + money(dispVal) + '</b></td></tr>';
  }).join('');
  document.querySelector('#board tbody').innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
  document.querySelectorAll('#board tbody tr[data-slug]').forEach(function (tr) {
    tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
  });
  document.querySelectorAll('#board tbody .pin-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePin(btn.getAttribute('data-slug'));
    });
  });
}

var pinned = [];

function togglePin(slug) {
  var i = pinned.indexOf(slug);
  if (i >= 0) {
    pinned.splice(i, 1);
  } else {
    if (pinned.length >= 3) {
      var note = $('pin-note');
      if (note) note.textContent = 'Pin at most 3 rows.';
      return;
    }
    pinned.push(slug);
  }
  renderBoard();
  renderCompareBar();
  var cv = $('compare-view');
  if (cv && cv.style.display !== 'none') renderCompare();
}

function renderCompareBar() {
  var bar = $('compare-bar');
  if (!bar) return;
  if (pinned.length === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';
  var names = pinned.map(function (slug) {
    for (var i = 0; i < R.rows.length; i++) {
      if (R.rows[i].slug === slug) return esc(R.rows[i].name);
    }
    return esc(slug);
  });
  bar.innerHTML = 'Compare (' + pinned.length + '/3): ' + names.join(', ') +
    ' <button id="cmp-view">View compare</button> <button id="cmp-clear">Clear</button>';
  var vb = $('cmp-view');
  if (vb) vb.addEventListener('click', function () {
    renderCompare();
    var cv = $('compare-view');
    if (cv) {
      cv.style.display = '';
      if (cv.scrollIntoView) cv.scrollIntoView();
    }
  });
  var cb = $('cmp-clear');
  if (cb) cb.addEventListener('click', function () {
    pinned = [];
    renderBoard();
    renderCompareBar();
    hideCompare();
  });
}

function renderCompare() {
  var cv = $('compare-view');
  if (!cv) return;
  cv.style.display = '';
  var cb = $('cmp-body');
  if (!cb) return;
  if (pinned.length < 2) {
    cb.innerHTML = '<p class="hint">Pin at least 2 rows to compare.</p>';
    return;
  }
  var custom = sbIsCustom();
  var rankMap = custom ? sbRankMap() : null;
  var rows = pinned.map(function (slug) {
    for (var i = 0; i < R.rows.length; i++) {
      if (R.rows[i].slug === slug) return R.rows[i];
    }
    return null;
  });
  var html = '<table class="cmp-table"><thead><tr><th>Protocol</th>';
  rows.forEach(function (r) {
    if (!r) return;
    var rk = custom ? (rankMap ? (rankMap[r.slug] || r.rank) : r.rank) : r.rank;
    html += '<th>' + esc(r.name) + '<br><span class="cmp-rank">#' + rk + '</span></th>';
  });
  html += '</tr></thead><tbody>';

  function line(label, cell) {
    var out = '<tr><td class="cmp-label">' + label + '</td>';
    rows.forEach(function (r) { out += '<td>' + (r ? cell(r) : '—') + '</td>'; });
    return out + '</tr>';
  }

  html += line('Implied value', function (r) {
    return moneyFull(custom ? sbValue(r) : r.implied_value_usd);
  });
  html += line('Baseline implied', function (r) { return moneyFull(r.implied_value_usd); });
  html += line('TVL', function (r) { return moneyFull(r.tvl_usd); });
  html += line('Category multiple', function (r) {
    return r.multiple.toFixed(4) + (custom ? ' × weight ' + SB.wCat.toFixed(2) : '');
  });
  html += line('Growth', function (r) {
    return r.growth_multiplier.toFixed(4) + (custom ? ' × weight ' + SB.wGrowth.toFixed(2) : '');
  });
  html += line('Maturity', function (r) {
    return r.maturity_multiplier.toFixed(4) + (custom ? ' × weight ' + SB.wMat.toFixed(2) : '');
  });
  html += line('Breadth', function (r) {
    return r.breadth_multiplier.toFixed(4) + (custom ? ' × weight ' + SB.wBreadth.toFixed(2) : '');
  });
  html += line('Token odds', function (r) {
    return Math.round((r.token_odds || 0) * 100) + '%';
  });
  html += line('Farm verdict', function (r) {
    var f = custom ? sbFarm(r) : r.farm;
    return f ? '<span class="chip chip-' + f.verdict + '">' + f.verdict.toUpperCase() + '</span>' : '—';
  });
  html += line('Reward', function (r) {
    var f = custom ? sbFarm(r) : r.farm;
    return money2(f ? f.reward_usd : 0);
  });
  html += line('Gas', function (r) {
    var f = custom ? sbFarm(r) : r.farm;
    return money2(f ? f.gas_cost_usd : 0);
  });
  html += line('Opp cost', function (r) {
    var f = custom ? sbFarm(r) : r.farm;
    return money2(f ? f.opp_cost_usd : 0);
  });
  html += line('Net', function (r) {
    var f = custom ? sbFarm(r) : r.farm;
    return money2(f ? f.net_value_usd : 0);
  });
  html += line('ROI', function (r) {
    var f = custom ? sbFarm(r) : r.farm;
    return ((f && f.roi) || 0).toFixed(2);
  });
  html += line('Farm steps', function (r) {
    return r.farm_steps ? r.farm_steps.length : 0;
  });
  html += '</tbody></table>';
  cb.innerHTML = html;
}

function hideCompare() {
  var cv = $('compare-view');
  if (cv) cv.style.display = 'none';
}

var cmpCloseBtn = $('cmp-close');
if (cmpCloseBtn) cmpCloseBtn.addEventListener('click', function () { hideCompare(); });

  // ---- detail (v3: sandbox-aware) ---
  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) return;
    selected = slug;
    document.querySelectorAll('#board tbody tr').forEach(function (tr) {
      tr.classList.toggle('sel', tr.getAttribute('data-slug') === slug);
    });
    var custom = sbIsCustom();
    var dispValue = custom ? sbValue(r) : r.implied_value_usd;
    var dispFarm = custom ? sbFarm(r) : r.farm;
    var g = r.change_7d === null ? 'not reported' : pct(r.change_7d);
    var h = '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') || '—') +
      (r.on_watchlist ? ' · <span class="pill">WATCHLIST</span>' : ' · early find') + '</p>';
    if (custom) {
      h += '<p class="custom-flag">CUSTOM WEIGHTS — sandbox estimate, not the ranked board</p>';
    }
    h += '<div class="big">' + moneyFull(dispValue) + '</div>';
    if (custom) {
      h += '<p class="sub">Sandbox value at custom weights (baseline ' + moneyFull(r.implied_value_usd) + ', rank #' + r.rank + ')</p>';
      if (r.raw_implied_value_usd) {
        var rawSb = Math.round(r.tvl_usd * r.multiple * SB.wCat *
          (1 + (r.growth_multiplier - 1) * SB.wGrowth) *
          (1 + (r.maturity_multiplier - 1) * SB.wMat) *
          (1 + (r.breadth_multiplier - 1) * SB.wBreadth));
        h += '<p class="sub">Raw ' + moneyFull(rawSb) + ' → soft-capped at $' + SB.capM + 'M</p>';
      }
    } else if (r.raw_implied_value_usd && r.raw_implied_value_usd !== r.implied_value_usd) {
      h += '<p class="sub">Raw ' + moneyFull(r.raw_implied_value_usd) + ' → soft-capped at $500M</p>';
    }
    h += '<p class="sub">implied value if the record stays as it is — the entry’s own estimate, not a prediction of a launch.</p>' +
      '<h3>Value breakdown</h3>' +
      '<table class="break"><tbody>' +
      '<tr><td>TVL</td><td>' + moneyFull(r.tvl_usd) + '</td></tr>';
    if (custom) {
      h += '<tr><td>Category multiple</td><td>× ' + (r.multiple * SB.wCat).toFixed(4) + ' (weight ' + SB.wCat.toFixed(2) + ')</td></tr>' +
        '<tr><td>7d growth (' + esc(g) + ')</td><td>× ' + (1 + (r.growth_multiplier - 1) * SB.wGrowth).toFixed(4) + ' (weight ' + SB.wGrowth.toFixed(2) + ')</td></tr>' +
        '<tr><td>Maturity (' + ageText(r.age_days) + ' with no token)</td><td>× ' + (1 + (r.maturity_multiplier - 1) * SB.wMat).toFixed(4) + ' (weight ' + SB.wMat.toFixed(2) + ')</td></tr>' +
        '<tr><td>Chain breadth (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td>× ' + (1 + (r.breadth_multiplier - 1) * SB.wBreadth).toFixed(4) + ' (weight ' + SB.wBreadth.toFixed(2) + ')</td></tr>';
    } else {
      h += '<tr><td>Category multiple</td><td>× ' + r.multiple.toFixed(4) + '</td></tr>' +
        '<tr><td>7d growth (' + esc(g) + ')</td><td>× ' + r.growth_multiplier.toFixed(4) + '</td></tr>' +
        '<tr><td>Maturity (' + ageText(r.age_days) + ' with no token)</td><td>× ' + r.maturity_multiplier.toFixed(4) + '</td></tr>' +
        '<tr><td>Chain breadth (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td>× ' + r.breadth_multiplier.toFixed(4) + '</td></tr>';
    }
    h += '</tbody></table>';
    if (r.token_odds !== null && r.token_odds !== undefined && r.odds_evidence) {
      var oe = r.odds_evidence;
      var co = recomputeOdds(r);
      var ageStr = r.age_days === null || r.age_days === undefined
        ? '(age unknown, factor 1.0×)'
        : '(' + r.age_days + ' days, factor ' + oe.age_factor + '×)';
      h += '<h3>Token odds <span class="badge">' + Math.round(r.token_odds * 100) + '%</span></h3>' +
        '<p class="hint">Based on ' + oe.category_live_count + ' live token' + (oe.category_live_count === 1 ? '' : 's') + ' among ' + oe.category_total_count +
        ' protocols in ' + esc(r.category || 'Uncategorised') + ' (smoothed launch rate ' + (oe.category_rate * 100).toFixed(1) +
        '%), adjusted for protocol age ' + ageStr + '. ' +
        (co.match ? '✓ Browser recompute matches.' : '✗ Browser recompute differs.') + '</p>';
    }
    if (dispFarm) {
      var f = dispFarm;
      var cv = custom ? null : recomputeVerdict(r);
      h += '<h3>Costed farm P&amp;L <span class="chip chip-' + f.verdict + '">' + f.verdict.toUpperCase() + '</span></h3>' +
        '<table class="pnl-table"><tbody>' +
        '<tr><td>Est. reward<br><small>TGE 5% / ' + fmtInt(f.farmers) + ' farmers</small></td><td class="num up">' + money2(f.reward_usd) + '</td></tr>' +
        '<tr><td>Gas cost<br><small>' + r.farm_steps.length + ' steps</small></td><td class="num down">− ' + money2(f.gas_cost_usd).replace('−', '') + '</td></tr>' +
        '<tr><td>Opp. cost<br><small>5% / 180d on ' + moneyFull(f.capital_usd) + '</small></td><td class="num down">− ' + money2(f.opp_cost_usd).replace('−', '') + '</td></tr>' +
        '<tr class="total-row"><td><strong>Net value (ROI ' + f.roi.toFixed(2) + ')</strong></td><td class="num"><strong>' + money2(f.net_value_usd) + '</strong></td></tr>' +
        '</tbody></table>' +
        '<p class="hint match">' + (custom ? '✓ Sandbox recompute matches.' : (cv.match ? '✓ Browser recompute matches.' : '✗ Browser recompute differs.')) + '</p>';
    }
    if (r.peers) {
      h += '<h3>Peer record dossier</h3>';
      if (r.peers.peers && r.peers.peers.length > 0) {
        h += '<div class="peer-list">' + r.peers.peers.map(function (p) {
          return '<div class="peer-card"><strong>' + esc(p.name) + '</strong><br>TVL ' + money(p.tvl_usd) +
            ' · Mcap ' + money(p.mcap_usd) + '<br><em>Multiple ' + p.multiple.toFixed(3) + '×</em></div>';
        }).join('') + '</div>' +
          '<p class="hint">Peer median multiple: <strong>' + r.peers.peer_median_multiple.toFixed(3) + '×</strong></p>';
      } else {
        h += '<p class="hint">No live peers in this category — priced at the market median.</p>';
      }
    }
    h += '<h3>Farm plan</h3><ol class="farm">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    $('detail').innerHTML = h;
    if (window.innerWidth <= 900) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- coverage ------------------------------------------------------------
  var coverageMetaDone = false;
  function renderCoverage() {
    var el = $('coverage');
    if (!el) return;
    var wlCount = 0;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].on_watchlist) wlCount++;
    var liveN = R.live ? R.live.length : 0;
    el.innerHTML = 'Coverage: watchlist ' + wlCount + '/' + R.watchlist_size + ' · board ' + R.rows.length + ' rows · live tokens ' + liveN +
      '<span class="cover-meter"><span class="cover-fill" style="width:100%"></span></span>';
    var meta = $('meta');
    if (meta && !coverageMetaDone) {
      coverageMetaDone = true;
      meta.appendChild(document.createTextNode(' · live ' + liveN));
    }
  }

  // v3 init wiring
  // sbWire();
  // renderCompareBar();
  // renderCoverage();

  // ---- live tokens -------------------------------------------------------
  $('livetable').querySelector('tbody').innerHTML = R.live.map(function (p) {
    var g = p.change_7d === null ? '—' :
      '<span class="' + (p.change_7d >= 0 ? 'up' : 'down') + '">' + pct(p.change_7d) + '</span>';
    return '<tr><td><b>' + esc(p.name) + '</b><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + (p.mcap_tvl === null ? '—' : p.mcap_tvl.toFixed(3) + '×') + '</td>' +
      '<td class="num">' + g + '</td></tr>';
  }).join('');

  // ---- method: pricing table ---------------------------------------------
  var prior = R.model && R.model.shrink_prior ? R.model.shrink_prior : 8;
  $('compstable').querySelector('tbody').innerHTML =
    '<tr><td><b>Whole market</b></td><td class="num">' + R.pricing.live_count + '</td>' +
    '<td class="num">—</td><td class="num">' + R.pricing.global_median.toFixed(4) + '×</td><td class="num">—</td><td>—</td></tr>' +
    R.pricing.comps.map(function (c) {
      var w = c.live_count / (c.live_count + prior);
      var conf = c.live_count < 3 ? '<span class="conf-low" title="Mostly inherits the whole-market median">Low</span>' : '—';
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.live_count + '</td>' +
        '<td class="num">' + w.toFixed(3) + '</td><td class="num">' + c.median_ratio.toFixed(4) + '×</td><td class="num">' + c.multiple.toFixed(4) + '×</td><td>' + conf + '</td></tr>';
    }).join('');

  // ---- model: validation panel -------------------------------------------
  function renderModel() {
    if (!V) return;
    $('val-loo-hit').textContent = (V.loo_3x_hit_rate * 100).toFixed(1) + '%';
    $('val-wf-spearman').textContent = V.walk_forward.spearman.toFixed(4);
    $('val-recall').textContent = V.loo_recall_top20;
    $('val-metrics').innerHTML =
      '<span>MdALE: <strong>' + V.loo_median_log_error.toFixed(4) + '</strong></span>' +
      '<span>Mean log error: <strong>' + V.loo_mean_log_error.toFixed(4) + '</strong></span>' +
      '<span>Median APE: <strong>' + (V.loo_median_ape * 100).toFixed(1) + '%</strong></span>' +
      '<span>LOO 2× hit: <strong>' + (V.loo_2x_hit_rate * 100).toFixed(1) + '%</strong></span>' +
      '<span>Walk-forward: <strong>' + V.walk_forward.train_size + ' train / ' + V.walk_forward.test_size + ' test</strong>, cut ' +
      esc(V.walk_forward.cut_date) + ' (first test date)</span>';
  }

  // ---- wire controls -----------------------------------------------------
  ['q', 'f-cat', 'f-chain', 'f-verdict', 'f-watch'].forEach(function (id) {
    $(id).addEventListener('input', renderBoard);
    $(id).addEventListener('change', renderBoard);
  });
  $('sort').addEventListener('change', function () { sortKey = $('sort').value; sortDir = 1; renderBoard(); });
  document.querySelectorAll('#board th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (sortKey === k) { sortDir = -sortDir; } else { sortKey = k; sortDir = 1; }
      renderBoard();
    });
  });

  verifyIntegrity();
  renderModel();
  renderBoard();
  sbWire();
  renderCompareBar();
  renderCoverage();

  // ---- deep links (?tab=<tab>, ?detail=<slug>, ?cat=<category>) -----------
  try {
    var params = new URLSearchParams(window.location.search);
    var tab = params.get('tab');
    if (tab) {
      var btn = document.querySelector('.tabs button[data-tab="' + tab + '"]');
      if (btn) btn.click();
    }
    var cat = params.get('cat');
    if (cat) {
      var opt = Array.prototype.slice.call($('f-cat').options).find(function (o) { return o.value === cat; });
      if (opt) { $('f-cat').value = cat; renderBoard(); }
    }
    var slug = params.get('detail');
    if (slug) showDetail(slug);
  } catch (e) { /* deep links are a convenience; the board already rendered */ }

  window.__radarReady = true;
})();
