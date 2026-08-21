"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ELO, SEASONS, DEFAULT_SEASON } from "../lib/data";
import { logoUrl, TEAMS } from "../lib/teams";
import {
  loadPlayers, loadFieldLeague, loadTeamPassDef, loadTeamRushDef,
  type PlayerRec, type FieldLeagueFile, type ZoneLeague, type GapLeague,
} from "../lib/players";
import { ReceivingMap, RushingMap } from "./FieldMap";

function pct(x: number) { return x >= 0.9995 ? "100%" : x < 0.01 ? (x > 0 ? "<1%" : "—") : `${(x * 100).toFixed(0)}%`; }

export default function TeamPage() {
  const abbr = useSearchParams().get("abbr") ?? "";
  const name = TEAMS[abbr]?.name ?? abbr;
  const [players, setPlayers] = useState<Record<string, PlayerRec> | null>(null);
  const [passDef, setPassDef] = useState<Record<string, ZoneLeague> | null>(null);
  const [rushDef, setRushDef] = useState<Record<string, GapLeague> | null>(null);
  const [league, setLeague] = useState<FieldLeagueFile | null>(null);
  useEffect(() => {
    loadPlayers().then((f) => setPlayers(f.players));
    loadTeamPassDef().then((f) => setPassDef(f.data[abbr] ?? {}));
    loadTeamRushDef().then((f) => setRushDef(f.data[abbr] ?? {}));
    loadFieldLeague().then(setLeague);
  }, [abbr]);
  const defSeasons = useMemo(() => (passDef ? Object.keys(passDef).sort() : []), [passDef]);
  const [defYr, setDefYr] = useState("");
  useEffect(() => { if (defSeasons.length && !defSeasons.includes(defYr)) setDefYr(defSeasons[defSeasons.length - 1]); }, [defSeasons, defYr]);
  const [defMode, setDefMode] = useState<"pass" | "rush">("pass");

  const rows = useMemo(() => SEASONS.map((s) => {
    const t = ELO[s]?.teams.find((x) => x.abbr === abbr);
    return t ? { s, t } : null;
  }).filter(Boolean) as { s: string; t: NonNullable<ReturnType<typeof ELO[string]["teams"]["find"]>> }[], [abbr]);

  const leaders = useMemo(() => {
    if (!players) return null;
    const roster = Object.values(players).filter((p) => p.team === abbr && p.seasons[DEFAULT_SEASON]);
    const pick = (grp: string, key: string) =>
      roster.filter((p) => p.grp === grp).sort((a, b) => (b.seasons[DEFAULT_SEASON][key] ?? 0) - (a.seasons[DEFAULT_SEASON][key] ?? 0)).slice(0, 3);
    return {
      QB: pick("QB", "py"), RB: pick("RB", "ry"), WR: pick("WR", "recy"), TE: pick("TE", "recy"),
      DEF: pick("DEF", "sk"),
    } as Record<string, PlayerRec[]>;
  }, [players, abbr]);

  if (!TEAMS[abbr]) return <p className="text-s-muted text-sm">Team not found.</p>;

  return (
    <>
      <div className="flex items-center gap-4 mb-5">
        <img src={logoUrl(abbr)} alt={abbr} width={60} height={60} className="object-contain shrink-0" style={{ width: 60, height: 60 }} />
        <div>
          <h1 className="text-2xl font-black tracking-tight leading-none">{name}</h1>
          <div className="text-sm text-s-muted mt-1.5">{TEAMS[abbr]?.division}</div>
        </div>
      </div>

      <div className="section-heading">Season by season</div>
      <div className="stat-card !p-0 mb-7">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="lft stk stk0">Yr</th><th>Record</th><th>PCT</th><th>Elo</th>
                <th>Seed</th><th>Playoffs</th><th>Win SB</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, t }) => (
                <tr key={s}>
                  <td className="lft font-semibold stk stk0">{s}</td>
                  <td className="tabular">{t.record.w}-{t.record.l}{t.record.t ? `-${t.record.t}` : ""}</td>
                  <td>{t.win_pct.toFixed(3).replace(/^0/, "")}</td>
                  <td className="font-bold">{t.elo.toFixed(0)}</td>
                  <td className="text-s-muted">{t.seed ?? "—"}</td>
                  <td>{t.made ? pct(t.odds.make) : "—"}</td>
                  <td>{t.made ? pct(t.odds.won) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-heading">Leaders · {DEFAULT_SEASON}</div>
      {!leaders ? <p className="text-s-muted text-sm">Loading…</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([["QB", "Passing", "py", "Pass Yds"], ["RB", "Rushing", "ry", "Rush Yds"], ["WR", "Receiving", "recy", "Rec Yds"],
             ["TE", "Tight End", "recy", "Rec Yds"], ["DEF", "Defense", "sk", "Sacks"]] as const).map(([g, title, key, lbl]) =>
            leaders[g]?.length ? (
              <div key={g} className="stat-card !p-3">
                <div className="text-2xs font-bold uppercase tracking-wider text-s-muted mb-2">{title}</div>
                {leaders[g].map((p) => (
                  <Link key={p.id} href={`/player?id=${p.id}`} className="flex items-center gap-2 py-1.5 hover:bg-s-hover rounded px-1 -mx-1">
                    {p.hs ? <img src={p.hs} alt="" width={26} height={26} className="rounded-full object-cover" style={{ width: 26, height: 26, background: "#fff" }} /> : null}
                    <span className="text-sm font-semibold truncate flex-1">{p.name}</span>
                    <span className="text-sm tabular font-bold">{p.seasons[DEFAULT_SEASON][key] ?? 0}</span>
                    <span className="text-2xs text-s-muted">{lbl.split(" ")[0]}</span>
                  </Link>
                ))}
              </div>
            ) : null,
          )}
        </div>
      )}

      {/* defensive field maps */}
      {defSeasons.length > 0 && (
        <div className="mt-7">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h2 className="section-heading !mb-0">Defense</h2>
            <select className="ctl !py-1" value={defYr} onChange={(e) => setDefYr(e.target.value)}>
              {defSeasons.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="segment">
              <button className={defMode === "pass" ? "on" : ""} onClick={() => setDefMode("pass")}>Pass D</button>
              <button className={defMode === "rush" ? "on" : ""} onClick={() => setDefMode("rush")}>Rush D</button>
            </div>
          </div>
          <div className="stat-card">
            {!league ? <p className="text-s-muted text-sm">Loading…</p>
              : defMode === "pass" && passDef?.[defYr]
                ? <ReceivingMap zones={passDef[defYr].z} total={passDef[defYr].N} league={league.pass[defYr]} kind="pass" defense />
                : defMode === "rush" && rushDef?.[defYr]
                  ? <RushingMap gaps={rushDef[defYr].g} league={league.rush[defYr]} defense />
                  : <p className="text-s-muted text-sm">No {defMode === "pass" ? "pass" : "rush"} defense data for {defYr}.</p>}
          </div>
          <p className="text-2xs text-s-muted mt-2">
            How this defense fared by field zone vs the rest of the league — pass D shows opponents&apos; throws
            (like a QB map), rush D shows runs faced by gap (like an RB map). Green = better than an average defense.
          </p>
        </div>
      )}
    </>
  );
}
