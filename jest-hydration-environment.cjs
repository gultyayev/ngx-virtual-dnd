// The Node test environment, plus jsdom's `JSDOM` for hydration.spec.ts, which renders on the server
// in Node and hydrates the result in a jsdom window of its own. jsdom is loaded here, by Node, as
// jest-environment-jsdom does: jest's module loader cannot load the ES modules jsdom depends on
// without --experimental-vm-modules, and from Jest 30.5 a spec can't reach Node's own `require`
// (`process.getBuiltinModule('node:module')` goes through jest's loader too).
const { TestEnvironment } = require('jest-environment-node');
const { JSDOM } = require('jsdom');

class HydrationEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.JSDOM = JSDOM;
  }
}

module.exports = HydrationEnvironment;
