"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import {
  computeWar, FANTASY_DEFAULT_SEASON, DEFAULT_SETTINGS, FANTASY_SEASONS,
  type FantasyRow,
} from "../lib/fantasy";
import { logoUrl } from "../lib/teams";

// depth discounts: best player at a position = 100%, 2nd = 65%, 3rd+ = 40%
const DEPTH_MULTS = [1.0, 0.65, 0.40];

function depthMult(player: FantasyRow, side: FantasyRow[]): number {
  const rank = side.filter((p) => p.pos === player.pos && p.war > player.war).length;
  return DEPTH_MULTS[Math.min(rank, DEPTH_MULTS.length - 1)];
}

function rawTotal(players: FantasyRow[]): number {
  return players.reduce((s, p) => s + p.war, 0);
}

function adjTotal(players: FantasyRow[]): number {
  return players.reduce((s, p) => s + p.war * depthMult(p, players), 0);
}

function hasDepth(players: FantasyRow[]): boolean {
  const cnt: Record<string, number> = {};
  for (const p of players) cnt[p.pos] = (cnt[p.pos] ?? 0) + 1;
  return Object.values(cnt).some((c) => c > 1);
}

function warColor(x: number): string {
  if (x >= 0.05) return "var(--heat-green)";
  if (x <= -0.05) return "var(--heat-purple)";
  return "var(--color-text)";
}

function PlayerSearch({ side, other, pool, onAdd }: {
  side: FantasyRow[]; other: FantasyRow[];
  pool: FantasyRow[]; onAdd: (p: FantasyRow) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  const excluded = useMemo(
    () => new Set([...side, ...other].map((p) => p.id)),
    [side, other]
  );

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const lq = q.toLowerCase();
    return pool
      .filter((p) => !excluded.has(p.id) && p.name.toLowerCase().includes(lq))
      .slice(0, 8);
  }, [q, pool, excluded]);

  function pick(p: FantasyRow) {
    onAdd(p);
    setQ("");
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input
        className="ctl w-full text-sm"
        placeholder="Search player to add…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <div
          className="absolute z-50 w-full mt-1 rounded-xl border border-s-border shadow-xl overflow-hidden"
          style={{ background: "var(--color-surface)" }}
        >
          {results.map((p) => (
            <button
              key={p.id}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-s-hover text-left"
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
            >
              <img
                src={p.pos === "DST" ? logoUrl(p.team) : (p.hs || logoUrl(p.team))}
                alt={p.name}
                className={`w-6 h-6 object-cover shrink-0${p.pos !== "DST" ? " rounded-full" : " object-contain"}`}
                style={p.pos !== "DST" ? { background: "#fff" } : undefined}
              />
              <span className="flex-1 text-sm font-medium text-s-text truncate">{p.name}</span>
              <span className="text-xs text-s-muted">{p.pos}</span>
              <span className="text-xs font-bold ml-2 tabular-nums" style={{ color: warColor(p.war) }}>
                {p.war.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SidePanel({ title, players, depthOn, onRemove }: {
  title: string; players: FantasyRow[]; depthOn: boolean;
  onRemove: (id: string) => void;
}) {
  const raw = rawTotal(players);
  const adj = adjTotal(players);

  return (
    <div className="stat-card flex flex-col gap-3 flex-1 min-w-0" style={{ minHeight: 180 }}>
      <div className="section-heading">{title}</div>

      {players.length === 0 ? (
        <div className="text-xs text-s-muted italic text-center py-6">No players added</div>
      ) : (
        <div className="flex flex-col gap-2">
          {players.map((p) => {
            const mult = depthMult(p, players);
            const adjWar = p.war * mult;
            const discounted = mult < 1;
            return (
              <div key={p.id} className="flex items-center gap-2">
                <img
                  src={p.pos === "DST" ? logoUrl(p.team) : (p.hs || logoUrl(p.team))}
                  alt={p.name}
                  className={`w-7 h-7 object-cover shrink-0${p.pos !== "DST" ? " rounded-full" : " object-contain"}`}
                  style={p.pos !== "DST" ? { background: "#fff" } : undefined}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-s-text truncate leading-tight">{p.name}</div>
                  <div className="text-xs text-s-muted">{p.pos} · {p.team}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold tabular-nums" style={{ color: warColor(adjWar) }}>
                    {adjWar.toFixed(2)}
                  </div>
                  {depthOn && discounted && (
                    <div className="text-xs text-s-muted tabular-nums">
                      {(mult * 100).toFixed(0)}% · {p.war.toFixed(2)} raw
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onRemove(p.id)}
                  className="ml-1 w-5 h-5 flex items-center justify-center rounded-full text-s-muted hover:text-red-400 hover:bg-s-hover text-base leading-none shrink-0"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {players.length > 0 && (
        <div className="border-t border-s-border pt-2 mt-auto flex flex-col gap-1">
          {depthOn && Math.abs(raw - adj) > 0.01 && (
            <div className="flex justify-between text-xs text-s-muted tabular-nums">
              <span>Raw WAR</span>
              <span>{raw.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline">
            <span className="section-heading mb-0">Adj. Value</span>
            <span className="text-base font-bold tabular-nums" style={{ color: warColor(adj) }}>
              {adj.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TradeCalc() {
  const [season, setSeason] = useState(FANTASY_DEFAULT_SEASON);
  const [sideA, setSideA] = useState<FantasyRow[]>([]);
  const [sideB, setSideB] = useState<FantasyRow[]>([]);

  const pool = useMemo(() => computeWar(season, DEFAULT_SETTINGS), [season]);

  const adjA = adjTotal(sideA);
  const adjB = adjTotal(sideB);
  const diff = adjA - adjB;
  const depthOn = hasDepth(sideA) || hasDepth(sideB);
  const bothSides = sideA.length > 0 && sideB.length > 0;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h2 className="text-lg font-bold text-s-text flex-1">Trade Calculator</h2>
        <select className="ctl text-sm" value={season} onChange={(e) => { setSeason(e.target.value); setSideA([]); setSideB([]); }}>
          {FANTASY_SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(sideA.length > 0 || sideB.length > 0) && (
          <button className="pill text-xs" onClick={() => { setSideA([]); setSideB([]); }}>
            Clear
          </button>
        )}
      </div>

      {/* search inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <div className="section-heading mb-1.5">Team A sends</div>
          <PlayerSearch side={sideA} other={sideB} pool={pool} onAdd={(p) => setSideA((prev) => [...prev, p])} />
        </div>
        <div>
          <div className="section-heading mb-1.5">Team B sends</div>
          <PlayerSearch side={sideB} other={sideA} pool={pool} onAdd={(p) => setSideB((prev) => [...prev, p])} />
        </div>
      </div>

      {/* side panels */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <SidePanel
          title="Team A sends"
          players={sideA}
          depthOn={depthOn}
          onRemove={(id) => setSideA((p) => p.filter((x) => x.id !== id))}
        />
        <SidePanel
          title="Team B sends"
          players={sideB}
          depthOn={depthOn}
          onRemove={(id) => setSideB((p) => p.filter((x) => x.id !== id))}
        />
      </div>

      {/* verdict */}
      {(sideA.length > 0 || sideB.length > 0) && (
        <div className="stat-card text-center py-4">
          {!bothSides ? (
            <div className="text-sm text-s-muted">Add players to both sides for a verdict</div>
          ) : Math.abs(diff) < 0.05 ? (
            <div className="text-base font-bold text-s-text">Even trade</div>
          ) : (
            <>
              <div className="text-xs uppercase tracking-widest text-s-muted mb-1">Trade verdict</div>
              <div className="text-lg font-bold" style={{ color: "var(--heat-green)" }}>
                {diff < 0 ? "Team A" : "Team B"} wins by {Math.abs(diff).toFixed(2)} WAR
              </div>
              <div className="text-xs text-s-muted mt-1">
                {diff < 0
                  ? `Team A receives ${adjB.toFixed(2)} adj. WAR, gives ${adjA.toFixed(2)}`
                  : `Team B receives ${adjA.toFixed(2)} adj. WAR, gives ${adjB.toFixed(2)}`}
              </div>
            </>
          )}
          {depthOn && (
            <div className="text-xs text-s-muted mt-3 border-t border-s-border pt-3">
              Depth discount: 2nd player at same position = 65% value, 3rd+ = 40% — reflects limited lineup spots.
            </div>
          )}
        </div>
      )}

      <div className="mt-4 text-xs text-s-muted leading-relaxed">
        Values use {season} fantasy WAR (half-PPR, 12-team defaults). DST and kickers are included.
        Depth discount applies when one side has multiple players at the same position.
      </div>
    </div>
  );
}
