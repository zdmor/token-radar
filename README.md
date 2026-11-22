# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zdmor/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zdmor/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot, ranks every
pre-token protocol by the implied value of a token it may issue one day, and
hands in a dashboard a reader can use — a sortable, filterable board, a detail
view with each protocol's value breakdown, token odds, costed farm P&amp;L,
peer dossier and farm plan, and the live-token set kept apart.

The model (radar-3) prices each protocol from the snapshot's own figures:
its TVL at the multiple its category's live tokens trade at (the median
mcap/TVL of the category, winsorized at 5× and shrunk toward the market
median), adjusted for seven-day growth, how long it has run with no token,
and how many chains it runs on, then soft-capped above $500M so one giant
TVL cannot hallucinate a ten-billion-dollar token. No name is ever
special-cased. The board covers all 40 watchlist protocols plus 156 early
finds — every rankable pre-token protocol in the snapshot.

The model is validated out-of-sample on the snapshot's 128 live-token
anchors: leave-one-out (each anchor predicted from the other 127, medians
re-estimated per fold), walk-forward (the oldest 60% of dated listings
pricing the newest 40%), and top-20 recall. The dashboard re-derives the
Spearman benchmark in the browser from the injected anchors and lights an
integrity strip only when it matches the build-time value exactly.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json` and `data.js`,
copies `dashboard/` and decodes `screenshots/*.jpg.b64` into `/output`, then
writes `dossier.json` with the vendored make.fun library. The screenshots are
stored base64-encoded in this repository so they travel as text; the program
decodes them back to JPEG before the dossier is built.

---

Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
