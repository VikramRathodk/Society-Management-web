import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { Complaint, ComplaintActivity } from '../../core/models';
import { ComplaintDetail } from './complaint-detail';

function complaint(status: Complaint['status'], raisedById = 7): Complaint {
  return {
    id: 4,
    societyId: 1,
    flatId: 9,
    flatNumber: '1001',
    category: 'PLUMBING',
    description: 'Kitchen tap leaking',
    status,
    raisedById,
    raisedByName: 'Wanda Maximoff',
    createdAt: '2026-10-28T10:00:00Z',
    updatedAt: null,
    updatedById: null,
    updatedByName: null,
  };
}

const timeline: ComplaintActivity[] = [
  {
    fromStatus: null,
    toStatus: 'OPEN',
    note: null,
    actorId: 7,
    actorName: 'Wanda Maximoff',
    createdAt: '2026-10-28T10:00:00Z',
  },
  {
    fromStatus: 'OPEN',
    toStatus: 'RESOLVED',
    note: 'Washer replaced',
    actorId: 3,
    actorName: 'Steve Rogers',
    createdAt: '2026-10-28T12:00:00Z',
  },
];

describe('ComplaintDetail', () => {
  let fixture: ComponentFixture<ComplaintDetail>;
  let http: HttpTestingController;

  async function setup(permissions: string[], userId: number, shown: Complaint): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ComplaintDetail],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthStore,
          useValue: {
            can: (p: string) => permissions.includes(p),
            canOnPlatform: () => false,
            user: () => ({ id: userId, name: 'Someone', roles: [] }),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ComplaintDetail);
    fixture.componentRef.setInput('id', 4);
    await fixture.whenStable();
    http.expectOne('/api/complaints/4').flush(shown);
    http.expectOne('/api/complaints/4/activity').flush(timeline);
    await fixture.whenStable();
  }

  const buttons = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map((b) =>
      b.textContent?.replace(/\s+/g, ' ').trim(),
    );
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  afterEach(() => http.verify());

  it('offers the committee the moves the status allows', async () => {
    await setup(
      ['COMPLAINT.TICKET.VIEW', 'COMPLAINT.RESOLUTION.APPROVE', 'COMPLAINT.RESOLUTION.REJECT'],
      3,
      complaint('RESOLVED'),
    );
    expect(buttons()).toEqual(['replay Reopen', 'lock Close']);
  });

  it('lets the author edit and withdraw while open, but not move it', async () => {
    const resident = [
      'COMPLAINT.TICKET.VIEW',
      'COMPLAINT.TICKET.UPDATE',
      'COMPLAINT.TICKET.DELETE',
    ];
    await setup(resident, 7, complaint('OPEN'));
    expect(buttons()).toEqual(['edit Edit', 'undo Withdraw']);
    expect(text()).toContain('The committee will update this');
  });

  it('locks the complaint for its author once resolved', async () => {
    await setup(
      ['COMPLAINT.TICKET.VIEW', 'COMPLAINT.TICKET.UPDATE', 'COMPLAINT.TICKET.DELETE'],
      7,
      complaint('RESOLVED'),
    );
    expect(buttons()).toEqual([]);
  });

  it('shows the timeline newest first with its notes', async () => {
    await setup(['COMPLAINT.TICKET.VIEW'], 7, complaint('RESOLVED'));
    const steps = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.step-title')].map(
      (s) => s.textContent?.trim(),
    );
    expect(steps).toEqual(['Resolved by Steve Rogers', 'Raised by Wanda Maximoff']);
    expect(text()).toContain('Washer replaced');
  });
});
