"""Export the fantasy SQLite database to a JSON file the web dashboard can read.

    python export_json.py            # export from the existing nfl_fantasy.db
    python export_json.py --refresh  # download the latest stats first, rebuild the DB, then export

Writes web/data/players.json.
"""
import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from fantasy_nfl_draft import (
    DB_PATH,
    add_position_medians,
    build_sqlite_db,
    fetch_weekly_player_stats,
    generate_recommendation,
)

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
    """One entry per player_id with every weekly score.

    Averages, totals and consistency are calculated in the browser so the site can
    show any single season or all seasons combined from the same data.
    """
    players = []
    for (player_id, position), games in weekly.groupby(["player_id", "position"]):
        latest = games.iloc[-1]  # rows are sorted by season/week, so the last row is the most recent game
        players.append({
            "id": player_id,
            "name": latest["player_name"],
            "position": position,
            "team": latest["recent_team"],
            # Compact [season, week, points, team] rows keep the file small.
            "weeks": [[int(s), int(w), round(float(p), 2), t]
                      for s, w, p, t in zip(games["season"], games["week"], games["fantasy_points"], games["recent_team"])],
        })
    return players


def build_positions(seasons: list[int], db_path: Path = DB_PATH) -> dict:
    """Position summaries keyed by season ("all" = every season combined)."""
    out = {}
    for season in [None, *seasons]:
        summary = add_position_medians(db_path, season)
        out["all" if season is None else str(season)] = [
            {
                "position": row["position"],
                "players": int(row["players"]),
                "games": int(row["games"]),
                "avg": round(float(row["avg_points"]), 2),
                "median": round(float(row["median_points"]), 2),
                "peak": round(float(row["peak_week"]), 2),
                "recommendation": generate_recommendation(summary, row["position"]),
            }
            for _, row in summary.iterrows()
        ]
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--refresh", action="store_true", help="Download the latest stats and rebuild the database first.")
    parser.add_argument("--years", nargs="+", type=int, default=None, help="Seasons to download with --refresh.")
    args = parser.parse_args()

    if args.refresh:
        print("Downloading latest weekly stats...")
        build_sqlite_db(fetch_weekly_player_stats(args.years))

    weekly = load_weekly()
    seasons = sorted(int(s) for s in weekly["season"].unique())
    latest = weekly[weekly["season"] == seasons[-1]]
    data = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "seasons": seasons,
        "latest": {"season": seasons[-1], "week": int(latest["week"].max())},
        "positions": build_positions(seasons),
        "players": build_players(weekly),
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"Exported {len(data['players'])} players ({len(weekly)} weekly records, seasons "
          f"{seasons[0]}-{seasons[-1]}, through {seasons[-1]} week {data['latest']['week']}) "
          f"to {OUT_PATH} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
