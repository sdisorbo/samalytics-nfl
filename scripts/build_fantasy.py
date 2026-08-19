#!/usr/bin/env python3
"""
build_fantasy.py  —  Samalytics NFL Fantasy WAR dataset

Ships per-player, per-week *component* stats (not fantasy points), so the site
can re-score everything in the browser from whatever league settings the user
enters and recompute Wins Above Replacement live.

Source: nflverse weekly player_stats (offense + kickers, one lightweight file)
plus schedules (D/ST points allowed). D/ST units are built by aggregating team
defensive stats per week. Regular season only. Seasons: 2021 -> current.

Output: data/fantasy.json
    { seasons:[...], updated:"...", data:{ "2021": {players:[...], dst:[...]}, ... } }

Each offense/K player: { id, name, pos, team, hs (headshot), w:[[week, ...comps]] }
  offense comps order: pass_yds, pass_td, int, pass2, rush_yds, rush_td, rush2,
                       rec, rec_yds, rec_td, rec2, fum_lost, ret_td
  kicker comps order:  fg0_39, fg40_49, fg50p, xp, fg_miss, xp_miss
Each D/ST: { team, w:[[week, pa, sack, int, fumrec, deftd, sttd, safety, blk]] }
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import nflreadpy as nfl

FIRST = 2021
OUT = Path(__file__).resolve().parent.parent / "data"

# generous per-position caps (well beyond replacement even for deep leagues)
CAPS = {"QB": 48, "RB": 100, "WR": 120, "TE": 64, "K": 40}
SKILL = ["QB", "RB", "WR", "TE"]


def num(x):
    """Round to int if whole, else 1 decimal; NaN -> 0."""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return 0
    x = float(x)
    return int(x) if x == int(x) else round(x, 1)


def build_season(season, sched):
    ps = nfl.load_player_stats(seasons=[season]).to_pandas()
    ps = ps[ps["season_type"] == "REG"].copy()
    for c in ps.columns:
        if ps[c].dtype.kind in "fi":
            ps[c] = ps[c].fillna(0)

    # ── points allowed per team/week from schedules ──────────────────────────
    sc = sched[sched["season"] == season]
    pa = {}  # (team, week) -> points allowed
    for _, g in sc.iterrows():
        if g["game_type"] != "REG":
            continue
        h, a, w = g["home_team"], g["away_team"], int(g["week"])
        hs, as_ = g["home_score"], g["away_score"]
        if pd.isna(hs) or pd.isna(as_):
            continue
        pa[(h, w)] = int(as_)   # home defense allowed the away score
        pa[(a, w)] = int(hs)

    # ── offense + kickers ────────────────────────────────────────────────────
    players = []
    # rank within position by total half-PPR-ish points to apply caps
    off = ps[ps["position"].isin(SKILL)].copy()
    off["fum_lost"] = off["fumbles_lost_total"]
    off["_score"] = (off["passing_yards"] * 0.04 + off["passing_tds"] * 4
                     - off["passing_interceptions"] * 2 + off["rushing_yards"] * 0.1
                     + off["rushing_tds"] * 6 + off["receiving_yards"] * 0.1
                     + off["receptions"] * 0.5 + off["receiving_tds"] * 6
                     - off["fum_lost"] * 2)
    totals = off.groupby("player_id")["_score"].sum()

    for pos in SKILL:
        pool = off[off["position"] == pos]
        ids = totals[pool["player_id"].unique()].sort_values(ascending=False)
        keep = ids.head(CAPS[pos]).index
        for pid in keep:
            rows = pool[pool["player_id"] == pid].sort_values("week")
            team = rows["team"].mode().iloc[0]
            name = rows["player_display_name"].iloc[-1]
            hs = rows["headshot_url"].dropna()
            weeks = []
            for _, r in rows.iterrows():
                comps = [int(r["week"]),
                         num(r["passing_yards"]), num(r["passing_tds"]), num(r["passing_interceptions"]),
                         num(r["passing_2pt_conversions"]),
                         num(r["rushing_yards"]), num(r["rushing_tds"]), num(r["rushing_2pt_conversions"]),
                         num(r["receptions"]), num(r["receiving_yards"]), num(r["receiving_tds"]),
                         num(r["receiving_2pt_conversions"]),
                         num(r["fum_lost"]), num(r["special_teams_tds"])]
                if any(comps[1:]):
                    weeks.append(comps)
            if weeks:
                players.append({"id": pid, "name": name, "pos": pos, "team": team,
                                "hs": hs.iloc[-1] if len(hs) else "", "w": weeks})

    # kickers
    kick = ps[ps["position"] == "K"].copy()
    kick["_kscore"] = (kick["fg_made"] * 3 + kick["pat_made"])
    ktot = kick.groupby("player_id")["_kscore"].sum().sort_values(ascending=False)
    for pid in ktot.head(CAPS["K"]).index:
        rows = kick[kick["player_id"] == pid].sort_values("week")
        team = rows["team"].mode().iloc[0]
        name = rows["player_display_name"].iloc[-1]
        hs = rows["headshot_url"].dropna()
        weeks = []
        for _, r in rows.iterrows():
            fg0_39 = r["fg_made_0_19"] + r["fg_made_20_29"] + r["fg_made_30_39"]
            fg40 = r["fg_made_40_49"]
            fg50 = r["fg_made_50_59"] + r["fg_made_60_"]
            comps = [int(r["week"]), num(fg0_39), num(fg40), num(fg50),
                     num(r["pat_made"]), num(r["fg_missed"]), num(r["pat_missed"])]
            if any(comps[1:]):
                weeks.append(comps)
        if weeks:
            players.append({"id": pid, "name": name, "pos": "K", "team": team,
                            "hs": hs.iloc[-1] if len(hs) else "", "w": weeks})

    # ── D/ST units (aggregate team defense) ──────────────────────────────────
    agg = ps.groupby(["team", "week"]).agg(
        sack=("def_sacks", "sum"), intc=("def_interceptions", "sum"),
        fumrec=("fumble_recovery_opp", "sum"), deftd=("def_tds", "sum"),
        sttd=("special_teams_tds", "sum"), safety=("def_safeties", "sum"),
        fgblk=("def_fg_blocks", "sum"), puntblk=("def_punt_blocks", "sum"),
        patblk=("def_pat_blocks", "sum"),
    ).reset_index()
    dst = []
    for team, tg in agg.groupby("team"):
        weeks = []
        for _, r in tg.sort_values("week").iterrows():
            wk = int(r["week"])
            if (team, wk) not in pa:
                continue
            blk = r["fgblk"] + r["puntblk"] + r["patblk"]
            weeks.append([wk, pa[(team, wk)], num(r["sack"]), num(r["intc"]),
                          num(r["fumrec"]), num(r["deftd"]), num(r["sttd"]),
                          num(r["safety"]), num(blk)])
        if weeks:
            dst.append({"team": team, "w": weeks})

    return {"players": players, "dst": dst}


def main():
    cur = nfl.get_current_season()
    seasons = list(range(FIRST, cur + 1))
    print("loading schedules…")
    sched = nfl.load_schedules(seasons=seasons).to_pandas()

    data = {}
    for s in seasons:
        d = build_season(s, sched)
        # only keep a season that actually has any weekly data
        if d["players"] or d["dst"]:
            data[str(s)] = d
        n_wk = sum(len(p["w"]) for p in d["players"])
        print(f"  {s}: {len(d['players'])} players ({n_wk} player-weeks), {len(d['dst'])} D/ST")

    out = {
        "seasons": [s for s in map(str, seasons) if s in data],
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "data": data,
    }
    OUT.mkdir(exist_ok=True)
    path = OUT / "fantasy.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path}  ({path.stat().st_size/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
