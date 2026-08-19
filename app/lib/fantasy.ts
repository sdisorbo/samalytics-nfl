// Client-side fantasy scoring + Wins Above Replacement engine.
// Raw per-week component stats ship in data/fantasy.json; everything below —
// fantasy points, replacement level, and WAR — is computed here from the user's
// league settings, so changing any setting re-ranks the whole table live.
import fantasy from "../../data/fantasy.json";

export type PlayerRaw = { id: string; name: string; pos: string; team: string; hs: string; w: number[][] };
export type DstRaw = { team: string; w: number[][] };
export type SeasonRaw = { players: PlayerRaw[]; dst: DstRaw[] };
type FantasyFile = { seasons: string[]; updated: string; data: Record<string, SeasonRaw> };

const FILE = fantasy as unknown as FantasyFile;
export const FANTASY_SEASONS: string[] = FILE.seasons;
export const FANTASY_UPDATED: string = FILE.updated;
export const FANTASY_DEFAULT_SEASON: string = FILE.seasons[FILE.seasons.length - 1];

// ── settings ─────────────────────────────────────────────────────────────────
export type Scoring = {
  passYd: number; passTd: number; int: number;
  rushYd: number; rushTd: number;
  recYd: number; recTd: number; rec: number;
  twoPt: number; fum: number; retTd: number;
  fg0: number; fg40: number; fg50: number; xp: number; fgMiss: number; xpMiss: number;
  dSack: number; dInt: number; dFum: number; dTd: number; dRetTd: number; dSafety: number; dBlk: number;
  paTiers: { max: number; pts: number }[];
};
export type Roster = { teams: number; qb: number; rb: number; wr: number; te: number; flex: number; k: number; dst: number };
export type Settings = { scoring: Scoring; roster: Roster };

export const DEFAULT_SCORING: Scoring = {
  passYd: 0.04, passTd: 4, int: -2,
  rushYd: 0.1, rushTd: 6,
  recYd: 0.1, recTd: 6, rec: 0.5,     // half-PPR
  twoPt: 2, fum: -2, retTd: 0,        // skill-player return TDs credited to D/ST by default
  fg0: 3, fg40: 4, fg50: 5, xp: 1, fgMiss: -1, xpMiss: -1,
  dSack: 1, dInt: 2, dFum: 2, dTd: 6, dRetTd: 6, dSafety: 2, dBlk: 2,
  paTiers: [
    { max: 0, pts: 10 }, { max: 6, pts: 7 }, { max: 13, pts: 4 }, { max: 20, pts: 1 },
    { max: 27, pts: 0 }, { max: 34, pts: -1 }, { max: 99, pts: -4 },
  ],
};
export const DEFAULT_ROSTER: Roster = { teams: 12, qb: 1, rb: 2, wr: 2, te: 1, flex: 2, k: 1, dst: 1 };
export const DEFAULT_SETTINGS: Settings = { scoring: DEFAULT_SCORING, roster: DEFAULT_ROSTER };

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"] as const;
export type Pos = (typeof POSITIONS)[number];

// ── weekly scoring ───────────────────────────────────────────────────────────
// offense comps: [wk, passYd, passTd, int, pass2, rushYd, rushTd, rush2, rec, recYd, recTd, rec2, fumLost, retTd]
function scoreOff(w: number[], s: Scoring): number {
  return w[1] * s.passYd + w[2] * s.passTd + w[3] * s.int + w[4] * s.twoPt
    + w[5] * s.rushYd + w[6] * s.rushTd + w[7] * s.twoPt
    + w[8] * s.rec + w[9] * s.recYd + w[10] * s.recTd + w[11] * s.twoPt
    + w[12] * s.fum + w[13] * s.retTd;
}
// kicker comps: [wk, fg0_39, fg40_49, fg50p, xp, fgMiss, xpMiss]
function scoreK(w: number[], s: Scoring): number {
  return w[1] * s.fg0 + w[2] * s.fg40 + w[3] * s.fg50 + w[4] * s.xp + w[5] * s.fgMiss + w[6] * s.xpMiss;
}
// dst comps: [wk, ptsAllowed, sack, int, fumrec, deftd, sttd, safety, blk]
function paScore(pa: number, tiers: Scoring["paTiers"]): number {
  for (const t of tiers) if (pa <= t.max) return t.pts;
  return tiers[tiers.length - 1].pts;
}
function scoreDst(w: number[], s: Scoring): number {
  return paScore(w[1], s.paTiers) + w[2] * s.dSack + w[3] * s.dInt + w[4] * s.dFum
    + w[5] * s.dTd + w[6] * s.dRetTd + w[7] * s.dSafety + w[8] * s.dBlk;
}

// ── normal CDF for the win-probability conversion ────────────────────────────
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

function variance(a: number[]): number {
  if (a.length < 2) return 0;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1);
}

export type FantasyRow = {
  id: string; name: string; pos: Pos; team: string; hs: string;
  g: number; pts: number; ppg: number; repl: number; vorp: number; war: number;
};

// how the FLEX slots split across RB/WR/TE, given each position's starter pool
function flexSplit(pools: Record<string, { total: number; pos: string }[]>, ded: Record<string, number>, flexN: number) {
  const rest: { total: number; pos: string }[] = [];
  for (const p of ["RB", "WR", "TE"]) rest.push(...pools[p].slice(ded[p]).map((x) => ({ total: x.total, pos: p })));
  rest.sort((a, b) => b.total - a.total);
  const add: Record<string, number> = { RB: 0, WR: 0, TE: 0 };
  for (const x of rest.slice(0, flexN)) add[x.pos]++;
  return add;
}

export function computeWar(season: string, settings: Settings): FantasyRow[] {
  const sd = FILE.data[season];
  if (!sd) return [];
  const { scoring: s, roster: r } = settings;

  // 1. weekly points + season aggregates for every player (incl. D/ST)
  type Agg = { id: string; name: string; pos: Pos; team: string; hs: string; wk: number[]; total: number };
  const aggs: Agg[] = [];
  for (const p of sd.players) {
    const scorer = p.pos === "K" ? scoreK : scoreOff;
    const wk = p.w.map((w) => scorer(w, s));
    aggs.push({ id: p.id, name: p.name, pos: p.pos as Pos, team: p.team, hs: p.hs, wk, total: wk.reduce((a, b) => a + b, 0) });
  }
  for (const d of sd.dst) {
    const wk = d.w.map((w) => scoreDst(w, s));
    aggs.push({ id: `DST-${d.team}`, name: `${d.team} D/ST`, pos: "DST", team: d.team, hs: "", wk, total: wk.reduce((a, b) => a + b, 0) });
  }

  // 2. per-position pools sorted by season total
  const pools: Record<string, Agg[]> = {};
  for (const pos of POSITIONS) pools[pos] = aggs.filter((a) => a.pos === pos).sort((a, b) => b.total - a.total);

  // 3. replacement rank per position (dedicated starters + FLEX share), then a
  //    waiver-tier baseline = mean per-game of the next `teams` players
  const ded: Record<string, number> = {
    QB: r.teams * r.qb, RB: r.teams * r.rb, WR: r.teams * r.wr,
    TE: r.teams * r.te, K: r.teams * r.k, DST: r.teams * r.dst,
  };
  const add = flexSplit(pools, ded, r.teams * r.flex);
  const starters: Record<string, number> = { ...ded, RB: ded.RB + add.RB, WR: ded.WR + add.WR, TE: ded.TE + add.TE };

  const repl: Record<string, number> = {};
  for (const pos of POSITIONS) {
    const pool = pools[pos];
    const start = starters[pos];
    const tier = pool.slice(start, start + r.teams);
    const ppgs = tier.map((a) => (a.wk.length ? a.total / a.wk.length : 0));
    repl[pos] = ppgs.length ? ppgs.reduce((a, b) => a + b, 0) / ppgs.length
      : pool.length ? pool[pool.length - 1].total / Math.max(1, pool[pool.length - 1].wk.length) : 0;
  }

  // 4. team weekly score spread σ (sum of starting-slot weekly variances)
  const posVar: Record<string, number> = {};
  for (const pos of POSITIONS) {
    const wkPts: number[] = [];
    for (const a of pools[pos].slice(0, Math.max(1, starters[pos]))) wkPts.push(...a.wk);
    posVar[pos] = variance(wkPts);
  }
  const flexVar = (posVar.RB + posVar.WR + posVar.TE) / 3;
  const teamVar = r.qb * posVar.QB + r.rb * posVar.RB + r.wr * posVar.WR + r.te * posVar.TE
    + r.k * posVar.K + r.dst * posVar.DST + r.flex * flexVar;
  const den = Math.max(18, Math.sqrt(Math.max(1, teamVar))) * Math.SQRT2;

  // 5. WAR = Σ weekly [Φ(PAR/den) − 0.5]
  const rows: FantasyRow[] = aggs.map((a) => {
    const rp = repl[a.pos];
    let war = 0;
    for (const wp of a.wk) war += Phi((wp - rp) / den) - 0.5;
    const g = a.wk.length;
    return {
      id: a.id, name: a.name, pos: a.pos, team: a.team, hs: a.hs,
      g, pts: a.total, ppg: g ? a.total / g : 0,
      repl: rp, vorp: a.total - rp * g, war,
    };
  });
  rows.sort((x, y) => y.war - x.war);
  return rows;
}
