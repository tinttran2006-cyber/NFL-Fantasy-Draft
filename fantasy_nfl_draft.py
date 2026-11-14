import argparse
import sqlite3
from datetime import date
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

VALID_POSITIONS = ["QB", "RB", "WR", "TE"]
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
DB_PATH = Path(__file__).resolve().parent / "nfl_fantasy.db"
FIRST_SEASON = 2023

# SQL expression for each scoring format. Half PPR is the midpoint of standard and full PPR
# (0.5 points per catch). Only these fixed strings are ever placed into SQL, never user input.
SCORING_SQL = {
    "standard": "fantasy_points",
    "half": "(fantasy_points + fantasy_points_ppr) / 2.0",
    "ppr": "fantasy_points_ppr",
}
DEFAULT_SCORING = "ppr"


def current_season(today: date | None = None) -> int:
    """NFL seasons start in September, so January-August still belong to last year's season."""
    today = today or date.today()
    return today.year if today.month >= 9 else today.year - 1


def default_years() -> list[int]:
    return list(range(FIRST_SEASON, current_season() + 1))


def fetch_weekly_player_stats(years=None) -> pd.DataFrame:
    """Pull public weekly NFL fantasy data from nflverse (via nflreadpy) and normalize it.

    Only regular-season games are kept: fantasy leagues are decided in the regular season.
    """
    # Imported here, not at the top, so other scripts (like export_json.py) can reuse
    # this module's functions without needing the download library installed.
    import nflreadpy as nfl

    years = list(years or default_years())
    stats = nfl.load_player_stats(seasons=years, summary_level="week")  # returns a Polars DataFrame
    # nflverse renamed "recent_team" to "team" in newer data; accept either.
    team_col = "team" if "team" in stats.columns else "recent_team"
    columns = ["player_id", "season", "week", "season_type", "player_name", "position", team_col,
               "fantasy_points", "fantasy_points_ppr"]
    df = pd.DataFrame(stats.select(columns).to_dicts()).rename(columns={team_col: "recent_team"})

    df = df[(df["season_type"] == "REG") & df["position"].isin(VALID_POSITIONS)].drop(columns="season_type").copy()
    df = df.dropna(subset=["player_id"])
    for col in ["fantasy_points", "fantasy_points_ppr"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    df["player_name"] = df["player_name"].fillna("Unknown")
    df["recent_team"] = df["recent_team"].fillna("FA")
    df["position"] = df["position"].astype(str).str.upper()
    df["season"] = df["season"].astype(int)
    df["week"] = df["week"].astype(int)
    return df.reset_index(drop=True)


def build_sqlite_db(df: pd.DataFrame, db_path: Path = DB_PATH) -> None:
    """Write the clean stats table to SQLite so SQL can be used in the analysis."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        df.to_sql("player_weekly_stats", conn, if_exists="replace", index=False)


def load_position_summary(db_path: Path = DB_PATH, season: int | None = None,
                          scoring: str = DEFAULT_SCORING) -> pd.DataFrame:
    """Per-position averages. Pass a season to limit to that year; None means all seasons."""
    pts = SCORING_SQL[scoring]
    sql = f"""
        SELECT
            position,
            COUNT(DISTINCT player_id) AS players,
            AVG({pts}) AS avg_points,
            MAX({pts}) AS peak_week,
            COUNT(*) AS games
        FROM player_weekly_stats
        WHERE :season IS NULL OR season = :season
        GROUP BY position
        ORDER BY avg_points DESC
    """
    with sqlite3.connect(db_path) as conn:
        return pd.read_sql_query(sql, conn, params={"season": season})


def add_position_medians(db_path: Path = DB_PATH, season: int | None = None,
                         scoring: str = DEFAULT_SCORING) -> pd.DataFrame:
    """Compute median fantasy values in pandas because SQLite does not ship a median aggregate."""
    with sqlite3.connect(db_path) as conn:
        raw = pd.read_sql_query(
            f"SELECT position, {SCORING_SQL[scoring]} AS fantasy_points FROM player_weekly_stats "
            "WHERE :season IS NULL OR season = :season",
            conn, params={"season": season},
        )

    medians = (
        raw.groupby("position", as_index=False)["fantasy_points"]
        .agg(lambda s: s.median())
        .rename(columns={"fantasy_points": "median_points"})
    )
    summary = load_position_summary(db_path, season, scoring)
    return summary.merge(medians, on="position", how="left")


def load_top_players_for_position(position: str, db_path: Path = DB_PATH, limit: int = 10,
                                  scoring: str = DEFAULT_SCORING) -> pd.DataFrame:
    pts = SCORING_SQL[scoring]
    # Group by player_id, not player_name: the data uses short names like "B.Robinson",
    # so different players can share a name and would otherwise be merged together.
    sql = f"""
        SELECT
            s.player_id,
            MAX(s.player_name) AS player_name,
            s.position,
            (
                SELECT t.recent_team
                FROM player_weekly_stats t
                WHERE t.player_id = s.player_id
                ORDER BY t.season DESC, t.week DESC
                LIMIT 1
            ) AS team,
            AVG({pts}) AS avg_points,
            MAX({pts}) AS peak_week,
            COUNT(*) AS games,
            SUM({pts}) AS total_points
        FROM player_weekly_stats s
        WHERE s.position = :position
        GROUP BY s.player_id, s.position
        ORDER BY avg_points DESC, total_points DESC
        LIMIT :limit
    """
    with sqlite3.connect(db_path) as conn:
        df = pd.read_sql_query(sql, conn, params={"position": position, "limit": limit})
    # Label with team so players who share a short name stay distinct in tables and charts.
    df["label"] = df["player_name"] + " (" + df["team"] + ")"
    return df


def generate_recommendation(summary: pd.DataFrame, selected_position: str) -> str:
    top_position = summary.iloc[0]["position"]
    selected_row = summary[summary["position"] == selected_position].iloc[0]
    relative_strength = selected_row["avg_points"] / summary["avg_points"].max() * 100
    if selected_position == top_position:
        headline = f"{selected_position} is the top scoring position in the current sample."
    else:
        headline = f"{selected_position} scores at {relative_strength:.0f}% of the best position average."

    if selected_position in {"RB", "WR"}:
        return (
            f"{headline} In most redraft leagues, {selected_position} offers the strongest weekly production depth and is a strong draft target. "
            f"It should be prioritized early if your league rewards volume and consistency."
        )
    if selected_position == "QB":
        return (
            f"{headline} Quarterbacks are elite in spike weeks, but the position has fewer high-volume players. "
            f"Streaming or waiting on QB can still be a winning strategy in shallow or competitive leagues."
        )
    return (
        f"{headline} Tight ends can outperform their draft slot when the matchup is favorable, but they have the least weekly depth. "
        f"This is a good sleeper or late-round strategy if your league values matchup upside."
    )


def plot_position_summary(summary: pd.DataFrame, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="whitegrid")
    fig, ax = plt.subplots(figsize=(9, 6))
    sns.barplot(data=summary, x="position", y="avg_points", palette="viridis", ax=ax)
    ax.set_title("Average Weekly Fantasy Points by Position")
    ax.set_xlabel("Position")
    ax.set_ylabel("Average Fantasy Points")
    for container in ax.containers:
        ax.bar_label(container, fmt="%.1f", padding=3)
    fig.tight_layout()
    fig.savefig(output_dir / "position_summary.png", dpi=200)
    plt.close(fig)


def plot_top_players(position: str, top_players: pd.DataFrame, output_dir: Path) -> None:
    if top_players.empty:
        return
    sns.set_theme(style="whitegrid")
    fig, ax = plt.subplots(figsize=(10, 7))
    top_players = top_players.sort_values("avg_points", ascending=True)
    sns.barplot(data=top_players, x="avg_points", y="label", palette="magma", ax=ax)
    ax.set_title(f"Top {position} Players by Average Weekly Fantasy Points")
    ax.set_xlabel("Average Fantasy Points")
    ax.set_ylabel("Player")
    for container in ax.containers:
        ax.bar_label(container, fmt="%.1f", padding=3)
    fig.tight_layout()
    fig.savefig(output_dir / f"{position}_top_players.png", dpi=200)
    plt.close(fig)


def build_analysis(position: str, years=None, scoring: str = DEFAULT_SCORING) -> dict:
    df = fetch_weekly_player_stats(years=years)
    build_sqlite_db(df)

    summary = add_position_medians(DB_PATH, scoring=scoring)
    top_players = load_top_players_for_position(position, DB_PATH, limit=10, scoring=scoring)
    plot_position_summary(summary, OUTPUT_DIR)
    plot_top_players(position, top_players, OUTPUT_DIR)

    selected_row = summary[summary["position"] == position].iloc[0]
    recommendation = generate_recommendation(summary, position)

    return {
        "summary": summary,
        "selected_position": selected_row,
        "top_players": top_players,
        "recommendation": recommendation,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fantasy draft position analyzer using public NFL weekly stats.")
    parser.add_argument("--position", default="RB", choices=VALID_POSITIONS, help="Position to analyze for fantasy draft value.")
    parser.add_argument("--years", nargs="+", type=int, default=None, help="NFL seasons to load (default: 2023 through the current season).")
    parser.add_argument("--scoring", default=DEFAULT_SCORING, choices=list(SCORING_SQL), help="Fantasy scoring format.")
    args = parser.parse_args()

    result = build_analysis(args.position, args.years, args.scoring)
    summary = result["summary"]
    print(f"Scoring: {args.scoring}\n\nSummary by position:")
    print(summary.to_string(index=False))
    print("\nSelected position analysis:")
    print(result["selected_position"].to_string())
    print("\nTop players:")
    print(result["top_players"].drop(columns=["player_id", "label"]).to_string(index=False))
    print("\nRecommendation:")
    print(result["recommendation"])
    print(f"\nCharts saved in: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
