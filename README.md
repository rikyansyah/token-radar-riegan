# token-radar-riegan

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rikyansyah/token-radar-riegan/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rikyansyah/token-radar-riegan/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads one sealed snapshot of every protocol DefiLlama tracks and asks a narrow question of each: if this record stayed exactly as it is and a token arrived, what would the launch be worth — and what should a reader be doing to farm the protocol in the meantime? Protocols whose token already trades are set aside and shown at the market's own numbers; the board ranks only the ones still waiting, and says a protocol *records* no token, never that it has none.

## Run it

```sh
node main.ts
```

---

Entered on [make.fun](https://make.fun/?ref=vrsa6rr4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards

## What the board holds

The house watchlist — every protocol at or above the snapshot's $50M TVL floor that records no token and is not a wrapped, staked, bridged or exchange product of one that trades — is the floor, never the ceiling. The board carries all 40 of them, plus every other protocol under the floor that passes the same test: 198 rows in all, 158 of them early finds the watchlist does not name. A wrapped product can never outrank a genuine launch candidate, because the same definition guards the whole board.

## The model

One function scores every row, from the snapshot's own figures only:

- **Peer price** — the median market-cap/TVL of the live-token protocols in the same category (four or more of them), else the snapshot-wide live median, held inside [0.05, 0.60].
- **Growth** — the seven-day TVL change bent through a logarithm (a +120% week scores 1; even +4,448% only reaches the 1.75 cap) and weighted at 0.5.
- **Maturity** — a ramp from 0.6 to 1.0 across three years of being tracked; an unknown listing date counts as one year.
- **Breadth** — 3% per extra chain, up to four.

`implied = max(1, round(TVL × peer price × growth × maturity × breadth))`. No protocol name appears anywhere in the model. The dashboard restates the constants, repeats the arithmetic in the page, and lets a reader turn two of the knobs in a sandbox to watch the board reprice live.

## Layout

- `main.ts` — the program: snapshot in, board and dashboard data out, dossier last.
- `lib/model.ts` — the radar model: peer pricing, scoring, the board, and the farm plans (seven steps per row, each with a cost and a time, all derived from the protocol's own record).
- `vendor/makefun-board.ts` — the kit's dossier library, unchanged.
- `dashboard/` — a static page that renders with no network: search, category and chain filters, a watchlist/early scope toggle, sortable columns, a live-token view, and a detail drawer per protocol.
- `screenshots/` — the board, a detail view, a filtered view (1440×900).
