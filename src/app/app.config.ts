import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';

import { routes } from './app.routes';
import { provideDemoAnimationConfig } from './demo-animation-settings';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideIonicAngular(),
    provideDemoAnimationConfig(),
  ],
};
