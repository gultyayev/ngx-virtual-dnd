# Checks: baseline

Commit: de8f0fb on docs/night-design-system, 2026-11-01T11:21Z

| Command                              | Result | Summary                                         |
| ------------------------------------ | ------ | ----------------------------------------------- |
| `npm run build:lib`                  | pass   | Built ngx-virtual-dnd                           |
| `npm run build`                      | pass   | Output location: dist/dnd                       |
| `npm run docs:build`                 | pass   | dist/site written                               |
| `npm run lint`                       | pass   | All files pass linting. All files pass linting. |
| `npm test -- --silent`               | pass   | 44 suites, 1361 passing, 0 failing              |
| `npm run typecheck`                  | pass   | no errors                                       |
| `npx playwright test --reporter=dot` | pass   | 2 skipped 839 passed (2.2m)                     |

Full logs: /private/tmp/claude-501/-Users-crush-Projects-dnd-dist-ngx-virtual-dnd/b40b7c88-8abe-49db-8119-cc4bb0a15de8/scratchpad/checks/baseline
