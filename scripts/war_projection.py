#!/usr/bin/env python3
"""
war_projection.py  —  does fantasy WAR carry year to year, and can we predict it?

1. Recompute each player's fantasy WAR per season (default 12-team half-PPR
   settings, matching the site's engine).
2. Measure year-over-year stability (correlation) overall and by position.
3. Build a next-season prediction dataset and compare baselines vs Ridge vs
   XGBoost with a time-based holdout (train on transitions into 2022-2024, test
   on into 2025).
4. Project 2026 WAR from 2025.

Run: ../.deadcap_venv/bin/python scripts/war_projection.py
"""
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import r2_score, mean_absolute_error
from xgboost import XGBRegressor
import nflreadpy as nfl

ROOT = Path(__file__).resolve().parent.parent
POS_ALL = ["QB", "RB", "WR", "TE", "K", "DST"]
MODEL_POS = ["QB", "RB", "WR", "TE"]          # positions we actually try to predict

# ── WAR engine (default settings, mirrors app/lib/fantasy.ts) ────────────────
def erf(x):
    t = 1 / (1 + 0.3275911 * abs(x))
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-x * x)
    return y if x >= 0 else -y
Phi = lambda z: 0.5 * (1 + erf(z / math.sqrt(2)))

PA_TIERS = [(0, 10), (6, 7), (13, 4), (20, 1), (27, 0), (34, -1), (99, -4)]
def pa_pts(pa):
    for m, p in PA_TIERS:
        if pa <= m:
            return p
    return -4
def so(w):  # offense week
    return (w[1]*.04 + w[2]*4 - w[3]*2 + w[4]*2 + w[5]*.1 + w[6]*6 + w[7]*2
            + w[8]*.5 + w[9]*.1 + w[10]*6 + w[11]*2 - w[12]*2)
def sk(w):  # kicker
    return w[1]*3 + w[2]*4 + w[3]*5 + w[4] - w[5] - w[6]
def sd(w):  # dst
    return pa_pts(w[1]) + w[2] + w[3]*2 + w[4]*2 + w[5]*6 + w[6]*6 + w[7]*2 + w[8]*2

def compute_war(season_data):
    """-> {gid: {'war','pts','ppg','g','pos','name'}} for one season (12-tm half-PPR)."""
    aggs = []
    for p in season_data["players"]:
        scorer = sk if p["pos"] == "K" else so
        wk = [scorer(w) for w in p["w"]]
        aggs.append((p["id"], p["name"], p["pos"], wk, sum(wk)))
    for d in season_data["dst"]:
        wk = [sd(w) for w in d["w"]]
        aggs.append(("DST-" + d["team"], d["team"] + " D/ST", "DST", wk, sum(wk)))

    pools = {pos: sorted([a for a in aggs if a[2] == pos], key=lambda a: -a[4]) for pos in POS_ALL}
    teams = 12
    ded = {"QB": teams, "RB": teams*2, "WR": teams*2, "TE": teams, "K": teams, "DST": teams}
    rest = []
    for pos in ("RB", "WR", "TE"):
        rest += [(a[4], pos) for a in pools[pos][ded[pos]:]]
    rest.sort(reverse=True)
    add = {"RB": 0, "WR": 0, "TE": 0}
    for _, pos in rest[:teams*2]:
        add[pos] += 1
    starters = dict(ded)
    for pos in ("RB", "WR", "TE"):
        starters[pos] += add[pos]

    repl = {}
    for pos in POS_ALL:
        tier = pools[pos][starters[pos]:starters[pos]+teams]
        ppg = [a[4]/len(a[3]) for a in tier if a[3]]
        repl[pos] = sum(ppg)/len(ppg) if ppg else 0
    pv = {}
    for pos in POS_ALL:
        wp = [x for a in pools[pos][:max(1, starters[pos])] for x in a[3]]
        pv[pos] = float(np.var(wp, ddof=1)) if len(wp) > 1 else 0.0
    fv = (pv["RB"]+pv["WR"]+pv["TE"])/3
    tv = pv["QB"]+2*pv["RB"]+2*pv["WR"]+pv["TE"]+pv["K"]+pv["DST"]+2*fv
    den = max(18, math.sqrt(max(1, tv))) * math.sqrt(2)

    out = {}
    for gid, name, pos, wk, tot in aggs:
        war = sum(Phi((x - repl[pos]) / den) - 0.5 for x in wk)
        g = len(wk)
        out[gid] = {"war": war, "pts": tot, "ppg": tot/g if g else 0, "g": g, "pos": pos, "name": name}
    return out


def main():
    F = json.loads((ROOT / "data" / "fantasy.json").read_text())
    seasons = [int(s) for s in F["seasons"]]
    war = {s: compute_war(F["data"][str(s)]) for s in seasons}

    # richer per-season features (usage, EPA, age)
    PL = json.loads((ROOT / "public" / "players.json").read_text())["players"]
    players_df = nfl.load_players().to_pandas()
    birth = {r["gsis_id"]: r["birth_date"] for _, r in players_df.iterrows() if isinstance(r["gsis_id"], str)}
    def age(gid, yr):
        b = birth.get(gid)
        try:
            return yr - int(str(b)[:4])
        except Exception:
            return np.nan
    def usage(gid, yr):
        s = PL.get(gid, {}).get("seasons", {}).get(str(yr), {})
        return s.get("att", 0) + s.get("car", 0) + s.get("tgt", 0)   # opportunities

    # ── 1. year-over-year stability ──────────────────────────────────────────
    print("=" * 66)
    print("YEAR-OVER-YEAR WAR STABILITY  (WAR_n vs WAR_n+1)")
    print("=" * 66)
    pairs = defaultdict(list)   # pos -> [(war_n, war_n1)]
    allp = []
    for s in seasons[:-1]:
        for gid, d in war[s].items():
            if gid in war[s+1] and d["g"] >= 4:
                nxt = war[s+1][gid]["war"]
                pairs[d["pos"]].append((d["war"], nxt))
                allp.append((d["war"], nxt))
    def corr(xy):
        a = np.array(xy)
        if len(a) < 5:
            return (np.nan, np.nan, len(a))
        r = pearsonr(a[:, 0], a[:, 1])[0]
        rho = spearmanr(a[:, 0], a[:, 1])[0]
        return (r, rho, len(a))
    r, rho, n = corr(allp)
    print(f"  ALL positions: Pearson r={r:.2f}  Spearman ρ={rho:.2f}  (n={n} player-seasons)")
    for pos in POS_ALL:
        r, rho, n = corr(pairs[pos])
        print(f"    {pos:4s}: r={r:5.2f}  ρ={rho:5.2f}  (n={n})")
    # how much does WAR regress? slope of war_n1 ~ war_n
    a = np.array(allp)
    slope, intercept = np.polyfit(a[:, 0], a[:, 1], 1)
    print(f"  regression line: WAR_next ≈ {slope:.2f}·WAR_now + {intercept:.2f}  (retains ~{slope*100:.0f}% of edge)")

    # ── 2. build prediction dataset ──────────────────────────────────────────
    rows = []
    for s in seasons[:-1]:
        for gid, d in war[s].items():
            if d["pos"] not in MODEL_POS or d["g"] < 4 or gid not in war[s+1]:
                continue
            prev = war[s-1][gid]["war"] if (s-1) in war and gid in war[s-1] else np.nan
            rows.append({
                "gid": gid, "name": d["name"], "pos": d["pos"], "from": s, "to": s+1,
                "war": d["war"], "ppg": d["ppg"], "g": d["g"], "pts": d["pts"],
                "age": age(gid, s), "usage": usage(gid, s), "war_prev": prev,
                "y": war[s+1][gid]["war"],
            })
    df = pd.DataFrame(rows)
    df["war_prev"] = df["war_prev"].fillna(df["war"])   # rookies: prior = current
    df["age"] = df["age"].fillna(df["age"].median())
    feats = ["war", "ppg", "g", "pts", "age", "usage", "war_prev"]
    for p in MODEL_POS:
        df[f"is_{p}"] = (df["pos"] == p).astype(int)
    feats += [f"is_{p}" for p in MODEL_POS]

    tr, te = df[df["to"] < seasons[-1]], df[df["to"] == seasons[-1]]
    Xtr, ytr = tr[feats].values, tr["y"].values
    Xte, yte = te[feats].values, te["y"].values
    print("\n" + "=" * 66)
    print(f"NEXT-SEASON PREDICTION  (train n={len(tr)} into ≤{seasons[-1]-1}, test n={len(te)} into {seasons[-1]})")
    print("=" * 66)

    metrics = []
    def report(name, pred):
        m = {"name": name, "r2": round(float(r2_score(yte, pred)), 3),
             "mae": round(float(mean_absolute_error(yte, pred)), 3), "rho": round(float(spearmanr(yte, pred)[0]), 3)}
        metrics.append(m)
        print(f"  {name:22s} R²={m['r2']:5.2f}  MAE={m['mae']:.3f}  ρ={m['rho']:.2f}")

    report("baseline: persistence", te["war"].values)                      # next = this year
    report("baseline: regress-to-mean", slope * te["war"].values + intercept)
    ridge = make_pipeline(StandardScaler(), Ridge(alpha=3.0)).fit(Xtr, ytr)
    report("Ridge regression", ridge.predict(Xte))
    xgb = XGBRegressor(n_estimators=250, max_depth=3, learning_rate=0.04, subsample=0.8,
                       colsample_bytree=0.8, reg_lambda=2.0, random_state=17)
    xgb.fit(Xtr, ytr)
    report("XGBoost", xgb.predict(Xte))

    imp = sorted(zip(feats, xgb.feature_importances_), key=lambda x: -x[1])[:6]
    print("  XGBoost top features:", ", ".join(f"{f}({v:.2f})" for f, v in imp))

    # ── 3. project the upcoming season from the latest one ───────────────────
    last = seasons[-1]
    proj_rows = []
    for gid, d in war[last].items():
        if d["pos"] not in MODEL_POS or d["g"] < 4:
            continue
        prev = war[last-1][gid]["war"] if (last-1) in war and gid in war[last-1] else d["war"]
        proj_rows.append({"gid": gid, "name": d["name"], "pos": d["pos"], "war": d["war"], "ppg": d["ppg"],
                          "g": d["g"], "pts": d["pts"], "age": age(gid, last), "usage": usage(gid, last),
                          "war_prev": prev})
    pdf = pd.DataFrame(proj_rows)
    pdf["age"] = pdf["age"].fillna(pdf["age"].median())
    for p in MODEL_POS:
        pdf[f"is_{p}"] = (pdf["pos"] == p).astype(int)
    # Ridge won the holdout, so project with Ridge retrained on all transitions
    ridge_all = make_pipeline(StandardScaler(), Ridge(alpha=3.0)).fit(df[feats].values, df["y"].values)
    pdf["proj"] = ridge_all.predict(pdf[feats].values)

    # ── write the site data file (projections + stability stats) ─────────────
    fmeta = {p["id"]: {"team": p["team"], "hs": p["hs"]} for p in F["data"][str(last)]["players"]}
    ridge_m = next(m for m in metrics if m["name"] == "Ridge regression")
    site = {
        "updated": pd.Timestamp.utcnow().strftime("%Y-%m-%d"),
        "season": last + 1, "fromSeason": last,
        "stability": {"r": round(float(pearsonr(a[:, 0], a[:, 1])[0]), 2), "slope": round(float(slope), 2),
                      "byPos": {pos: round(corr(pairs[pos])[0], 2) for pos in POS_ALL}, "n": len(allp)},
        "model": {"name": "Ridge regression", "r2": ridge_m["r2"], "mae": ridge_m["mae"], "rho": ridge_m["rho"],
                  "testN": int(len(te)), "trainN": int(len(tr))},
        "players": [
            {"id": r["gid"], "name": r["name"], "pos": r["pos"],
             "team": fmeta.get(r["gid"], {}).get("team", ""), "hs": fmeta.get(r["gid"], {}).get("hs", ""),
             "prev": round(float(r["war"]), 2), "proj": round(float(r["proj"]), 2)}
            for _, r in pdf.sort_values("proj", ascending=False).iterrows()],
    }
    (ROOT / "data" / "war_projections.json").write_text(json.dumps(site, separators=(",", ":")))
    print(f"wrote data/war_projections.json ({len(site['players'])} players)")
    print("\n" + "=" * 66)
    print(f"PROJECTED {last+1} WAR — top 15 (Ridge, from {last})")
    print("=" * 66)
    top = pdf.sort_values("proj", ascending=False).head(15)
    for _, r in top.iterrows():
        print(f"  {r['name']:24s} {r['pos']:3s}  {last} WAR {r['war']:4.2f} → proj {r['proj']:4.2f}")

    # ── export for the visual ────────────────────────────────────────────────
    export = {
        "seasons": seasons,
        "allR": round(float(pearsonr(a[:, 0], a[:, 1])[0]), 3),
        "slope": round(float(slope), 3), "intercept": round(float(intercept), 3),
        "posCorr": {pos: {"r": round(corr(pairs[pos])[0], 3), "rho": round(corr(pairs[pos])[1], 3), "n": corr(pairs[pos])[2]} for pos in POS_ALL},
        "yoy": [{"x": round(x, 2), "y": round(y, 2), "pos": p}
                for p in MODEL_POS for (x, y) in pairs[p]],
        "models": metrics,
        "featImp": [[f, round(float(v), 3)] for f, v in sorted(zip(feats, xgb.feature_importances_), key=lambda x: -x[1])[:7]],
        "proj": [{"name": r["name"], "pos": r["pos"], "war": round(float(r["war"]), 2), "proj": round(float(r["proj"]), 2)}
                 for _, r in pdf.sort_values("proj", ascending=False).head(24).iterrows()],
        "testN": int(len(te)), "trainN": int(len(tr)),
    }
    out = Path("/private/tmp/claude-501/-Users-samdisorbo-Documents-code-python-projects-agora-aug252025/fba296bd-7f97-42f3-bc38-c2010cde78f8/scratchpad/war_analysis.json")
    out.write_text(json.dumps(export))
    print(f"\nexported {out}")


if __name__ == "__main__":
    main()
