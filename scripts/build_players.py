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

STAT_FIRST = 1999   # full career season stats (player_stats goes back to 1999)
SNAP_FIRST = 2013   # snap counts start 2013
MAP_FIRST = 2021    # pbp-based receiving/rushing maps (play-by-play is heavy)
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
    targets = defaultdict(dict)                       # gid -> {yr: [[lane,ay,catch,epa,yds],...]}  (receiver)
    passes = defaultdict(dict)                        # gid -> {yr: [[lane,ay,complete,epa,yds],...]}  (passer)
    rushes = defaultdict(dict)                        # gid -> {yr: {gap: [att,yds,epaSum,stuffed]}}

    # ── full-career season stats (player_stats back to 1999) ─────────────────
    for season in range(STAT_FIRST, cur + 1):
        ps = nfl.load_player_stats(seasons=[season]).to_pandas()
        ps = ps[ps["season_type"] == "REG"]
        for gid, rows in ps.groupby("player_id"):
            if not isinstance(gid, str):
                continue
            if gid not in ident:
                ident[gid] = {"name": rows["player_display_name"].iloc[-1],
                              "pos": rows["position"].iloc[-1] if isinstance(rows["position"].iloc[-1], str) else "",
                              "hs": "", "team": ""}
            gpos = ident[gid]["pos"] or (rows["position"].iloc[-1] if isinstance(rows["position"].iloc[-1], str) else "")
            row = season_stat_row(grp(gpos), rows)
            row = {k: v for k, v in row.items() if v or k == "g"}   # drop zeros to stay lean
            players[gid]["seasons"][str(season)] = row
            team = rows["team"].mode().iloc[0] if len(rows["team"].mode()) else ident[gid]["team"]
            players[gid]["_team"] = team
            players[gid].setdefault("tmYr", {})[str(season)] = team
            hs = rows["headshot_url"].dropna()
            if not ident[gid]["hs"] and len(hs):
                ident[gid]["hs"] = hs.iloc[-1]
        if season % 4 == 0:
            nfl.clear_cache()
    print(f"  career stats: {STAT_FIRST}-{cur}")

    # ── snaps (2013+, join via pfr id) ───────────────────────────────────────
    for season in range(SNAP_FIRST, cur + 1):
        sc = nfl.load_snap_counts(seasons=[season]).to_pandas()
        sc = sc[sc["game_type"] == "REG"]
        snap = sc.groupby("pfr_player_id").agg(o=("offense_snaps", "sum"), d=("defense_snaps", "sum"),
                                               st=("st_snaps", "sum"), team=("team", lambda x: x.mode().iloc[0])).reset_index()
        yr = str(season)
        for _, r in snap.iterrows():
            gid = pfr2gsis.get(r["pfr_player_id"])
            if not gid or gid not in ident:
                continue
            if yr not in players[gid]["seasons"]:
                players[gid]["seasons"][yr] = {"g": 0}
                players[gid]["_team"] = r["team"]
                players[gid].setdefault("tmYr", {}).setdefault(yr, r["team"])
            for k, v in (("osnp", r0(r["o"])), ("dsnp", r0(r["d"])), ("stsnp", r0(r["st"]))):
                if v:
                    players[gid]["seasons"][yr][k] = v
    nfl.clear_cache()

    # ── receiving/rushing field maps + league baselines + team defense ───────
    lane = {"left": 0, "middle": 1, "right": 2}
    gapmap = {("left", "end"): "LE", ("left", "tackle"): "LT", ("left", "guard"): "LG",
              ("right", "end"): "RE", ("right", "tackle"): "RT", ("right", "guard"): "RG"}
    BINS = [-100, 0, 5, 10, 15, 20, 30, 100]

    def zbin(ay):
        for i in range(7):
            if BINS[i] <= ay < BINS[i + 1]:
                return i
        return 6

    league = {"pass": {}, "rush": {}}          # per-season baselines
    team_passdef = defaultdict(dict)           # team -> {yr: {z, N}}
    team_rushdef = defaultdict(dict)           # team -> {yr: {g, N}}

    for season in range(MAP_FIRST, cur + 1):
        pbp = nfl.load_pbp(seasons=[season]).to_pandas()
        yr = str(season)
        pas = pbp[(pbp["play_type"] == "pass") & pbp["air_yards"].notna()
                  & pbp["pass_location"].isin(["left", "middle", "right"])]
        by_rec, by_pass = defaultdict(list), defaultdict(list)
        lgz = [[0, 0, 0.0, 0] for _ in range(21)]; lgn = 0     # league pass zones
        tdz = defaultdict(lambda: [[0, 0, 0.0, 0] for _ in range(21)]); tdn = defaultdict(int)
        for _, p in pas.iterrows():
            comp = int(p["complete_pass"] == 1); ep = 0.0 if pd.isna(p["epa"]) else float(p["epa"]); yg = r0(p["yards_gained"])
            row = [lane[p["pass_location"]], r0(p["air_yards"]), comp, round(ep, 1), yg]
            if isinstance(p["receiver_player_id"], str):
                by_rec[p["receiver_player_id"]].append(row)
            if isinstance(p["passer_player_id"], str):
                by_pass[p["passer_player_id"]].append(row)
            z = lane[p["pass_location"]] * 7 + zbin(r0(p["air_yards"]))
            a = lgz[z]; a[0] += 1; a[1] += comp; a[2] += ep; a[3] += yg; lgn += 1
            dt = p["defteam"]
            if isinstance(dt, str):
                b = tdz[dt][z]; b[0] += 1; b[1] += comp; b[2] += ep; b[3] += yg; tdn[dt] += 1
        for gid, arr in by_rec.items():
            if len(arr) >= 10:
                targets[gid][yr] = arr
        for gid, arr in by_pass.items():
            if len(arr) >= 30:
                passes[gid][yr] = arr
        league["pass"][yr] = {"z": [[a[0], a[1], round(a[2], 1), a[3]] for a in lgz], "N": lgn}
        for tm, z in tdz.items():
            team_passdef[tm][yr] = {"z": [[a[0], a[1], round(a[2], 1), a[3]] for a in z], "N": tdn[tm]}

        run = pbp[(pbp["play_type"] == "run") & pbp["rusher_player_id"].notna()]
        by_rush = defaultdict(lambda: defaultdict(lambda: [0, 0, 0.0, 0]))
        lgg = defaultdict(lambda: [0, 0, 0.0, 0]); lgan = 0    # league rush gaps
        tdg = defaultdict(lambda: defaultdict(lambda: [0, 0, 0.0, 0])); tdan = defaultdict(int)
        for _, p in run.iterrows():
            loc, gp = p["run_location"], p["run_gap"]
            key = "M" if (loc == "middle" or not isinstance(loc, str)) else gapmap.get((loc, gp if isinstance(gp, str) else "tackle"), f"{loc[0].upper()}T")
            yg = r0(p["yards_gained"]); ep = 0.0 if pd.isna(p["epa"]) else float(p["epa"]); st = int(yg <= 0)
            b = by_rush[p["rusher_player_id"]][key]; b[0] += 1; b[1] += yg; b[2] += ep; b[3] += st
            lg = lgg[key]; lg[0] += 1; lg[1] += yg; lg[2] += ep; lg[3] += st; lgan += 1
            dt = p["defteam"]
            if isinstance(dt, str):
                tg = tdg[dt][key]; tg[0] += 1; tg[1] += yg; tg[2] += ep; tg[3] += st; tdan[dt] += 1
        for gid, gaps in by_rush.items():
            if isinstance(gid, str) and sum(v[0] for v in gaps.values()) >= 20:
                rushes[gid][yr] = {k: [v[0], v[1], round(v[2], 1), v[3]] for k, v in gaps.items()}
        league["rush"][yr] = {"g": {k: [v[0], v[1], round(v[2], 1), v[3]] for k, v in lgg.items()}, "N": lgan}
        for tm, g in tdg.items():
            team_rushdef[tm][yr] = {"g": {k: [v[0], v[1], round(v[2], 1), v[3]] for k, v in g.items()}, "N": tdan[tm]}

        nfl.clear_cache()
        print(f"  {season}: {sum(1 for g in targets if yr in targets[g])} receivers, "
              f"{sum(1 for g in rushes if yr in rushes[g])} rushers, {len(tdz)} team defenses")

    # assemble outputs
    out_players, index = {}, []
    for gid, rec in players.items():
        if not rec["seasons"]:
            continue
        info = ident.get(gid, {"name": gid, "pos": "", "hs": ""})
        name = info["name"] if isinstance(info["name"], str) and info["name"] else None
        if not name:
            continue
        team = rec.get("_team", info.get("team", "")) or ""
        pos = info["pos"] or ""
        hs = info["hs"] if isinstance(info["hs"], str) else ""
        out_players[gid] = {
            "id": gid, "name": name, "pos": pos, "grp": grp(pos), "team": team,
            "hs": hs, "seasons": rec["seasons"], "tms": rec.get("tmYr", {}),
        }
        index.append({"id": gid, "name": name, "pos": pos, "team": team})

    index.sort(key=lambda x: x["name"])
    teams_idx = sorted({p["team"] for p in index if p["team"]})

    DATA.mkdir(exist_ok=True); PUB.mkdir(exist_ok=True)
    (PUB / "search_index.json").write_text(json.dumps(
        {"players": index, "teams": teams_idx, "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d")},
        separators=(",", ":")))
    upd = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    (PUB / "players.json").write_text(json.dumps(
        {"updated": upd, "seasons": [str(s) for s in range(STAT_FIRST, cur + 1)], "players": out_players}, separators=(",", ":")))
    map_meta = {"updated": upd, "seasons": [str(s) for s in range(MAP_FIRST, cur + 1)]}
    (PUB / "targets.json").write_text(json.dumps({**map_meta, "data": targets}, separators=(",", ":")))
    (PUB / "passes.json").write_text(json.dumps({**map_meta, "data": passes}, separators=(",", ":")))
    (PUB / "rushes.json").write_text(json.dumps({**map_meta, "data": rushes}, separators=(",", ":")))
    (PUB / "field_league.json").write_text(json.dumps({**map_meta, **league}, separators=(",", ":")))
    (PUB / "team_passdef.json").write_text(json.dumps({**map_meta, "data": team_passdef}, separators=(",", ":")))
    (PUB / "team_rushdef.json").write_text(json.dumps({**map_meta, "data": team_rushdef}, separators=(",", ":")))

    print(f"players {len(out_players)}, index {len(index)}, "
          f"players.json {(PUB/'players.json').stat().st_size/1e6:.2f}MB, "
          f"targets.json {(PUB/'targets.json').stat().st_size/1e6:.2f}MB")


if __name__ == "__main__":
    main()
