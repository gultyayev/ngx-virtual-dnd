# Performance benchmarks

The benchmark compares library revisions using a common production-built consumer,
browser, and measurement harness. Balanced adjacent base/head blocks reduce
execution-order drift. Raw measurements and completed-work checks make the results
auditable. An experiment reports **pass**, **regression**, **inconclusive**, or
**invalid**; a standalone suite is diagnostic.

PRs run a short **counts** profile by default: three balanced blocks, no warmups,
and layout/style count budgets. Task timing is diagnostic, so a computational
slowdown that preserves these counts can pass. Apply the **`perf:timing`** PR
label to request twenty blocks with warmups and timing bounds. Timing regressions
and inconclusive bounds remain advisory; count budget regressions and invalid or
incomplete evidence fail CI in both profiles. The timing profile derives its
required count decision from the same validated samples. A required timing gate needs repeated
unchanged-code A/A experiments and positive controls on the PR runner class.
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

`perf:build` builds the library and production consumer and records their source,
fixture, declared dependency, actual installed dependency, and output hashes.
The benchmark serves static output; Angular compilation and development-server
rebuilds are outside the experiment. Rebuild after changing library source,
the measured consumer, or dependencies. Experiments reject stale builds.

To compare against a Git revision, prepare a clean, disposable base checkout
with the head's harness and dependency manifests:

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
```

Replace `origin/master` with the desired base revision. `perf:prepare` replaces
the disposable checkout's harness, dependency manifests, and server scripts while
preserving its consumer, compiler configuration, library source, and Git revision.
It refuses a dirty base checkout or the head checkout itself. Both builds use
**the base consumer**: the candidate build stages it in a temporary directory
against the candidate's compiled library. Head-only demo bindings to new APIs
cannot break the baseline, and staging preserves both source trees.

The head supplies the harness and browser for **both** variants. Both checkouts
need current `perf:build` output. Their measured consumer and dependencies must
match; only the library varies. An incompatible library/consumer combination
cannot produce comparable evidence. Dependency changes require a separate
experiment: this comparison installs the head lockfile on both sides. Builds
validate the installed hidden lockfile and package versions against that lockfile,
then freeze their fingerprint for the experiment.

To measure already prepared checkouts:

```bash
npm run perf:ab -- --base /path/to/base --head /path/to/head --profile counts
# Full timing comparison with a declared twenty-block budget:
npm run perf:ab -- --base /path/to/base --head /path/to/head --profile timing
npm run perf:compare -- --experiment perf/results/experiment.json --threshold 10
npm run perf:report -- --input perf/results/experiment.json
```

`perf:ab` defaults to the current checkout for both paths and the timing profile
with 20 blocks. `--profile counts` defaults to 3 blocks and zero warmups.
`--blocks` overrides the predeclared budget. `--base-port` and `--head-port`
replace ports 4300 and 4301; `--output` selects the experiment JSON path.
One timing block is useful for a smoke check, but returns inconclusive.

```bash
# Unchanged-code A/A: both paths must contain identical library source/revisions.
npm run perf:a/a -- --base . --head . --blocks 20

# Known busy work during each head measurement:
npm run perf:a/a -- --base . --head . --blocks 20 \
  --control script --control-work-ms 50

# Environmental sensitivity to CPU contention:
npm run perf:a/a -- --base . --head . --blocks 20 --control cpu
```

Controls require calibration mode and the timing profile, are recorded in the
artifact, and are never ordinary PR comparisons. `--control-work-ms` ranges
from 0 to 1000; injected absolute work is not a guaranteed percentage slowdown.
The CPU control tests contention sensitivity rather than a library regression.
The script control runs in a browser timer task so script counters, long-task
observers, and frame intervals can observe it. Busy work executed directly
through DevTools can visibly stall while normal instrumentation omits it.

`perf:compare` accepts `--experiment`, `--threshold`, `--output` (Markdown), and
`--json` (machine-readable verdict). Its default input is
`perf/results/experiment.json` and threshold is 10%. Exit codes are:

| Code | Verdict      | Counts profile                                          | Timing profile                                          |
| ---- | ------------ | ------------------------------------------------------- | ------------------------------------------------------- |
| 0    | pass         | All paired median count excesses are within budget.     | All primary bounds are within their practical budgets.  |
| 1    | regression   | At least one median count excess exceeds budget.        | At least one bound is wholly above its budget.          |
| 2    | inconclusive | Not used for a complete valid count comparison.         | Too few blocks or uncertainty overlaps a budget.        |
| 3    | invalid      | Missing, corrupt, incomplete, or incomparable evidence. | Missing, corrupt, incomplete, or incomparable evidence. |

`--decision-profile counts` derives the count budget decision from validated
timing evidence, as CI does to keep count budgets required. It changes the
decision metrics without changing the recorded protocol, warmups, or raw samples.
It cannot bypass integrity checks or turn incomplete evidence into a pass.

`perf:report` defaults to `experiment.json` when present. A failed preflight with
only `comparison.json` is reported as invalid instead of falling back to an older
suite; a summary without raw evidence cannot establish a valid verdict. With
neither experiment nor summary, it uses `latest.json`. It accepts `--input`,
`--output`, `--threshold`, and `--details`. It exits 3 for invalid evidence and 0
for a rendered report; use `perf:compare` for the verdict's exit code.

The default report shows the verdict and one row per scenario, with task time,
layout/style changes, and uncertain or regressing metrics. A counts pass refers
explicitly to count checks; its task column is marked diagnostic. Unchanged
library source is labelled a harness check, so a harness-only PR does not imply
a library speedup. The original runner error appears first for incomplete runs.
CI uses this compact report in the PR comment and job summary. `--details`
provides metric tables, workloads, confidence intervals, hashes, environment
settings, and runner health. CI saves it as `report-details.md` with raw JSON.

```bash
npm run perf:report -- --input perf/results/experiment.json
npm run perf:report -- --input perf/results/experiment.json --details \
  --output perf/results/report-details.md
```

`perf:baseline` remains a local snapshot convenience. Historical snapshots can
be inspected with `perf:compare -- --baseline <file> --current <file>`, but valid
unpaired evidence always returns inconclusive. Old schemas and missing metadata
are invalid; compatibility checks cannot be bypassed.

## Measured work

Demo pages open with `?dragStateDebug=false`. The page object rejects visible
drag-state debug output: rendering cursor diagnostics can add a consumer-wide
render every drag frame. Keep high-frequency debug output and template listeners
out of measured pages.

| Scenario                             | Page                           | Workload                                             |
| ------------------------------------ | ------------------------------ | ---------------------------------------------------- |
| `scroll-2000-items`                  | `/`                            | Fixed row checkpoints through a 2000-item list       |
| `drag-within-list-1000`              | `/`                            | Fixed drag updates and verified reorder              |
| `drag-within-virtual-for-list`       | `/virtual-viewport`            | Fixed drag updates and verified reorder              |
| `dynamic-height-scroll`              | `/dynamic-height`              | Fixed row checkpoints through dynamic rows           |
| `dynamic-height-long-list-scroll`    | `/dynamic-height?count=100000` | Fixed checkpoints through previously unmeasured rows |
| `drag-between-lists-autoscroll-1000` | `/`                            | Paced autoscroll and verified cross-list transfer    |

Fixed-work scenarios wait for delivered updates and verify operations, requested
row checkpoints, or the resulting reorder. Scroll paths advance through logical
row IDs independent of row height or total scroll range. Each requested row must
render and settle at its target position. Pixel distances and rendered ranges
remain diagnostic across variants; per-run scroll evidence must still be
internally consistent. Drag outcomes include drop attributes and the item
observed in the destination, collected after verification outside the measured
window. Within-list drags stay clear of the autoscroll edge.

A slower runner must complete the same work instead of visiting fewer rows during
a fixed elapsed duration. Fixed-work evidence is compared in every block.
Additional visited rows remain diagnostic: differing overscan strategies can
complete the same checkpoints. Paced autoscroll retains the responsiveness
workload and reports actual distance/operations; its totals do not gate because
elapsed-time work varies under load.

The timing profile performs a page-reset warmup before measured iterations;
the default CI counts profile uses zero warmups. Each measurement starts on a
fresh page, so warmups prime the browser process rather than reusing a warmed
application document. Workload, snapshots, and observers run under 4× CPU
throttling. Navigation, app startup, Playwright utility-script compilation,
and functional verification run at normal speed to prevent bootstrap stalls.

A standalone suite defaults to five measured iterations. Each experiment suite
has one measured iteration; four suites form a block. Three blocks collect six
measurements per variant per scenario; twenty collect forty. The default profile
runs 12 suites without warmups; timing runs 80 with one warmup each. This reduces
default measurement work substantially, but wall time depends on the runner.
Both profiles retain all six scenarios and the same page-reset protocol.
Retries are disabled.

## Measurement and integrity

Metrics schema **4** preserves every measured sample, frame interval, long task,
page-clock bound, browser version, visibility state, counter exposure, and
actual workload outcome. Aggregates derive from raw evidence; stored summaries
cannot override the comparison. Warmup measurements remain separate from inference.

Long-task observers are created/disconnected per measurement and bounded by the
page's monotonic clock. CDP snapshots bracket renderer counters. Counter exposure
includes transport/setup overhead and is recorded separately from the interaction
window. Startup and warmup are excluded from measured interaction.

Frame intervals measure `requestAnimationFrame` callback cadence, rather than
presented frames. A post-work callback makes a final stall observable. The leading
partial interval before the first callback is excluded. Finite zero intervals
are valid at reduced timer precision; negative or nonfinite intervals invalidate
results.

The comparator requires the expected scenario set, one raw measurement per
experiment suite, unique source files, valid execution order, finite counters,
consistent raw-derived diagnostics, supported schema/browser settings, and
matching logical workload definitions. Empty, duplicate, missing, hidden,
unfinished, or incompatible evidence fails closed. Experiment files are saved
after every suite so interrupted runs retain evidence while reporting invalid.

The runner freezes harness inputs, the common external consumer fixture, actual
installed dependencies, production builds, and Git revisions before each suite
and after the last. Editing or rebuilding either checkout during an experiment
invalidates it while preserving collected samples.

## Decisions and metrics

The **counts** profile checks layout and style-recalculation counts for five
fixed-work scenarios across three balanced blocks. The median paired budget
excess determines its verdict. With three blocks, a regression requires positive
budget excess in at least two blocks. This reduces the effect of an isolated
outlier, but correlated count variation can affect it. This is a practical architectural
check, without a confidence-level or calibrated false-alarm claim. Task cost and
responsiveness remain diagnostic.

The **timing** profile checks task duration, layout count, and style-recalculation
count for those five scenarios. Each block's practical budget is the larger of
the percentage threshold and absolute floor:

| Metric                    | Absolute floor   | Purpose                                      |
| ------------------------- | ---------------- | -------------------------------------------- |
| Task duration             | 5 ms             | Total renderer cost for equal completed work |
| Layout count              | 1 layout         | Architectural work indicator                 |
| Style recalculation count | 3 recalculations | Architectural work indicator                 |

Floors define tolerated changes, not noise estimates. With a 100 ms base and
10% threshold, the task budget is 10 ms. Passing does not rule out smaller changes.
Both profiles average the two base costs and two head costs separately per block;
the paired observation is `head − base − budget`. Zero baselines use absolute
differences and report an undefined percentage honestly.

Timing uses an exact distribution-free median order-statistic interval, with
Bonferroni adjustment across 15 primary checks for simultaneous 95% bounds.
A bound wholly above zero supports regression; wholly at/below zero supports
passing; an overlapping or unbounded interval is inconclusive. Coverage assumes
independent blocks with a common target median; balanced order does not prove
that assumption. Frames, repeated rows, and iterations within a block are not
independent statistical units.

| Timing blocks | Ordered excess bounds | Agreement needed on one side of the budget |
| ------------- | --------------------- | ------------------------------------------ |
| 10            | 1st–10th              | All 10 blocks                              |
| 14            | 2nd–13th              | 13 of 14 blocks                            |
| 20            | 4th–17th              | 17 of 20 blocks                            |

Fewer than ten blocks cannot form finite simultaneous bounds. Ten blocks are
not inconclusive by construction: consistent evidence passes or fails, but
outlier tolerance and detection power are limited. Inconclusive does not establish
acceptable performance. MAD, mean, and maximum are descriptive diagnostics and
do not replace paired uncertainty. Modeled pass rates are not measured
false-alarm/detection rates for the complete procedure.

| Diagnostic                              | Interpretation                                                        |
| --------------------------------------- | --------------------------------------------------------------------- |
| Duration and frame count                | Exposure for interpreting workload and stalls                         |
| Script duration                         | Attribution within task duration                                      |
| Average frame interval                  | Refresh cadence; weak evidence of isolated stalls                     |
| Maximum frame gap                       | Worst observed stall, without an independent hard gate                |
| Jank interval count                     | Intervals over 25 ms; not missed/dropped frames                       |
| Frame time over budget                  | Sum of `max(0, interval − 16.67 ms)`, preserving stall severity       |
| Long-task count and Total Blocking Time | Severe-stall diagnostics; zero rows collapse without removing samples |

The redundant five-sample aggregate p95 and fragile frame p99 are removed.
Individual intervals remain available. Responsiveness and paced throughput
need calibrated budgets before becoming hard gates.

## Runner drift and calibration

Provenance records CPU model/count, memory, OS/kernel, image version, browser,
Node/Playwright, hashes, order, and timestamps. Suites record load, free memory,
CPU counters, and available Linux pressure counters before and after. These
describe conditions; they cannot identify a particular slowdown's cause alone.

GitHub-hosted VMs have a published resource class, but physical CPU performance
and image revisions can differ. Pinning the Ubuntu OS family permits image
updates. Queue load delays assignment without proving a running measurement is
contended. Browser, server, OS, and host activity may compete. Chrome's 4× CPU
throttling is relative to its host, not one absolute speed across hosts.

Alternating **ABBA** and **BAAB** blocks balances base/head positions and reduces
approximately linear drift. It does not remove sudden interference, nonlinear
warmup, garbage collection, or correlated changes. Health data is retained;
unfavorable samples are not erased automatically. Larger runners cannot repair
unequal work or invalid measurement windows.

CI runs **only on pull requests** affecting the library, harness, static server,
or benchmark workflow. Other changes, including dependency-only PRs, skip this
library comparison. Adding/removing `perf:timing` selects the relevant profile;
unrelated label events do not start measurements. There is no scheduled or
manually dispatched workflow. Local A/A and positive-control commands above
provide calibration. Cancelled runs retain evidence without replacing the
previous PR comment. Workflow artifacts are retained for 90 days.

Retain all verdicts and artifacts across independent full experiments. Measure
false alarms for the complete timing procedure and positive-control detection
at relevant costs. Zero false alarms in twenty independent experiments still
permits about a 14% one-sided 95% upper bound; roughly 300 clean experiments
are needed to support a 1% bound. These counts concern experiments, not blocks.

Promote timing to a required gate only after useful false-alarm and detection
rates are demonstrated. The runner uses a fixed block count, without automatic
confirmation. Future confirmation needs a predeclared stopping rule and alpha
allocation across repeated looks. Increasing ten blocks to twenty after seeing
a result and reusing the ordinary 95% interval does not preserve its stated
coverage. This harness does not rerun automatically until green.

## Files

| Path                                              | Purpose                                     |
| ------------------------------------------------- | ------------------------------------------- |
| `prepare.ts`, `build.ts`, `run.ts`                | Common fixture, provenance, experiments     |
| `scenarios/*.perf.ts`                             | Verified fixed-work and paced interactions  |
| `fixtures/perf.page.ts`                           | Page setup and workload helpers             |
| `fixtures/metrics-collector.ts`, `metric-math.ts` | Raw collection and derivation               |
| `fixtures/compare-metrics.ts`, `run-types.ts`     | Integrity, decisions, experiment contract   |
| `fixtures/statistics.ts`                          | Descriptive aggregation                     |
| `compare.ts`, `report.ts`                         | Machine verdict and readable evidence       |
| `results/`, `baselines/`                          | Gitignored raw evidence and local snapshots |
