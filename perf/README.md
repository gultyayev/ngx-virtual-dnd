# Performance benchmarks

The benchmark measures library revisions with a common production-built demo,
browser, and measurement harness. Adjacent, balanced base/head blocks reduce
execution-order drift. Raw measurements and completed-work checks make the
results auditable. An experiment reports **pass**, **regression**,
**inconclusive**, or **invalid**; a standalone suite is diagnostic.

Timing results are initially advisory in CI. Invalid or incomplete evidence
fails the job. Enabling a timing gate requires repeated unchanged-code A/A
experiments and positive controls on the runner class used for pull requests.
A single passing calibration does not establish a false-alarm rate.

## Commands

Install dependencies and Chromium, then build before measuring:

```bash
npm ci
npx playwright install chromium
npm run perf:build
npm run perf
npm run perf:report -- --input perf/results/latest.json
npm run perf:test
```

`perf:build` builds the library and production demo and records their source,
fixture, dependency, and output hashes. The benchmark serves this static output;
Angular compilation and development-server rebuilds are outside the experiment.
Rebuild after changing library source, the measured demo, or dependencies.
Experiments reject stale builds.

To compare against a Git revision, prepare a clean, disposable base checkout
with the head's demo fixture and lockfile:

```bash
git worktree add --detach ../perf-base origin/master
npm run perf:prepare -- --base ../perf-base
npm --prefix ../perf-base ci
npm --prefix ../perf-base run perf:build
npm run perf:build
npm run perf:ab -- --base ../perf-base --blocks 10
npm run perf:compare
npm run perf:report
```

Replace `origin/master` with the desired base revision. `perf:prepare` replaces
the disposable checkout's consumer fixture, harness, and build scripts while
preserving its library source and Git revision. It refuses a dirty base checkout
or the head checkout itself. To measure already prepared checkouts:

```bash
npm run perf:ab -- --base /path/to/base --head /path/to/head --blocks 10
npm run perf:compare -- --experiment perf/results/experiment.json --threshold 10
npm run perf:report -- --input perf/results/experiment.json
```

The head checkout supplies the harness and browser for **both** variants. Both
checkouts must have a `perf:build` output. Their measured consumer fixture and
dependencies must match; only the library revision varies. This prevents a
changed demo or browser from being attributed to the library. A base library
that cannot build against the common fixture is incomparable and yields invalid
evidence. Dependency changes require a separately designed experiment.

`perf:ab` defaults to the current checkout for both paths and 10 blocks. Use
`--base-port` and `--head-port` if the default ports 4300 and 4301 are occupied.
`--output` selects the experiment JSON path. One block is useful for a smoke
check, but deliberately produces an inconclusive timing verdict.

```bash
# Unchanged-code A/A: both paths must contain identical library source/revisions.
npm run perf:a/a -- --base . --head . --blocks 10

# Positive cost control: add known busy work during each head measurement.
npm run perf:a/a -- --base . --head . --blocks 10 \
  --control script --control-work-ms 50

# Environmental sensitivity control: contend for CPU during head measurements.
npm run perf:a/a -- --base . --head . --blocks 10 --control cpu
```

Controls require calibration mode, are recorded in the artifact, and are never
ordinary PR comparisons. `--control-work-ms` ranges from 0 to 1000; injected
absolute work is not a guaranteed percentage slowdown. The CPU control tests
sensitivity to contention rather than a library regression.

The script control runs in a browser timer task so script counters, long-task
observers, and frame intervals can all observe it. A busy loop executed directly
through DevTools can create a visible stall while being omitted from normal
script and long-task instrumentation.

`perf:compare` accepts `--experiment`, `--threshold`, `--output` (Markdown), and
`--json` (machine-readable verdict). Its default input is
`perf/results/experiment.json` and threshold is 10%. Exit codes are:

| Code | Verdict      | Meaning                                                           |
| ---- | ------------ | ----------------------------------------------------------------- |
| 0    | pass         | All primary confidence bounds are within their practical budgets. |
| 1    | regression   | At least one primary bound is wholly above its budget.            |
| 2    | inconclusive | Too few blocks or uncertainty overlaps a budget.                  |
| 3    | invalid      | Missing, corrupt, incomplete, or incomparable evidence.           |

`perf:report` defaults to `experiment.json` when present. If a failed preflight
left only `comparison.json`, it reports that invalid result instead of an older
standalone suite; a summary without raw evidence cannot establish a valid
verdict. With neither experiment nor summary present, it uses `latest.json`.
It accepts `--input`, `--output` (replace Markdown), and `--threshold`. It exits 3
for invalid evidence and 0 for a successfully rendered report; use
`perf:compare` for the verdict's exit code. The report uses the actual sample
counts, browser identity, CPU throttle, exposure, and workload observations.

`perf:baseline` remains a local snapshot convenience. Historical snapshots can
be inspected with `perf:compare -- --baseline <file> --current <file>`, but valid
unpaired evidence always returns inconclusive. Old schemas and missing metadata
are invalid; there is no option to bypass compatibility checks.

## Measured work

The demo pages open with `?dragStateDebug=false`. The page object rejects visible
drag-state debug output: rendering cursor diagnostics can otherwise add a
consumer-wide render on every drag frame. Keep high-frequency debug output and
template listeners out of the measured pages.

| Scenario                             | Page                           | Workload kind                                        |
| ------------------------------------ | ------------------------------ | ---------------------------------------------------- |
| `scroll-2000-items`                  | `/`                            | Fixed scroll checkpoints through a 2000-item list    |
| `drag-within-list-1000`              | `/`                            | Fixed drag updates and verified reorder              |
| `drag-within-virtual-for-list`       | `/virtual-viewport`            | Fixed drag updates and verified reorder              |
| `dynamic-height-scroll`              | `/dynamic-height`              | Fixed scroll checkpoints through dynamic rows        |
| `dynamic-height-long-list-scroll`    | `/dynamic-height?count=100000` | Fixed checkpoints through previously unmeasured rows |
| `drag-between-lists-autoscroll-1000` | `/`                            | Paced autoscroll and verified cross-list transfer    |

Fixed-work scenarios wait for delivered updates and verify operations, requested
row checkpoints, final scroll position, or the resulting reorder. Within-list
drags stay clear of the autoscroll edge. A slower runner must complete the same
work instead of silently visiting fewer rows during a fixed elapsed duration.
Fixed-work evidence is compared within every block. Additional visited rows and
rendered ranges are diagnostic: differing overscan strategies can complete the
same checkpoints. Paced autoscroll preserves
the responsiveness workload and reports actual distance/operations; its totals
do not gate because elapsed-time work varies under load.

Each suite performs a page-reset warmup before measured iterations. The workload,
snapshots, and observers run under 4× CPU throttling for both warmup and measured
iterations. Page navigation, app startup, Playwright utility-script compilation,
and functional verification run at normal speed. Keeping throttling outside those
preparation steps prevents browser bootstrap stalls from blocking the benchmark.
A standalone suite defaults to five measured iterations. Each
experiment suite has one measured iteration; there are four suites per block,
so 10 blocks collect 20 measurements per variant per scenario. Page resets and
warmups follow the same protocol for both variants. Retries are disabled.

## Measurement and integrity

Metrics schema **4** preserves every measured sample, frame interval, long task,
page-clock start/end bound, browser version, visibility state, counter exposure,
and actual workload outcome. Aggregates are derived from this raw evidence;
stored summary fields cannot override the comparison.

Long-task observers are created/disconnected per measurement and bounded by the
page's monotonic clock. Renderer counters are bracketed by CDP snapshots.
Counter exposure includes transport/setup overhead and is recorded separately
from the page's interaction window. Browser startup and warmup are excluded
from the measured interaction. Raw warmup measurements are retained separately
and excluded from inference.

Frame intervals measure `requestAnimationFrame` callback cadence, rather than
actual presented frames. Collection drains a post-work callback so a final
stall remains observable. The leading partial interval before the first
observed callback is excluded.

The comparator requires the complete expected scenario set, exactly one raw
measurement per experiment suite, unique source files, valid execution order,
finite counters, consistent raw-derived diagnostics, supported schema/browser
settings, and matching workload definitions. Empty, duplicate, missing, hidden,
unfinished, or incompatible measurements fail closed. Experiment files are
saved after every suite so interrupted runs retain their completed evidence
while being reported invalid.

The runner checks frozen harness inputs, production builds, and Git revisions
before every suite and after the final suite. Editing or rebuilding either
checkout during the experiment invalidates it while preserving collected samples.

## Decisions and metrics

Primary decisions use **task duration, layout count, and style-recalculation
count** for the five fixed-work scenarios. The practical budget for each block
is the larger of the percentage threshold and its absolute floor:

| Metric                    | Absolute floor   | Purpose                                      |
| ------------------------- | ---------------- | -------------------------------------------- |
| Task duration             | 5 ms             | Total renderer cost for equal completed work |
| Layout count              | 1 layout         | Architectural work indicator                 |
| Style recalculation count | 3 recalculations | Architectural work indicator                 |

Floors define tolerated changes; they are not estimates of noise. For example,
with a 100 ms base and the default 10% threshold, the task budget is 10 ms.
Passing does not establish the absence of a smaller regression.

For each block, the two base costs and two head costs are averaged separately.
The paired observation is `head − base − budget`. The comparator uses an exact,
distribution-free median order-statistic interval, with Bonferroni adjustment
across all 15 primary checks for simultaneous 95% bounds. A bound wholly above
zero supports regression; a bound wholly at or below zero supports passing;
an overlapping or unbounded interval is inconclusive. Zero baselines use
absolute differences, with an undefined percentage reported honestly.

Blocks are the statistical units. Adjacent frames, iterations within a block,
and repeated rows are not independent samples. The interval's coverage assumes
independent blocks from comparable conditions; balanced ordering does not prove
that assumption. With the current 15 checks, fewer than 10 blocks cannot form
finite simultaneous bounds. Even 10 blocks produce broad min/max bounds, so a
noisy result may remain inconclusive. MAD, mean, and maximum are descriptive
diagnostics and do not substitute for the paired uncertainty calculation.

| Diagnostic                              | Interpretation                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Duration and frame count                | Exposure; needed to interpret workload and stalls                                      |
| Script duration                         | Attribution within task duration                                                       |
| Average frame interval                  | Refresh cadence; weak evidence of isolated stalls                                      |
| Maximum frame gap                       | Worst observed stall; retain without an independent hard gate                          |
| Jank interval count                     | Number of intervals over 25 ms; **not** missed/dropped frames                          |
| Frame time over budget                  | Sum of `max(0, interval − 16.67 ms)`, preserving stall severity                        |
| Long-task count and Total Blocking Time | Severe-stall diagnostics; zero rows collapse to a statement without discarding samples |

The redundant five-sample aggregate p95 and fragile frame p99 are removed.
Individual frame intervals remain available for later analysis. Responsiveness
diagnostics and paced throughput need their own calibrated budgets before
becoming hard gates.

## Runner drift and calibration

The runner records CPU model/count, memory, OS/kernel, image version, browser,
Node/Playwright, harness/dependency hashes, execution order, and timestamps.
Every suite records host load, free memory, CPU counters, and available Linux
pressure counters before and after. These observations describe conditions;
they cannot identify the cause of a particular slowdown by themselves.

GitHub-hosted VMs have a published resource class, but jobs can see different
physical CPU performance and image revisions. Pinning the Ubuntu OS family
limits OS changes while permitting image updates. Queue load can delay job
assignment; it does not prove a running measurement is contended. The browser,
server, operating system, and other host activity may compete during a run.
Chrome's 4× throttling is relative to its host and does not normalize different
hosts to one absolute CPU speed.

Alternating **ABBA** and **BAAB** blocks gives equal base/head positions and
reduces approximate linear drift. It does not remove sudden interference,
nonlinear warmup, garbage collection, or correlated host changes. Health data
is retained, not used to erase unfavorable samples automatically. Adding a
larger runner does not repair unequal work or invalid measurement windows.

CI schedules unchanged-code calibration nightly and supports manually dispatched
calibration with script or CPU controls. Workflow artifacts are retained for
90 days. Retain all verdicts and artifacts across independent full
experiments. Measure the false-alarm rate for the complete 15-check procedure,
and test positive controls at costs representative of the desired sensitivity.
For context, zero false alarms in 20 independent experiments still permits
about a 14% one-sided 95% upper bound; roughly 300 clean experiments are needed
to support a 1% bound. These counts concern full experiments, not their blocks.

Promote timing to a required CI gate only after calibration demonstrates useful
false-alarm and detection rates. The runner uses a fixed block count and has no
automatic confirmation. A future confirmation procedure must predeclare its
stopping rule and alpha allocation across repeated looks, and calibrate that
complete procedure. Increasing 10 blocks to 20 after inspecting a result and
reusing the ordinary 95% interval does not preserve its stated coverage. Retain
all observations; this harness does not automatically rerun until green.

## Files

| Path                                              | Purpose                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `prepare.ts`, `build.ts`, `run.ts`                | Common fixture preparation, build provenance, and balanced experiments |
| `scenarios/*.perf.ts`                             | Verified fixed-work and paced interactions                             |
| `fixtures/perf.page.ts`                           | Common page setup, warmups, and workload helpers                       |
| `fixtures/metrics-collector.ts`, `metric-math.ts` | Raw collection and metric derivation                                   |
| `fixtures/compare-metrics.ts`, `run-types.ts`     | Integrity checks, decisions, experiment contract                       |
| `fixtures/statistics.ts`                          | Descriptive aggregation                                                |
| `compare.ts`, `report.ts`                         | Machine-readable verdict and human-readable evidence                   |
| `results/`                                        | Experiment JSON, suite JSON, comparison JSON/Markdown (gitignored)     |
| `baselines/`                                      | Local historical snapshots (gitignored)                                |
