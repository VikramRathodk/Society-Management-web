import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AuthStore } from './auth/auth.store';
import { Notifier } from './notifier';
import { PushMessage, PushService } from './push';

const user = {
  id: 7,
  name: 'Nick Fury',
  phone: '9000000616',
  email: null,
  isActive: true,
  roles: [],
};

/** Stands in for the browser APIs jsdom lacks. */
function stubBrowser(permission: NotificationPermission) {
  const notification = {
    permission,
    requestPermission: vi.fn(async () => notification.permission),
  };
  const worker = new EventTarget() as EventTarget & { register: ReturnType<typeof vi.fn> };
  worker.register = vi.fn(async () => ({}));
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, 'Notification', { configurable: true, value: notification });
  }
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
  return { notification, worker };
}

describe('PushService', () => {
  let http: HttpTestingController;
  let browser: ReturnType<typeof stubBrowser>;
  let getToken: ReturnType<typeof vi.fn>;
  let notifier: { show: ReturnType<typeof vi.fn> };

  function create(permission: NotificationPermission): PushService {
    browser = stubBrowser(permission);
    notifier = { show: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: { user: signal(user) } },
        { provide: Notifier, useValue: notifier },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const service = TestBed.inject(PushService);
    getToken = vi.fn(async () => 'tok-1');
    vi.spyOn(service as unknown as { firebase: () => unknown }, 'firebase').mockResolvedValue({
      initializeApp: () => ({}),
      getMessaging: () => ({}),
      getToken,
      isSupported: async () => true,
    });
    return service;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('does not prompt or register on load without permission', async () => {
    const push = create('default');
    push.resume();
    await Promise.resolve();
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
    expect(push.status()).toBe('off');
  });

  it('starts blocked when the browser denied notifications', () => {
    expect(create('denied').status()).toBe('blocked');
  });

  it('refreshes the token on load when already granted and saves it once', async () => {
    const push = create('granted');
    push.resume();
    const req = await vi.waitFor(() => http.expectOne('/api/users/7'));
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ fcmToken: 'tok-1' });
    req.flush({});
    expect(push.status()).toBe('on');
    expect(localStorage.getItem('sm.fcmToken')).toBe('7:tok-1');
  });

  it('skips the PATCH when this user already sent this token', async () => {
    localStorage.setItem('sm.fcmToken', '7:tok-1');
    const push = create('granted');
    push.resume();
    await vi.waitFor(() => expect(push.status()).toBe('on'));
    http.expectNone('/api/users/7');
  });

  it('marks the service blocked when the user denies the prompt', async () => {
    const push = create('default');
    browser.notification.permission = 'denied';
    await push.enable();
    expect(browser.notification.requestPermission).toHaveBeenCalled();
    expect(push.status()).toBe('blocked');
  });

  it('clears the token on the backend and locally on logout', async () => {
    const push = create('default');
    browser.notification.permission = 'granted';
    const enabled = push.enable();
    (await vi.waitFor(() => http.expectOne('/api/users/7'))).flush({});
    await enabled;

    const done = push.unregister();
    const req = await vi.waitFor(() => http.expectOne('/api/users/7'));
    expect(req.request.body).toEqual({ fcmToken: '' });
    req.flush({}, { status: 500, statusText: 'Server Error' }); // errors never block logout
    await expect(done).resolves.toBeUndefined();
    expect(push.status()).toBe('off');
    expect(localStorage.getItem('sm.fcmToken')).toBeNull();
  });

  it('passes worker messages on and ignores unrelated ones', async () => {
    const push = create('default');
    push.resume();
    const received = firstValueFrom(push.messages$);
    const post = (data: unknown) =>
      browser.worker.dispatchEvent(new MessageEvent('message', { data }));
    post({ type: 'unrelated' });
    post({
      source: 'sm-push',
      kind: 'message',
      title: 'Visitor',
      data: { type: 'VISITOR_LOGGED' },
    });
    expect(await received).toEqual<PushMessage>({
      title: 'Visitor',
      body: undefined,
      data: { type: 'VISITOR_LOGGED' },
    });
    expect(notifier.show).toHaveBeenCalledOnce();
    expect(notifier.show).toHaveBeenCalledWith('Visitor', 'View', 6000, expect.any(Function));
  });
});
