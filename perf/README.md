# Performance checks

The default PR check tests the library's virtualization contract in a production
browser. It measures both renderers at **1,000, 10,000 and 100,000 items**, with
fixed and dynamic heights. It also smoke-runs every benchmark workload against
the candidate's own demo, so changes to demo hooks cannot silently break the next
library PR. Neither consumer instrumentation nor benchmark code is published in
the npm library.

Apply **`perf:timing`** to a PR for a longer paired base/head investigation.
Timing is advisory until independent hosted-runner experiments establish useful
false-alarm and detection rates. Rendering-count budgets and evidence integrity
are enforced in that investigation. A passing default check does **not** mean
"no performance regression": pure computation can get slower without changing
any deterministic work count, and the absolute stall limits are deliberately
coarse. An inconclusive timing result is not a pass.

## Default check

```bash
npm ci
npx playwright install chromium
npm run perf:build             # library and the candidate's production demo
npm run perf:build:contracts   # separate instrumented consumer
npm run perf:check             # 7 contract tests and 6 demo smoke scenarios
npm run perf:test              # harness unit tests; no dependencies needed
node --experimental-strip-types perf/check-report.ts
```

The contract consumer lives in `perf/consumer/`, is built separately into
`dist/perf-contracts/browser`, and is never added to the demo's navigation or
library entry points. Tests run serially in Chromium at normal CPU speed, with
no retries. Data allocation precedes the initial-render measurement. Angular's
first completed render ends it; asynchronous dynamic-height settling is checked
before subsequent interactions.

For a 400px viewport, 40–60px rows and three rows of overscan on either side:

| Check                                   | Budget / behavior                                                       |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Rendered DOM rows                       | At most 18, including boundary/sticky allowances                        |
| Retained Angular row views              | At most 38, including detached/recycled views                           |
| Transient live row views                | At most 76 during reconciliation                                        |
| Destroyed list                          | Zero live row views                                                     |
| Fixed-height initial item-ID reads      | Fewer than 500, independent of total list length                        |
| 24 identical logical scroll checkpoints | At most 576 row-template checks and 3,600 item-ID reads                 |
| Consumer host checks during scrolling   | Zero for the component; at most 24 for the directive                    |
| Scaling from 1k to 100k                 | At most 12 extra row checks / 150 extra ID reads for the identical path |
| Placeholder movement                    | No consumer/row-template checks; at most 500 ID reads                   |
| Initial rendering                       | At most 500ms, excluding caller data allocation                         |
| Ordinary scrolling                      | No observed animation-frame gap over 250ms                              |

The timing limits catch severe stalls; they do not certify 60 FPS or a particular
device class. Absolute timings, frame cadence and relative timings are different
questions. The row probe counts actual template evaluations even when bindings
produce no DOM mutation. Lifetime counters include detached views, so a leak
cannot hide behind a constant DOM size. Repeated distant scrolling checks pool
bounds, and unmount checks destruction.

Re-inserting recycled views also refreshes visible templates. The directive
refreshes its declaration view; the component isolates that work from its host.
The budgets allow this existing behavior while requiring it to stay bounded by
the viewport, independently of total list size.

Browser positive controls deliberately re-check the consumer, scan the whole
list on every scroll, render excessive overscan, stall initial rendering, and inject a 500ms scrolling stall.
The checks verify that those real workloads exceed the corresponding budgets.
This validates collection and detection for those classes, not a statistical
false-alarm rate for all future changes.

Budgets are reviewed policy, not values regenerated from the latest result.
For an intentional increase, document the changed user-visible work, record
before/after evidence, and change the specific budget and its regression test
in the PR. Do not widen the timing percentage to excuse count increases.
Branch protection is a repository setting: a failing job only blocks merging
if that check is required there. This workflow has path filters.

## Paired comparison

The slower investigation compares two libraries against the **same base demo**,
with identical installed dependencies, production settings, browser and harness.
Preparing the baseline changes only a disposable checkout. Source consumers stay
intact; the candidate builds the baseline consumer in temporary staging.

```bash
git worktree add --detach ../perf-base origin/master
npm run perf:prepare -- --base ../perf-base
npm ci
npm --prefix ../perf-base ci
npm --prefix ../perf-base run perf:build
npm run perf:build -- --fixture ../perf-base
npm run perf:ab -- --base ../perf-base --profile counts
npm run perf:compare
npm run perf:report
# Full timing investigation:
npm run perf:ab -- --base ../perf-base --profile timing --blocks 20
```

`counts` remains a local three-block diagnostic, without warmups. It checks
layout/style passes, not computational cost. It is no longer the default CI job.
`timing` uses twenty predeclared blocks with one warmup per scenario/suite.
Each suite measures every scenario once; ABBA / BAAB blocks alternate execution
order, yielding 40 observations per variant/scenario. The statistical unit is a
block, not a frame or an individual row.

The former default counts job took about 9½ minutes on CI, including about five
minutes of measurement. The new default builds one library and runs the contract
matrix and one demo smoke suite; it does not launch 12 comparison suites or
install the same dependency tree twice. A local run on master `a450ecb` took
58.5 seconds for all 13 browser tests, or 76.0 seconds including the three builds
(dependencies/browser already installed). That is not a hosted-runner estimate
or a like-for-like comparison with the old workload inventory.
The optional 80-suite timing protocol
can still take roughly an hour. It is explicitly requested, never scheduled or
manually dispatched. CI installs timing dependencies once and reuses identical
files in the baseline; builds must not mutate `node_modules`.

Both sides use the head dependency lockfile: this isolates library changes, and
**does not measure dependency-upgrade regressions**. The candidate contract and
smoke check does run on dependency-only PRs. A source-incompatible library API
cannot compile the base demo; the report preserves the consumer build stage and
compiler diagnostic rather than claiming a performance result.

## Workloads

| Scenario                             | Work                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| `scroll-2000-items`                  | Fixed logical row checkpoints in the main demo       |
| `drag-within-list-1000`              | Fixed pointer updates and verified reorder           |
| `drag-within-virtual-for-list`       | Fixed updates and verified viewport reorder          |
| `dynamic-height-scroll`              | Fixed row checkpoints through dynamic rows           |
| `dynamic-height-long-list-scroll`    | Previously unmeasured rows in a 100k list            |
| `drag-between-lists-autoscroll-1000` | Paced autoscroll with a verified cross-list transfer |

All demo pages disable drag-state debug output. That output can cause consumer
re-renders on every pointer update, so the harness rejects it. Do not attach
high-frequency output listeners in measured consumer templates.

Scroll comparisons verify the same requested row IDs and their settled alignment;
geometry and extra overscan rows remain diagnostic. Corrective scroll writes are
recorded. They may vary when geometry changes, so an unexpected layout/style
increase needs inspection of the raw work before attribution to the library.
Drags verify the actual source, destination index and item order after measurement.
The paced autoscroll scenario reports actual progress but never gates totals:
its completed work varies with elapsed time and load.

Every sample starts from a fresh document. Setup, page load, functional checks
and Playwright compilation run at normal speed; measured interactions use 4×
CPU throttling. Warmups prime the browser process, not a retained application
page. A standalone `npm run perf` defaults to five measured iterations plus one
warmup, requires a production build, and is diagnostic only.

## Budgets and timing uncertainty

Count budgets use **max(2% of base, absolute floor)**: one layout or three style
recalculations. Timing uses **max(10% of base, 5ms)** by default. `--threshold`
changes only the timing percentage, never count tolerances. Each block averages
its two base and two candidate costs, then computes `head − base − budget`.
The counts decision uses the median of these paired excesses, without a
confidence-level claim.

Timing uses exact median order-statistic bounds with Bonferroni adjustment across
15 checks (five fixed-work scenarios × task time / layout / style), for nominal
simultaneous 95% coverage under independent blocks with a common target median:

| Blocks | Ordered excess bounds | Agreement needed |
| ------ | --------------------- | ---------------- |
| 10     | 1st–10th              | All 10 blocks    |
| 14     | 2nd–13th              | 13 of 14         |
| 20     | 4th–17th              | 17 of 20         |

A lower bound above zero means regression; an upper bound at/below zero means
pass; overlap or unbounded intervals mean inconclusive. Balanced ordering reduces
approximately linear drift, but does not eliminate nonlinear warmup, GC,
interference or correlated observations. More samples cannot repair unequal work.

**Hosted-runner operating characteristics remain uncalibrated.** Historical
unchanged-code evidence included a task-time difference of −10.1%; another
unchanged comparison changed from +34.7% to +4.4% on rerun. Those observations show
instability, not measured power or false-alarm rates for this procedure. No modeled
pass-rate claim is made. Collect independent complete experiments and seeded
regressions before promoting timing to a required check.

```bash
npm run perf:a/a -- --base . --head . --blocks 20
npm run perf:a/a -- --base . --head . --blocks 20 --control script --control-work-ms 50
npm run perf:a/a -- --base . --head . --blocks 20 --control cpu
```

Script controls execute an ordinary browser timer task so instrumentation observes
them. CPU controls measure environmental sensitivity. Neither is an ordinary PR
comparison. Also test representative library regressions, such as extra row
checks or repeated whole-list work, rather than relying only on a busy loop.
Retain all outcomes. Zero false alarms in twenty experiments still allows about
a 14% one-sided 95% upper bound. Roughly 300 clean independent experiments are
needed to support a 1% upper bound. Do not rerun until green or add blocks after
seeing results without a predeclared sequential procedure.

## Evidence and failures

Schema 4 preserves raw measured/warmup samples, frame intervals, long tasks,
visibility, counter exposure, workload outcomes and environment identity.
Frame intervals are rAF callback cadence, not presented/dropped frames. Zero
intervals from timer quantization are valid. Task time includes script, rendering
and instrumentation work; layout/style counts measure passes, not cost per pass.
Frames, long tasks, TBT and script time remain attribution diagnostics in the
paired experiment.

Comparisons reject missing/duplicate/failed scenarios, retries, changed inputs,
stale builds, incompatible browser/schema metadata and unequal logical work.
Production output, actual installed dependencies, consumer and library sources
are fingerprinted. Rebuild after changing inputs. Interrupted runs retain raw
evidence and never become a passing partial experiment. Build failures retain
the stage and compiler output; suite failures retain Playwright output. CI marks
the current run pending before setup so cancellation cannot leave a stale PASS.

`perf:compare` exits 0 (pass), 1 (regression), 2 (inconclusive), or 3 (invalid).
`--decision-profile counts` derives the count decision from the same validated
timing evidence. The timing job displays **both decisions**, including failing
count rows, in the job summary and PR report. Raw JSON and detailed reports are
artifacts retained for 90 days.

`perf:report -- --details` renders full diagnostics. Historical unpaired snapshots
remain diagnostic/inconclusive; they cannot establish a valid paired result.
There is no cross-schema or browser-mismatch bypass.

## Adding or changing a scenario

1. Add the workload and update `EXPECTED_SCENARIOS`, its validation, fixtures and
   report labels. Specify fixed logical work or explicitly paced work.
2. Keep assertions and observed drop verification outside the measured interval.
3. Run the candidate-demo smoke check and workload-driver browser tests.
4. For paired comparisons, required demo hooks must already exist on the base
   branch. Land additive hooks first; the independent candidate smoke check
   protects them from subsequent breakage.
5. If the default test inventory changes, update `check-report.ts`'s expected
   inventory so skipped or missing checks cannot produce a green report.
6. Document budget/measurement changes and bump schema when metric meaning changes.

The dedicated contract consumer is separate from these demo hooks and always tests
the candidate library directly. CI triggers include library, consumer, harness,
root compiler/build configuration and dependency changes. Unrelated labels have
separate cancellation groups and check names; only `perf:timing` requests timing.
