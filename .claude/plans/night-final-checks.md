# Night restyle (demo app): final checks

Branch `chore/demo-night-design-system`, 2026-11-01. Same commands as the step 0 baseline
(`night-baseline.md`).

| Command                                                              | Baseline              | Final                 |
| -------------------------------------------------------------------- | --------------------- | --------------------- |
| `npm run build:lib`                                                  | pass                  | pass                  |
| `npm run build`                                                      | pass                  | pass                  |
| `npm run docs:build`                                                 | pass                  | pass                  |
| `npm run lint`                                                       | pass                  | pass                  |
| `npm run typecheck`                                                  | pass                  | pass                  |
| `npm test -- --silent`                                               | 1,361 passing         | 1,361 passing         |
| `npx playwright test --reporter=dot --max-failures=1` (all browsers) | 839 passed, 2 skipped | 839 passed, 2 skipped |

The first final run failed in Firefox (`container-resize.spec.ts`: the list measured
900.00003px instead of 900px), caused by fractional line heights above the lists. Fixed by
giving those text blocks whole-pixel line heights; the full suite then passed twice.

Also checked: no horizontal scroll at 390px on Main demo, Page scroll and Dynamic height; the
mobile menu sheet; keyboard focus on a row (accent edge and ring); Geist and Geist Mono load
from the bundled files.
