import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  ActivatedRouteSnapshot,
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withViewTransitions,
} from '@angular/router';
import { switchMap } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthStore } from './core/auth/auth.store';
import { errorInterceptor } from './core/auth/error.interceptor';
import { SocietyContextStore } from './core/society-context/society-context.store';
import { AppTitleStrategy } from './core/title-strategy';

/** The matched path, ignoring query params and fragment (e.g. `finance/accounts/12/`). */
function routePath(s: ActivatedRouteSnapshot | null): string {
  return s ? `${s.url.map((u) => u.path).join('/')}/${routePath(s.firstChild)}` : '';
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      // Soft cross-fade between pages (styles.scss). Filter and tab changes only touch the query
      // string, so those stay instant.
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: ({ transition, from, to }) => {
          if (routePath(from) === routePath(to)) transition.skipTransition();
        },
      }),
    ),
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
