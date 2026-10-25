import {
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { ErrorResponse } from '../models';
import { AuthStore } from './auth.store';

/** Set on requests whose caller shows every error inline, so no snackbar is raised (401 still logs out). */
export const INLINE_ERRORS = new HttpContextToken<boolean>(() => false);

export function inlineErrors(): HttpContext {
  return new HttpContext().set(INLINE_ERRORS, true);
}

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const snack = inject(MatSnackBar);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      // The login form shows its own errors inline.
      if (req.url.includes('/api/auth/')) return throwError(() => err);

      if (err.status === 401) {
        auth.logout();
        router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
      } else if (err.status !== 400 && !req.context.get(INLINE_ERRORS)) {
        snack.open(errorMessage(err), 'Close', { duration: 4000 });
      }
      return throwError(() => err);
    }),
  );
};

export function errorMessage(err: HttpErrorResponse): string {
  if (err.status === 0) return 'Cannot reach the server';
  return (err.error as ErrorResponse | null)?.message ?? 'Something went wrong';
}
