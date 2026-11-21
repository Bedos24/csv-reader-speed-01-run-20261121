# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Bedos24/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Bedos24/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0: `solve.js` exports `run(input)` and returns
csv-reader's exact answer — `{columns, rows, errors}` under its broken-row policy (stray_cr,
quote_junk, unterminated_quote, short_row, long_row) — for every input, and `main.ts` is the
house driver that reads `/input/cases.json` and writes `/output/answers.json`.

Where the reference walks one character at a time and builds each field a character at a time,
this reader finds each field's end by scanning and takes the field as one slice of the text
whenever it holds nothing that needs rewriting; only fields that actually contain a stray CR,
a CR inside quotes, or a doubled quote pay for a segmented rebuild. Quoted fields are closed
with an `indexOf` scan for the next undoubled quote, and their content is unescaped in one
pass when it holds no CR.

Measured on the kit's practice set (6 cases, 10,193,953 characters, 709,592 fields) in this
workspace, parse-only CPU per set: csv-reader 1.0.0 ≈ 620–750 ms, this entry ≈ 88–93 ms —
about 7–8× faster — with answers byte-identical to the baseline's on all 6 cases and equal to
the reference implementation on 12,102 fuzzed broken-CSV inputs (0 mismatches).

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=cqr5rs5e&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
