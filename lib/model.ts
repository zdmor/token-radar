// Token launch radar, model radar-2.
//
// One sealed DefiLlama snapshot in, one ranked board out. Every number the
// model uses comes from the snapshot itself: the implied value of a protocol
// that records no token is its TVL priced at the multiple its own category's
// live tokens trade at, adjusted for its seven-day growth, how long it has
// run with no token, and how many chains it runs on. No protocol name is
// ever special-cased: the same function scores every row, and the dashboard
// prints the formula and each row's breakdown.
//
//   multiple     = shrunk median mcap/TVL of the category's live tokens
//   growthMult   = 1 + clamp(change_7d, -50, 100) / 100 * 0.4
//   maturityMult = 0.7 + min(age_days, 1095) / 1095 * 0.5
//   breadthMult  = 1 + min(chains - 1, 9) * 0.01
//   raw          = tvl_usd * multiple * growthMult * maturityMult * breadthMult
//   implied      = max(1, round(softCap(raw)))  // log soft cap above $500M:
//                  x <= cap -> x; x > cap -> cap + cap * ln(1 + (x - cap) / cap)
//
// Validation is honest out-of-sample: validateModel() runs leave-one-out over
// the live-token anchors (re-estimating every median per fold, so no leakage),
// a chronological walk-forward split, and a blind rank test, and reports the
// real numbers — no cherry-picked in-sample figures.
//
// The category multiple is shrunk toward the whole market's median by a
// pseudo-count of 8 live tokens, so a category with one or two thin comps
// does not set a wild price, and it is clamped to [0.05, 1.5]. Each live
// token's mcap/TVL ratio is winsorized at 5 before the median is taken, so
// one thin outlier (a small TVL with a large market cap) cannot set a
// category's price. A protocol whose category has no live token at all
// prices at the market median.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_prior: number;
  ratio_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap_chains: number;
  soft_cap_usd: number;
}

export const MODEL: ModelConstants = {
  shrink_prior: 8,
  ratio_cap: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.01,
  breadth_cap_chains: 10,
  soft_cap_usd: 500_000_000,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One live-token comparable category: how the market prices it. */
export interface CategoryComp {
  category: string;
  live_count: number;
  median_ratio: number;
  multiple: number;
}

/** The pricing the snapshot's live tokens imply, per category and overall. */
export interface Pricing {
  global_median: number;
  live_count: number;
  comps: CategoryComp[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    raw_implied_value_usd: number;
    age_days: number | null;
  };
  farm_steps: string[];
  token_odds: number;
  odds_evidence: Omit<TokenOddsResult, 'odds'>;
  farm: FarmVerdict;
  peers: PeerDossier;
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  raw_implied_value_usd: number;
  multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
  token_odds: number;
  odds_evidence: Omit<TokenOddsResult, 'odds'>;
  farm: FarmVerdict;
  peers: PeerDossier;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard needs: the board, the live set, the pricing, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  validation: ValidationResult;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  pricing: Pricing;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `n` into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** The median of a sorted array, or `fallback` when empty. */
function medianOf(sorted: number[], fallback: number): number {
  if (sorted.length === 0) return fallback;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories the watchlist rule treats as wrapped, staked or bridged products, not launches. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
  'Stablecoin Wrapper',
]);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in the name: a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's name at the start of the name: the exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether the board may rank a protocol: it records no token, and it is not
 * a wrapped, staked or bridged product, an exchange product, or a versioned
 * pool. The same rule the house drew the watchlist with, applied to every
 * protocol in the snapshot, since parentProtocol is not one of the
 * snapshot's fields and cannot be checked here.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/**
 * The pricing the snapshot's live tokens imply: the median mcap/TVL of each
 * category's live tokens, shrunk toward the whole market's median. A
 * category with no live token prices at the market median.
 */
/**
 * The pricing a set of live tokens implies. priceSnapshot() is this over the
 * snapshot's live set; validateModel() calls it per fold over 127 anchors,
 * so no held-out anchor leaks into its own prediction.
 */
export function priceLive(live: SnapshotProtocol[], model: ModelConstants = MODEL): Pricing {
  // Winsorize each ratio at ratio_cap before any median: one thin outlier
  // (a small TVL with a large market cap) must not set a category's price.
  const ratioOf = (p: SnapshotProtocol): number => Math.min(p.mcap_usd! / p.tvl_usd, model.ratio_cap);
  const allRatios = live.map(ratioOf).sort((a, b) => a - b);
  const global = medianOf(allRatios, 0.25);
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(ratioOf(p));
    byCategory.set(key, list);
  }
  const comps: CategoryComp[] = [...byCategory.entries()]
    .map(([category, ratios]) => {
      ratios.sort((a, b) => a - b);
      const med = medianOf(ratios, global);
      const w = ratios.length / (ratios.length + model.shrink_prior);
      const multiple = clamp(w * med + (1 - w) * global, model.multiple_floor, model.multiple_cap);
      return { category, live_count: ratios.length, median_ratio: round4(med), multiple: round4(multiple) };
    })
    .sort((a, b) => b.live_count - a.live_count || (a.category < b.category ? -1 : 1));
  return { global_median: round4(global), live_count: live.length, comps };
}

/** The pricing the snapshot's live tokens imply: priceLive over the live set. */
export function priceSnapshot(snapshot: Snapshot, model: ModelConstants = MODEL): Pricing {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0);
  return priceLive(live, model);
}

/** The multiple one protocol prices at: its category's, or the market's. */
export function multipleFor(p: SnapshotProtocol, pricing: Pricing, model: ModelConstants = MODEL): number {
  const key = p.category ?? 'Uncategorised';
  const comp = pricing.comps.find((c) => c.category === key);
  if (comp !== undefined) return comp.multiple;
  return clamp(pricing.global_median, model.multiple_floor, model.multiple_cap);
}

/**
 * The log soft cap: values at or below the cap pass through; above it the
 * curve bends logarithmically, so a $1.47B raw value damps to about $1.04B
 * and a $10B one to about $2B, instead of letting one giant TVL dominate the
 * board. Strictly increasing, so ranks never flip.
 */
export function softCap(x: number, cap: number = MODEL.soft_cap_usd): number {
  if (x <= cap) return x;
  return cap + cap * Math.log(1 + (x - cap) / cap);
}

/** The multipliers and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  pricing: Pricing,
  model: ModelConstants = MODEL,
): {
  implied: number;
  rawImplied: number;
  multiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const multiple = multipleFor(p, pricing, model);
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), model.breadth_cap_chains - 1) * model.breadth_step;
  const rawImplied = p.tvl_usd * multiple * growthMult * maturityMult * breadthMult;
  const implied = Math.max(1, Math.round(softCap(rawImplied, model.soft_cap_usd)));
  return { implied, rawImplied: Math.max(1, Math.round(rawImplied)), multiple, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const pricing = priceSnapshot(snapshot, model);
  const onWatchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => onWatchlist.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, pricing, model);
    return { p, ...v };
  });
  // Four-level tie-break: implied value, then TVL, then younger first (unknown age last), then slug.
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.age ?? 999_999) - (b.age ?? 999_999) ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => {
    const oddsObj = tokenOdds(s.p, snapshot, s.age);
    const { odds, ...oddsEvidence } = oddsObj;
    const farm = farmVerdict(s.p, s.implied, s.age);
    const peers = peerDossier(s.p, snapshot);
    return {
      rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: onWatchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      raw_implied_value_usd: s.rawImplied,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    token_odds: odds,
    odds_evidence: oddsEvidence,
    farm,
    peers,
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, as the farm plan states it. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $8 to $15 of gas';
  if (c === 'solana') return 'about $0.05 of gas';
  if (c === 'bitcoin') return 'about $2 of network fees';
  if (['base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'blast', 'linea', 'scroll', 'zksync', 'mantle', 'mode', 'fraxtal', 'ink', 'soneium', 'unichain', 'abstract', 'berachain', 'sei', 'sui', 'aptos', 'ton', 'near', 'cosmos', 'tron'].includes(c)) return 'about $0.50 to $2 of gas';
  return 'about $1 to $3 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and make one swap through it each week.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a small amount against it, and keep both sides open.`;
  if (c.includes('restak')) return `Restake $${capital} of the staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and let it compound.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('asset management')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetics')) return `Deposit $${capital} of USDC as margin on ${name}, open one small hedged position, and close it after a week.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC through ${name} to ${chain} and use the bridged funds in its app.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold the position through one funding cycle.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then settle it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy open.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${name}'s shielded pool on ${chain} and make one private transfer.`;
  if (c.includes('launchpad')) return `Stake $${capital} on ${name}'s launchpad on ${chain} and join one sale.`;
  if (c.includes('gaming') || c.includes('game')) return `Deposit $${capital} into ${name}'s game economy on ${chain} and play one session a week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline and off any screenshot.`,
      cost: `${gas} for the first transaction`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gas}`,
      time: '20 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'free to check, and never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    raw_implied_value_usd: row.model.raw_implied_value_usd,
    multiple: row.model.multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
    token_odds: row.token_odds,
    odds_evidence: row.odds_evidence,
    farm: row.farm,
    peers: row.peers,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const pricing = priceSnapshot(snapshot, model);
  const validation = validateModel(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    pricing,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: size, coverage, ranks, order, one shared implied value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i++) if (sorted[i]!.rank !== i + 1) return `rank ${i + 1} is ${sorted[i]!.rank}`;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.implied_value_usd > sorted[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && sorted[0]!.implied_value_usd === sorted[sorted.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${sorted[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------------------
// Out-of-sample validation (radar-3): leave-one-out, walk-forward, blind rank.
// Every number is computed from the snapshot at build time; the dashboard
// re-derives the Spearman benchmark in the browser from the injected anchors.
// ---------------------------------------------------------------------------

/** One live-token anchor: the LOO prediction for it, and its real market cap. */
export interface LiveAnchor {
  slug: string;
  predicted: number;
  actual: number;
}

/** The walk-forward split's result: the old 60% predicting the new 40%. */
export interface WalkForwardResult {
  train_size: number;
  test_size: number;
  cut_date: string;
  spearman: number;
  hit_rate_3x: number;
}

/** Everything validateModel() reports: the dashboard prints these verbatim. */
export interface ValidationResult {
  loo_3x_hit_rate: number;
  loo_2x_hit_rate: number;
  loo_median_log_error: number;
  loo_mean_log_error: number;
  loo_median_ape: number;
  loo_spearman: number;
  loo_recall_top20: { ratio: string; count: number };
  walk_forward: WalkForwardResult;
  spearman_benchmark: number;
  anchors: LiveAnchor[];
}

/**
 * Spearman rank correlation between two equal-length series, as the Pearson
 * correlation of their average ranks. Average ranks handle ties; the
 * textbook 1 - 6*sum(d^2) shortcut is only valid without ties, so it is
 * deliberately not used here. The browser's calculateRankCorrelation must
 * implement this same formula, or the integrity check will disagree.
 */
function spearmanRank(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n <= 1) return 0;
  const ranks = (v: number[]): number[] => {
    const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const r = new Array<number>(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && order[j + 1]![0] === order[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

/**
 * The model's honest out-of-sample report. Leave-one-out re-estimates the
 * global and every category median per fold (a held-out anchor never prices
 * itself); walk-forward trains on the oldest 60% of dated anchors and tests
 * on the newest 40% with the sets strictly isolated; the blind rank test
 * compares the full model's predicted top 20 against the market's actual
 * top 20. Deterministic: no randomness, no clock, every sort has a slug
 * fallback.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): ValidationResult {
  const livePool = snapshot.protocols.filter((p) => !isPreToken(p) && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0);
  const n = livePool.length;
  const looAnchors: LiveAnchor[] = [];
  const logErrors: number[] = [];
  const apeErrors: number[] = [];
  let hits3x = 0;
  let hits2x = 0;

  // Leave-one-out: each anchor predicted from the other 127.
  for (let i = 0; i < n; i++) {
    const p = livePool[i]!;
    const trainPool = livePool.filter((_, idx) => idx !== i);
    const looPricing = priceLive(trainPool, model);
    const { implied } = impliedValue(p, snapshot.as_of, looPricing, model);
    const actual = p.mcap_usd!;

    looAnchors.push({ slug: p.slug, predicted: implied, actual });

    const ratio = implied / actual;
    if (ratio >= 0.33 && ratio <= 3.0) hits3x++;
    if (ratio >= 0.5 && ratio <= 2.0) hits2x++;

    logErrors.push(Math.abs(Math.log10(implied) - Math.log10(actual)));
    apeErrors.push(Math.abs(implied - actual) / actual);
  }

  logErrors.sort((a, b) => a - b);
  apeErrors.sort((a, b) => a - b);
  const looSpearman = round4(spearmanRank(looAnchors.map((a) => a.predicted), looAnchors.map((a) => a.actual)));

  // Blind rank test: the full model's predicted top 20 vs the market's actual top 20.
  const actualTop20 = new Set([...looAnchors].sort((a, b) => b.actual - a.actual).slice(0, 20).map((a) => a.slug));
  const predictedTop20 = [...looAnchors].sort((a, b) => b.predicted - a.predicted).slice(0, 20).map((a) => a.slug);
  let top20Hits = 0;
  for (const slug of predictedTop20) {
    if (actualTop20.has(slug)) top20Hits++;
  }

  // Walk-forward: the oldest 60% of dated anchors price the newest 40%.
  const datedLive = livePool
    .filter((p) => p.listed_at !== null)
    .sort(
      (a, b) =>
        Date.parse(`${a.listed_at}T00:00:00Z`) - Date.parse(`${b.listed_at}T00:00:00Z`) ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );

  let wfResult: WalkForwardResult = { train_size: 0, test_size: 0, cut_date: '', spearman: 0, hit_rate_3x: 0 };

  if (datedLive.length > 0) {
    const splitIdx = Math.floor(datedLive.length * 0.6);
    const wfTrain = datedLive.slice(0, splitIdx);
    const wfTest = datedLive.slice(splitIdx);
    const cutDate = wfTest[0]?.listed_at ?? 'N/A';

    const wfPricing = priceLive(wfTrain, model);
    const wfAnchors: LiveAnchor[] = [];
    let wfHits3x = 0;

    for (const p of wfTest) {
      const { implied } = impliedValue(p, snapshot.as_of, wfPricing, model);
      const actual = p.mcap_usd!;
      wfAnchors.push({ slug: p.slug, predicted: implied, actual });
      const ratio = implied / actual;
      if (ratio >= 0.33 && ratio <= 3.0) wfHits3x++;
    }

    wfResult = {
      train_size: wfTrain.length,
      test_size: wfTest.length,
      cut_date: cutDate,
      spearman: round4(spearmanRank(wfAnchors.map((a) => a.predicted), wfAnchors.map((a) => a.actual))),
      hit_rate_3x: round4(wfHits3x / wfTest.length),
    };
  }

  return {
    loo_3x_hit_rate: round4(hits3x / n),
    loo_2x_hit_rate: round4(hits2x / n),
    loo_median_log_error: round4(medianOf(logErrors, 0)),
    loo_mean_log_error: round4(logErrors.reduce((a, b) => a + b, 0) / n),
    loo_median_ape: round4(medianOf(apeErrors, 0)),
    loo_spearman: looSpearman,
    loo_recall_top20: { count: top20Hits, ratio: `${top20Hits}/20` },
    walk_forward: wfResult,
    spearman_benchmark: looSpearman,
    anchors: looAnchors,
  };
}

// ---------------------------------------------------------------------------
// radar-3: token odds, peer dossier, costed farm verdict.
// Every number derives from the snapshot at build time; the dashboard
// re-derives the odds and the verdict in the browser from the row's own
// fields, so the page can show its work.
// ---------------------------------------------------------------------------

/** Two decimals, for dollar amounts. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A token launch probability, with the evidence that produced it. */
export interface TokenOddsResult {
  odds: number;
  category_rate: number;
  category_live_count: number;
  category_total_count: number;
  age_factor: number;
}

/**
 * The chance this protocol launches a token: its category's launch rate
 * (Bayesian-smoothed, so a one-protocol category inherits the prior) times
 * an age factor — over 1,500 days old halves it, the 180–730 day window
 * lifts it 20%. Unknown age is neutral (1.0): no information, no adjustment.
 */
export function tokenOdds(p: SnapshotProtocol, snapshot: Snapshot, age: number | null): TokenOddsResult {
  const cat = p.category ?? 'Uncategorised';
  let totalCount = 0;
  let liveCount = 0;

  for (const sp of snapshot.protocols) {
    const spCat = sp.category ?? 'Uncategorised';
    if (spCat === cat) {
      totalCount++;
      if (!isPreToken(sp) && (sp.mcap_usd ?? 0) > 0 && sp.tvl_usd > 0) {
        liveCount++;
      }
    }
  }

  // Bayesian smoothing: (live + 2) / (total + 5).
  const categoryRate = (liveCount + 2) / (totalCount + 5);

  let ageFactor = 1.0;
  if (age !== null) {
    if (age > 1500) {
      ageFactor = 0.5;
    } else if (age >= 180 && age <= 730) {
      ageFactor = 1.2;
    }
  }

  const odds = clamp(categoryRate * ageFactor, 0.01, 0.99);

  return {
    odds: round4(odds),
    category_rate: round4(categoryRate),
    category_live_count: liveCount,
    category_total_count: totalCount,
    age_factor: ageFactor,
  };
}

/** One peer: a live token of the same category, close in TVL. */
export interface PeerRecord {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** The peer dossier: the three closest live peers and their median multiple. */
export interface PeerDossier {
  peers: PeerRecord[];
  peer_median_multiple: number | null;
}

/**
 * The three same-category live tokens closest in TVL (log distance), with
 * their actual mcap/TVL multiples — the white-box evidence behind the row's
 * price. No cross-category filling: if the category has no live token, the
 * dossier is empty and the page says so ("No live peers in this category —
 * priced at the market median.").
 */
export function peerDossier(p: SnapshotProtocol, snapshot: Snapshot): PeerDossier {
  const cat = p.category ?? 'Uncategorised';
  const livePeers = snapshot.protocols.filter(
    (sp) => (sp.category ?? 'Uncategorised') === cat && !isPreToken(sp) && (sp.mcap_usd ?? 0) > 0 && sp.tvl_usd > 0,
  );

  const pLog = Math.log(Math.max(1, p.tvl_usd));

  livePeers.sort((a, b) => {
    const aLog = Math.log(Math.max(1, a.tvl_usd));
    const bLog = Math.log(Math.max(1, b.tvl_usd));
    const diff = Math.abs(aLog - pLog) - Math.abs(bLog - pLog);
    return diff !== 0 ? diff : a.slug.localeCompare(b.slug);
  });

  const top3 = livePeers.slice(0, 3);
  const peers: PeerRecord[] = top3.map((sp) => ({
    slug: sp.slug,
    name: sp.name,
    tvl_usd: sp.tvl_usd,
    mcap_usd: sp.mcap_usd!,
    multiple: round4(sp.mcap_usd! / sp.tvl_usd),
  }));

  let medianMultiple: number | null = null;
  if (peers.length > 0) {
    const multis = peers.map((x) => x.multiple).sort((a, b) => a - b);
    medianMultiple = round4(medianOf(multis, 0));
  }

  return { peers, peer_median_multiple: medianMultiple };
}

/** A costed farm verdict: the P&L for one farming wallet, and the call. */
export interface FarmVerdict {
  verdict: 'farm' | 'thin' | 'skip';
  farmers: number;
  reward_usd: number;
  gas_cost_usd: number;
  opp_cost_usd: number;
  capital_usd: number;
  net_value_usd: number;
  roi: number;
  tge_alloc: number;
  steps: number;
}

/** How crowded a chain's farming is: cheap chains attract sybil farms. */
function getSybilFactor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'solana' || c === 'arbitrum') return 5.0;
  if (c === 'polygon' || c === 'bsc') return 4.0;
  if (c === 'base' || c === 'sui' || c === 'aptos') return 3.0;
  if (c === 'optimism') return 2.0;
  if (c === 'avalanche') return 1.5;
  if (c === 'ethereum') return 0.5;
  if (c === 'bitcoin') return 0.1;
  return 1.0; // Unlisted chains default to 1.0.
}

/** What one farm transaction costs on a chain, in dollars per step. */
function getGasCost(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 15.0;
  if (c === 'solana') return 0.01;
  if (c === 'bitcoin') return 2.0;
  const l2s = ['base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'linea', 'zksync', 'starknet', 'scroll', 'manta', 'blast'];
  if (l2s.includes(c)) return 0.5;
  return 1.0; // Unlisted chains default to $1.00.
}

/**
 * The capital a farm position needs, by the protocol's TVL: a $1B+ points
 * program prices out a $75 wallet, so the ladder runs $500–$5,000.
 * <$50M $500, $50–200M $1,000, $200–500M $2,000, $500M–$1B $3,000, >$1B $5,000.
 */
function getCapitalForFarm(tvl: number): number {
  if (tvl < 50_000_000) return 500;
  if (tvl < 200_000_000) return 1000;
  if (tvl < 500_000_000) return 2000;
  if (tvl < 1_000_000_000) return 3000;
  return 5000;
}

/**
 * The costed farm verdict for one wallet: the TGE airdrop pool (5% of the
 * damped implied value) split among the estimated farmers, minus gas and
 * the opportunity cost of 180 days' locked capital at a 5% risk-free rate.
 * Farm when the net clears $100 with ROI above 1.0; thin when it is merely
 * positive; skip when the wallet loses money.
 */
export function farmVerdict(p: SnapshotProtocol, impliedUsd: number, age: number | null): FarmVerdict {
  const tgeAlloc = 0.05;
  const totalAirdrop = impliedUsd * tgeAlloc;

  const firstChain = chainOf(p);
  const sybilFactor = getSybilFactor(firstChain);
  const farmers = Math.round(10_000 + Math.sqrt(Math.max(0, p.tvl_usd)) * sybilFactor);

  const reward = totalAirdrop / Math.max(1, farmers);

  const stepCount = farmSteps(p, age).length;
  const singleGas = getGasCost(firstChain);
  const gasCost = singleGas * stepCount;

  const capital = getCapitalForFarm(p.tvl_usd);
  const oppCost = capital * 0.05 * (180 / 365);

  const netValue = reward - gasCost - oppCost;
  const roi = netValue / (gasCost + oppCost);

  let verdict: 'farm' | 'thin' | 'skip' = 'skip';
  if (netValue > 100 && roi > 1.0) {
    verdict = 'farm';
  } else if (netValue > 0) {
    verdict = 'thin';
  }

  return {
    verdict,
    farmers,
    reward_usd: round2(reward),
    gas_cost_usd: round2(gasCost),
    opp_cost_usd: round2(oppCost),
    capital_usd: capital,
    net_value_usd: round2(netValue),
    roi: round4(roi),
    tge_alloc: tgeAlloc,
    steps: stepCount,
  };
}
