# token-radar-riegan

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rikyansyah/token-radar-riegan/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rikyansyah/token-radar-riegan/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The best token launch radar: reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones with no token yet that are not a wrapped or staked product of one that trades, and ranks them by what their launch would be worth — shown in a web dashboard with a board, a detail view per protocol, and steps to farm it.

## Run it

```sh
node main.ts
```

---

Entered on [make.fun](https://make.fun/?ref=vrsa6rr4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards

## How it works

`main.ts` reads the snapshot, builds the ranked board with the model in `lib/model.ts` (implied value = TVL × median mcap/TVL of live-token peers in the same category × growth, maturity and chain-breadth factors), writes `board.json` (198 rows, whole watchlist covered) and the dashboard data, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json` with `buildDossier` from `vendor/makefun-board.ts`.

## Layout

- `main.ts` — the program: snapshot → board → dashboard data → dossier.
- `lib/model.ts` — the radar model, ranking and farm plans (7 steps per row).
- `vendor/makefun-board.ts` — from the kit, unchanged.
- `dashboard/` — static page, renders with no network: search, category + chain filters, scope toggle, sortable columns, per-protocol detail dialog.
- `screenshots/` — board, detail view, filtered view (1440×900).
