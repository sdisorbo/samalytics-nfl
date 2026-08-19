#!/usr/bin/env python3
"""
build_data.py  —  Samalytics NFL Elo engine

Builds the dataset the site serves, straight from LIVE nflverse data
(nflreadpy). One combined elo.json across seasons + a meta manifest, so adding
a season needs no front-end code changes -- just re-run this script.

Model
-----
Elo, 538-style. All 32 teams open 2021 at 1500. Each game moves the two teams
by a margin-of-victory-scaled K update with a home-field bump. Between seasons a
team keeps most of its rating but is pulled part-way back to 1500 (CARRY), so a
good team stays good but nobody is locked in -- "some brevity between seasons".

Playoffs
--------
Seeds and the field are read from the ACTUAL postseason games in the schedule
(who hosted the Wild Card round, who had the bye), so historical brackets are
exactly right. From each team's end-of-regular-season Elo we then Monte-Carlo
the bracket forward to get the chance of reaching each round and winning it all.

Outputs (data/)
    elo.json    per-season teams, odds, and Elo trend for the chart
    teams.json  abbr -> name / color / logo / conf / division
    meta.json   season manifest + latest

Usage
    python scripts/build_data.py
"""
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import nflreadpy as nfl

# ── model constants ─────────────────────────────────────────────────────────
SEASONS   = [2021, 2022, 2023, 2024, 2025]
BASE      = 1500.0     # league average
K         = 20.0       # update speed
HFA       = 48.0       # home-field advantage, in Elo points
CARRY     = 0.70       # offseason: new = 1500 + CARRY*(old - 1500)  (regress 30%)
N_SIMS    = 30000      # Monte-Carlo playoff simulations
SEED      = 17

OUT = Path(__file__).resolve().parent.parent / "data"
POST_TYPES = {"WC", "DIV", "CON", "SB"}


# ── Elo math ─────────────────────────────────────────────────────────────────
def win_prob(elo_a: float, elo_b: float, hfa: float = 0.0) -> float:
    """P(team A beats team B), with hfa Elo added to A (0 = neutral site)."""
    return 1.0 / (1.0 + 10.0 ** (-((elo_a + hfa) - elo_b) / 400.0))


def update(elo_h, elo_a, score_h, score_a, neutral):
    """Return (new_home, new_away) after one game."""
    hfa = 0.0 if neutral else HFA
    exp_h = win_prob(elo_h, elo_a, hfa)
    if score_h > score_a:
        s_h, elo_w, elo_l = 1.0, elo_h + hfa, elo_a
    elif score_h < score_a:
        s_h, elo_w, elo_l = 0.0, elo_a, elo_h + hfa
    else:
        s_h, elo_w, elo_l = 0.5, elo_h + hfa, elo_a
    margin = max(abs(score_h - score_a), 1)
    # 538 margin-of-victory multiplier (dampens as favorite's edge grows)
    mult = math.log(margin + 1.0) * (2.2 / ((elo_w - elo_l) * 0.001 + 2.2))
    delta = K * mult * (s_h - exp_h)
    return elo_h + delta, elo_a - delta


# ── load ─────────────────────────────────────────────────────────────────────
def load_team_meta(season_abbrs):
    """abbr -> {name,color,logo,conf,division}, limited to teams that actually play."""
    t = nfl.load_teams().to_pandas().drop_duplicates("team_abbr", keep="first")
    meta = {}
    for _, r in t.iterrows():
        ab = r["team_abbr"]
        if ab not in season_abbrs:
            continue
        color = r["team_color"] if isinstance(r["team_color"], str) and r["team_color"].startswith("#") else "#0B691C"
        meta[ab] = {
            "name": r["team_name"],
            "color": color,
            "logo": r["team_logo_espn"],
            "conf": r["team_conf"],
            "division": r["team_division"],
        }
    return meta


# ── standings / seeding ──────────────────────────────────────────────────────
def regular_records(reg):
    rec = defaultdict(lambda: {"w": 0, "l": 0, "t": 0, "pf": 0, "pa": 0})
    for _, g in reg.iterrows():
        h, a = g["home_team"], g["away_team"]
        hs, as_ = g["home_score"], g["away_score"]
        if hs is None or as_ is None or (isinstance(hs, float) and math.isnan(hs)):
            continue
        hs, as_ = int(hs), int(as_)
        rec[h]["pf"] += hs; rec[h]["pa"] += as_
        rec[a]["pf"] += as_; rec[a]["pa"] += hs
        if hs > as_:
            rec[h]["w"] += 1; rec[a]["l"] += 1
        elif hs < as_:
            rec[h]["l"] += 1; rec[a]["w"] += 1
        else:
            rec[h]["t"] += 1; rec[a]["t"] += 1
    return rec


def win_pct(r):
    g = r["w"] + r["l"] + r["t"]
    return (r["w"] + 0.5 * r["t"]) / g if g else 0.0


def seed_playoffs(reg, post, meta, rec):
    """Return {abbr: seed 1..7} using actual postseason games when available."""
    conf_of = {a: meta[a]["conf"] for a in meta}
    seeds = {}

    wc = post[post["game_type"] == "WC"] if len(post) else post
    if len(wc):
        # Home teams in the Wild Card round are the division winners seeded 2-4;
        # the bye team (seed 1) is the conference's playoff team not playing that week.
        for conf in ("AFC", "NFC"):
            games = wc[[conf_of.get(h) == conf for h in wc["home_team"]]]
            hosts = list(games["home_team"])        # seeds 2,3,4
            visitors = list(games["away_team"])     # seeds 5,6,7
            playoff_teams = set(hosts) | set(visitors)
            # who else from this conf appears anywhere in the postseason -> the bye
            conf_post = set()
            for _, g in post.iterrows():
                for tm in (g["home_team"], g["away_team"]):
                    if conf_of.get(tm) == conf:
                        conf_post.add(tm)
            bye = list(conf_post - playoff_teams)
            # Seed 1 is exactly the bye team (it alone skips the Wild Card round);
            # the three hosts are seeds 2-4, ordered by record (approx tiebreak).
            hosts_sorted = sorted(set(hosts),
                                  key=lambda a: (-win_pct(rec[a]), -(rec[a]["pf"] - rec[a]["pa"])))
            div_winners = (bye[:1]) + hosts_sorted
            wilds = sorted(set(visitors),
                           key=lambda a: (-win_pct(rec[a]), -(rec[a]["pf"] - rec[a]["pa"])))
            for i, a in enumerate(div_winners[:4]):
                seeds[a] = i + 1
            for i, a in enumerate(wilds[:3]):
                seeds[a] = 5 + i
        return seeds

    # Fallback (season with no postseason yet): compute from records.
    by_div = defaultdict(list)
    for a in meta:
        by_div[(meta[a]["conf"], meta[a]["division"])].append(a)
    for conf in ("AFC", "NFC"):
        winners, rest = [], []
        for (c, _), teams in by_div.items():
            if c != conf:
                continue
            teams = sorted(teams, key=lambda a: (-win_pct(rec[a]), -(rec[a]["pf"] - rec[a]["pa"])))
            winners.append(teams[0]); rest.extend(teams[1:])
        winners = sorted(winners, key=lambda a: (-win_pct(rec[a]), -(rec[a]["pf"] - rec[a]["pa"])))
        rest = sorted(rest, key=lambda a: (-win_pct(rec[a]), -(rec[a]["pf"] - rec[a]["pa"])))
        for i, a in enumerate(winners[:4]):
            seeds[a] = i + 1
        for i, a in enumerate(rest[:3]):
            seeds[a] = 5 + i
    return seeds


# ── Monte-Carlo the bracket ──────────────────────────────────────────────────
def simulate(seeds, elo, meta, rng):
    """Return odds dict abbr -> {make,div,conf,sb,won} from N_SIMS bracket sims."""
    conf_seed = {c: {} for c in ("AFC", "NFC")}
    for a, s in seeds.items():
        conf_seed[meta[a]["conf"]][s] = a
    field = list(seeds.keys())
    reach = {a: {"div": 0, "conf": 0, "sb": 0, "won": 0} for a in field}

    def game(a, b, neutral=False):
        # a hosts (higher seed); neutral for the Super Bowl
        p = win_prob(elo[a], elo[b], 0.0 if neutral else HFA)
        return a if rng.random() < p else b

    for _ in range(N_SIMS):
        finalists = {}
        for conf in ("AFC", "NFC"):
            s = conf_seed[conf]
            if len(s) < 7:
                continue
            # Wild Card: 2v7, 3v6, 4v5 (higher seed hosts); 1 has a bye
            w1 = game(s[2], s[7]); w2 = game(s[3], s[6]); w3 = game(s[4], s[5])
            for t in (s[1], w1, w2, w3):
                reach[t]["div"] += 1
            # Divisional: reseed -> seed 1 plays the lowest remaining seed
            remaining = sorted([s[1], w1, w2, w3], key=lambda a: seeds[a])
            top, low = remaining[0], remaining[-1]
            mid = [x for x in remaining if x not in (top, low)]
            d1 = game(top, low)
            d2 = game(mid[0], mid[1])  # higher seed listed first after sort? ensure host
            d2 = game(*sorted([mid[0], mid[1]], key=lambda a: seeds[a]))
            for t in (d1, d2):
                reach[t]["conf"] += 1
            champ = game(*sorted([d1, d2], key=lambda a: seeds[a]))
            reach[champ]["sb"] += 1
            finalists[conf] = champ
        if len(finalists) == 2:
            a, b = finalists["AFC"], finalists["NFC"]
            winner = game(a, b, neutral=True)
            reach[winner]["won"] += 1

    odds = {}
    for a in field:
        r = reach[a]
        odds[a] = {
            "make": 1.0,
            "div": round(r["div"] / N_SIMS, 4),
            "conf": round(r["conf"] / N_SIMS, 4),
            "sb": round(r["sb"] / N_SIMS, 4),
            "won": round(r["won"] / N_SIMS, 4),
        }
    return odds


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    rng = np.random.default_rng(SEED)
    print("loading schedules…")
    sched = {s: nfl.load_schedules(seasons=[s]).to_pandas() for s in SEASONS}

    abbrs = set()
    for s in SEASONS:
        abbrs |= set(sched[s]["home_team"]) | set(sched[s]["away_team"])
    meta = load_team_meta(abbrs)
    print(f"  {len(meta)} teams")

    elo = {a: BASE for a in meta}       # running rating, carried across seasons
    elo_json = {}

    for si, season in enumerate(SEASONS):
        if si > 0:
            for a in elo:               # offseason regression toward the mean
                elo[a] = BASE + CARRY * (elo[a] - BASE)

        df = sched[season]
        reg = df[df["game_type"] == "REG"].sort_values(["gameday", "gametime"])
        post = df[df["game_type"].isin(POST_TYPES)]

        trend = defaultdict(list)       # abbr -> [{date, rating}]
        band_dates = []
        seen_dates = set()

        for _, g in reg.iterrows():
            h, a = g["home_team"], g["away_team"]
            hs, as_ = g["home_score"], g["away_score"]
            if hs is None or as_ is None or (isinstance(hs, float) and math.isnan(hs)):
                continue
            neutral = str(g.get("location", "Home")) != "Home"
            nh, na = update(elo[h], elo[a], int(hs), int(as_), neutral)
            elo[h], elo[a] = nh, na
            d = str(g["gameday"])
            trend[h].append({"date": d, "rating": round(elo[h], 1)})
            trend[a].append({"date": d, "rating": round(elo[a], 1)})
            if d not in seen_dates:
                seen_dates.add(d); band_dates.append(d)

        rec = regular_records(reg)
        seeds = seed_playoffs(reg, post, meta, rec)
        odds = simulate(seeds, elo, meta, rng) if seeds else {}

        # division ranks
        by_div = defaultdict(list)
        for a in meta:
            by_div[meta[a]["division"]].append(a)
        div_rank = {}
        for div, teams in by_div.items():
            for i, a in enumerate(sorted(teams, key=lambda x: (-win_pct(rec[x]),
                                          -(rec[x]["pf"] - rec[x]["pa"])))):
                div_rank[a] = i + 1

        teams_out = []
        for a in meta:
            r = rec[a]
            teams_out.append({
                "abbr": a,
                "name": meta[a]["name"],
                "logo": meta[a]["logo"],
                "conf": meta[a]["conf"],
                "division": meta[a]["division"],
                "seed": seeds.get(a),
                "div_rank": div_rank[a],
                "elo": round(elo[a], 1),
                "record": {"w": r["w"], "l": r["l"], "t": r["t"]},
                "win_pct": round(win_pct(r), 4),
                "pf": r["pf"], "pa": r["pa"],
                "made": a in seeds,
                "odds": odds.get(a, {"make": 0.0, "div": 0.0, "conf": 0.0, "sb": 0.0, "won": 0.0}),
            })
        teams_out.sort(key=lambda t: -t["elo"])

        # band: min/max/avg of carried-forward ratings over the date scaffold
        carry = {a: BASE for a in meta}
        idx = {a: 0 for a in meta}
        band = []
        for d in band_dates:
            for a in meta:
                pts = trend[a]
                while idx[a] < len(pts) and pts[idx[a]]["date"] <= d:
                    carry[a] = pts[idx[a]]["rating"]; idx[a] += 1
            vals = list(carry.values())
            band.append({"date": d, "min": round(min(vals), 1),
                         "max": round(max(vals), 1), "avg": round(sum(vals) / len(vals), 1)})

        elo_json[str(season)] = {
            "season": str(season),
            "teams": teams_out,
            "trend": {a: trend[a] for a in meta},
            "band": band,
        }
        champ = max(teams_out, key=lambda t: t["odds"]["won"])
        print(f"  {season}: {len(teams_out)} teams, "
              f"top Elo {teams_out[0]['abbr']} {teams_out[0]['elo']:.0f}, "
              f"SB fav {champ['abbr']} {champ['odds']['won']*100:.0f}%")

    OUT.mkdir(exist_ok=True)
    (OUT / "elo.json").write_text(json.dumps(elo_json, separators=(",", ":")))
    (OUT / "teams.json").write_text(json.dumps(meta, separators=(",", ":")))
    manifest = {
        "seasons": [{"code": str(s), "label": str(s)} for s in SEASONS],
        "latest": str(SEASONS[-1]),
    }
    (OUT / "meta.json").write_text(json.dumps(manifest))
    print(f"wrote {OUT}/elo.json, teams.json, meta.json")


if __name__ == "__main__":
    main()
