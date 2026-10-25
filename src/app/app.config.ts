import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { switchMap } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthStore } from './core/auth/auth.store';
import { errorInterceptor } from './core/auth/error.interceptor';
import { SocietyContextStore } from './core/society-context/society-context.store';
import { AppTitleStrategy } from './core/title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    // Reload user + permissions when a token is already stored, then the societies they work in.
    provideAppInitializer(() => {
      const ctx = inject(SocietyContextStore);
      return inject(AuthStore)
        .restore()
        .pipe(switchMap(() => ctx.load()));
    }),
  ],
};
