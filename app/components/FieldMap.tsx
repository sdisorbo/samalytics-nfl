"use client";
import { useMemo, useState } from "react";
import { GAP_ORDER, GAP_LABEL, type Target, type RushGaps } from "../lib/players";

type RecMetric = "tgt" | "catch" | "epa" | "yds";
const REC_METRICS: [RecMetric, string][] = [["tgt", "Target %"], ["catch", "Catch %"], ["epa", "EPA / tgt"], ["yds", "Yds / tgt"]];
const LOS_BLUE = "#2f6fed", FD_GOLD = "#ecc94b";

function green(i: number) { return `color-mix(in srgb, var(--heat-green) ${Math.round(Math.max(0, Math.min(1, i)) * 78)}%, transparent)`; }
function purple(i: number) { return `color-mix(in srgb, var(--heat-purple) ${Math.round(Math.max(0, Math.min(1, i)) * 78)}%, transparent)`; }
function div(v: number, scale: number) {
  const t = Math.max(-1, Math.min(1, v / scale));
  return t >= 0 ? green(t) : purple(-t);
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const LANE_NAME = ["Left", "Middle", "Right"];

// ── receiving: real target dots at (side, air-yards depth) over a field ───────
export function ReceivingMap({ targets }: { targets: Target[] }) {
  const [metric, setMetric] = useState<RecMetric>("tgt");
  const [hover, setHover] = useState<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const W = 340, H = 470, top = 18, bot = 408, padX = 6;

  const { dmin, dmax } = useMemo(() => {
    const ays = targets.map((t) => t[1]);
    return { dmin: Math.min(-4, ...ays), dmax: Math.max(22, ...ays) };
  }, [targets]);
  const yOf = (d: number) => bot - ((d - dmin) / (dmax - dmin || 1)) * (bot - top);
  const laneX = (l: number) => padX + ((l + 0.5) / 3) * (W - 2 * padX);
  const laneBand = (l: number) => [padX + (l / 3) * (W - 2 * padX), padX + ((l + 1) / 3) * (W - 2 * padX)];

  const BINS = [-100, 0, 5, 10, 15, 20, 30, 100];
  const zones = useMemo(() => {
    const z: { lane: number; b0: number; b1: number; vals: Target[] }[] = [];
    for (let lane = 0; lane < 3; lane++)
      for (let i = 0; i < BINS.length - 1; i++)
        z.push({ lane, b0: BINS[i], b1: BINS[i + 1], vals: targets.filter((t) => t[0] === lane && t[1] >= BINS[i] && t[1] < BINS[i + 1]) });
    return z;
  }, [targets]);
  const maxShare = Math.max(1, ...zones.map((z) => z.vals.length)) / Math.max(1, targets.length);

  function zoneColor(vals: Target[]) {
    if (!vals.length) return "transparent";
    if (metric === "tgt") return green((vals.length / targets.length) / maxShare);
    if (metric === "catch") return green(mean(vals.map((v) => v[2])));
    if (metric === "epa") return div(mean(vals.map((v) => v[3])), 1.4);
    return green(mean(vals.map((v) => v[4])) / 18);
  }

  const N = targets.length;
  const sum = { n: N, catch: mean(targets.map((t) => t[2])), adot: mean(targets.map((t) => t[1])),
    epa: mean(targets.map((t) => t[3])), yds: mean(targets.map((t) => t[4])) };
  const yardLines = [] as number[];
  for (let d = Math.ceil(dmin / 5) * 5; d <= dmax; d += 5) yardLines.push(d);
  const hz = hover != null ? zones[hover] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {REC_METRICS.map(([k, l]) => (
          <button key={k} className={`pill ${metric === k ? "on" : ""}`} onClick={() => setMetric(k)}>{l}</button>
        ))}
      </div>
      <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start">
        <div className="relative" style={{ width: "100%", maxWidth: 360 }}
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
          onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", borderRadius: 10, background: "var(--color-hover)" }}>
            {/* mowed-grass bands */}
            {yardLines.map((d, i) => i % 2 === 0 ? (
              <rect key={"g" + d} x={padX} y={yOf(d + 5)} width={W - 2 * padX} height={Math.abs(yOf(d) - yOf(d + 5))} fill="#ffffff" opacity={0.035} />
            ) : null)}
            {/* metric zones (hoverable) */}
            {zones.map((z, i) => {
              const [x0, x1] = laneBand(z.lane);
              const y1 = yOf(Math.max(z.b0, dmin)), y0 = yOf(Math.min(z.b1, dmax));
              return (
                <g key={i}>
                  <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={zoneColor(z.vals)} />
                  <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="transparent"
                    stroke={hover === i ? "var(--color-text)" : "transparent"} strokeWidth={1}
                    onMouseEnter={() => setHover(i)} style={{ cursor: "default" }} />
                </g>
              );
            })}
            {/* yard lines + numbers */}
            {yardLines.filter((d) => d !== 0 && d !== 10).map((d) => (
              <g key={d}>
                <line x1={padX} x2={W - padX} y1={yOf(d)} y2={yOf(d)} stroke="#ffffff" strokeOpacity={0.22} strokeWidth={1} />
                <text x={padX + 3} y={yOf(d) - 3} fontSize="8.5" fill="var(--color-muted)">{d > 0 ? `+${d}` : d}</text>
              </g>
            ))}
            {/* line of scrimmage (blue) + first down (gold, +10) */}
            <line x1={padX} x2={W - padX} y1={yOf(0)} y2={yOf(0)} stroke={LOS_BLUE} strokeWidth={2.4} />
            <text x={W - padX - 2} y={yOf(0) - 3} fontSize="9" fill={LOS_BLUE} textAnchor="end" fontWeight="700">LOS</text>
            {dmax >= 10 && <>
              <line x1={padX} x2={W - padX} y1={yOf(10)} y2={yOf(10)} stroke={FD_GOLD} strokeWidth={2.4} />
              <text x={W - padX - 2} y={yOf(10) - 3} fontSize="9" fill={FD_GOLD} textAnchor="end" fontWeight="700">1ST</text>
            </>}
            {/* lane dividers */}
            {[1, 2].map((l) => <line key={l} x1={laneBand(l)[0]} x2={laneBand(l)[0]} y1={top} y2={bot} stroke="#ffffff" strokeOpacity={0.15} strokeDasharray="2 5" />)}
            {/* real target dots */}
            {targets.map((t, i) => {
              const [x0, x1] = laneBand(t[0]);
              const jx = x0 + 6 + ((i * 2654435761) % 1000) / 1000 * (x1 - x0 - 12);
              return <circle key={i} cx={jx} cy={yOf(t[1])} r={2.8}
                fill={t[2] ? "var(--heat-green)" : "var(--color-muted)"} stroke="#0008" strokeWidth={0.4}
                opacity={t[2] ? 0.9 : 0.55} />;
            })}
            {/* lane labels */}
            {LANE_NAME.map((l, i) => (
              <text key={l} x={laneX(i)} y={H - 6} fontSize="9" fill="var(--color-muted)" textAnchor="middle" fontWeight="700">{l.toUpperCase()}</text>
            ))}
          </svg>
          {/* hover tooltip */}
          {hz && (
            <div className="absolute z-10 pointer-events-none stat-card !p-2 text-2xs"
              style={{ left: Math.min(pos.x + 12, 200), top: pos.y + 10, minWidth: 132 }}>
              <div className="font-bold mb-0.5">{LANE_NAME[hz.lane]} · {hz.b0 < 0 ? "behind LOS" : `${hz.b0}–${hz.b1 === 100 ? "30+" : hz.b1} yds`}</div>
              {hz.vals.length ? (
                <div className="grid grid-cols-2 gap-x-2 text-s-muted">
                  <span>Targets</span><span className="text-right text-s-text font-semibold">{hz.vals.length} ({Math.round(hz.vals.length / N * 100)}%)</span>
                  <span>Catch %</span><span className="text-right text-s-text font-semibold">{Math.round(mean(hz.vals.map((v) => v[2])) * 100)}%</span>
                  <span>Yds / tgt</span><span className="text-right text-s-text font-semibold">{mean(hz.vals.map((v) => v[4])).toFixed(1)}</span>
                  <span>EPA / tgt</span><span className="text-right font-semibold" style={{ color: mean(hz.vals.map((v) => v[3])) >= 0 ? "var(--heat-green)" : "var(--heat-purple)" }}>{mean(hz.vals.map((v) => v[3])).toFixed(2)}</span>
                </div>
              ) : <div className="text-s-muted">No targets here</div>}
            </div>
          )}
        </div>

        <div className="text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 max-w-xs">
            <Stat label="Targets" value={sum.n} />
            <Stat label="Catch %" value={`${(sum.catch * 100).toFixed(0)}%`} />
            <Stat label="aDOT" value={sum.adot.toFixed(1)} />
            <Stat label="Yds / tgt" value={sum.yds.toFixed(1)} />
            <Stat label="EPA / tgt" value={sum.epa.toFixed(2)} color={sum.epa >= 0 ? "var(--heat-green)" : "var(--heat-purple)"} />
          </div>
          <p className="text-2xs text-s-muted mt-3 leading-relaxed max-w-xs">
            <span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: "var(--heat-green)" }} />caught ·
            <span className="inline-block w-2 h-2 rounded-full align-middle mx-1" style={{ background: "var(--color-muted)" }} />incomplete.
            Every dot is a <strong className="text-s-text">real target</strong>: its depth (air yards) and side
            (L/M/R) are exact — only the spread within a lane is cosmetic, since the data has no finer left-right
            coordinate. Hover any zone for its averages.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── rushing: gap heat across the line, incl. stuffed-at-LOS rate ──────────────
type RushMetric = "att" | "ypc" | "epa" | "stuff";
const RUSH_METRICS: [RushMetric, string][] = [["att", "Attempts"], ["ypc", "Yds / att"], ["epa", "EPA / att"], ["stuff", "Stuff % (≤ LOS)"]];

export function RushingMap({ gaps }: { gaps: RushGaps }) {
  const [metric, setMetric] = useState<RushMetric>("att");
  const totAtt = GAP_ORDER.reduce((s, g) => s + (gaps[g]?.[0] ?? 0), 0);
  const maxAtt = Math.max(1, ...GAP_ORDER.map((g) => gaps[g]?.[0] ?? 0));
  const totStuff = GAP_ORDER.reduce((s, g) => s + (gaps[g]?.[3] ?? 0), 0);

  function display(g: string): string {
    const d = gaps[g]; if (!d || !d[0]) return "—";
    if (metric === "att") return String(d[0]);
    if (metric === "ypc") return (d[1] / d[0]).toFixed(1);
    if (metric === "epa") return (d[2] / d[0]).toFixed(2);
    return `${Math.round((d[3] / d[0]) * 100)}%`;
  }
  function color(g: string): string {
    const d = gaps[g]; if (!d || !d[0]) return "transparent";
    if (metric === "att") return green(d[0] / maxAtt);
    if (metric === "ypc") return green((d[1] / d[0]) / 6);
    if (metric === "epa") return div(d[2] / d[0], 0.4);
    return purple((d[3] / d[0]) / 0.35);   // higher stuff rate = worse
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {RUSH_METRICS.map(([k, l]) => (
          <button key={k} className={`pill ${metric === k ? "on" : ""}`} onClick={() => setMetric(k)}>{l}</button>
        ))}
      </div>
      <div className="stat-card !p-3" style={{ background: "var(--color-hover)" }}>
        <div className="text-2xs text-s-muted mb-2 text-center">
          ↑ downfield · runs by gap ({totAtt} carries · {Math.round(totStuff / Math.max(1, totAtt) * 100)}% stuffed at/behind LOS)
        </div>
        <div className="grid grid-cols-7 gap-1">
          {GAP_ORDER.map((g) => {
            const d = gaps[g];
            return (
              <div key={g} className="rounded-md p-1.5 text-center" style={{ background: color(g), border: "1px solid var(--color-border)", minHeight: 66 }}>
                <div className="text-2xs font-bold text-s-muted">{g}</div>
                {d && d[0] ? (<>
                  <div className="text-sm font-black tabular">{display(g)}</div>
                  <div className="text-2xs text-s-muted tabular">{d[0]} att</div>
                </>) : <div className="text-2xs text-s-muted mt-2">—</div>}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-7 gap-1 mt-1">
          {GAP_ORDER.map((g) => <div key={g} className="text-2xs text-s-muted text-center leading-tight">{GAP_LABEL[g].replace("Left ", "L ").replace("Right ", "R ")}</div>)}
        </div>
        <div className="h-[3px] mt-2 rounded" style={{ background: LOS_BLUE }} />
        <div className="text-2xs text-center mt-1" style={{ color: LOS_BLUE }}>line of scrimmage</div>
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
