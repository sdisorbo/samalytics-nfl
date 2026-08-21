"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  loadPlayers, loadTargets, loadPasses, loadRushes, STAT_COLUMNS, EPA_DENOM,
  HAS_RECEIVING_MAP, HAS_RUSHING_MAP, HAS_PASSING_MAP,
  type PlayerRec, type Target, type RushGaps,
} from "../lib/players";
import { logoUrl } from "../lib/teams";
import { ReceivingMap, RushingMap } from "./FieldMap";

const isEpa = (k: string) => k.endsWith("epa");
// EPA per play from a season/career totals row (total EPA ÷ its play count)
function epaPerPlay(row: Record<string, number>, k: string): number {
  const d = row[EPA_DENOM[k]] ?? 0;
  return d ? (row[k] ?? 0) / d : 0;
}
const fmtEpa = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;

export default function PlayerPage() {
  const id = useSearchParams().get("id") ?? "";
  const [player, setPlayer] = useState<PlayerRec | null | undefined>(undefined);
  const [targets, setTargets] = useState<Record<string, Target[]> | null>(null);
  const [passes, setPasses] = useState<Record<string, Target[]> | null>(null);
  const [rushes, setRushes] = useState<Record<string, RushGaps> | null>(null);

  useEffect(() => {
    let live = true;
    loadPlayers().then((f) => { if (live) setPlayer(f.players[id] ?? null); });
    return () => { live = false; };
  }, [id]);

  const grp = player?.grp ?? "";
  useEffect(() => {
    if (!player) return;
    if (HAS_RECEIVING_MAP.has(grp)) loadTargets().then((f) => setTargets(f.data[id] ?? {}));
    if (HAS_PASSING_MAP.has(grp)) loadPasses().then((f) => setPasses(f.data[id] ?? {}));
    if (HAS_RUSHING_MAP.has(grp)) loadRushes().then((f) => setRushes(f.data[id] ?? {}));
  }, [player, grp, id]);

  const cols = STAT_COLUMNS[grp] ?? STAT_COLUMNS.ST;
  const years = useMemo(() => (player ? Object.keys(player.seasons).sort() : []), [player]);
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    if (player) for (const y of years) for (const [k] of cols) if (k !== "g" || true) t[k] = (t[k] ?? 0) + (player.seasons[y][k] ?? 0);
    return t;
  }, [player, years, cols]);

  // map season selector
  const mapSeasons = useMemo(() => {
    const keys = [targets, passes, rushes].flatMap((m) => (m ? Object.keys(m) : []));
    return Array.from(new Set(keys)).sort();
  }, [targets, passes, rushes]);
  const [mapYr, setMapYr] = useState<string>("");
  const [mapMode, setMapMode] = useState<"rec" | "rush" | "pass">("rec");
  useEffect(() => { setMapMode(HAS_PASSING_MAP.has(grp) ? "pass" : "rec"); }, [grp]);
  useEffect(() => { if (mapSeasons.length && !mapSeasons.includes(mapYr)) setMapYr(mapSeasons[mapSeasons.length - 1]); }, [mapSeasons, mapYr]);

  if (player === undefined) return <p className="text-s-muted text-sm">Loading…</p>;
  if (player === null) return (
    <p className="text-s-muted text-sm">Player not found. <Link href="/" className="underline">Back to standings</Link>.</p>
  );

  const showRec = HAS_RECEIVING_MAP.has(grp) && targets && targets[mapYr]?.length;
  const showPass = HAS_PASSING_MAP.has(grp) && passes && passes[mapYr]?.length;
  const showRush = HAS_RUSHING_MAP.has(grp) && rushes && rushes[mapYr];
  const hasMap = mapSeasons.length > 0 && (showRec || showPass || showRush);

  return (
    <>
      <div className="flex items-center gap-4 mb-5">
        {player.hs
          ? <img src={player.hs} alt={player.name} width={64} height={64} className="rounded-full object-cover shrink-0" style={{ width: 64, height: 64, background: "#fff" }} />
          : <img src={logoUrl(player.team)} alt={player.team} width={56} height={56} className="object-contain shrink-0" style={{ width: 56, height: 56 }} />}
        <div>
          <h1 className="text-2xl font-black tracking-tight leading-none">{player.name}</h1>
          <div className="flex items-center gap-2 mt-1.5 text-sm text-s-muted">
            <span className="font-semibold text-s-text">{player.pos}</span>
            {player.team && <><span>·</span><img src={logoUrl(player.team)} alt={player.team} width={18} height={18} className="object-contain" /><span>{player.team}</span></>}
          </div>
        </div>
      </div>

      {/* season stats */}
      <div className="section-heading">Season stats · EPA per play</div>
      <div className="stat-card !p-0 mb-7">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="lft stk stk0">Yr</th>
                <th className="lft">Tm</th>
                {cols.map(([k, l]) => <th key={k}>{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const s = player.seasons[y];
                return (
                  <tr key={y}>
                    <td className="lft font-semibold stk stk0">{y}</td>
                    <td className="lft">
                      {(() => { const tm = player.tms?.[y] ?? player.team; return tm
                        ? <span className="inline-flex items-center gap-1"><img src={logoUrl(tm)} alt={tm} width={16} height={16} className="object-contain" /><span className="text-2xs text-s-muted">{tm}</span></span>
                        : null; })()}
                    </td>
                    {cols.map(([k]) => {
                      if (isEpa(k)) {
                        const v = epaPerPlay(s, k);
                        return <td key={k} style={{ color: v >= 0 ? "var(--heat-green)" : "var(--heat-purple)", fontWeight: 700 }}>{fmtEpa(v)}</td>;
                      }
                      return <td key={k}>{s[k] ?? 0}</td>;
                    })}
                  </tr>
                );
              })}
              {years.length > 1 && (
                <tr style={{ borderTop: "2px solid var(--color-border)" }}>
                  <td className="lft font-black stk stk0">Car</td><td />
                  {cols.map(([k]) => {
                    if (isEpa(k)) {
                      const v = epaPerPlay(totals, k);
                      return <td key={k} className="font-bold" style={{ color: v >= 0 ? "var(--heat-green)" : "var(--heat-purple)" }}>{fmtEpa(v)}</td>;
                    }
                    return <td key={k} className="font-bold">{k === "fgl" ? "" : totals[k]}</td>;
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* field map */}
      {hasMap && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h2 className="section-heading !mb-0">Field map</h2>
            <select className="ctl !py-1" value={mapYr} onChange={(e) => setMapYr(e.target.value)}>
              {mapSeasons.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {HAS_RUSHING_MAP.has(grp) && (
              <div className="segment">
                <button className={mapMode === "rec" ? "on" : ""} onClick={() => setMapMode("rec")}>Receiving</button>
                <button className={mapMode === "rush" ? "on" : ""} onClick={() => setMapMode("rush")}>Rushing</button>
              </div>
            )}
          </div>
          <div className="stat-card">
            {mapMode === "pass" && showPass
              ? <ReceivingMap targets={passes![mapYr]} kind="pass" />
              : mapMode === "rush" && showRush
                ? <RushingMap gaps={rushes![mapYr]} />
                : showRec
                  ? <ReceivingMap targets={targets![mapYr]} />
                  : <p className="text-s-muted text-sm">No {mapMode} data for {mapYr}.</p>}
          </div>
        </>
      )}
    </>
  );
}
