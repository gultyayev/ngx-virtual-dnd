# Contributing

Requires npm 12 (the version pinned in `packageManager`): `npm install -g npm@12`.

```bash
npm start              # Demo app (localhost:4200)
npm run build:lib      # Build the library (required after library edits)
npm run docs:dev       # Docs site (localhost:3000); live examples load from the demo on :4200
npm test               # Unit tests
npm run e2e            # E2E tests
npm run site:build     # Full GitHub Pages build: docs at /, demo at /demo/
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): description`); a commit-msg hook checks them.
