# Virtualization contracts

The PR check builds the candidate library and a tiny instrumented production
consumer. It checks both renderers with fixed and dynamic heights, from 1,000 to
100,000 items, in Chromium at normal CPU speed. Consumer probes and controls are
not published in the npm library. No demo build or smoke run is needed.

```bash
npm ci
npx playwright install chromium
npm run perf:build:contracts   # library + isolated production consumer
npm run perf:check             # all registered contract cases, no retries
node --experimental-strip-types perf/check-report.ts
npm run perf:test              # dependency-free harness/report unit tests
```

The separate paired timing work is preserved on
[`codex/paired-timing-protocol-archive`](https://github.com/gultyayev/ngx-virtual-dnd/tree/codex/paired-timing-protocol-archive).
It is not part of this check. The existing manual benchmark commands described
in [../README.md](../README.md) remain available and unchanged.

## Budgets

For a 400px viewport, 40–60px rows and overscan 3:

| Interaction                                   | Contract                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Rendered rows                                 | At most 18 DOM rows                                                                                        |
| Retained views                                | At most 38 live row views, including detached views; at most 76 transiently                                |
| Fixed-height mount                            | Fewer than 500 ID reads regardless of total list length                                                    |
| 24 logical scroll steps of 3 rows             | At most 72 row-template checks for the component and 120 for the directive, and 3,600 ID reads             |
| Scroll layouts                                | At most 24, for fixed and dynamic heights                                                                  |
| Scroll style recalculations                   | At most 24, for fixed and dynamic heights                                                                  |
| Scaling from 1k to 100k                       | At most 12 extra row checks / 150 extra ID reads on the identical path                                     |
| Host checks during pooled scroll              | Zero for both renderers                                                                                    |
| Scroll without pooled-view reuse              | Zero host checks; check only newly created rows and the directive's former last row, whose context changes |
| Five placeholder movements, fixed and dynamic | Zero host/row checks; at most 500 ID reads, five layouts and ten style recalculations                      |
| Destroy                                       | Zero live row views, after proving the pool is nonempty at the end of the list                             |
| Initial rendering                             | At most 500ms, excluding caller data allocation                                                            |
| Scroll responsiveness                         | No observed frame gap over 250ms; at most one long task (50ms or more)                                     |

These are explicit reviewable budgets, not baselines regenerated from the latest
run. An intentional increase requires before/after evidence and an explanation
of the additional user-visible work. Layout and style counts measure passes,
not the cost of each pass. Template probes count evaluations even when no DOM
binding changes. Lifetime probes count detached Angular row views too.

Each scroll step targets the same logical row and verifies alignment after two
frames. The scaling tests then alternate distant positions, scroll to the end,
and verify that live views exceed rendered views before destroying the list.
This exercises destruction of the detached-view pool, rather than only active
rows. The no-reuse case separately verifies that every original row stays
rendered, new rows are created, and no detached views exist.

Each scroll step brings three rows into the rendered range; after the first, they
reuse the views of the three that left. Only those rows may be checked, and for
the directive the new first row and the former last row, whose `first`/`last`
context flags change. The rows that stay rendered as they were are not. Before
[#172](https://github.com/gultyayev/ngx-virtual-dnd/pull/172), each reused view
checked every rendered row again
([#171](https://github.com/gultyayev/ngx-virtual-dnd/issues/171)): 417–464 row
checks, and 23 host checks for the directive, within the earlier budgets of 576
row checks and 24 directive host checks.

## Evidence and controls

The Chromium collector brackets the interaction with `LayoutCount` and
`RecalcStyleCount`, observes long tasks without replaying page-load history,
and records animation-frame intervals. A leading full frame and trailing frame
keep stalls on the first/last input observable. Hidden pages, absent metrics,
and missing frames fail. Raw observations and counters are Playwright JSON
attachments, and the concise report includes rendering counts and pool sizes.

Browser controls inject real extra template checks, every row checked again on
each reused view with a clean host (a row host binding that reads a signal
input), full-list scans, excessive overscan, synchronous write/read layout
thrashing, a 500ms mount/scroll stall, and 60ms of CPU work on every scroll step.
They must exceed their budgets. The no-reuse tests were also verified against a
temporarily seeded library `markForCheck()` regression: both directive cases
failed, then passed after the library was restored. The pooled-scroll budgets
were run against the library before #172: all four scaling cases failed.

The coarse time limits do not certify 60 FPS or exclude smaller computational
regressions. One incidental long task is allowed; repeated per-step blocking is
not. Initial-render timing ends at Angular's first completed render; subsequent
height settling occurs before interactions. Frame intervals measure callback
cadence, not presented or dropped frames. Row-view lifetime checks do not prove
that every possible source of retained memory is absent.

## CI and maintenance

The workflow runs on PR open/reopen/push, with workflow-level cancellation.
There are no label events, dynamic job names, schedules or manual dispatches.
Library, contract, root build/compiler configuration and dependency changes
trigger it. Demo interactions remain covered by the existing full browser
matrix. Branch protection must require the desired check names to block merging.

`cases.ts` is the single inventory used to register tests and validate reports.
A missing, duplicate, unknown, skipped, retried or failed case cannot yield a
passing report. Build failures retain their stage and compiler output and remove
old browser/check artifacts. The PR comment is marked pending before harness
validation, so an early failure or cancellation cannot retain a stale PASS.
Artifacts are retained for 90 days.
