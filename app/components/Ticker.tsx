"use client";
import Link from "next/link";
import { GAMES, defaultSeason, defaultWeek, fmtTime, type Game } from "../lib/games";
import { logoUrl } from "../lib/teams";

function GameItem({ g }: { g: Game }) {
  const played = g.hs != null && g.as != null;
  const homeWon = played && (g.hs as number) >= (g.as as number);
  return (
    <Link href="/games" className="tk-item hover:!text-s-text" style={{ color: "var(--color-muted)" }}>
      <img src={logoUrl(g.away)} alt={g.away} loading="lazy" />
      <span className="tk-abbr" style={played && !homeWon ? undefined : { color: "var(--color-muted)", fontWeight: 600 }}>{g.away}</span>
      {played && <span style={{ color: !homeWon ? "var(--color-text)" : "var(--color-muted)", fontWeight: !homeWon ? 700 : 400 }}>{g.as}</span>}
      <span className="opacity-60">@</span>
      <img src={logoUrl(g.home)} alt={g.home} loading="lazy" />
      <span className="tk-abbr" style={played && !homeWon ? { color: "var(--color-muted)", fontWeight: 600 } : undefined}>{g.home}</span>
      {played && <span style={{ color: homeWon ? "var(--color-text)" : "var(--color-muted)", fontWeight: homeWon ? 700 : 400 }}>{g.hs}</span>}
      <span className="opacity-70 ml-1">{played ? "F" : `${g.day} ${fmtTime(g.time).replace(" ET", "")}`}</span>
    </Link>
  );
}

export default function Ticker() {
  const season = defaultSeason();
  const week = defaultWeek(season);
  const games = (GAMES[season] ?? []).filter((g) => g.wk === week)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  if (!games.length) return null;

  const label = (
    <span className="tk-item" style={{ color: "var(--color-accent)", fontWeight: 800, letterSpacing: "0.04em" }}>
      {season} · WEEK {week}
    </span>
  );
  const run = (key: string) => (
    <div className="inline-flex items-center" key={key} aria-hidden={key === "b"}>
      {label}
      {games.map((g, i) => <GameItem key={`${key}-${i}`} g={g} />)}
    </div>
  );
  // two identical runs so the -50% translate loops seamlessly; ~5s per game (slow)
  const duration = Math.max(120, games.length * 15);

  return (
    <div className="ticker sticky z-40" style={{ top: 48 }}>
      <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
        {run("a")}
        {run("b")}
      </div>
    </div>
  );
}
