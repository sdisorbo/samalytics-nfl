// Client-side loaders for the search index and player/team page data. Everything
// lives in /public and is fetched on demand (cached per module) so it never
// bloats the shared bundle.

export type IndexPlayer = { id: string; name: string; pos: string; team: string };
export type SearchIndex = { players: IndexPlayer[]; teams: string[]; updated: string };

export type SeasonStat = Record<string, number>;
export type PlayerRec = {
  id: string; name: string; pos: string; grp: string; team: string; hs: string;
  seasons: Record<string, SeasonStat>;
  tms: Record<string, string>;   // year -> team that season (players change teams)
};
export type PlayersFile = { updated: string; seasons: string[]; players: Record<string, PlayerRec> };

// receiving target: [lane(0/1/2), airYards, catch(0/1), epa, yards]
export type Target = number[];
export type TargetsFile = { updated: string; seasons: string[]; data: Record<string, Record<string, Target[]>> };
// rushing: gap -> [attempts, yards, epaSum]
export type RushGaps = Record<string, number[]>;
export type RushesFile = { updated: string; seasons: string[]; data: Record<string, Record<string, RushGaps>> };

function cached<T>(url: string): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= fetch(url).then((r) => r.json() as Promise<T>));
}

// league baselines / team defense (for league-relative coloring + team D maps)
export type ZoneLeague = { z: number[][]; N: number };   // z: 21 zones of [n, compSum, epaSum, ydsSum]
export type GapLeague = { g: Record<string, number[]>; N: number };
export type FieldLeagueFile = { seasons: string[]; pass: Record<string, ZoneLeague>; rush: Record<string, GapLeague> };
export type TeamDefZonesFile = { seasons: string[]; data: Record<string, Record<string, ZoneLeague>> };
export type TeamDefGapsFile = { seasons: string[]; data: Record<string, Record<string, GapLeague>> };

export const loadIndex = cached<SearchIndex>("/search_index.json");
export const loadPlayers = cached<PlayersFile>("/players.json");
export const loadTargets = cached<TargetsFile>("/targets.json");
export const loadPasses = cached<TargetsFile>("/passes.json");
export const loadRushes = cached<RushesFile>("/rushes.json");
export const loadFieldLeague = cached<FieldLeagueFile>("/field_league.json");
export const loadTeamPassDef = cached<TeamDefZonesFile>("/team_passdef.json");
export const loadTeamRushDef = cached<TeamDefGapsFile>("/team_rushdef.json");

export const GAP_ORDER = ["LE", "LT", "LG", "M", "RG", "RT", "RE"] as const;
export const GAP_LABEL: Record<string, string> = {
  LE: "Left End", LT: "Left Tackle", LG: "Left Guard", M: "Middle",
  RG: "Right Guard", RT: "Right Tackle", RE: "Right End",
};

// which stat columns a position group shows, in order: [key, label]
export const STAT_COLUMNS: Record<string, [string, string][]> = {
  QB: [["g", "G"], ["cmp", "Cmp"], ["att", "Att"], ["py", "Pass Yds"], ["ptd", "TD"], ["intc", "Int"],
       ["sk", "Sk"], ["pepa", "EPA/att"], ["car", "Rush"], ["ry", "Rush Yds"], ["rtd", "Rush TD"], ["repa", "EPA/car"]],
  RB: [["g", "G"], ["car", "Att"], ["ry", "Rush Yds"], ["rtd", "TD"], ["repa", "EPA/car"],
       ["tgt", "Tgt"], ["rec", "Rec"], ["recy", "Rec Yds"], ["rectd", "Rec TD"], ["recepa", "EPA/tgt"]],
  WR: [["g", "G"], ["tgt", "Tgt"], ["rec", "Rec"], ["recy", "Rec Yds"], ["rectd", "TD"], ["ay", "Air Yds"],
       ["yac", "YAC"], ["recepa", "EPA/tgt"], ["car", "Rush"], ["ry", "Rush Yds"]],
  TE: [["g", "G"], ["tgt", "Tgt"], ["rec", "Rec"], ["recy", "Rec Yds"], ["rectd", "TD"], ["ay", "Air Yds"],
       ["yac", "YAC"], ["recepa", "EPA/tgt"]],
  K:  [["g", "G"], ["fgm", "FGM"], ["fga", "FGA"], ["fgl", "Long"], ["xpm", "XPM"], ["xpa", "XPA"]],
  DEF: [["g", "G"], ["tkl", "Tkl"], ["solo", "Solo"], ["sk", "Sacks"], ["tfl", "TFL"], ["qbh", "QB Hit"],
        ["intc", "Int"], ["pd", "PD"], ["ff", "FF"], ["dtd", "TD"]],
  OL: [["g", "G"], ["osnp", "Off Snaps"]],
  ST: [["g", "G"], ["stsnp", "ST Snaps"], ["osnp", "Off Snaps"], ["dsnp", "Def Snaps"]],
};

// EPA columns are stored as season totals; divide by these play counts to show EPA per play
export const EPA_DENOM: Record<string, string> = { pepa: "att", repa: "car", recepa: "tgt" };

export const HAS_RECEIVING_MAP = new Set(["WR", "TE", "RB"]);
export const HAS_RUSHING_MAP = new Set(["RB"]);
export const HAS_PASSING_MAP = new Set(["QB"]);
