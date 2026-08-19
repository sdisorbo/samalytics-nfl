// All seasons load from combined files + a meta manifest, so adding a season
// needs no code changes -- just re-run scripts/build_data.py.
import eloAll from "../../data/elo.json";
import meta from "../../data/meta.json";

export type Season = string;

type MetaSeason = { code: string; label: string };
const META = meta as unknown as { seasons: MetaSeason[]; latest: string };

export const SEASONS: string[] = META.seasons.map((s) => s.code);
export const SEASON_LABEL: Record<string, string> = Object.fromEntries(META.seasons.map((s) => [s.code, s.label]));
export const DEFAULT_SEASON: string = META.latest ?? SEASONS[SEASONS.length - 1];

export type Odds = { make: number; div: number; conf: number; sb: number; won: number };
export type Rec = { w: number; l: number; t: number };
export type EloTeam = {
  abbr: string; name: string; logo: string | null;
  conf: string; division: string;
  seed: number | null; div_rank: number;
  elo: number; record: Rec; win_pct: number; pf: number; pa: number;
  made: boolean; odds: Odds;
};
export type TrendPoint = { date: string; rating: number };
export type BandPoint = { date: string; min: number; max: number; avg: number };
export type EloData = { season: string; teams: EloTeam[]; trend: Record<string, TrendPoint[]>; band: BandPoint[] };

export const ELO = eloAll as unknown as Record<string, EloData>;

// The odds ladder, shared by the standings table and any legend.
export const ODDS_STEPS: { key: keyof Odds; label: string; short: string }[] = [
  { key: "make", label: "Playoffs", short: "PO" },
  { key: "div", label: "Divisional", short: "DIV" },
  { key: "conf", label: "Conf Champ", short: "CONF" },
  { key: "sb", label: "Super Bowl", short: "SB" },
  { key: "won", label: "Win SB", short: "WIN" },
];
