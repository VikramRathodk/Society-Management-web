import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { NoticeApi } from './notice.api';

describe('NoticeApi', () => {
  let api: NoticeApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(NoticeApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists one society\'s board a page at a time', () => {
    api.list(3, 1, 20).subscribe();
    http.expectOne('/api/societies/3/notices?page=1&size=20').flush([]);
  });

  it('posts to the society and edits by notice id', () => {
    api.create(3, { title: 'Water cut' }).subscribe();
    const post = http.expectOne('/api/societies/3/notices');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ title: 'Water cut' });
    post.flush({});

    api.update(5, { description: '' }).subscribe();
    const patch = http.expectOne('/api/notices/5');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ description: '' });
    patch.flush({});
  });
});
