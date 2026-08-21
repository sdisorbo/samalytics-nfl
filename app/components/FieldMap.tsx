"use client";
import { useMemo, useState } from "react";
import { GAP_ORDER, GAP_LABEL, type Target, type ZoneLeague, type GapLeague } from "../lib/players";
import { copyFieldCard, type FieldCardSpec } from "../lib/shareCard";

export type MapMeta = { name: string; pos: string; team: string; hs: string; season: string; label: string };

function CopyBtn({ spec }: { spec: () => FieldCardSpec }) {
  const [st, setSt] = useState<"" | "working" | "copied" | "saved">("");
  async function go() {
    if (st === "working") return;
    setSt("working");
    try { setSt(await copyFieldCard(spec())); } catch { setSt(""); }
    setTimeout(() => setSt(""), 1800);
  }
  return (
    <button onClick={go} title="Copy this plot as an image"
      className="pill ml-auto" style={{ borderColor: "var(--color-border)" }}>
      {st === "copied" ? "Copied ✓" : st === "saved" ? "Saved ✓" : st === "working" ? "…" : "⧉ PNG"}
    </button>
  );
}

type RecMetric = "tgt" | "catch" | "epa" | "yds";
const WORDS = {
  rec: { unit: "Target", comp: "Catch %", per: "tgt", dot: "caught", noun: "target" },
  pass: { unit: "Attempt", comp: "Comp %", per: "att", dot: "complete", noun: "pass" },
};
const LOS_BLUE = "#2f6fed", FD_GOLD = "#ecc94b";
const BINS = [-100, 0, 5, 10, 15, 20, 30, 100];
const zbin = (ay: number) => { for (let i = 0; i < 7; i++) if (ay >= BINS[i] && ay < BINS[i + 1]) return i; return 6; };

function green(i: number) { return `color-mix(in srgb, var(--heat-green) ${Math.round(Math.max(0, Math.min(1, i)) * 82)}%, transparent)`; }
function purple(i: number) { return `color-mix(in srgb, var(--heat-purple) ${Math.round(Math.max(0, Math.min(1, i)) * 82)}%, transparent)`; }
const clampT = (v: number, scale: number) => Math.max(-1, Math.min(1, v / scale));
const colorT = (t: number) => (t >= 0 ? green(t) : purple(-t));
const div = (v: number, scale: number) => colorT(clampT(v, scale));
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const LANE_NAME = ["Left", "Middle", "Right"];

// zone stat helpers: arr = [n, compSum, epaSum, ydsSum]
const REC_SCALE: Record<RecMetric, number> = { tgt: 0.04, catch: 0.12, epa: 0.5, yds: 4 };
function zoneMetric(arr: number[], N: number, m: RecMetric): number {
  if (!arr || !arr[0]) return 0;
  if (m === "tgt") return arr[0] / N;
  return arr[m === "catch" ? 1 : m === "epa" ? 2 : 3] / arr[0];
}

/** Receiving/passing/pass-defense field. Pass `targets` for offense (dots + zones);
 *  pass `zones`+`total` for defense (aggregate zones, no dots). Zones color by the
 *  player/team value vs the league baseline for that zone. */
export function ReceivingMap({ targets, zones, total, league, kind = "rec", defense = false, meta }:
  { targets?: Target[]; zones?: number[][]; total?: number; league: ZoneLeague; kind?: "rec" | "pass"; defense?: boolean; meta: MapMeta }) {
  const [metric, setMetric] = useState<RecMetric>(defense ? "epa" : "tgt");
  const [hover, setHover] = useState<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const W = 340, H = 470, top = 18, bot = 408, padX = 6;
  const w = WORDS[kind];
  const allowed = defense ? " allowed" : "";
  const REC_METRICS: [RecMetric, string][] = [
    [defense ? "tgt" : "tgt", defense ? "Volume" : `${w.unit} %`], ["catch", w.comp + allowed],
    ["epa", `EPA / ${w.per}${allowed}`], ["yds", `Yds / ${w.per}${allowed}`],
  ];

  // 21 zone aggregates for this player/team
  const { pZones, N, agg, ays } = useMemo(() => {
    const z: number[][] = Array.from({ length: 21 }, () => [0, 0, 0, 0]);
    if (targets) for (const t of targets) { const a = z[t[0] * 7 + zbin(t[1])]; a[0]++; a[1] += t[2]; a[2] += t[3]; a[3] += t[4]; }
    else if (zones) for (let i = 0; i < 21; i++) z[i] = zones[i];
    const n = targets ? targets.length : (total ?? 0);
    const ag = z.reduce((s, a) => [s[0] + a[0], s[1] + a[1], s[2] + a[2], s[3] + a[3]], [0, 0, 0, 0]);
    return { pZones: z, N: n, agg: ag, ays: targets?.map((t) => t[1]) ?? [] };
  }, [targets, zones, total]);

  const dmin = ays.length ? Math.min(-4, ...ays) : -6, dmax = ays.length ? Math.max(22, ...ays) : 33;
  const yOf = (d: number) => bot - ((d - dmin) / (dmax - dmin || 1)) * (bot - top);
  const laneX = (l: number) => padX + ((l + 0.5) / 3) * (W - 2 * padX);
  const laneBand = (l: number) => [padX + (l / 3) * (W - 2 * padX), padX + ((l + 1) / 3) * (W - 2 * padX)];

  function zoneT(idx: number): number {
    const pa = pZones[idx]; if (!pa || !pa[0]) return 0;
    const pv = zoneMetric(pa, N, metric), lv = zoneMetric(league.z[idx], league.N, metric);
    const sign = defense && metric !== "tgt" ? -1 : 1;   // for D, lower allowed = better = green
    return clampT((pv - lv) * sign, REC_SCALE[metric]);
  }
  function zoneColor(idx: number): string {
    return pZones[idx][0] ? colorT(zoneT(idx)) : "transparent";
  }
  function zoneText(idx: number): string {
    const pa = pZones[idx]; if (!pa || !pa[0]) return "";
    if (metric === "tgt") return String(pa[0]);
    if (metric === "catch") return `${Math.round(pa[1] / pa[0] * 100)}%`;
    if (metric === "epa") return (pa[2] / pa[0]).toFixed(2);
    return (pa[3] / pa[0]).toFixed(1);
  }

  const yardLines: number[] = [];
  for (let d = Math.ceil(dmin / 5) * 5; d <= dmax; d += 5) yardLines.push(d);
  const hz = hover != null ? hover : -1;
  const metricLabel = REC_METRICS.find((m) => m[0] === metric)![1];

  // summary tiles (shared by the page + the share card)
  const summary: { label: string; value: string; sign?: number }[] = defense
    ? [
      { label: `${w.unit}s faced`, value: String(agg[0]) },
      { label: w.comp + " allowed", value: agg[0] ? `${Math.round(agg[1] / agg[0] * 100)}%` : "—" },
      { label: `Yds/${w.per} allowed`, value: agg[0] ? (agg[3] / agg[0]).toFixed(1) : "—" },
      { label: `EPA/${w.per} allowed`, value: agg[0] ? (agg[2] / agg[0]).toFixed(2) : "—", sign: agg[2] <= 0 ? 1 : -1 },
    ]
    : [
      { label: `${w.unit}s`, value: String(agg[0]) },
      { label: w.comp, value: agg[0] ? `${Math.round(agg[1] / agg[0] * 100)}%` : "—" },
      { label: "aDOT", value: ays.length ? mean(ays).toFixed(1) : "—" },
      { label: `Yds / ${w.per}`, value: agg[0] ? (agg[3] / agg[0]).toFixed(1) : "—" },
      { label: `EPA / ${w.per}`, value: agg[0] ? (agg[2] / agg[0]).toFixed(2) : "—", sign: agg[2] >= 0 ? 1 : -1 },
    ];

  const cardSpec = (): FieldCardSpec => ({
    name: meta.name, pos: meta.pos, team: meta.team, hs: meta.hs,
    title: `${meta.label} Map`, subtitle: `${meta.season} · shaded by ${metricLabel}`,
    defense, kind: "field", metricLabel,
    keyLow: metric === "tgt" ? "less" : "worse", keyHigh: metric === "tgt" ? "more" : "better",
    summary,
    dmin, dmax,
    zones: pZones.map((pa, idx) => (pa[0] ? { lane: Math.floor(idx / 7), bin: idx % 7, t: zoneT(idx), text: defense ? zoneText(idx) : undefined } : null))
      .filter((z): z is NonNullable<typeof z> => z != null),
    dots: defense ? undefined : (targets ?? []).map((t) => ({ lane: t[0], ay: t[1], complete: t[2] })),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {REC_METRICS.map(([k, l]) => <button key={k} className={`pill ${metric === k ? "on" : ""}`} onClick={() => setMetric(k)}>{l}</button>)}
        <CopyBtn spec={cardSpec} />
      </div>
      <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start">
        <div className="relative" style={{ width: "100%", maxWidth: 360 }}
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
          onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", borderRadius: 10, background: "var(--color-hover)" }}>
            {yardLines.map((d, i) => i % 2 === 0 ? <rect key={"g" + d} x={padX} y={yOf(d + 5)} width={W - 2 * padX} height={Math.abs(yOf(d) - yOf(d + 5))} fill="#fff" opacity={0.035} /> : null)}
            {pZones.map((_, idx) => {
              const lane = Math.floor(idx / 7), bin = idx % 7;
              const [x0, x1] = laneBand(lane);
              const y1 = yOf(Math.max(BINS[bin], dmin)), y0 = yOf(Math.min(BINS[bin + 1], dmax));
              return (
                <g key={idx}>
                  <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={zoneColor(idx)} />
                  {defense && pZones[idx][0] > 0 && <text x={(x0 + x1) / 2} y={(y0 + y1) / 2 + 3} fontSize="10" textAnchor="middle" fill="var(--color-text)" fontWeight="700" opacity={0.85}>{zoneText(idx)}</text>}
                  <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="transparent" stroke={hz === idx ? "var(--color-text)" : "transparent"} strokeWidth={1} onMouseEnter={() => setHover(idx)} />
                </g>
              );
            })}
            {yardLines.filter((d) => d !== 0 && d !== 10).map((d) => (
              <g key={d}><line x1={padX} x2={W - padX} y1={yOf(d)} y2={yOf(d)} stroke="#fff" strokeOpacity={0.22} strokeWidth={1} />
                <text x={padX + 3} y={yOf(d) - 3} fontSize="8.5" fill="var(--color-muted)">{d > 0 ? `+${d}` : d}</text></g>
            ))}
            <line x1={padX} x2={W - padX} y1={yOf(0)} y2={yOf(0)} stroke={LOS_BLUE} strokeWidth={2.4} />
            <text x={W - padX - 2} y={yOf(0) - 3} fontSize="9" fill={LOS_BLUE} textAnchor="end" fontWeight="700">LOS</text>
            {dmax >= 10 && <><line x1={padX} x2={W - padX} y1={yOf(10)} y2={yOf(10)} stroke={FD_GOLD} strokeWidth={2.4} />
              <text x={W - padX - 2} y={yOf(10) - 3} fontSize="9" fill={FD_GOLD} textAnchor="end" fontWeight="700">1ST</text></>}
            {[1, 2].map((l) => <line key={l} x1={laneBand(l)[0]} x2={laneBand(l)[0]} y1={top} y2={bot} stroke="#fff" strokeOpacity={0.15} strokeDasharray="2 5" />)}
            {targets && targets.map((t, i) => {
              const [x0, x1] = laneBand(t[0]);
              const jx = x0 + 6 + ((i * 2654435761) % 1000) / 1000 * (x1 - x0 - 12);
              return <circle key={i} cx={jx} cy={yOf(t[1])} r={2.8} fill={t[2] ? "var(--heat-green)" : "var(--color-muted)"} stroke="#0008" strokeWidth={0.4} opacity={t[2] ? 0.9 : 0.5} />;
            })}
            {LANE_NAME.map((l, i) => <text key={l} x={laneX(i)} y={H - 6} fontSize="9" fill="var(--color-muted)" textAnchor="middle" fontWeight="700">{l.toUpperCase()}</text>)}
          </svg>
          {hz >= 0 && (
            <div className="absolute z-10 pointer-events-none stat-card !p-2 text-2xs" style={{ left: Math.min(pos.x + 12, 190), top: pos.y + 10, minWidth: 150 }}>
              <div className="font-bold mb-0.5">{LANE_NAME[Math.floor(hz / 7)]} · {BINS[hz % 7] < 0 ? "behind LOS" : `${BINS[hz % 7]}–${BINS[hz % 7 + 1] === 100 ? "30+" : BINS[hz % 7 + 1]} yds`}</div>
              {pZones[hz][0] ? (() => {
                const pa = pZones[hz], la = league.z[hz];
                const rows: [string, string, string][] = [
                  [`${w.unit}s`, `${pa[0]} (${Math.round(pa[0] / N * 100)}%)`, `${Math.round(la[0] / league.N * 100)}%`],
                  [w.comp + allowed, `${Math.round(pa[1] / pa[0] * 100)}%`, `${Math.round(la[1] / la[0] * 100)}%`],
                  [`Yds/${w.per}`, (pa[3] / pa[0]).toFixed(1), (la[3] / la[0]).toFixed(1)],
                  [`EPA/${w.per}`, (pa[2] / pa[0]).toFixed(2), (la[2] / la[0]).toFixed(2)],
                ];
                return <div className="space-y-0.5">
                  {rows.map(([lab, val, lg], i) => (
                    <div key={i} className="flex justify-between gap-3 text-s-muted">
                      <span>{lab}</span>
                      <span><span className="text-s-text font-semibold">{val}</span> <span className="opacity-70">vs {lg} lg</span></span>
                    </div>
                  ))}
                </div>;
              })() : <div className="text-s-muted">No {w.noun}s here</div>}
            </div>
          )}
        </div>

        <div className="text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 max-w-xs">
            {summary.map((st) => <Stat key={st.label} label={st.label} value={st.value}
              color={st.sign != null ? (st.sign >= 0 ? "var(--heat-green)" : "var(--heat-purple)") : undefined} />)}
          </div>
          <p className="text-2xs text-s-muted mt-3 leading-relaxed max-w-xs">
            Zones shade <strong className="text-s-text">vs the league</strong> at that spot —
            <span style={{ color: "var(--heat-green)" }}> green</span> {defense ? "= better than an average defense" : "= above average"},
            <span style={{ color: "var(--heat-purple)" }}> purple</span> {defense ? "= worse" : "= below"}. Hover for this-vs-league.
            {targets && <> Dots are real {w.noun}s (green {w.dot}, grey incomplete); depth &amp; side are exact.</>}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── rushing / rush-defense: gap heat vs league ───────────────────────────────
type RushMetric = "att" | "ypc" | "epa" | "stuff";
const RUSH_SCALE: Record<RushMetric, number> = { att: 0.03, ypc: 0.8, epa: 0.25, stuff: 0.08 };

export function RushingMap({ gaps, league, defense = false, meta }: { gaps: Record<string, number[]>; league: GapLeague; defense?: boolean; meta: MapMeta }) {
  const [metric, setMetric] = useState<RushMetric>(defense ? "epa" : "att");
  const allowed = defense ? " allowed" : "";
  const RUSH_METRICS: [RushMetric, string][] = [
    ["att", defense ? "Volume" : "Attempts"], ["ypc", `Yds/att${allowed}`], ["epa", `EPA/att${allowed}`],
    ["stuff", defense ? "Stuff % forced" : "Stuff % (≤ LOS)"],
  ];
  const totAtt = GAP_ORDER.reduce((s, g) => s + (gaps[g]?.[0] ?? 0), 0);
  const totStuff = GAP_ORDER.reduce((s, g) => s + (gaps[g]?.[3] ?? 0), 0);
  const totYds = GAP_ORDER.reduce((s, g) => s + (gaps[g]?.[1] ?? 0), 0);
  const totEpa = GAP_ORDER.reduce((s, g) => s + (gaps[g]?.[2] ?? 0), 0);

  const gm = (arr: number[] | undefined, N: number, m: RushMetric): number => {
    if (!arr || !arr[0]) return 0;
    if (m === "att") return arr[0] / N;
    if (m === "ypc") return arr[1] / arr[0];
    if (m === "epa") return arr[2] / arr[0];
    return arr[3] / arr[0];
  };
  function display(g: string): string {
    const d = gaps[g]; if (!d || !d[0]) return "—";
    if (metric === "att") return String(d[0]);
    if (metric === "ypc") return (d[1] / d[0]).toFixed(1);
    if (metric === "epa") return (d[2] / d[0]).toFixed(2);
    return `${Math.round((d[3] / d[0]) * 100)}%`;
  }
  function gapT(g: string): number {
    const d = gaps[g]; if (!d || !d[0]) return 0;
    const pv = gm(d, totAtt, metric), lv = gm(league.g[g], league.N, metric);
    let sign = 1;   // higher-is-better; "allowed" metrics invert for a defense
    if (metric === "ypc" || metric === "epa") sign = defense ? -1 : 1;
    if (metric === "stuff") sign = defense ? 1 : -1;
    return clampT((pv - lv) * sign, RUSH_SCALE[metric]);
  }
  const color = (g: string) => (gaps[g]?.[0] ? colorT(gapT(g)) : "transparent");
  const metricLabel = RUSH_METRICS.find((m) => m[0] === metric)![1];

  const summary: { label: string; value: string; sign?: number }[] = [
    { label: defense ? "Carries faced" : "Carries", value: String(totAtt) },
    { label: `Yds/att${allowed}`, value: totAtt ? (totYds / totAtt).toFixed(1) : "—" },
    { label: `EPA/att${allowed}`, value: totAtt ? (totEpa / totAtt).toFixed(2) : "—", sign: defense ? (totEpa <= 0 ? 1 : -1) : (totEpa >= 0 ? 1 : -1) },
    { label: defense ? "Stuff % forced" : "Stuff %", value: totAtt ? `${Math.round(totStuff / totAtt * 100)}%` : "—" },
  ];
  const cardSpec = (): FieldCardSpec => ({
    name: meta.name, pos: meta.pos, team: meta.team, hs: meta.hs,
    title: `${meta.label} Map`, subtitle: `${meta.season} · shaded by ${metricLabel}`,
    defense, kind: "rush", metricLabel,
    keyLow: metric === "att" ? "less" : "worse", keyHigh: metric === "att" ? "more" : "better",
    summary,
    gaps: GAP_ORDER.map((g) => ({ gap: g, t: gaps[g]?.[0] ? gapT(g) : 0, att: gaps[g]?.[0] ?? 0, text: display(g) })),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {RUSH_METRICS.map(([k, l]) => <button key={k} className={`pill ${metric === k ? "on" : ""}`} onClick={() => setMetric(k)}>{l}</button>)}
        <CopyBtn spec={cardSpec} />
      </div>
      <div className="stat-card !p-3" style={{ background: "var(--color-hover)" }}>
        <div className="text-2xs text-s-muted mb-2 text-center">↑ downfield · {defense ? "runs faced" : "runs"} by gap ({totAtt} carries · {Math.round(totStuff / Math.max(1, totAtt) * 100)}% {defense ? "stuffed" : "at/behind LOS"})</div>
        <div className="grid grid-cols-7 gap-1">
          {GAP_ORDER.map((g) => {
            const d = gaps[g];
            return (
              <div key={g} className="rounded-md p-1.5 text-center" style={{ background: color(g), border: "1px solid var(--color-border)", minHeight: 66 }}>
                <div className="text-2xs font-bold text-s-muted">{g}</div>
                {d && d[0] ? <><div className="text-sm font-black tabular">{display(g)}</div><div className="text-2xs text-s-muted tabular">{d[0]} att</div></> : <div className="text-2xs text-s-muted mt-2">—</div>}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-7 gap-1 mt-1">
          {GAP_ORDER.map((g) => <div key={g} className="text-2xs text-s-muted text-center leading-tight">{GAP_LABEL[g].replace("Left ", "L ").replace("Right ", "R ")}</div>)}
        </div>
        <div className="h-[3px] mt-2 rounded" style={{ background: LOS_BLUE }} />
        <div className="text-2xs text-center mt-1" style={{ color: LOS_BLUE }}>line of scrimmage · shaded vs league (green better)</div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return <div><div className="text-2xs text-s-muted uppercase tracking-wide">{label}</div><div className="text-lg font-black tabular" style={color ? { color } : undefined}>{value}</div></div>;
}
