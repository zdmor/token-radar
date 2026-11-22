// Token Radar dashboard, model radar-3: renders window.RADAR with no network
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
    rank: function (a, b) { return a.rank - b.rank; },
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
    age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
    odds: function (a, b) { return (b.token_odds || 0) - (a.token_odds || 0); },
    net: function (a, b) { return (b.farm ? b.farm.net_value_usd : -1e9) - (a.farm ? a.farm.net_value_usd : -1e9); },
    name: function (a, b) { return a.name.localeCompare(b.name); },
    category: function (a, b) { return (a.category || '').localeCompare(b.category || ''); },
  };

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
      if (verd && (!r.farm || r.farm.verdict !== verd)) return false;
      if (watch && !r.on_watchlist) return false;
      return true;
    });
    rows.sort(SORTS[sortKey] || SORTS.rank);
    if (sortDir < 0) rows.reverse();
    return rows;
  }

  function renderBoard() {
    var rows = filtered();
    $('count').textContent = rows.length + ' of ' + R.rows.length + ' rows';
    var html = rows.map(function (r) {
      var g = r.change_7d === null ? '<span>—</span>' :
        '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b>' + (r.on_watchlist ? '<span class="pill">WATCHLIST</span>' : '') +
        (r.token_odds !== null && r.token_odds !== undefined ? '<span class="badge">Odds: ' + Math.round(r.token_odds * 100) + '%</span>' : '') +
        (r.farm ? '<span class="chip chip-' + r.farm.verdict + '">' + r.farm.verdict.toUpperCase() + '</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + g + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
    document.querySelector('#board tbody').innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
    document.querySelectorAll('#board tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }

  // ---- detail ------------------------------------------------------------
  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) return;
    selected = slug;
    document.querySelectorAll('#board tbody tr').forEach(function (tr) {
      tr.classList.toggle('sel', tr.getAttribute('data-slug') === slug);
    });
    var g = r.change_7d === null ? 'not reported' : pct(r.change_7d);
    var h = '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') || '—') +
      (r.on_watchlist ? ' · <span class="pill">WATCHLIST</span>' : ' · early find') + '</p>' +
      '<div class="big">' + moneyFull(r.implied_value_usd) + '</div>' +
      (r.raw_implied_value_usd && r.raw_implied_value_usd !== r.implied_value_usd
        ? '<p class="sub">Raw ' + moneyFull(r.raw_implied_value_usd) + ' → soft-capped at $500M</p>'
        : '') +
      '<p class="sub">implied value if the record stays as it is — the entry\u2019s own estimate, not a prediction of a launch.</p>' +
      '<h3>Value breakdown</h3>' +
      '<table class="break"><tbody>' +
      '<tr><td>TVL</td><td>' + moneyFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple</td><td>× ' + r.multiple.toFixed(4) + '</td></tr>' +
      '<tr><td>7d growth (' + esc(g) + ')</td><td>× ' + r.growth_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td>Maturity (' + ageText(r.age_days) + ' with no token)</td><td>× ' + r.maturity_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td>Chain breadth (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td>× ' + r.breadth_multiplier.toFixed(4) + '</td></tr>' +
      '</tbody></table>';
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
    if (r.farm) {
      var f = r.farm;
      var cv = recomputeVerdict(r);
      h += '<h3>Costed farm P&amp;L <span class="chip chip-' + f.verdict + '">' + f.verdict.toUpperCase() + '</span></h3>' +
        '<table class="pnl-table"><tbody>' +
        '<tr><td>Est. reward<br><small>TGE 5% / ' + fmtInt(f.farmers) + ' farmers</small></td><td class="num up">' + money2(f.reward_usd) + '</td></tr>' +
        '<tr><td>Gas cost<br><small>' + r.farm_steps.length + ' steps</small></td><td class="num down">− ' + money2(f.gas_cost_usd).replace('−', '') + '</td></tr>' +
        '<tr><td>Opp. cost<br><small>5% / 180d on ' + moneyFull(f.capital_usd) + '</small></td><td class="num down">− ' + money2(f.opp_cost_usd).replace('−', '') + '</td></tr>' +
        '<tr class="total-row"><td><strong>Net value (ROI ' + f.roi.toFixed(2) + ')</strong></td><td class="num"><strong>' + money2(f.net_value_usd) + '</strong></td></tr>' +
        '</tbody></table>' +
        '<p class="hint match">' + (cv.match ? '✓ Browser recompute matches.' : '✗ Browser recompute differs.') + '</p>';
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
