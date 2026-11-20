// Token launch radar: the scoring model.
//
// One sealed snapshot goes in, one ranked board comes out. The board carries
// every protocol that records no token of its own and is not a wrapped,
// staked, bridged or exchange-issued stand-in for a token that already
// trades: the house watchlist in full, plus every other protocol under the
// watchlist's TVL floor that fits the same definition.
//
// A row's implied value is built only from figures the snapshot itself
// carries, in four moves:
//   peer price  the median market-cap-to-TVL ratio of the protocols in the
//               same category whose token already trades (four or more of
//               them), or the snapshot-wide live median when the category
//               has too few; either way the multiple is held in [0.05, 0.60].
//   growth      the seven-day TVL change bent through a logarithm, so a
//               +120% week lands on a score of 1 and even a +4,448% week
//               only reaches the cap instead of running away with the board.
//   maturity    a ramp from 0.6 to 1.0 across the first three years the
//               protocol has been tracked; an unknown listing date counts
//               as one year, neither the best nor the worst case.
//   breadth     three per cent for each chain past the first, up to four
//               extra chains: a launch reaches more wallets on more chains.
// implied = max(1, round(TVL x peer multiple x growth x maturity x breadth)).
// No protocol is ever named in this file: one function scores them all, and
// the dashboard repeats the same arithmetic in the page so any reader can
// check any row against board.json.

/** One protocol exactly as the sealed snapshot records it: ten fields. */
export interface ProtocolRecord {
  slug: string; name: string;
  category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
}

/** The snapshot document: its date, its provenance, its floor, its rows. */
export interface SnapshotDoc {
  as_of: string; source: string; floor_usd: number;
  protocols: ProtocolRecord[]; watchlist: string[];
}

/** The model's knobs, named once here; the dashboard prints them verbatim. */
export interface Tuning {
  growth_weight: number; growth_log_base: number;
  growth_floor: number; growth_cap: number;
  maturity_floor: number; maturity_range: number;
  maturity_days: number; unknown_age_days: number;
  breadth_per_chain: number; breadth_max_chains: number;
  multiple_floor: number; multiple_cap: number; multiple_min_peers: number;
}

export const TUNING: Tuning = {
  growth_weight: 0.5, // share of the growth score that moves the price
  growth_log_base: 121, // a +120% week is a growth score of exactly 1
  growth_floor: -0.6, // the worst week the model will price
  growth_cap: 1.75, // the best week the model will price
  maturity_floor: 0.6, // a brand-new protocol still keeps 60% of its base
  maturity_range: 0.4, // the ramp adds the remaining 40% over time
  maturity_days: 1095, // three years to full maturity
  unknown_age_days: 365, // an unlisted age is read as one year
  breadth_per_chain: 0.03, // each extra chain adds 3%
  breadth_max_chains: 4, // breadth stops counting after four extra chains
  multiple_floor: 0.05, // no category prices under 5% of TVL
  multiple_cap: 0.6, // no category prices over 60% of TVL
  multiple_min_peers: 4, // a category needs four live peers to price itself
};

/** The model's name, printed by the dashboard and carried in its data. */
export const VERSION_LABEL = 'radar-2';

/** One farm action before it is flattened: the act, its price, its clock. */
export interface FarmAction { text: string; cost: string; time: string }

/** One ranked row of board.json, with the model's working shown beside it. */
export interface BoardEntry {
  rank: number; slug: string; name: string;
  category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number; growth_pct: number;
    growth_multiplier: number; maturity_multiplier: number;
    breadth_multiplier: number; live_peer_median: number;
    live_peer_count: number; age_days: number | null;
  };
  farm_steps: string[];
}

/** One ranked row as the dashboard receives it: the plan is rebuilt in-page. */
export interface CompactEntry {
  rank: number; slug: string; name: string;
  category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  age_days: number | null; implied_value_usd: number;
  base_multiple: number; growth_multiplier: number;
  maturity_multiplier: number; breadth_multiplier: number;
  live_peer_median: number; live_peer_count: number; watchlist: boolean;
}

/** A protocol whose token already trades: shown at the market's own value. */
export interface LiveEntry {
  slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number;
  mcap_usd: number | null; change_7d: number | null;
}

/** How one category's live peers price a token: their median mcap/TVL. */
export interface PeerMedian { category: string; median: number; count: number }

/** The dashboard's whole payload: board, live set, peer prices, the knobs. */
export interface RadarPayload {
  as_of: string; source: string; floor_usd: number;
  model: Tuning; model_version: string;
  watchlist_size: number; board_size: number;
  early_size: number; live_size: number;
  global_median: number; live_medians: PeerMedian[];
  rows: CompactEntry[]; live: LiveEntry[];
}

/** Raised when the snapshot is not a document this model can score. */
export class SnapshotProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotProblem';
  }
}

const MS_PER_DAY = 86_400_000;

/** `n` held inside [`lo`, `hi`]. */
const clampTo = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A value that is a usable number, or `fallback` when it is not. */
const asFinite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** The middle of a list of numbers, or the mean of the two middle ones. */
function medianOf(values: number[]): number {
  const ordered = values.slice().sort((x, y) => x - y);
  const half = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[half]!;
  return (ordered[half - 1]! + ordered[half]!) / 2;
}

/** Whole days between the listing date and the snapshot date; null if either is unusable. */
export function daysListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const stamp = (day: string): number => Date.parse(day + 'T00:00:00Z');
  const from = stamp(listedAt);
  const to = stamp(asOf);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const days = Math.floor((to - from) / MS_PER_DAY);
  return days < 0 ? 0 : days;
}

/** What the snapshot's trading protocols say a token is worth per TVL dollar. */
export interface Pricing { globalRaw: number; peers: Map<string, PeerMedian> }

export function peerPricing(snapshot: SnapshotDoc, tuning: Tuning): Pricing {
  const trading = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
  const ratiosByCategory = new Map<string, number[]>();
  for (const p of trading) {
    const key = p.category ?? 'Other';
    const bucket = ratiosByCategory.get(key);
    if (bucket === undefined) ratiosByCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
    else bucket.push(p.mcap_usd! / p.tvl_usd);
  }
  const peers = new Map<string, PeerMedian>();
  for (const [category, ratios] of ratiosByCategory) {
    if (ratios.length < tuning.multiple_min_peers) continue;
    peers.set(category, { category, median: clampTo(medianOf(ratios), tuning.multiple_floor, tuning.multiple_cap), count: ratios.length });
  }
  return { globalRaw: medianOf(trading.map((p) => p.mcap_usd! / p.tvl_usd)), peers };
}

/** The multiple one protocol is priced at, and the peer group behind it. */
export function multipleFor(p: ProtocolRecord, pricing: Pricing, tuning: Tuning): { multiple: number; peerMedian: number; peerCount: number } {
  const group = p.category === null ? undefined : pricing.peers.get(p.category);
  if (group !== undefined) return { multiple: group.median, peerMedian: group.median, peerCount: group.count };
  const global = clampTo(pricing.globalRaw, tuning.multiple_floor, tuning.multiple_cap);
  return { multiple: global, peerMedian: global, peerCount: 0 };
}

/** A seven-day change as the model reads it: log-bent, capped, and turned into a multiplier. */
export function growthFactors(change7d: number | null, tuning: Tuning): { pct: number; mult: number } {
  const raw = asFinite(change7d, 0);
  const bent = Math.sign(raw) * (Math.log(1 + Math.abs(raw)) / Math.log(tuning.growth_log_base));
  const score = clampTo(bent, tuning.growth_floor, tuning.growth_cap);
  return { pct: Math.round(raw * 100) / 100, mult: 1 + score * tuning.growth_weight };
}

/** Every factor of one protocol's price, and the price itself. */
export interface ScoreBreakdown {
  value: number; multiple: number; peerMedian: number; peerCount: number;
  growthPct: number; growthMult: number; maturityMult: number; breadthMult: number;
  age: number | null;
}

export function scoreProtocol(p: ProtocolRecord, asOf: string, pricing: Pricing, tuning: Tuning): ScoreBreakdown {
  const age = daysListed(asOf, p.listed_at);
  const priced = multipleFor(p, pricing, tuning);
  const growth = growthFactors(p.change_7d, tuning);
  const ageForRamp = age === null ? tuning.unknown_age_days : age;
  const rampShare = clampTo(ageForRamp, 0, tuning.maturity_days) / tuning.maturity_days;
  const maturityMult = tuning.maturity_floor + rampShare * tuning.maturity_range;
  const extraChains = clampTo(p.chains.length - 1, 0, tuning.breadth_max_chains);
  const breadthMult = 1 + extraChains * tuning.breadth_per_chain;
  const product = p.tvl_usd * priced.multiple * growth.mult * maturityMult * breadthMult;
  return {
    value: Math.max(1, Math.round(product)),
    multiple: priced.multiple, peerMedian: priced.peerMedian, peerCount: priced.peerCount,
    growthPct: growth.pct, growthMult: growth.mult,
    maturityMult, breadthMult, age,
  };
}

// A name that ends in a release marker belongs to another protocol's pool,
// not to a launch of its own: "… V2", "… v3", "… 2.0" and their kin.
const NAME_ENDS_IN_VERSION = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// Categories that are never a launch candidate: each is a pass-through
// product of some token that already trades, or an exchange's own shelf.
const STANDIN_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge', 'Canonical Bridge',
  'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX',
]);

// A name that opens with an exchange's name is that exchange's product.
const NAME_STARTS_WITH_EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

// A whole word that gives a stand-in away, anywhere in the name.
const NAME_HAS_STANDIN_WORD = /\b(wrapped|staked|staking)\b/i;

/** True when the record carries no token at all: no cap, no id, no symbol. */
export function hasNoToken(p: ProtocolRecord): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * True when the board may rank this protocol: it records no token, and it is
 * not a stand-in for one that trades. This is the watchlist's own definition
 * with the TVL floor taken off, so the same test guards the whole board and
 * a wrapped product can never outrank a genuine launch candidate.
 */
export function canRank(p: ProtocolRecord): boolean {
  if (!hasNoToken(p)) return false;
  if (p.category !== null && STANDIN_CATEGORIES.has(p.category)) return false;
  if (NAME_ENDS_IN_VERSION.test(p.name)) return false;
  if (NAME_HAS_STANDIN_WORD.test(p.name)) return false;
  if (NAME_STARTS_WITH_EXCHANGE.test(p.name)) return false;
  return true;
}

/** Scored candidates in board order: value first, slug to break the tie. */
function compareScored(x: { value: number; p: ProtocolRecord }, y: { value: number; p: ProtocolRecord }): number {
  if (x.value !== y.value) return y.value - x.value;
  if (x.p.slug === y.p.slug) return 0;
  return x.p.slug < y.p.slug ? -1 : 1;
}

/** The ranked board: every chosen protocol scored, ordered, and numbered. */
export function buildBoard(snapshot: SnapshotDoc, tuning: Tuning = TUNING): BoardEntry[] {
  const bySlug = new Map<string, ProtocolRecord>();
  for (const p of snapshot.protocols) bySlug.set(p.slug, p);
  const chosen = new Map<string, ProtocolRecord>();
  for (const slug of snapshot.watchlist) {
    const hit = bySlug.get(slug);
    if (hit !== undefined) chosen.set(slug, hit);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && canRank(p)) chosen.set(p.slug, p);
  }
  const pricing = peerPricing(snapshot, tuning);
  const scored = [...chosen.values()].map((p) => ({ p, ...scoreProtocol(p, snapshot.as_of, pricing, tuning) }));
  scored.sort(compareScored);
  return scored.map((s, i) => ({
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
    age_days: s.age,
    implied_value_usd: s.value,
    model: {
      base_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      breadth_multiplier: s.breadthMult,
      live_peer_median: s.peerMedian,
      live_peer_count: s.peerCount,
      age_days: s.age,
    },
    farm_steps: planFor(s.p, s.age).map(renderStep),
  }));
}

/** One action flattened to a single line, held inside the gate's 20..600 characters. */
export function renderStep(action: FarmAction): string {
  let line = action.text + ' Cost: ' + action.cost + '. Time: ' + action.time + '.';
  if (line.length > 600) line = line.slice(0, 596) + '...';
  if (line.length < 20) line += " Hold the position and check the protocol's own page.";
  return line;
}

/** The chain a protocol names first, or a neutral phrase when it names none. */
const firstChain = (p: ProtocolRecord): string => (p.chains.length > 0 ? p.chains[0]! : 'its main chain');

/** The chain a protocol names second, or null when it lives on one chain. */
const otherChain = (p: ProtocolRecord): string | null => (p.chains.length > 1 ? p.chains[1]! : null);

/** The size of one farm position, stepped down as the protocol's TVL falls. */
function stakeSize(p: ProtocolRecord): number {
  const steps: Array<[number, number]> = [[5_000_000_000, 250], [1_000_000_000, 150], [100_000_000, 100]];
  for (const [floor, amount] of steps) if (p.tvl_usd >= floor) return amount;
  return 50;
}

const GAS_BY_CHAIN: Record<string, string> = {
  ethereum: 'about $8 of gas',
  solana: 'about $0.05 of gas',
  binance: 'about $0.30 of gas',
  bsc: 'about $0.30 of gas',
  avalanche: 'about $1 of gas',
};
const HALF_DOLLAR_GAS: ReadonlySet<string> = new Set(['arbitrum', 'optimism', 'base', 'polygon', 'zksync era', 'blast', 'mode']);

/** What one transaction costs on a chain, as the dashboard states it: an estimate, never a quote. */
function gasText(chain: string): string {
  const key = chain.toLowerCase();
  if (HALF_DOLLAR_GAS.has(key)) return 'about $0.50 of gas';
  return GAS_BY_CHAIN[key] ?? 'about $2 of gas';
}

/** How long a position must sit, from the protocol's age: the young get the longest window. */
function holdFor(ageDays: number | null): number {
  if (ageDays === null) return 30;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

interface OpeningRule { needles: string[]; say: (name: string, capital: number, chain: string) => string }

// The opening move per category, in the order they are tried: the first
// rule whose needle appears in the category name writes the sentence.
const OPENING_RULES: OpeningRule[] = [
  { needles: ['lend', 'cdp', 'collateral'], say: (name, capital, chain) => 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.' },
  { needles: ['dex', 'yield', 'leveraged farm'], say: (name, capital, chain) => 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.' },
  { needles: ['bridge'], say: (name, capital, chain) => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.' },
  { needles: ['staking', 'restak'], say: (name, capital) => 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.' },
  { needles: ['perpetual', 'derivative'], say: (name, capital) => 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade.' },
  { needles: ['prediction'], say: (name, capital) => 'Fund $' + capital + ' and place one market position on ' + name + '.' },
  { needles: ['curator', 'allocator'], say: (name, capital, chain) => 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.' },
  { needles: ['stable'], say: (name, capital, chain) => 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.' },
  { needles: ['rwa'], say: (name, capital, chain) => 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.' },
  { needles: ['insurance'], say: (name, capital, chain) => 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.' },
];

/** The first move of a farm: what to do with the capital, in the category's own terms. */
function openingMove(p: ProtocolRecord, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const rule of OPENING_RULES) {
    if (rule.needles.some((needle) => category.includes(needle))) return rule.say(p.name, capital, chain);
  }
  return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
}

interface WeeklyRule { needles: string[]; say: (name: string, chain: string) => string }

// The weekly habit per category: a snapshot rewards returning, not arriving.
const WEEKLY_RULES: WeeklyRule[] = [
  { needles: ['dex', 'yield'], say: (name, chain) => 'Swap $25 through ' + name + ' on ' + chain + ' once a week, in either direction.' },
  { needles: ['lend', 'cdp', 'collateral'], say: (name) => 'Borrow $20 against the deposit on ' + name + ' once a week, then repay it the same day.' },
  { needles: ['bridge'], say: (name) => 'Bridge $25 through ' + name + ' once a week, even a small amount, and use the funds on the other side.' },
  { needles: ['staking', 'restak'], say: (name) => 'Add $10 to the stake on ' + name + ' once a week and keep every receipt.' },
  { needles: ['perpetual', 'derivative'], say: (name) => 'Place one small trade on ' + name + ' once a week and close it the same day.' },
  { needles: ['prediction'], say: (name) => 'Place one small market position on ' + name + ' once a week.' },
  { needles: ['stable'], say: (name) => 'Move $25 in and out of the stable asset on ' + name + ' once a week.' },
  { needles: ['rwa'], say: (name) => 'Check the yield accrual on ' + name + ' once a week and record the balance in the farm log.' },
];

/** The move to repeat every week, in the category's own terms. */
function weeklyMove(p: ProtocolRecord, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const rule of WEEKLY_RULES) {
    if (rule.needles.some((needle) => category.includes(needle))) return rule.say(p.name, chain);
  }
  return 'Use ' + p.name + ' once a week: a deposit, a swap, a vote or any action its app offers.';
}

/**
 * One protocol's farm plan: seven actions, each with its price and its
 * clock, all read off the protocol's own record (category, chains, TVL,
 * age). No name is written anywhere in the plan's making.
 */
export function planFor(p: ProtocolRecord, age: number | null): FarmAction[] {
  const chain = firstChain(p);
  const second = otherChain(p);
  const capital = stakeSize(p);
  const hold = holdFor(age);
  const gas = gasText(chain);
  const actions: FarmAction[] = [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, ' + 'and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: openingMove(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
    { text: weeklyMove(p, chain), cost: gas + ' a week', time: '10 minutes a week' },
  ];
  if (second !== null) {
    actions.push({
      text: 'Repeat the same position on ' + second + ", the protocol's second chain, so the activity is visible on both chains.",
      cost: '$' + Math.round(capital / 2) + ' of capital and ' + gasText(second),
      time: '15 minutes',
    });
  } else {
    actions.push({
      text: "Open the protocol's own points or rewards page once a week and finish one listed quest or task.",
      cost: 'no fee to check',
      time: '10 minutes a week',
    });
  }
  actions.push(
    {
      text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
      cost: 'the $' + capital + ' stays in the position',
      time: hold + ' days',
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return actions;
}

/** The trading protocols for the dashboard's live view: biggest market cap first, two dozen of them. */
export function liveSet(snapshot: SnapshotDoc): LiveEntry[] {
  const trading = snapshot.protocols.filter((p) => !hasNoToken(p) && p.category !== 'CEX');
  trading.sort((x, y) => (y.mcap_usd ?? 0) - (x.mcap_usd ?? 0) || y.tvl_usd - x.tvl_usd);
  return trading.slice(0, 24).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row squeezed for the page: the factors travel, the plan is rebuilt there. */
export function compactRow(row: BoardEntry, watchlist: ReadonlySet<string>): CompactEntry {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    live_peer_median: row.model.live_peer_median,
    live_peer_count: row.model.live_peer_count,
    watchlist: watchlist.has(row.slug),
  };
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** Board and payload together: everything the program writes comes from here. */
export function buildRadar(snapshot: SnapshotDoc, tuning: Tuning = TUNING): { board: BoardEntry[]; radar: RadarPayload } {
  const board = buildBoard(snapshot, tuning);
  const live = liveSet(snapshot);
  const pricing = peerPricing(snapshot, tuning);
  const watch = new Set(snapshot.watchlist);
  const medians = [...pricing.peers.values()];
  medians.sort((x, y) => y.count - x.count || (x.category < y.category ? -1 : 1));
  const radar: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: tuning,
    model_version: VERSION_LABEL,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    global_median: round4(pricing.globalRaw),
    live_medians: medians,
    rows: board.map((r) => compactRow(r, watch)),
    live,
  };
  return { board, radar };
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The snapshot read out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): SnapshotDoc {
  const fail = (why: string): never => {
    throw new SnapshotProblem(why);
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('snapshot.json is not a JSON object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) fail('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') fail('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) fail('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) fail('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) fail('snapshot.json has no watchlist of slugs');
  const protocols = (doc.protocols as unknown[]).map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) fail(`snapshot.json's protocol ${i} is not an object`);
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || numOrNull(p.tvl_usd) === null) {
      fail(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const record: ProtocolRecord = {
      slug: p.slug as string,
      name: p.name as string,
      category: strOrNull(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number,
      change_7d: numOrNull(p.change_7d),
      mcap_usd: numOrNull(p.mcap_usd),
      listed_at: strOrNull(p.listed_at),
      gecko_id: strOrNull(p.gecko_id),
      symbol: strOrNull(p.symbol),
    };
    return record;
  });
  return { as_of: doc.as_of as string, source: doc.source as string, floor_usd: doc.floor_usd as number, protocols, watchlist: doc.watchlist as string[] };
}

/** Why this board is not one the gate accepts, or null when it is. */
export function boardIssue(board: BoardEntry[], snapshot: SnapshotDoc): string | null {
  const covered = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((slug) => !covered.has(slug));
  if (missing.length > 0) {
    return 'the board misses ' + missing.length + ' watchlist slug' + (missing.length === 1 ? '' : 's') + ': ' + missing.slice(0, 5).join(', ');
  }
  const ranksInOrder = board.map((r) => r.rank).sort((x, y) => x - y);
  for (let i = 0; i < ranksInOrder.length; i++) {
    if (ranksInOrder[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranksInOrder[i];
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all ' + board.length + ' rows share the same implied value $' + board[0]!.implied_value_usd + ': a board that ranks nothing by value is not a ranking';
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return row.slug + ' has ' + row.farm_steps.length + ' farm steps';
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return row.slug + ' has a farm step of ' + step.length + ' characters';
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return row.slug + ' has implied value ' + row.implied_value_usd;
  }
  return null;
}

/** The dashboard's dataset as one script the page loads beside itself: no fetch, no network. */
export function dataScript(radar: RadarPayload): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}



