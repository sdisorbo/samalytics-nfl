#!/usr/bin/env python3
"""
build_players.py  —  Samalytics NFL player index + season stats + field maps

Builds the data behind the player search / player pages:
  data/search_index.json   small: every player {id,name,pos,team} + teams (for the nav search box)
  public/players.json       per-player season-by-season stats (all positions) incl. EPA + snaps
  public/targets.json       receiving targets (WR/TE/RB) for the field map: [lane, air_yards, catch, epa]
  public/rushes.json        rushing by gap (RB) for the field map

Sources: load_players (identity + gsis<->pfr crosswalk + headshots), load_player_stats
(production + EPA), load_snap_counts (snaps, incl. OL), load_pbp (target/rush geometry).
Play-by-play is processed one season at a time and the cache is cleared between
seasons to stay disk-frugal.
"""
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import nflreadpy as nfl

FIRST = 2021
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PUB = ROOT / "public"

POS_GROUP = {
    "QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE", "K": "K",
    "P": "ST", "LS": "ST",
    "C": "OL", "G": "OL", "T": "OL", "OT": "OL", "OG": "OL", "OL": "OL",
}
DEF_POS = {"CB", "S", "FS", "SS", "SAF", "DB", "LB", "ILB", "MLB", "OLB", "DE", "DT", "DL", "NT", "EDGE"}


def grp(pos):
    if pos in POS_GROUP:
        return POS_GROUP[pos]
    if pos in DEF_POS:
        return "DEF"
    return "ST"


def r0(x):  # round to int
    return int(round(float(x))) if x is not None and not (isinstance(x, float) and np.isnan(x)) else 0


def r1(x):
    v = 0.0 if x is None or (isinstance(x, float) and np.isnan(x)) else float(x)
    return round(v, 1)


def season_stat_row(g, rows):
    """rows = a player's weekly player_stats rows for one season -> compact stat dict by group."""
    s = rows.sum(numeric_only=True)
    games = int((rows[["passing_yards", "rushing_yards", "receiving_yards", "fg_att",
                       "def_tackles_solo", "def_tackle_assists"]].abs().sum(axis=1) > 0).sum()) or len(rows)
    base = {"g": games}
    if g == "QB":
        base.update(cmp=r0(s.completions), att=r0(s.attempts), py=r0(s.passing_yards), ptd=r0(s.passing_tds),
                    intc=r0(s.passing_interceptions), sk=r0(s.sacks_suffered), pepa=r1(s.passing_epa),
                    car=r0(s.carries), ry=r0(s.rushing_yards), rtd=r0(s.rushing_tds), repa=r1(s.rushing_epa))
    elif g == "RB":
        base.update(car=r0(s.carries), ry=r0(s.rushing_yards), rtd=r0(s.rushing_tds), repa=r1(s.rushing_epa),
                    tgt=r0(s.targets), rec=r0(s.receptions), recy=r0(s.receiving_yards), rectd=r0(s.receiving_tds),
                    recepa=r1(s.receiving_epa))
    elif g in ("WR", "TE"):
        base.update(tgt=r0(s.targets), rec=r0(s.receptions), recy=r0(s.receiving_yards), rectd=r0(s.receiving_tds),
                    ay=r0(s.receiving_air_yards), yac=r0(s.receiving_yards_after_catch), recepa=r1(s.receiving_epa),
                    car=r0(s.carries), ry=r0(s.rushing_yards), rtd=r0(s.rushing_tds))
    elif g == "K":
        base.update(fgm=r0(s.fg_made), fga=r0(s.fg_att), fgl=r0(rows["fg_long"].max()),
                    xpm=r0(s.pat_made), xpa=r0(s.pat_att))
    elif g == "DEF":
        base.update(tkl=r0(s.def_tackles_solo) + r0(s.def_tackle_assists), solo=r0(s.def_tackles_solo),
                    sk=r1(s.def_sacks), tfl=r0(s.def_tackles_for_loss), qbh=r0(s.def_qb_hits),
                    intc=r0(s.def_interceptions), pd=r0(s.def_pass_defended), ff=r0(s.def_fumbles_forced),
                    dtd=r0(s.def_tds))
    return base


def main():
    cur = nfl.get_current_season()
    seasons = list(range(FIRST, cur + 1))

    print("loading identities…")
    pl = nfl.load_players().to_pandas()
    ident, pfr2gsis = {}, {}
    for _, r in pl.iterrows():
        gid = r["gsis_id"]
        if not isinstance(gid, str):
            continue
        ident[gid] = {
            "name": r["display_name"], "pos": r["position"] if isinstance(r["position"], str) else "",
            "hs": r["headshot"] if isinstance(r["headshot"], str) else "",
            "team": r["latest_team"] if isinstance(r["latest_team"], str) else "",
        }
        if isinstance(r["pfr_id"], str):
            pfr2gsis[r["pfr_id"]] = gid

    players = defaultdict(lambda: {"seasons": {}})   # gid -> {seasons: {yr: {...}}}
    targets = defaultdict(dict)                       # gid -> {yr: [[lane,ay,catch,epa],...]}
    rushes = defaultdict(dict)                        # gid -> {yr: {gap: [att,yds,epaSum]}}

    for season in seasons:
        ps = nfl.load_player_stats(seasons=[season]).to_pandas()
        ps = ps[ps["season_type"] == "REG"]
        for gid, rows in ps.groupby("player_id"):
            if not isinstance(gid, str) or gid not in ident:
                if isinstance(gid, str):
                    ident[gid] = {"name": rows["player_display_name"].iloc[-1],
                                  "pos": rows["position"].iloc[-1] if isinstance(rows["position"].iloc[-1], str) else "",
                                  "hs": "", "team": ""}
                else:
                    continue
            gpos = ident[gid]["pos"] or (rows["position"].iloc[-1] if isinstance(rows["position"].iloc[-1], str) else "")
            g = grp(gpos)
            team = rows["team"].mode().iloc[0] if len(rows["team"].mode()) else ident[gid]["team"]
            row = season_stat_row(g, rows)
            players[gid]["seasons"][str(season)] = row
            players[gid]["_team"] = team
            hs = rows["headshot_url"].dropna()
            if not ident[gid]["hs"] and len(hs):
                ident[gid]["hs"] = hs.iloc[-1]

        # snaps (join via pfr id)
        sc = nfl.load_snap_counts(seasons=[season]).to_pandas()
        sc = sc[sc["game_type"] == "REG"]
        snap = sc.groupby("pfr_player_id").agg(o=("offense_snaps", "sum"), d=("defense_snaps", "sum"),
                                               st=("st_snaps", "sum"), team=("team", lambda x: x.mode().iloc[0])).reset_index()
        for _, r in snap.iterrows():
            gid = pfr2gsis.get(r["pfr_player_id"])
            if not gid:
                continue
            if gid not in ident:
                continue
            yr = str(season)
            if yr not in players[gid]["seasons"]:
                players[gid]["seasons"][yr] = {"g": 0}
                players[gid]["_team"] = r["team"]
            players[gid]["seasons"][yr].update(osnp=r0(r["o"]), dsnp=r0(r["d"]), stsnp=r0(r["st"]))
            players[gid].setdefault("_team", r["team"])

        # play-by-play: receiving targets + rushing by gap
        pbp = nfl.load_pbp(seasons=[season]).to_pandas()
        yr = str(season)
        pas = pbp[(pbp["play_type"] == "pass") & pbp["receiver_player_id"].notna()
                  & pbp["air_yards"].notna() & pbp["pass_location"].isin(["left", "middle", "right"])]
        lane = {"left": 0, "middle": 1, "right": 2}
        by_rec = defaultdict(list)
        for _, p in pas.iterrows():
            by_rec[p["receiver_player_id"]].append(
                [lane[p["pass_location"]], r0(p["air_yards"]), int(p["complete_pass"] == 1), r1(p["epa"]),
                 r0(p["yards_gained"])])
        for gid, arr in by_rec.items():
            if isinstance(gid, str) and len(arr) >= 10:
                targets[gid][yr] = arr

        run = pbp[(pbp["play_type"] == "run") & pbp["rusher_player_id"].notna()]
        gapmap = {("left", "end"): "LE", ("left", "tackle"): "LT", ("left", "guard"): "LG",
                  ("right", "end"): "RE", ("right", "tackle"): "RT", ("right", "guard"): "RG"}
        by_rush = defaultdict(lambda: defaultdict(lambda: [0, 0, 0.0]))
        for _, p in run.iterrows():
            loc, gp = p["run_location"], p["run_gap"]
            if loc == "middle" or not isinstance(loc, str):
                key = "M"
            else:
                key = gapmap.get((loc, gp if isinstance(gp, str) else "tackle"), f"{loc[0].upper()}T")
            b = by_rush[p["rusher_player_id"]][key]
            b[0] += 1; b[1] += r0(p["yards_gained"]); b[2] += (0.0 if pd.isna(p["epa"]) else float(p["epa"]))
        for gid, gaps in by_rush.items():
            if isinstance(gid, str) and sum(v[0] for v in gaps.values()) >= 20:
                rushes[gid][yr] = {k: [v[0], v[1], round(v[2], 1)] for k, v in gaps.items()}

        nfl.clear_cache()   # drop this season's downloads before the next
        print(f"  {season}: {len(ps.player_id.unique())} stat players, "
              f"{sum(1 for g in targets if yr in targets[g])} receivers, "
              f"{sum(1 for g in rushes if yr in rushes[g])} rushers")

    # assemble outputs
    out_players, index = {}, []
    for gid, rec in players.items():
        if not rec["seasons"]:
            continue
        info = ident.get(gid, {"name": gid, "pos": "", "hs": ""})
        team = rec.get("_team", info.get("team", "")) or ""
        pos = info["pos"] or ""
        out_players[gid] = {
            "id": gid, "name": info["name"], "pos": pos, "grp": grp(pos), "team": team,
            "hs": info["hs"], "seasons": rec["seasons"],
        }
        index.append({"id": gid, "name": info["name"], "pos": pos, "team": team})

    index.sort(key=lambda x: x["name"])
    teams_idx = sorted({p["team"] for p in index if p["team"]})

    DATA.mkdir(exist_ok=True); PUB.mkdir(exist_ok=True)
    (PUB / "search_index.json").write_text(json.dumps(
        {"players": index, "teams": teams_idx, "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d")},
        separators=(",", ":")))
    meta = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "seasons": [str(s) for s in seasons]}
    (PUB / "players.json").write_text(json.dumps({**meta, "players": out_players}, separators=(",", ":")))
    (PUB / "targets.json").write_text(json.dumps({**meta, "data": targets}, separators=(",", ":")))
    (PUB / "rushes.json").write_text(json.dumps({**meta, "data": rushes}, separators=(",", ":")))

    print(f"players {len(out_players)}, index {len(index)}, "
          f"players.json {(PUB/'players.json').stat().st_size/1e6:.2f}MB, "
          f"targets.json {(PUB/'targets.json').stat().st_size/1e6:.2f}MB")


if __name__ == "__main__":
    main()
