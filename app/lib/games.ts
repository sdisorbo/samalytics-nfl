import gamesJson from "../../data/games.json";

export type Game = {
  wk: number; date: string; day: string; time: string;
  away: string; home: string;
  ae: number; he: number;          // pre-game Elo
  hwp: number;                     // home win probability (incl. home field unless neutral)
  hWin: number; hLoss: number;     // home Elo swing on win / loss
  aWin: number; aLoss: number;     // away Elo swing on win / loss
  neutral: boolean;
  as: number | null; hs: number | null; // final scores if played
};
type GamesFile = { updated: string; seasons: string[]; data: Record<string, Game[]> };

const FILE = gamesJson as unknown as GamesFile;
export const GAMES_SEASONS: string[] = FILE.seasons;
export const GAMES_UPDATED: string = FILE.updated;
export const GAMES: Record<string, Game[]> = FILE.data;

export function weeksFor(season: string): number[] {
  return Array.from(new Set((GAMES[season] ?? []).map((g) => g.wk))).sort((a, b) => a - b);
}

/** The week to open on: the earliest week that still has an unplayed game, else the last week. */
export function defaultWeek(season: string): number {
  const games = GAMES[season] ?? [];
  const upcoming = games.filter((g) => g.hs == null).map((g) => g.wk).sort((a, b) => a - b);
  if (upcoming.length) return upcoming[0];
  const wks = weeksFor(season);
  return wks[wks.length - 1] ?? 1;
}

/** The most sensible season to land on: the latest one that has any unplayed games. */
export function defaultSeason(): string {
  for (let i = GAMES_SEASONS.length - 1; i >= 0; i--) {
    const s = GAMES_SEASONS[i];
    if ((GAMES[s] ?? []).some((g) => g.hs == null)) return s;
  }
  return GAMES_SEASONS[GAMES_SEASONS.length - 1];
}

export function fmtTime(t: string): string {
  if (!t) return "";
  const [hh, mm] = t.split(":").map(Number);
  const ap = hh >= 12 ? "PM" : "AM";
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, "0")} ${ap} ET`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS: Record<string, string> = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" };
export function fmtDay(date: string, day: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${DAYS[day] ?? day}, ${MONTHS[m - 1]} ${d}`;
}
