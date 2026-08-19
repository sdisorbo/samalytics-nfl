#!/usr/bin/env python3
"""
build_games.py  —  Samalytics NFL games / matchups dataset

Runs the SAME Elo model as build_data.py chronologically across seasons
(2021 → the upcoming one) and, for every game, records each team's pre-game
Elo, the Elo-based home win probability, and how much Elo each side would gain
on a win / lose on a loss. Upcoming (unplayed) games therefore carry each
team's preseason-projected Elo; as games are played the in-season action
re-runs this and later weeks reflect the new ratings.

Output: data/games.json
    { updated, seasons:[...], data:{ "2026": [ {game}, ... ] } }

NOTE: the Elo constants below MUST match scripts/build_data.py.
"""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import nflreadpy as nfl

BASE = 1500.0
K = 20.0
HFA = 48.0
CARRY = 0.70
MARGIN = 10          # representative margin for the projected win/loss Elo swing
FIRST = 2021
OUT = Path(__file__).resolve().parent.parent / "data"


def win_prob(elo_a, elo_b, hfa=0.0):
    return 1.0 / (1.0 + 10.0 ** (-((elo_a + hfa) - elo_b) / 400.0))


def mov_mult(elo_w, elo_l, margin):
    return math.log(margin + 1.0) * (2.2 / ((elo_w - elo_l) * 0.001 + 2.2))


def played(hs, as_):
    return not (hs is None or as_ is None or (isinstance(hs, float) and math.isnan(hs)))


def main():
    cur = nfl.get_current_season()
    seasons = list(range(FIRST, cur + 2))          # include the upcoming season
    elo = None
    data = {}

    for si, season in enumerate(seasons):
        try:
            df = nfl.load_schedules(seasons=[season]).to_pandas()
        except Exception:
            continue
        reg = df[df["game_type"] == "REG"]
        if not len(reg):
            continue

        teams = sorted(set(reg["home_team"]) | set(reg["away_team"]))
        if elo is None:
            elo = {t: BASE for t in teams}
        else:
            for t in teams:
                elo.setdefault(t, BASE)
            for t in elo:                           # offseason regression toward mean
                elo[t] = BASE + CARRY * (elo[t] - BASE)

        reg = reg.sort_values(["gameday", "gametime"])
        games = []
        for _, g in reg.iterrows():
            h, a = g["home_team"], g["away_team"]
            he, ae = elo[h], elo[a]
            neutral = str(g.get("location", "Home")) != "Home"
            hfa = 0.0 if neutral else HFA
            he_eff, ae_eff = he + hfa, ae
            hwp = win_prob(he, ae, hfa)

            # Elo at stake at a representative margin (zero-sum per game)
            d1 = K * mov_mult(he_eff, ae_eff, MARGIN) * (1 - hwp)   # home wins
            d2 = K * mov_mult(ae_eff, he_eff, MARGIN) * hwp         # away wins

            hs, as_ = g["home_score"], g["away_score"]
            done = played(hs, as_)
            games.append({
                "wk": int(g["week"]),
                "date": str(g["gameday"]),
                "day": str(g["weekday"])[:3],
                "time": (str(g["gametime"]) if not pd.isna(g["gametime"]) else ""),
                "away": a, "home": h,
                "ae": round(ae, 0), "he": round(he, 0),
                "hwp": round(hwp, 3),
                "hWin": round(d1), "hLoss": -round(d2),
                "aWin": round(d2), "aLoss": -round(d1),
                "neutral": neutral,
                "as": int(as_) if done else None,
                "hs": int(hs) if done else None,
            })

            if done:                                # only played games move Elo
                hs, as_ = int(hs), int(as_)
                exp_h = win_prob(he, ae, hfa)
                if hs > as_:
                    s_h, ew, el = 1.0, he_eff, ae
                elif hs < as_:
                    s_h, ew, el = 0.0, ae, he_eff
                else:
                    s_h, ew, el = 0.5, he_eff, ae
                m = max(abs(hs - as_), 1)
                delta = K * mov_mult(ew, el, m) * (s_h - exp_h)
                elo[h] += delta
                elo[a] -= delta

        data[str(season)] = games
        n_done = sum(1 for g in games if g["as"] is not None)
        print(f"  {season}: {len(games)} games ({n_done} played)")

    OUT.mkdir(exist_ok=True)
    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "seasons": list(data.keys()),
        "data": data,
    }
    path = OUT / "games.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path}  ({path.stat().st_size/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
