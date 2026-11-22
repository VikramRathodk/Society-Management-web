import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { SubscriptionAccessStore } from '../../core/subscription/subscription-access.store';
import { VisitorCreate } from './visitor-create';

describe('VisitorCreate', () => {
  let fixture: ComponentFixture<VisitorCreate>;
  let http: HttpTestingController;

  async function setup(permissions: string[]): Promise<void> {
    localStorage.clear();
    localStorage.setItem('sm.societyId', '1');
    TestBed.configureTestingModule({
      imports: [VisitorCreate],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthStore, useValue: { can: (p: string) => permissions.includes(p) } },
        // Parking off: no visitor slot picker, no slot requests.
        { provide: SubscriptionAccessStore, useValue: { allows: () => false } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(VisitorCreate);
    await fixture.whenStable();
  }

  const notice = () => (fixture.nativeElement as HTMLElement).querySelector('[role=status]');

  afterEach(() => http.verify());

  it('loads wings when the role can see the flat directory', async () => {
    await setup(['VISITOR.ENTRY.CREATE', 'FLAT.DIRECTORY.VIEW']);
    http.expectOne('/api/societies/1/wings').flush([{ id: 1, societyId: 1, name: 'Stark Wing' }]);
    expect(notice()).toBeNull();
  });

  it("explains, without calling the API, when the role can't see flats", async () => {
    await setup(['VISITOR.ENTRY.CREATE']);
    http.expectNone('/api/societies/1/wings');
    expect(notice()?.textContent).toContain('FLAT.DIRECTORY.VIEW');
  });
});
