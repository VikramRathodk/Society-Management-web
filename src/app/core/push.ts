import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Messaging } from 'firebase/messaging';
import { Subject, catchError, firstValueFrom, of, timeout } from 'rxjs';

import { environment } from '../../environments/environment';
import { UserApi } from './api/user.api';
import { inlineErrors } from './auth/error.interceptor';
import { AuthStore } from './auth/auth.store';
import { Notifier } from './notifier';
import { PushData, pushRoute } from './push-routes';

const SENT_KEY = 'sm.fcmToken';
const WORKER = 'firebase-messaging-sw.js';
// Its own scope, like Firebase's default, so it never clashes with an app service worker.
const WORKER_SCOPE = 'firebase-cloud-messaging-push-scope';
const RECHECK_MS = 24 * 60 * 60 * 1000;

/** unsupported: no browser support or no VAPID key · blocked: denied in browser settings. */
export type PushStatus = 'unsupported' | 'off' | 'on' | 'blocked';

export interface PushMessage {
  title?: string;
  body?: string;
  data: PushData;
}

/** What the service worker posts to an open tab. */
type WorkerMessage =
  | ({ source: 'sm-push'; kind: 'message' } & PushMessage)
  | { source: 'sm-push'; kind: 'open'; url: string };

/**
 * Registers this browser for FCM push and stores the token as the user's `fcmToken`. Firebase
 * loads on first use so it stays out of the initial bundle. Failures are silent: push is a
 * convenience, and the visitor list still polls.
 *
 * The service worker shows notifications while no tab is visible; otherwise it posts the message
 * here, and it arrives on `messages$` with a snackbar.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly auth = inject(AuthStore);
  private readonly userApi = inject(UserApi);
  private readonly notifier = inject(Notifier);
  private readonly router = inject(Router);

  private readonly _status = signal<PushStatus>(initialStatus());
  readonly status = this._status.asReadonly();

  private readonly _messages = new Subject<PushMessage>();
  /** Pushes received while a tab is visible, so screens can re-fetch. */
  readonly messages$ = this._messages.asObservable();

  private messaging: Messaging | null = null;
  private listening = false;
  private connecting: Promise<void> | null = null;
  private checkedAt = 0;

  /** On app load: refreshes the token if permission was already granted. Never prompts. */
  resume(): void {
    if (this._status() === 'unsupported') return;
    this.listen();
    if (Notification.permission === 'granted') void this.connect();
  }

  /** From a user click (browsers block prompts that aren't): asks permission, then registers. */
  async enable(): Promise<void> {
    if (this._status() === 'unsupported') return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      this._status.set(permission === 'denied' ? 'blocked' : 'off');
      return;
    }
    this.listen();
    await this.connect();
  }

  /**
   * Before logout, while the JWT still works: clears the token on the backend, then in this
   * browser. Never throws and gives the backend at most 2 s.
   */
  async unregister(): Promise<void> {
    const user = this.auth.user();
    if (user && this._status() === 'on') {
      await firstValueFrom(
        this.userApi.update(user.id, { fcmToken: '' }, inlineErrors()).pipe(
          timeout(2000),
          catchError(() => of(null)),
        ),
      );
    }
    await this.forget();
  }

  /**
   * After a 401 the JWT is gone, so only this browser's token is dropped. The backend moves the
   * token to whoever registers it next.
   */
  async forget(): Promise<void> {
    clearSent();
    if (this._status() === 'on') this._status.set('off');
    if (!this.messaging) return;
    try {
      const { deleteToken } = await import('firebase/messaging');
      await deleteToken(this.messaging);
    } catch {
      // Best effort: the backend no longer points at this token anyway.
    }
  }

  private connect(): Promise<void> {
    // resume() and enable() can overlap; share one registration.
    this.connecting ??= this.register().finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async register(): Promise<void> {
    const user = this.auth.user();
    if (!user) return;
    try {
      const firebase = await this.firebase();
      if (!(await firebase.isSupported())) {
        this._status.set('unsupported');
        return;
      }
      this.messaging ??= firebase.getMessaging(firebase.initializeApp(environment.firebase));
      const token = await firebase.getToken(this.messaging, {
        vapidKey: environment.vapidKey,
        serviceWorkerRegistration: await navigator.serviceWorker.register(
          new URL(WORKER, document.baseURI).pathname,
          { scope: new URL(WORKER_SCOPE, document.baseURI).pathname },
        ),
      });
      if (!token) return;
      if (!environment.production) console.info('[push] FCM token', token);
      this.checkedAt = Date.now();
      this._status.set('on');

      // Only PATCH when the token is new for this user; it rarely changes.
      const sent = `${user.id}:${token}`;
      if (readSent() !== sent) {
        this.userApi.update(user.id, { fcmToken: token }, inlineErrors()).subscribe({
          next: () => writeSent(sent),
          error: () => {},
        });
      }
    } catch (err) {
      console.warn('[push] registration failed', err);
    }
  }

  /** Separate so tests can stub Firebase. */
  protected async firebase() {
    const [{ initializeApp }, { getMessaging, getToken, isSupported }] = await Promise.all([
      import('firebase/app'),
      import('firebase/messaging'),
    ]);
    return { initializeApp, getMessaging, getToken, isSupported };
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;

    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data as WorkerMessage | null;
      if (msg?.source !== 'sm-push') return;
      if (msg.kind === 'open') {
        void this.router.navigateByUrl(msg.url);
        return;
      }
      const { title, body, data } = msg;
      this._messages.next({ title, body, data });
      const text = [title, body].filter(Boolean).join(' — ');
      if (text) {
        this.notifier.show(text, 'View', 6000, () => this.router.navigateByUrl(pushRoute(data)));
      }
    });

    // Firebase rotates tokens now and then; re-check about once a day. The cache avoids a PATCH.
    document.addEventListener('visibilitychange', () => {
      if (
        document.visibilityState === 'visible' &&
        this._status() === 'on' &&
        Date.now() - this.checkedAt > RECHECK_MS
      ) {
        void this.connect();
      }
    });
  }
}

function initialStatus(): PushStatus {
  if (!environment.vapidKey || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  return Notification.permission === 'denied' ? 'blocked' : 'off';
}

function readSent(): string | null {
  try {
    return localStorage.getItem(SENT_KEY);
  } catch {
    return null;
  }
}

function writeSent(value: string): void {
  try {
    localStorage.setItem(SENT_KEY, value);
  } catch {
    // Storage unavailable — the token is just re-sent next time.
  }
}

function clearSent(): void {
  try {
    localStorage.removeItem(SENT_KEY);
  } catch {
    // Storage unavailable — nothing was cached.
  }
}
