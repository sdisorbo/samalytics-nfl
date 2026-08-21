// Client-side loaders for the search index and player/team page data. Everything
// lives in /public and is fetched on demand (cached per module) so it never
// bloats the shared bundle.

export type IndexPlayer = { id: string; name: string; pos: string; team: string };
export type SearchIndex = { players: IndexPlayer[]; teams: string[]; updated: string };

export type SeasonStat = Record<string, number>;
export type PlayerRec = {
  id: string; name: string; pos: string; grp: string; team: string; hs: string;
  seasons: Record<string, SeasonStat>;
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

export const loadIndex = cached<SearchIndex>("/search_index.json");
export const loadPlayers = cached<PlayersFile>("/players.json");
export const loadTargets = cached<TargetsFile>("/targets.json");
export const loadRushes = cached<RushesFile>("/rushes.json");

export const GAP_ORDER = ["LE", "LT", "LG", "M", "RG", "RT", "RE"] as const;
export const GAP_LABEL: Record<string, string> = {
  LE: "Left End", LT: "Left Tackle", LG: "Left Guard", M: "Middle",
  RG: "Right Guard", RT: "Right Tackle", RE: "Right End",
};

// which stat columns a position group shows, in order: [key, label]
export const STAT_COLUMNS: Record<string, [string, string][]> = {
  QB: [["g", "G"], ["cmp", "Cmp"], ["att", "Att"], ["py", "Pass Yds"], ["ptd", "TD"], ["intc", "Int"],
       ["sk", "Sk"], ["pepa", "Pass EPA"], ["car", "Rush"], ["ry", "Rush Yds"], ["rtd", "Rush TD"], ["repa", "Rush EPA"]],
  RB: [["g", "G"], ["car", "Att"], ["ry", "Rush Yds"], ["rtd", "TD"], ["repa", "Rush EPA"],
       ["tgt", "Tgt"], ["rec", "Rec"], ["recy", "Rec Yds"], ["rectd", "Rec TD"], ["recepa", "Rec EPA"]],
  WR: [["g", "G"], ["tgt", "Tgt"], ["rec", "Rec"], ["recy", "Rec Yds"], ["rectd", "TD"], ["ay", "Air Yds"],
       ["yac", "YAC"], ["recepa", "Rec EPA"], ["car", "Rush"], ["ry", "Rush Yds"]],
  TE: [["g", "G"], ["tgt", "Tgt"], ["rec", "Rec"], ["recy", "Rec Yds"], ["rectd", "TD"], ["ay", "Air Yds"],
       ["yac", "YAC"], ["recepa", "Rec EPA"]],
  K:  [["g", "G"], ["fgm", "FGM"], ["fga", "FGA"], ["fgl", "Long"], ["xpm", "XPM"], ["xpa", "XPA"]],
  DEF: [["g", "G"], ["tkl", "Tkl"], ["solo", "Solo"], ["sk", "Sacks"], ["tfl", "TFL"], ["qbh", "QB Hit"],
        ["intc", "Int"], ["pd", "PD"], ["ff", "FF"], ["dtd", "TD"]],
  OL: [["g", "G"], ["osnp", "Off Snaps"]],
  ST: [["g", "G"], ["stsnp", "ST Snaps"], ["osnp", "Off Snaps"], ["dsnp", "Def Snaps"]],
};

export const HAS_RECEIVING_MAP = new Set(["WR", "TE", "RB"]);
export const HAS_RUSHING_MAP = new Set(["RB"]);
