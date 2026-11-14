# Fantasy NFL Draft Analyzer

A data pipeline and web dashboard for fantasy football draft research. It pulls public NFL weekly stats, stores them in SQLite, analyzes them with SQL and pandas, and shows the results in an interactive website with player rankings and head-to-head comparisons.

<img width="1488" height="905" alt="image" src="https://github.com/user-attachments/assets/0294fd67-7cee-4dd5-a59c-f91ce0d710cf" />

## Features

- **Rankings by position** (QB, RB, WR, TE), sortable by average, total, best week, or consistency
- **Player comparison**: side-by-side stats and a week-by-week points chart for any two players
- **Season filter**: view a single season (2023 through the current season) or all seasons combined
- **Scoring formats**: PPR (default), Half PPR, or Standard
- **Consistency metric**: standard deviation of weekly points, so you can tell steady players from boom-or-bust ones
- **Weekly auto-update**: a scheduled GitHub Actions job refreshes the data every Tuesday during the season

## How it works

```
nflverse public data ──► Python (nflreadpy + pandas) ──► SQLite database ──► JSON file ──► website (HTML/CSS/JavaScript)
                          fantasy_nfl_draft.py           nfl_fantasy.db      export_json.py  web/
```

1. `fantasy_nfl_draft.py` downloads regular-season weekly stats and saves them to `nfl_fantasy.db`.
2. `export_json.py` turns the database into `web/data/players.json`.
3. The website in `web/` loads that JSON and does all filtering, sorting and charting in the browser. It uses no frameworks or chart libraries; the charts are drawn with plain SVG.

## Run the website locally

**Requirements:** Python 3.10 or newer.

```bash
# 1. Get the code
git clone https://github.com/tinttran2006-cyber/NFL-Fantasy-Draft.git
cd NFL-Fantasy-Draft

# 2. Install dependencies
python -m pip install -r requirements.txt

# 3. (Optional) Download the latest stats. The repo already includes a recent copy of the data.
python export_json.py --refresh

# 4. Start a local web server from the web folder
cd web
python -m http.server 8000
```

Then open **http://localhost:8000** in your browser. Press `Ctrl+C` in the terminal to stop the server.

> **Why a server?** Browsers block a page opened straight from your files (double-clicking `index.html`) from loading `players.json`. A local server avoids that.

## Run the terminal analysis

The original command-line version still works. It prints a summary and saves charts to `output/`:

```bash
python fantasy_nfl_draft.py --position WR --scoring ppr
```

| Option | Values | Default |
|---|---|---|
| `--position` | `QB`, `RB`, `WR`, `TE` | `RB` |
| `--scoring` | `ppr`, `half`, `standard` | `ppr` |
| `--years` | one or more seasons, e.g. `--years 2024 2025` | 2023 through the current season |

## Automatic updates

`.github/workflows/update-data.yml` runs every Tuesday morning (after Monday Night Football). It downloads the newest stats, rebuilds the data, and commits the updated `players.json` back to the repo. You can also start it by hand from the **Actions** tab with **Run workflow**.

## Project structure

```
├── fantasy_nfl_draft.py      # download, clean, store and analyze the data
├── export_json.py            # export the database to JSON for the website
├── nfl_fantasy.db            # SQLite database of weekly player stats
├── requirements.txt
├── web/
│   ├── index.html            # page layout
│   ├── style.css             # styling
│   ├── app.js                # rankings, filters, comparison and SVG charts
│   └── data/players.json     # generated data the site reads
└── .github/workflows/
    └── update-data.yml       # weekly data refresh
```

## Notes

- **Data:** public NFL weekly stats from [nflverse](https://github.com/nflverse), loaded with the `nflreadpy` package. Only regular-season games are included, since fantasy leagues are decided in the regular season.
- **Half PPR** is calculated as the midpoint of Standard and full PPR, which is 0.5 points per catch.
- **Data-integrity fix:** players are grouped by their unique `player_id`, not their name. The source data uses short names like "B.Robinson," so grouping by name used to merge different players (for example, Bijan Robinson and Brian Robinson Jr.) into one row.

This is a personal project for research and draft prep, not betting advice.
