import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

// Specs marked `@jest-environment node` run like a server: no document, and no browser test
// environment, whose DOM adapter would stop @angular/platform-server from installing its own.
if (typeof document !== 'undefined') {
  setupZonelessTestEnv();
}
