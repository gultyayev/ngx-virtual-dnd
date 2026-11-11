#!/usr/bin/env bash

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

cd "$(dirname "$0")/.." || exit 1

# The lockfile is written by the npm pinned in package.json (packageManager). The npm bundled
# with the container's Node is older and refuses it ("package.json and package-lock.json are not
# in sync"), so install with the pinned version, as CI does.
pinned_npm="$(node -p "require('./package.json').packageManager.split('+')[0]")"
npx --yes "$pinned_npm" ci || exit 1

# The project's own Playwright (now installed) picks the browser builds it needs.
npx playwright install --with-deps chromium firefox webkit
