"use client";
import { useState } from "react";
import { ELO, SEASONS, SEASON_LABEL, DEFAULT_SEASON, type Season } from "../lib/data";
import { logoUrl, eloHeat } from "../lib/teams";
import EloChart from "./EloChart";

export default function EloView() {
  const [season, setSeason] = useState<Season>(DEFAULT_SEASON);
  const teams = ELO[season].teams; // already sorted by Elo, desc

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select className="ctl" value={season} onChange={(e) => setSeason(e.target.value as Season)}>
          {SEASONS.map((s) => <option key={s} value={s}>{SEASON_LABEL[s]}</option>)}
        </select>
        <span className="text-2xs text-s-muted ml-auto">End-of-season Elo. 1500 = league average.</span>
      </div>

      <div className="stat-card !p-0 mb-7">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="lft stk stk0">#</th>
                <th className="lft stk stk1">Team</th>
                <th className="lft">Conf</th>
                <th className="lft">Div</th>
                <th>Record</th>
                <th>Elo</th>
                <th>vs Avg</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => {
                const heat = eloHeat(t.elo);
                const d = Math.round(t.elo - 1500);
                return (
                  <tr key={t.abbr}>
                    <td className="lft text-s-muted stk stk0">{i + 1}</td>
                    <td className="lft stk stk1">
                      <span className="inline-flex items-center gap-2.5 font-semibold">
                        {logoUrl(t.abbr) ? <img src={logoUrl(t.abbr)} alt={t.abbr} width={26} height={26} className="object-contain" loading="lazy" /> : null}
                        <span className="hidden sm:inline">{t.name}</span>
                        <span className="sm:hidden">{t.abbr}</span>
                      </span>
                    </td>
                    <td className="lft text-s-muted">{t.conf}</td>
                    <td className="lft text-s-muted">{t.division.split(" ")[1]}</td>
                    <td className="tabular">{t.record.w}-{t.record.l}{t.record.t ? `-${t.record.t}` : ""}</td>
                    <td className="font-bold" style={{ background: heat.bg, color: heat.fg }}>{t.elo.toFixed(0)}</td>
                    <td style={{ color: d >= 0 ? "var(--color-accent)" : "var(--heat-purple)" }}>{d >= 0 ? `+${d}` : d}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="text-sm font-bold uppercase tracking-wider text-s-muted mb-3">Elo Through the Season</h2>
      <EloChart season={season} />
    </>
  );
}
