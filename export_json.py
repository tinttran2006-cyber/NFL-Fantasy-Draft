"""Export the fantasy SQLite database to a JSON file the web dashboard can read.

Run after fantasy_nfl_draft.py has built nfl_fantasy.db:
    python export_json.py
Writes web/data/players.json.
"""
import json
import sqlite3
from pathlib import Path

import pandas as pd

from fantasy_nfl_draft import DB_PATH, VALID_POSITIONS, add_position_medians, generate_recommendation

OUT_PATH = Path(__file__).resolve().parent / "web" / "data" / "players.json"


def load_weekly(db_path: Path = DB_PATH) -> pd.DataFrame:
    sql = """
        SELECT player_id, player_name, position, recent_team, season, week, fantasy_points
        FROM player_weekly_stats
        ORDER BY player_id, season, week
    """
    with sqlite3.connect(db_path) as conn:
        return pd.read_sql_query(sql, conn)


def build_players(weekly: pd.DataFrame) -> list[dict]:
    """One entry per player_id with season totals plus every weekly score (for charts and comparisons)."""
    players = []
    for (player_id, position), games in weekly.groupby(["player_id", "position"]):
        points = games["fantasy_points"]
        latest = games.iloc[-1]  # rows are sorted by season/week, so the last row is the most recent game
        players.append({
            "id": player_id,
            "name": latest["player_name"],
            "position": position,
            "team": latest["recent_team"],
            "games": int(len(games)),
            "avg": round(float(points.mean()), 2),
            "total": round(float(points.sum()), 2),
            "peak": round(float(points.max()), 2),
            # Standard deviation = week-to-week consistency (lower is steadier). 0 when only one game.
            "stdev": round(float(points.std(ddof=0)), 2),
            # Compact [season, week, points] triples keep the file small.
            "weeks": [[int(s), int(w), round(float(p), 2)]
                      for s, w, p in zip(games["season"], games["week"], points)],
        })
    return sorted(players, key=lambda p: p["avg"], reverse=True)


def build_positions(db_path: Path = DB_PATH) -> list[dict]:
    summary = add_position_medians(db_path)
    rows = []
    for _, row in summary.iterrows():
        rows.append({
            "position": row["position"],
            "players": int(row["players"]),
            "games": int(row["games"]),
            "avg": round(float(row["avg_points"]), 2),
            "median": round(float(row["median_points"]), 2),
            "peak": round(float(row["peak_week"]), 2),
            "recommendation": generate_recommendation(summary, row["position"]),
        })
    return rows


def main() -> None:
    weekly = load_weekly()
    data = {
        "seasons": sorted(int(s) for s in weekly["season"].unique()),
        "positions": build_positions(),
        "players": build_players(weekly),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"Exported {len(data['players'])} players ({len(weekly)} weekly records) "
          f"for positions {', '.join(VALID_POSITIONS)} to {OUT_PATH} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
