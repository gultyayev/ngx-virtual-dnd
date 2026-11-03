// @angular/platform-server (from 21.1) imports its server DOM as a default export from a separate
// file: `import domino from '../third_party/domino/bundled-domino.mjs'`. jest-preset-angular
// compiles `.mjs` files with esbuild, which gives a default import from an `.mjs` file Node's
// interop: the whole `module.exports` (`{ default: domino }`), so `domino.impl` is undefined and
// every `renderApplication` throws in `setDomTypes`. jest.config.ts maps that import here, and
// this module's exports are domino itself.
const path = require('node:path');

module.exports = require(
  path.join(
    __dirname,
    'node_modules/@angular/platform-server/third_party/domino/bundled-domino.mjs',
  ),
).default;
