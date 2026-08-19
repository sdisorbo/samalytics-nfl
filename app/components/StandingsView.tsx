"use client";
import { Fragment, useMemo, useState } from "react";
import { ELO, SEASONS, SEASON_LABEL, DEFAULT_SEASON, ODDS_STEPS, type Season, type EloTeam, type Odds } from "../lib/data";
import { logoUrl, eloHeat, oddsHeat } from "../lib/teams";

type Mode = "all" | "division" | "wildcard";
type SortKey = "win_pct" | "elo" | keyof Odds;

const DIV_ORDER = ["AFC East", "AFC North", "AFC South", "AFC West", "NFC East", "NFC North", "NFC South", "NFC West"];

// games back from a leader; ties cancel out of the standard formula
const diff = (t: EloTeam) => t.record.w - t.record.l;
const gb = (leader: EloTeam, t: EloTeam) => (diff(leader) - diff(t)) / 2;
const fmtGb = (x: number) => (x <= 0 ? "—" : x % 1 === 0 ? x.toFixed(0) : x.toFixed(1));

type Row = { t: EloTeam; rank: string; gb: number };
type Section = { title: string | null; rows: Row[]; cutAfter?: number };

function oddsCell(x: number, made: boolean) {
  if (!made) return <span className="text-s-muted">—</span>;
  const p = x * 100;
  const label = x >= 0.9995 ? "100%" : p < 1 ? "<1%" : `${p.toFixed(0)}%`;
  const { bg, fg } = oddsHeat(x);
  return <span className="inline-block rounded px-1.5 py-0.5 font-semibold" style={{ background: bg, color: fg }}>{label}</span>;
}

export default function StandingsView() {
  const [season, setSeason] = useState<Season>(DEFAULT_SEASON);
  const [mode, setMode] = useState<Mode>("all");
  const [sortKey, setSortKey] = useState<SortKey>("win_pct");
  const data = ELO[season];

  const sections = useMemo<Section[]>(() => {
    const teams = data.teams;
    const byWL = (a: EloTeam, b: EloTeam) => b.win_pct - a.win_pct || b.elo - a.elo;

    if (mode === "division") {
      return DIV_ORDER.map((div) => {
        const rows = teams.filter((t) => t.division === div).sort((a, b) => a.div_rank - b.div_rank);
        const lead = rows[0];
        return { title: div, rows: rows.map((t) => ({ t, rank: String(t.div_rank), gb: gb(lead, t) })) };
      });
    }

    if (mode === "wildcard") {
      const out: Section[] = [];
      for (const conf of ["AFC", "NFC"]) {
        const ct = teams.filter((t) => t.conf === conf);
        const leaders = ct.filter((t) => t.seed != null && t.seed <= 4).sort((a, b) => (a.seed ?? 9) - (b.seed ?? 9));
        // wild-card race: teams already holding a spot (seeds 5-7) first, in seed
        // order, then the hunt ranked by record. Numbered by race position.
        const rest = ct
          .filter((t) => !(t.seed != null && t.seed <= 4))
          .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99) || byWL(a, b));
        const lead1 = leaders[0];
        out.push({ title: `${conf} — Division Leaders`, rows: leaders.map((t) => ({ t, rank: String(t.seed), gb: gb(lead1, t) })) });
        const wcLead = rest[0];
        out.push({
          title: `${conf} — Wild Card`,
          rows: rest.map((t, i) => ({ t, rank: `${i + 1}`, gb: gb(wcLead, t) })),
          cutAfter: 3,
        });
      }
      return out;
    }

    // all
    const get = (t: EloTeam): number =>
      sortKey === "win_pct" || sortKey === "elo"
        ? (t[sortKey] as number)
        : (t.odds[sortKey] as number);
    const rows = teams.slice().sort((a, b) => get(b) - get(a) || byWL(a, b));
    const lead = rows.slice().sort(byWL)[0];
    return [{ title: null, rows: rows.map((t, i) => ({ t, rank: String(i + 1), gb: gb(lead, t) })) }];
  }, [data, mode, sortKey]);

  const sortable = mode === "all";
  const th = (k: SortKey, label: string) => (
    <th onClick={sortable ? () => setSortKey(k) : undefined} style={{ cursor: sortable ? "pointer" : "default" }}>
      {label}{sortable && sortKey === k ? " ↓" : ""}
    </th>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select className="ctl" value={season} onChange={(e) => setSeason(e.target.value as Season)}>
          {SEASONS.map((s) => <option key={s} value={s}>{SEASON_LABEL[s]}</option>)}
        </select>
        <div className="segment">
          {(["all", "division", "wildcard"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m === "all" ? "League" : m === "division" ? "Division" : "Wild Card"}
            </button>
          ))}
        </div>
        <span className="text-2xs text-s-muted ml-auto hidden sm:block">
          Odds: Monte-Carlo of the bracket from end-of-season Elo.
        </span>
      </div>

      <div className="stat-card !p-0">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="lft stk stk0">#</th>
                <th className="lft stk stk1">Team</th>
                <th>Record</th>
                {th("win_pct", "PCT")}
                <th style={{ cursor: "default" }}>GB</th>
                {th("elo", "Elo")}
                {ODDS_STEPS.map((o) => (
                  <th key={o.key} onClick={sortable ? () => setSortKey(o.key) : undefined}
                    style={{ cursor: sortable ? "pointer" : "default" }}>
                    {o.label}{sortable && sortKey === o.key ? " ↓" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((sec, si) => (
                <Fragment key={sec.title ?? `s${si}`}>
                  {sec.title && (
                    <tr className="grp-row"><td className="lft" colSpan={11}>{sec.title}</td></tr>
                  )}
                  {sec.rows.map((r, ri) => {
                    const t = r.t;
                    const heat = eloHeat(t.elo);
                    const cut = sec.cutAfter != null && ri === sec.cutAfter;
                    return (
                      <tr key={t.abbr} className={cut ? "cut-line" : undefined}>
                        <td className="lft text-s-muted stk stk0">{r.rank}</td>
                        <td className="lft stk stk1">
                          <span className="inline-flex items-center gap-2.5 font-semibold">
                            {logoUrl(t.abbr)
                              ? <img src={logoUrl(t.abbr)} alt={t.abbr} width={26} height={26} className="object-contain" loading="lazy" />
                              : null}
                            <span className="hidden sm:inline">{t.name}</span>
                            <span className="sm:hidden">{t.abbr}</span>
                          </span>
                        </td>
                        <td className="tabular">{t.record.w}-{t.record.l}{t.record.t ? `-${t.record.t}` : ""}</td>
                        <td>{t.win_pct.toFixed(3).replace(/^0/, "")}</td>
                        <td className="text-s-muted">{fmtGb(r.gb)}</td>
                        <td className="font-bold" style={{ background: heat.bg, color: heat.fg }}>{t.elo.toFixed(0)}</td>
                        {ODDS_STEPS.map((o) => <td key={o.key}>{oddsCell(t.odds[o.key], t.made)}</td>)}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
