"use client";
import { useMemo, useState } from "react";
import { GAP_ORDER, GAP_LABEL, type Target, type RushGaps } from "../lib/players";

type RecMetric = "tgt" | "catch" | "epa" | "yds";
const REC_METRICS: [RecMetric, string][] = [["tgt", "Target %"], ["catch", "Catch %"], ["epa", "EPA / tgt"], ["yds", "Yds / tgt"]];

function green(i: number) { return `color-mix(in srgb, var(--heat-green) ${Math.round(Math.max(0, Math.min(1, i)) * 74)}%, transparent)`; }
function div(v: number, scale: number) {
  const t = Math.max(-1, Math.min(1, v / scale));
  return t >= 0
    ? `color-mix(in srgb, var(--heat-green) ${Math.round(t * 74)}%, transparent)`
    : `color-mix(in srgb, var(--heat-purple) ${Math.round(-t * 74)}%, transparent)`;
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// ── receiving: dots at (lane, air-yards depth) over metric-shaded zones ───────
export function ReceivingMap({ targets }: { targets: Target[] }) {
  const [metric, setMetric] = useState<RecMetric>("tgt");
  const W = 340, H = 440, top = 24, bot = 396, padX = 8;

  const { dmin, dmax } = useMemo(() => {
    const ays = targets.map((t) => t[1]);
    return { dmin: Math.min(-4, ...ays), dmax: Math.max(22, ...ays) };
  }, [targets]);
  const yOf = (d: number) => bot - ((d - dmin) / (dmax - dmin || 1)) * (bot - top);
  const laneX = (lane: number) => padX + ((lane + 0.5) / 3) * (W - 2 * padX);
  const laneBand = (lane: number) => [padX + (lane / 3) * (W - 2 * padX), padX + ((lane + 1) / 3) * (W - 2 * padX)];

  const BINS = [-100, 0, 5, 10, 15, 20, 30, 100];
  const zones = useMemo(() => {
    const z: { lane: number; b0: number; b1: number; vals: Target[] }[] = [];
    for (let lane = 0; lane < 3; lane++)
      for (let i = 0; i < BINS.length - 1; i++)
        z.push({ lane, b0: BINS[i], b1: BINS[i + 1], vals: targets.filter((t) => t[0] === lane && t[1] >= BINS[i] && t[1] < BINS[i + 1]) });
    return z;
  }, [targets]);
  const maxShare = Math.max(1, ...zones.map((z) => z.vals.length)) / targets.length;

  function zoneColor(vals: Target[]) {
    if (!vals.length) return "transparent";
    if (metric === "tgt") return green((vals.length / targets.length) / maxShare);
    if (metric === "catch") return green(mean(vals.map((v) => v[2])));
    if (metric === "epa") return div(mean(vals.map((v) => v[3])), 1.4);
    return green(mean(vals.map((v) => v[4])) / 18);
  }

  const N = targets.length;
  const summary = {
    n: N, catch: mean(targets.map((t) => t[2])), adot: mean(targets.map((t) => t[1])),
    epa: mean(targets.map((t) => t[3])), yds: mean(targets.map((t) => t[4])),
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {REC_METRICS.map(([k, l]) => (
          <button key={k} className={`pill ${metric === k ? "on" : ""}`} onClick={() => setMetric(k)}>{l}</button>
        ))}
      </div>
      <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 360, background: "var(--color-hover)", borderRadius: 10 }}>
          {/* shaded zones */}
          {zones.map((z, i) => {
            const [x0, x1] = laneBand(z.lane);
            const y1 = yOf(Math.max(z.b0, dmin)), y0 = yOf(Math.min(z.b1, dmax));
            return <rect key={i} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={zoneColor(z.vals)} />;
          })}
          {/* yard lines */}
          {[0, 5, 10, 15, 20].filter((d) => d >= dmin && d <= dmax).map((d) => (
            <g key={d}>
              <line x1={padX} x2={W - padX} y1={yOf(d)} y2={yOf(d)} stroke="var(--color-border)"
                strokeWidth={d === 0 ? 1.6 : 1} strokeDasharray={d === 0 ? "" : "3 4"} />
              <text x={padX + 2} y={yOf(d) - 3} fontSize="9" fill="var(--color-muted)">{d === 0 ? "LOS" : d}</text>
            </g>
          ))}
          {/* lane dividers */}
          {[1, 2].map((l) => <line key={l} x1={laneBand(l)[0]} x2={laneBand(l)[0]} y1={top} y2={bot} stroke="var(--color-border)" strokeDasharray="2 5" />)}
          {/* target dots */}
          {targets.map((t, i) => {
            const [x0, x1] = laneBand(t[0]);
            const jx = x0 + 6 + ((i * 2654435761) % 1000) / 1000 * (x1 - x0 - 12);
            return <circle key={i} cx={jx} cy={yOf(t[1])} r={3}
              fill={t[2] ? "var(--heat-green)" : "var(--color-muted)"} opacity={t[2] ? 0.85 : 0.5} />;
          })}
          {/* lane labels */}
          {["LEFT", "MIDDLE", "RIGHT"].map((l, i) => (
            <text key={l} x={laneX(i)} y={H - 6} fontSize="9" fill="var(--color-muted)" textAnchor="middle" fontWeight="700">{l}</text>
          ))}
        </svg>
        <div className="text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 max-w-xs">
            <Stat label="Targets" value={summary.n} />
            <Stat label="Catch %" value={`${(summary.catch * 100).toFixed(0)}%`} />
            <Stat label="aDOT" value={summary.adot.toFixed(1)} />
            <Stat label="Yds / tgt" value={summary.yds.toFixed(1)} />
            <Stat label="EPA / tgt" value={summary.epa.toFixed(2)} color={summary.epa >= 0 ? "var(--heat-green)" : "var(--heat-purple)"} />
          </div>
          <p className="text-2xs text-s-muted mt-3 leading-relaxed max-w-xs">
            Each dot is a target at its downfield depth (air yards) and side (L/M/R) — the only location
            the public data encodes. Green = caught, grey = incomplete. Zones shade by the selected metric.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── rushing: gap heat across the line ────────────────────────────────────────
type RushMetric = "att" | "ypc" | "epa";
const RUSH_METRICS: [RushMetric, string][] = [["att", "Attempts"], ["ypc", "Yds / att"], ["epa", "EPA / att"]];

export function RushingMap({ gaps }: { gaps: RushGaps }) {
  const [metric, setMetric] = useState<RushMetric>("att");
  const totAtt = GAP_ORDER.reduce((s, g) => s + (gaps[g]?.[0] ?? 0), 0);
  const maxAtt = Math.max(1, ...GAP_ORDER.map((g) => gaps[g]?.[0] ?? 0));

  function val(g: string): number | null {
    const d = gaps[g]; if (!d || !d[0]) return null;
    if (metric === "att") return d[0];
    if (metric === "ypc") return d[1] / d[0];
    return d[2] / d[0];
  }
  function color(g: string): string {
    const d = gaps[g]; if (!d || !d[0]) return "transparent";
    if (metric === "att") return green(d[0] / maxAtt);
    if (metric === "ypc") return green((d[1] / d[0]) / 6);
    return div(d[2] / d[0], 0.4);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {RUSH_METRICS.map(([k, l]) => (
          <button key={k} className={`pill ${metric === k ? "on" : ""}`} onClick={() => setMetric(k)}>{l}</button>
        ))}
      </div>
      <div className="stat-card !p-3" style={{ background: "var(--color-hover)" }}>
        <div className="text-2xs text-s-muted mb-2 text-center">↑ downfield · runs by gap ({totAtt} carries)</div>
        <div className="grid grid-cols-7 gap-1">
          {GAP_ORDER.map((g) => {
            const v = val(g), d = gaps[g];
            return (
              <div key={g} className="rounded-md p-1.5 text-center" style={{ background: color(g), border: "1px solid var(--color-border)", minHeight: 70 }}>
                <div className="text-2xs font-bold text-s-muted">{g}</div>
                {d && d[0] ? (
                  <>
                    <div className="text-sm font-black tabular">{metric === "att" ? d[0] : (v as number).toFixed(metric === "epa" ? 2 : 1)}</div>
                    <div className="text-2xs text-s-muted tabular">{d[0]} att</div>
                  </>
                ) : <div className="text-2xs text-s-muted mt-2">—</div>}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-7 gap-1 mt-1">
          {GAP_ORDER.map((g) => <div key={g} className="text-2xs text-s-muted text-center leading-tight">{GAP_LABEL[g].replace("Left ", "L ").replace("Right ", "R ")}</div>)}
        </div>
        <div className="h-1 mt-2 rounded" style={{ background: "var(--color-border)" }} />
        <div className="text-2xs text-s-muted mt-1 text-center">line of scrimmage</div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div className="text-2xs text-s-muted uppercase tracking-wide">{label}</div>
      <div className="text-lg font-black tabular" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
