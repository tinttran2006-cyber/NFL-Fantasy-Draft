# Fantasy Draft NFL Analyzer

This project uses public NFL player-week data from the `nfl_data_py` package to compare fantasy production by position and rank the best players at a chosen position.

## What it does
- Pulls weekly public NFL player data for QB, RB, WR, and TE
- Stores the data in SQLite using SQL queries
- Aggregates fantasy value by position
- Ranks the best players for a target position
- Saves charts to the `output` folder

## Run it
```bash
python fantasy_nfl_draft.py --position RB
```

You can also choose a different position:
```bash
python fantasy_nfl_draft.py --position WR
python fantasy_nfl_draft.py --position QB
python fantasy_nfl_draft.py --position TE
```

## Outputs
- `nfl_fantasy.db`
- `output/position_summary.png`
- `output/RB_top_players.png` (or whichever position you selected)

## Notes
This is a public-data drafting tool meant for research and decision support. It helps identify the most productive fantasy positions and the strongest players in the current data sample.
