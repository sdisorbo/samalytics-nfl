"use client";
import { useMemo, useState } from "react";
import {
  computeWar, FANTASY_SEASONS, FANTASY_DEFAULT_SEASON, FANTASY_UPDATED,
  DEFAULT_SETTINGS, POSITIONS,
  type Settings, type Scoring, type Roster, type FantasyRow, type Pos,
} from "../lib/fantasy";
import { logoUrl } from "../lib/teams";

type NumKey = "war" | "vorp" | "pts" | "ppg" | "g";
type SortKey = NumKey | "name" | "pos" | "team";
const NUMERIC = new Set<SortKey>(["war", "vorp", "pts", "ppg", "g"]);

function warColor(x: number): string {
  if (x >= 0.05) return "var(--heat-green)";
  if (x <= -0.05) return "var(--heat-purple)";
  return "var(--color-text)";
}

// ── minimalist sparkline: bold line = top-15 avg, faint line = all avg ────────
function Spark({ top, all }: { top: number[]; all: number[] }) {
  const W = 138, H = 42, P = 5;
  const vals = [...top, ...all, 0];
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const sx = (i: number, n: number) => P + (W - 2 * P) * (n <= 1 ? 0 : i / (n - 1));
  const sy = (v: number) => H - P - (H - 2 * P) * ((v - min) / range);
  const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${sx(i, s.length).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ");
  const zy = sy(0);
  const lastTop = top[top.length - 1];
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
      {min <= 0 && max >= 0 && (
        <line x1={P} x2={W - P} y1={zy} y2={zy} stroke="var(--color-border)" strokeDasharray="2 3" strokeWidth={1} />
      )}
      <path d={path(all)} fill="none" stroke="var(--color-muted)" strokeWidth={1} opacity={0.55} />
      <path d={path(top)} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(top.length - 1, top.length)} cy={sy(lastTop)} r={2.6} fill="var(--color-accent)" />
    </svg>
  );
}

// small labelled number input
function Num({ label, value, step = 1, onChange, w = 60 }:
  { label: string; value: number; step?: number; onChange: (v: number) => void; w?: number }) {
  return (
    <label className="flex items-center justify-between gap-2 text-2xs">
      <span className="text-s-muted">{label}</span>
      <input type="number" step={step} value={value} style={{ width: w }}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className="ctl !py-1 !px-1.5 text-right tabular" />
    </label>
  );
}

export default function FantasyView() {
  const [season, setSeason] = useState<string>(FANTASY_DEFAULT_SEASON);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [posFilter, setPosFilter] = useState<Set<Pos>>(new Set());
  const [team, setTeam] = useState<string>("");
  const [q, setQ] = useState("");
  const [minG, setMinG] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("war");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const setScoring = (patch: Partial<Scoring>) =>
    setSettings((s) => ({ ...s, scoring: { ...s.scoring, ...patch } }));
  const setRoster = (patch: Partial<Roster>) =>
    setSettings((s) => ({ ...s, roster: { ...s.roster, ...patch } }));
  const setTier = (i: number, pts: number) =>
    setSettings((s) => ({ ...s, scoring: { ...s.scoring, paTiers: s.scoring.paTiers.map((t, j) => j === i ? { ...t, pts } : t) } }));

  const all = useMemo(() => computeWar(season, settings), [season, settings]);
  const teams = useMemo(() => Array.from(new Set(all.map((r) => r.team))).sort(), [all]);

  // per-position WAR trends across every season (recompute when scoring changes)
  const trends = useMemo(() => {
    const perSeason = FANTASY_SEASONS.map((s) => computeWar(s, settings));
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return POSITIONS.map((pos) => {
      const top: number[] = [], avg: number[] = [];
      for (const rows of perSeason) {
        const pr = rows.filter((r) => r.pos === pos);              // already WAR-sorted desc
        top.push(mean(pr.slice(0, 15).map((r) => r.war)));
        avg.push(mean(pr.map((r) => r.war)));
      }
      return { pos, top, avg };
    });
  }, [settings]);

  const rows = useMemo(() => {
    let rs = all;
    if (posFilter.size) rs = rs.filter((r) => posFilter.has(r.pos));
    if (team) rs = rs.filter((r) => r.team === team);
    if (minG) rs = rs.filter((r) => r.g >= minG);
    const query = q.trim().toLowerCase();
    if (query) rs = rs.filter((r) => r.name.toLowerCase().includes(query) || r.team.toLowerCase().includes(query));
    const dir = sortDir === "desc" ? -1 : 1;
    return rs.slice().sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const d = NUMERIC.has(sortKey) ? (av as number) - (bv as number) : String(av).localeCompare(String(bv));
      return dir * d;
    });
  }, [all, posFilter, team, minG, q, sortKey, sortDir]);

  function clickSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir(NUMERIC.has(k) ? "desc" : "asc"); }
  }
  function togglePos(p: Pos) {
    setPosFilter((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "desc" ? " ↓" : " ↑") : "");
  const th = (k: SortKey, label: string, cls = "") => (
    <th className={cls} onClick={() => clickSort(k)}>{label}{arrow(k)}</th>
  );

  const sc = settings.scoring, ro = settings.roster;
  const yrs = FANTASY_SEASONS.length > 1 ? `${FANTASY_SEASONS[0]}–${FANTASY_SEASONS[FANTASY_SEASONS.length - 1]}` : FANTASY_SEASONS[0];

  return (
    <>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className="ctl" value={season} onChange={(e) => setSeason(e.target.value)}>
          {FANTASY_SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          {POSITIONS.map((p) => (
            <button key={p} className={`pill ${posFilter.has(p) ? "on" : ""}`} onClick={() => togglePos(p)}>{p}</button>
          ))}
        </div>
        <select className="ctl" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="ctl" placeholder="Search player…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-2xs text-s-muted">min G
          <input type="number" min={0} value={minG} onChange={(e) => setMinG(Number(e.target.value) || 0)} className="ctl !py-1 !px-1.5" style={{ width: 48 }} />
        </label>
        <button className={`pill ${showSettings ? "on" : ""} ml-auto`} onClick={() => setShowSettings((v) => !v)}>
          ⚙ League Settings
        </button>
      </div>

      {/* settings panel */}
      {showSettings && (
        <div className="stat-card mb-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="section-heading !mb-0">Presets</span>
            <button className="pill" onClick={() => setScoring({ rec: 0 })}>Standard (0)</button>
            <button className="pill" onClick={() => setScoring({ rec: 0.5 })}>Half-PPR</button>
            <button className="pill" onClick={() => setScoring({ rec: 1 })}>Full PPR</button>
            <button className="pill ml-auto" onClick={() => setSettings(DEFAULT_SETTINGS)}>Reset all</button>
          </div>

          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="section-heading">League &amp; Roster</div>
              <div className="grid gap-1.5">
                <Num label="Teams" value={ro.teams} onChange={(v) => setRoster({ teams: v })} />
                <Num label="QB" value={ro.qb} onChange={(v) => setRoster({ qb: v })} />
                <Num label="RB" value={ro.rb} onChange={(v) => setRoster({ rb: v })} />
                <Num label="WR" value={ro.wr} onChange={(v) => setRoster({ wr: v })} />
                <Num label="TE" value={ro.te} onChange={(v) => setRoster({ te: v })} />
                <Num label="FLEX (R/W/T)" value={ro.flex} onChange={(v) => setRoster({ flex: v })} />
                <Num label="K" value={ro.k} onChange={(v) => setRoster({ k: v })} />
                <Num label="D/ST" value={ro.dst} onChange={(v) => setRoster({ dst: v })} />
              </div>
            </div>
            <div>
              <div className="section-heading">Offense</div>
              <div className="grid gap-1.5">
                <Num label="Pass yd/pt" value={sc.passYd} step={0.01} onChange={(v) => setScoring({ passYd: v })} />
                <Num label="Pass TD" value={sc.passTd} onChange={(v) => setScoring({ passTd: v })} />
                <Num label="Interception" value={sc.int} onChange={(v) => setScoring({ int: v })} />
                <Num label="Rush yd/pt" value={sc.rushYd} step={0.01} onChange={(v) => setScoring({ rushYd: v })} />
                <Num label="Rush TD" value={sc.rushTd} onChange={(v) => setScoring({ rushTd: v })} />
                <Num label="Rec yd/pt" value={sc.recYd} step={0.01} onChange={(v) => setScoring({ recYd: v })} />
                <Num label="Reception (PPR)" value={sc.rec} step={0.5} onChange={(v) => setScoring({ rec: v })} />
                <Num label="Rec TD" value={sc.recTd} onChange={(v) => setScoring({ recTd: v })} />
                <Num label="2-pt conv" value={sc.twoPt} onChange={(v) => setScoring({ twoPt: v })} />
                <Num label="Fumble lost" value={sc.fum} onChange={(v) => setScoring({ fum: v })} />
                <Num label="Return TD" value={sc.retTd} onChange={(v) => setScoring({ retTd: v })} />
              </div>
            </div>
            <div>
              <div className="section-heading">Kicker</div>
              <div className="grid gap-1.5">
                <Num label="FG 0–39" value={sc.fg0} onChange={(v) => setScoring({ fg0: v })} />
                <Num label="FG 40–49" value={sc.fg40} onChange={(v) => setScoring({ fg40: v })} />
                <Num label="FG 50+" value={sc.fg50} onChange={(v) => setScoring({ fg50: v })} />
                <Num label="Extra point" value={sc.xp} onChange={(v) => setScoring({ xp: v })} />
                <Num label="Missed FG" value={sc.fgMiss} onChange={(v) => setScoring({ fgMiss: v })} />
                <Num label="Missed XP" value={sc.xpMiss} onChange={(v) => setScoring({ xpMiss: v })} />
              </div>
            </div>
            <div>
              <div className="section-heading">Defense / ST</div>
              <div className="grid gap-1.5">
                <Num label="Sack" value={sc.dSack} onChange={(v) => setScoring({ dSack: v })} />
                <Num label="Interception" value={sc.dInt} onChange={(v) => setScoring({ dInt: v })} />
                <Num label="Fumble rec" value={sc.dFum} onChange={(v) => setScoring({ dFum: v })} />
                <Num label="Def TD" value={sc.dTd} onChange={(v) => setScoring({ dTd: v })} />
                <Num label="Return TD" value={sc.dRetTd} onChange={(v) => setScoring({ dRetTd: v })} />
                <Num label="Safety" value={sc.dSafety} onChange={(v) => setScoring({ dSafety: v })} />
                <Num label="Block" value={sc.dBlk} onChange={(v) => setScoring({ dBlk: v })} />
              </div>
              <div className="section-heading mt-3">Pts Allowed</div>
              <div className="grid gap-1.5">
                {["0", "1–6", "7–13", "14–20", "21–27", "28–34", "35+"].map((lbl, i) => (
                  <Num key={lbl} label={lbl} value={sc.paTiers[i].pts} onChange={(v) => setTier(i, v)} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* how it's calculated */}
      <div className="stat-card mb-4 !py-0">
        <button onClick={() => setShowHelp((v) => !v)}
          className="w-full flex items-center justify-between py-3 text-left font-bold text-sm">
          <span>How WAR &amp; VORP are calculated</span>
          <span className="text-s-muted text-xs">{showHelp ? "▲ hide" : "▼ show"}</span>
        </button>
        {showHelp && (
          <div className="pb-4 text-sm leading-relaxed text-s-muted space-y-3 max-w-3xl">
            <p>
              <strong className="text-s-text">Replacement level</strong> is the baseline a manager could
              always get for free off waivers: the tier of players just past every league&apos;s starting
              spots. With your settings that&apos;s <em>teams × starters at each position</em>, and the
              FLEX slots are handed to the best remaining RB/WR/TE. Replacement value for a position is the
              average per-game points of the next tier of players below that cutoff.
            </p>
            <p>
              <strong className="text-s-text">VORP</strong> (Value Over Replacement Player) is the simple
              version: a player&apos;s total season points minus what a replacement-level player would have
              scored over the same games — <em>points above replacement</em>. It rewards big raw totals but
              treats a 40-point week and a 15-point week as equally useful.
            </p>
            <p>
              <strong className="text-s-text">WAR</strong> (Wins Above Replacement) turns that into actual
              wins. Each week we take the player&apos;s points above replacement and ask how much it moves a
              team&apos;s win probability against an average opponent — using the league&apos;s week-to-week
              scoring spread — then add those weekly win contributions across the season. Because a single
              game can only be won once, a monster week can&apos;t add more than ~half a win, and a dud
              subtracts value. That&apos;s why WAR, not raw points, separates a steady every-week starter
              from a boom-or-bust player with the same total.
            </p>
          </div>
        )}
      </div>

      {/* positional WAR trends */}
      <div className="mb-4">
        <div className="section-heading">Positional WAR trend · {yrs} <span className="normal-case font-normal">— bold = top-15 avg, faint = position avg</span></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {trends.map((t) => (
            <div key={t.pos} className="stat-card !p-2.5">
              <div className="flex items-baseline justify-between mb-1">
                <span className="font-bold text-sm">{t.pos}</span>
                <span className="text-2xs text-s-muted tabular">{t.top[t.top.length - 1].toFixed(2)}</span>
              </div>
              <Spark top={t.top} all={t.avg} />
            </div>
          ))}
        </div>
      </div>

      {/* table */}
      <div className="stat-card !p-0">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="lft stk stk0">#</th>
                {th("name", "Player", "lft stk stk1")}
                {th("pos", "Pos", "lft")}
                {th("team", "Tm", "lft")}
                {th("g", "G")}
                {th("pts", "Pts")}
                {th("ppg", "PPG")}
                {th("vorp", "VORP")}
                {th("war", "WAR")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="lft text-s-muted stk stk0">{i + 1}</td>
                  <td className="lft stk stk1">
                    <span className="inline-flex items-center gap-2.5 font-semibold">
                      <img
                        src={r.pos === "DST" ? logoUrl(r.team) : (r.hs || logoUrl(r.team))}
                        alt={r.team} width={30} height={30}
                        className="object-contain rounded-full shrink-0"
                        style={{ width: 30, height: 30, background: "#fff" }} loading="lazy"
                      />
                      <span className="hidden sm:inline">{r.name}</span>
                      <span className="sm:hidden">{r.name.split(" ").slice(-1)[0]}</span>
                    </span>
                  </td>
                  <td className="lft text-s-muted">{r.pos}</td>
                  <td className="lft">
                    <span className="inline-flex items-center gap-1.5">
                      <img src={logoUrl(r.team)} alt={r.team} width={18} height={18} className="object-contain" loading="lazy" />
                      <span className="text-2xs text-s-muted">{r.team}</span>
                    </span>
                  </td>
                  <td className="text-s-muted">{r.g}</td>
                  <td>{r.pts.toFixed(1)}</td>
                  <td>{r.ppg.toFixed(1)}</td>
                  <td style={{ color: r.vorp >= 0 ? "var(--color-text)" : "var(--color-muted)" }}>
                    {r.vorp >= 0 ? "+" : ""}{r.vorp.toFixed(0)}
                  </td>
                  <td className="font-bold" style={{ color: warColor(r.war) }}>{r.war.toFixed(2)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td className="lft text-s-muted" colSpan={9} style={{ padding: 16 }}>No players match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-2xs text-s-muted mt-2">Data through {FANTASY_UPDATED}. {rows.length} players shown.</p>
    </>
  );
}
