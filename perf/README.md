# Performance Benchmarks

Playwright-driven micro-benchmarks that gate pull requests by measuring the
PR's **base and head on the same CI runner in the same workflow run** (A/B) and
comparing the two. This document records the **methodology** behind the numbers
so the regression gate stays trustworthy in both directions (no false alarms,
no missed regressions).

A committed baseline was used first and abandoned (#62, #63): PR runs happen on
different shared-runner hosts than the run that produced the baseline, and
cross-run/host drift shifts **every** sample of a run together. No within-run
statistical guard can tell that apart from a real regression — a min-based
"sustained" check was tried and disproven by its own PR's benchmark. Measuring
both sides back-to-back on one host removes the drift from the comparison
instead of trying to model it.

## Layout

| Path                            | Purpose                                                             |
| ------------------------------- | ------------------------------------------------------------------- |
| `scenarios/*.perf.ts`           | One benchmark per interaction (scroll, drag, autoscroll, dynamic).  |
| `fixtures/perf.page.ts`         | Page object: opens demo pages without drag-state debug output.      |
| `fixtures/metrics-collector.ts` | In-page long-task / frame collection and CDP counters.              |
| `fixtures/metric-math.ts`       | Pure metric derivation (TBT, dropped frames, CDP counters, report). |
| `fixtures/statistics.ts`        | Pure aggregation (mean, median, p95, stddev).                       |
| `fixtures/compare-metrics.ts`   | Pure regression-gating decision.                                    |
| `compare.ts`                    | Baseline vs current comparison + Markdown output (CLI).             |
| `report.ts`                     | Human-readable benchmark report (CLI).                              |
| `baselines/`                    | Locally captured reference runs (gitignored, nothing committed).    |

## Commands

```bash
npm run perf            # run the benchmark scenarios (writes perf/results/latest.json)
npm run perf:report     # render the latest run as a Markdown table
npm run perf:compare    # compare latest run against a saved local baseline
npm run perf:test       # unit-test the pure statistics / gating logic (node --test)
npm run perf:baseline   # run perf and save the result as the local baseline
```

`perf:compare` flags: `--threshold <pct>` (default 25), `--baseline <file>`,
`--current <file>`, `--output <file>`, `--allow-baseline-mismatch` (downgrade an
incompatible-baseline failure to a warning). It exits non-zero — failing CI — on
a detected regression, a missing scenario/metric, or an incompatible baseline.

## Measured pages

The scenarios run on the demo pages (`/`, `/virtual-viewport`, `/dynamic-height`),
always opened with `?dragStateDebug=false` (`PerfPage.goto`). That flag removes
the pages' drag-state debug output, which E2E tests read to synchronize with the
drag scheduler: the main demo's debug panel and the hidden `app-drag-state-debug`
mirror elsewhere. Both render the cursor position, so they re-render on every drag
frame, and the main demo's panel re-renders the whole `DemoComponent` template and
every rendered row of both lists with it (#97). `PerfPage.goto` fails the run when a
page still renders that output, so a page that stops honoring the flag can't
silently skew the numbers again.

For the same reason the main demo subscribes to `placeholderMove` in its
constructor instead of binding it in the template: a template listener marks the
demo's view dirty, so each placeholder move (about one every three frames during
autoscroll) re-rendered the demo and every row. Keep high-frequency outputs out of
the measured pages' templates.

Measured against the previous page (5 runs before, 3 after, alternated on one
machine), `drag-within-list-1000` went from 24 layouts to 10 and about 15% less
main-thread task time, and `drag-between-lists-autoscroll-1000` from 88 layouts
to 78 and about 10% less task time. What remains is the library's work,
including the consumer row templates it renders.

| Scenario                             | Page                           | Interaction                                                    |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------------- |
| `scroll-2000-items`                  | `/`                            | Smooth-scroll a `vdnd-virtual-scroll` list                     |
| `drag-within-list-1000`              | `/`                            | Drag within a `vdnd-virtual-scroll` list                       |
| `drag-between-lists-autoscroll-1000` | `/`                            | Drag to the other list and hold at its edge (autoscroll)       |
| `drag-within-virtual-for-list`       | `/virtual-viewport`            | Drag within a `vdnd-virtual-viewport` list (`*vdndVirtualFor`) |
| `dynamic-height-scroll`              | `/dynamic-height`              | Smooth-scroll a dynamic-height `*vdndVirtualFor` list          |
| `dynamic-height-long-list-scroll`    | `/dynamic-height?count=100000` | Scroll through rows never measured before                      |

## Measurement methodology

Each scenario runs `1` warmup + `5` measured iterations under `4x` CPU
throttling. For every iteration the collector:

1. **Creates a single long-task `PerformanceObserver` per iteration and
   disconnects it** in `collectObserverResults`. A leftover observer from an
   earlier iteration would otherwise keep firing into the current iteration's
   array and over-count long tasks.
2. **Omits `buffered: true`** and **filters entries to the scenario window** via
   a `performance.now()` start bound (`filterLongTasksSince`). Long tasks from
   page load and warmup are never attributed to the measured scenario.
3. Classifies a frame as **dropped only when the interval exceeds ~25 ms**
   (`DROPPED_FRAME_THRESHOLD_MS`, ≈1.5× the 16.67 ms vsync interval). Ordinary
   60 Hz scheduling jitter (16.8 ms) is not counted the same as a real stall.
4. Reads the renderer's cumulative counters from CDP `Performance.getMetrics`
   before and after the scenario and reports the deltas: `layoutCount`,
   `recalcStyleCount`, and main-thread time, `taskDuration` (`TaskDuration`, all
   main-thread tasks: script, style, layout, paint, …) and `scriptDuration`
   (`ScriptDuration`), converted to ms. These are wall times of the tasks (CDP's
   default `timeTicks` domain), which include the CPU throttling. The frame
   metrics only move when a frame misses its budget; task time also counts extra
   work that still fits in the frame, but only a change beyond the percent
   threshold gates it. It includes the harness's own page calls (Playwright's
   waits, the frame tracker), which differ little between the two sides. A
   missing counter fails the run instead of reading as 0.

## Regression gating

The gate compares the **median** of the 5 samples, not p95. With only 5 samples
the p95 index resolves to the maximum, so p95 gated on the single noisiest run.
The median is the representative central value.

A metric (all gated metrics are "higher is worse") is flagged as a **REGRESSION**
only when the current median is worse than the baseline median by **all** of:

- more than the percent `--threshold` (default 25%),
- more than a per-metric **absolute floor** (`MIN_ABS_DELTA` in
  `fixtures/compare-metrics.ts`), and
- more than **3× the baseline MAD** (median absolute deviation).

These are **within-run** guards for iteration-level noise; run-level drift is
handled structurally by the same-runner A/B setup, not statistically. (A
min-based "sustained" guard was tried for cross-run drift and reverted: drift
shifts all five samples together, so the guard both failed to catch the
observed false positives and let one unusually fast sample veto genuine
regressions.)

An over-threshold change that fails one of the guards is reported as
informational with the guard that suppressed it: `noise (below floor)` or
`noise (within band)`.

`scriptDuration` is reported but **not gated**: every iteration reloads the page,
so JIT compilation and GC timing vary, and runs of the same code on one machine
differed by up to 26% (past the 25% threshold). `taskDuration`, which includes
script time, drifted at most 19% between those runs and is gated. The one
larger task-time difference (+27%) had the first benchmark run in a fresh
container as the slower side; CI measures the base first, so a cold start there
slows the base, not the head.

`p99FrameTime` is reported but **not gated**: the scenarios collect fewer than
~300 frame intervals, so nearest-rank p99 resolves to (or right next to) the
maximum — gating it would evaluate the same noisy value as `maxFrameGap` a
second time with a contradictory tolerance (exactly how #63's first attempt
stayed red: identical 26.5 → 37.7 values were suppressed under `maxFrameGap`'s
15 ms floor and gated under p99's 5 ms floor).

MAD is used instead of standard deviation because, with only five samples, a
single outlier inflates stddev enough to hide a real, sustained regression — a
baseline of `[0,0,0,0,500]` has stddev ≈224 but MAD 0, so a steady jump to 100 ms
is correctly gated rather than swallowed by the band. `3 × MAD ≈ 2σ` for normal
data.

The absolute floor is what keeps a **zero baseline** from auto-failing: a metric
that was `0` and becomes `1` (e.g. a single 51 ms long task) is `+100%` but stays
below its floor, so it is reported as informational ("noise (below floor)")
rather than gating. A floor must guard small baselines **without exceeding
typical baseline medians themselves** — layout/style-recalc counts are
near-deterministic (MAD ≈ 0), and their original floor of 25 was larger than the
drag-within-list layout baseline (24), which let a full doubling of layout work
slip through as "noise". Without the debug panel (schema 3) the drag layout
baselines are 10 (drag-within-list) and 6 (drag-within-virtual-for-list), so the
layout floor is 3: one forced layout per placeholder move adds 4 layouts to the
`*vdndVirtualFor` drag. The task-time floor sits above run-to-run drift on the
smallest baseline (up to 28 ms on the ~200 ms drag-within-virtual-for-list) and
at 25% of it; the percent threshold covers the larger baselines. Current floors:

| Metric            | Floor | Unit   |
| ----------------- | ----- | ------ |
| totalBlockingTime | 20    | ms     |
| longTaskCount     | 2     | tasks  |
| layoutCount       | 3     | count  |
| recalcStyleCount  | 10    | count  |
| taskDuration      | 50    | ms     |
| avgFrameTime      | 1.5   | ms     |
| maxFrameGap       | 15    | ms     |
| droppedFrames     | 3     | frames |

## Baseline compatibility (fail closed)

A comparison is only meaningful when both sides were produced by the **same
harness**. `perf:compare` fails closed — before comparing any numbers — when the
baseline is not comparable to the current run:

- **Metrics schema.** Each scenario report records `metricsSchemaVersion`
  (`fixtures/metric-math.ts`). Bump it whenever a change alters what a number
  _means_ (long-task window, dropped-frame threshold, aggregation, the page a
  scenario measures). The pre-#42 harness — leaking observer, `buffered: true`,
  `>16.7ms` dropped frames — is schema 1; schema 2 measured the main demo with
  its debug panel re-rendering every drag frame; this collector is schema 3
  (pages without drag-state debug output, plus main-thread time, #97). Comparing across
  schemas would attribute a **semantics** change (e.g. dropped frames 60 → 0)
  to the library.
- **Playwright version.** Embedded in each side's JSON report; different
  browser builds produce different numbers.
- **Mixed or partially unversioned runs.** A results file is only healthy when
  **every** scenario carries the **same numeric** `metricsSchemaVersion`. More
  than one version, or a mix of versioned and unversioned scenarios (e.g. a
  stale results file merged with a fresh one), is rejected outright.

Both versions are printed in the output — along with each run's **git commit and
date** (embedded by Playwright's JSON reporter) so it is always visible what
each side was measured from. Mismatches fail the run; pass
`--allow-baseline-mismatch` to compare anyway (unreliable).

The comparison also fails when a scenario or metric present in the baseline is
**missing** from the current run — a renamed, skipped, or crashed benchmark must
not silently disappear behind a green check. The reverse case — a scenario in
the current run with no baseline entry — is a **new benchmark**: it is listed as
`NEW (no baseline)` and stays ungated (in CI it gains a baseline automatically
once it exists on the base side, i.e. after the PR merges).

When the baseline run is more than 60 days older than the current run, the
output includes a non-fatal **stale baseline** warning. In CI this never fires
(both sides run minutes apart); it guards local comparisons against an old
saved baseline.

## CI: same-runner A/B

The `Performance Benchmarks` workflow checks out the PR's **base commit** and
**head (merge commit)** into sibling directories, then — on the same runner,
back to back — installs, builds, and runs `npm run perf` in each, and finally
compares head against base with head's `compare.ts`:

- Absolute numbers are only ever compared within a single job on a single
  host, so runner-image updates, hardware generation differences, and noisy
  neighbors between workflow runs cannot masquerade as regressions.
- There is no committed baseline to go stale and nothing to regenerate; each
  PR is measured against exactly the code it branched from.
- Each side runs its own harness. A PR that changes metric **semantics** (bumps
  `metricsSchemaVersion`) will fail the comparison closed — that PR's perf
  check requires human judgment (`--allow-baseline-mismatch` locally) because
  no automated comparison across semantics is meaningful.

## Local baselines

`npm run perf:baseline` saves the latest run to `perf/baselines/baseline.json`
(gitignored), and `npm run perf:compare` diffs a later run against it — useful
for local before/after checks while optimizing. Local absolute numbers reflect
your machine; only compare runs captured on the same machine.
