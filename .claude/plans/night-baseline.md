# Night restyle (demo app): step 0 baseline

Clean checkout of `master` at `6d90a0d` (2026-11-01), macOS, Node from `packageManager`.

| Command                                                              | Result                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| `npm run build:lib`                                                  | pass                                                  |
| `npm run build`                                                      | pass                                                  |
| `npm run docs:build`                                                 | pass                                                  |
| `npm run lint`                                                       | pass ("All files pass linting.")                      |
| `npm run typecheck`                                                  | pass                                                  |
| `npm test -- --silent`                                               | pass: 1,361 passing, 0 failing, 0 pending (44 suites) |
| `npx playwright test --reporter=dot --max-failures=1` (all browsers) | pass: 839 passed, 2 skipped                           |

Screenshots (1440px wide, light and dark): `night-screens/before/` — Main demo (at rest and mid-drag, Item 4 from List 1 over List 2), Page scroll, Dynamic height.
