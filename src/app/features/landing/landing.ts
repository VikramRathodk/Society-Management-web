import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { Avatar, StatusPill } from '../../shared/ui';

/**
 * Sales details. Sections that need them stay hidden until they're filled in, so the page never
 * shows made-up prices or a dead contact link.
 */
export const LANDING = {
  /** e.g. 'hello@yourdomain.in' — shows "Request a demo" in the hero and the closing section. */
  contactEmail: null as string | null,
  /** e.g. '+91 98xxx xxxxx' — shown next to the email. */
  contactPhone: null as string | null,
  /** Public plans; the pricing section appears once there is at least one. */
  plans: [] as { name: string; price: string; per: string; blurb: string; points: string[] }[],
};

interface Pillar {
  icon: string;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
}

/** The hero's product picture: the dashboard and gate board in miniature, with sample data. */
@Component({
  selector: 'app-landing-preview',
  imports: [MatIconModule, Avatar, StatusPill],
  template: `
    <figure class="preview" aria-label="Preview of the dashboard with sample data">
      <figcaption>Sample data</figcaption>
      <div class="p-head">
        <span class="p-date">Thursday, 12 November · Sai Sagar Residency</span>
        <span class="p-hello">Good morning, Sunita</span>
      </div>
      <div class="p-tiles">
        <div class="p-tile">
          <span class="p-label"><mat-icon aria-hidden="true">south_west</mat-icon>Income</span>
          <span class="p-value">₹1,86,000</span>
          <span class="p-delta good"
            ><mat-icon aria-hidden="true">trending_up</mat-icon>+12% vs Oct</span
          >
        </div>
        <div class="p-tile">
          <span class="p-label"><mat-icon aria-hidden="true">north_east</mat-icon>Spent</span>
          <span class="p-value">₹1,42,350</span>
          <span class="p-delta good"
            ><mat-icon aria-hidden="true">trending_down</mat-icon>−4% vs Oct</span
          >
        </div>
        <div class="p-tile">
          <span class="p-label"><mat-icon aria-hidden="true">balance</mat-icon>Surplus</span>
          <span class="p-value positive">₹43,650</span>
          <span class="p-delta">November 2026</span>
        </div>
      </div>
      <div class="p-collect">
        <span><strong>31 of 36</strong> flats paid · Nov 2026 bills</span>
        <span class="p-meter"><span style="width: 86%"></span></span>
      </div>
      <div class="p-lane">
        <div class="p-lane-head"><mat-icon aria-hidden="true">how_to_reg</mat-icon>Let in</div>
        <div class="p-row">
          <app-avatar name="Ravi Kumar" [size]="34" />
          <span class="p-who"><strong>Ravi Kumar</strong><small>Flat A-101 · Delivery</small></span>
          <app-status-pill tone="success">Approved</app-status-pill>
        </div>
        <div class="p-row">
          <app-avatar name="Meera Iyer" [size]="34" />
          <span class="p-who"><strong>Meera Iyer</strong><small>Flat B-204 · Guest</small></span>
          <app-status-pill tone="warning">Pending</app-status-pill>
        </div>
      </div>
    </figure>
  `,
  styles: `
    :host {
      display: block;
    }

    .preview {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 20px;
      border: 1px solid var(--app-card-border);
      border-radius: 24px;
      background: var(--mat-sys-surface-container-low);
      box-shadow:
        var(--app-card-shadow),
        0 30px 60px -30px light-dark(rgb(35 45 30 / 0.3), rgb(0 0 0 / 0.6));

      figcaption {
        position: absolute;
        top: -12px;
        right: 20px;
        padding: 3px 10px;
        border: 1px solid var(--app-card-border);
        border-radius: 999px;
        background: var(--mat-sys-surface-container-lowest);
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-label-small);
        letter-spacing: 0.04em;
      }
    }

    .p-head {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .p-date {
      color: var(--mat-sys-primary);
      font: var(--mat-sys-label-small);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .p-hello {
      font-family: var(--app-font-display);
      font-size: 1.4rem;
    }

    .p-tiles {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .p-tile,
    .p-collect,
    .p-lane {
      border: 1px solid var(--app-card-border);
      border-radius: 14px;
      background: var(--mat-sys-surface-container-lowest);
    }

    .p-tile {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      padding: 12px;
    }

    .p-label,
    .p-delta {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);

      mat-icon {
        width: 14px;
        height: 14px;
        font-size: 14px;
      }
    }

    .p-delta.good {
      color: var(--app-success);
    }

    .p-value {
      overflow: hidden;
      font-family: var(--app-font-display);
      font-size: 1.25rem;
      font-variant-numeric: lining-nums tabular-nums;
      text-overflow: ellipsis;
      white-space: nowrap;

      &.positive {
        color: var(--app-success);
      }
    }

    .p-collect {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      font: var(--mat-sys-body-medium);
    }

    .p-meter {
      display: block;
      height: 8px;
      overflow: hidden;
      border-radius: 4px;
      background: var(--mat-sys-surface-container-high);

      span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--app-success);
      }
    }

    .p-lane-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      font-family: var(--app-font-display);

      mat-icon {
        width: 20px;
        height: 20px;
        color: var(--app-success);
        font-size: 20px;
      }
    }

    .p-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }

    .p-who {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      font: var(--mat-sys-body-medium);

      small {
        color: var(--mat-sys-on-surface-variant);
        font: var(--mat-sys-body-small);
      }
    }

    @media (max-width: 599.98px) {
      .p-tiles {
        grid-template-columns: repeat(2, minmax(0, 1fr));

        .p-tile:last-child {
          display: none;
        }
      }
    }
  `,
})
export class LandingPreview {}

/** Public home page for signed-out visitors: what the app does, for whom, and how to start. */
@Component({
  selector: 'app-landing',
  imports: [RouterLink, MatButtonModule, MatIconModule, LandingPreview],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  private readonly document = inject(DOCUMENT);

  protected readonly config = LANDING;
  protected readonly year = new Date().getFullYear();
  protected readonly demoLink = LANDING.contactEmail
    ? `mailto:${LANDING.contactEmail}?subject=${encodeURIComponent('Demo request')}`
    : null;

  protected readonly pillars: Pillar[] = [
    {
      icon: 'door_front',
      eyebrow: 'The gate',
      title: 'Visitors approved from the flat, not the intercom',
      text: 'The guard logs a visitor with a photo; the flat gets a notification and approves or rejects from their phone. The gate board shows who to let in, who is still waiting and who is inside.',
      points: [
        'Live gate board with big, one-tap actions',
        'Push notifications to the flat',
        'Committee can decide on a flat’s behalf — recorded as an override',
      ],
    },
    {
      icon: 'receipt_long',
      eyebrow: 'Maintenance',
      title: 'Bills for every flat, every cycle',
      text: 'Set charge heads once and issue a cycle for the whole society. Each bill carries a UPI QR code, late fees apply after the grace days, and payments, advances and refunds are tracked flat by flat.',
      points: [
        'Fixed or interest-based late fees',
        'Cash, UPI, cheque or bank transfer, with receipts',
        'Opening balances so you can start mid-year',
      ],
    },
    {
      icon: 'account_balance',
      eyebrow: 'The books',
      title: 'Proper accounts, not a spreadsheet',
      text: 'Double-entry books with a chart of accounts made for housing societies. Income, expenses, transfers and journals need a second person’s approval before they post, and a lock date keeps closed periods closed.',
      points: [
        'Trial balance, income & expenditure, receipts & payments, balance sheet',
        'Ledgers per account and per flat, exportable to CSV',
        'An audit log of every change',
      ],
    },
  ];

  protected readonly roles = [
    {
      icon: 'groups',
      title: 'Committee & treasurer',
      text: 'Money at a glance, the approvals queue, statements, dues by flat and the audit log.',
    },
    {
      icon: 'shield_person',
      title: 'Security guards',
      text: 'A gate board built for a phone at the gate: large buttons, live updates, quick search.',
    },
    {
      icon: 'home',
      title: 'Residents',
      text: 'Their dues and how to pay, visitors to approve, complaints, notices — and the society’s monthly summary when the committee shares it.',
    },
  ];

  protected readonly features = [
    {
      icon: 'report_problem',
      title: 'Complaints',
      text: 'Raised with a timeline, notes and status.',
    },
    { icon: 'campaign', title: 'Notice board', text: 'Notices that reach every flat.' },
    {
      icon: 'admin_panel_settings',
      title: 'Roles & permissions',
      text: 'Built-in roles, or your own.',
    },
    { icon: 'domain', title: 'Building view', text: 'Wings, floors and flats at a glance.' },
    { icon: 'qr_code_2', title: 'Invite by link or QR', text: 'Or share it on WhatsApp.' },
    { icon: 'apartment', title: 'Several societies', text: 'One login, switch from the top bar.' },
    { icon: 'notifications_active', title: 'Notifications', text: 'Visitor and approval alerts.' },
    { icon: 'download', title: 'Export & print', text: 'CSV exports and printable bills.' },
    { icon: 'search', title: 'Search everything', text: 'Jump anywhere with Ctrl K.' },
    { icon: 'contrast', title: 'Light & dark', text: 'Easy on the eyes at night.' },
  ];

  protected readonly steps = [
    {
      title: 'Set up the building',
      text: 'Add wings, floors and flats, then the monthly charges for each.',
    },
    {
      title: 'Invite your people',
      text: 'Residents, committee and guards join by link, QR or WhatsApp — each with the right role.',
    },
    {
      title: 'Run the month',
      text: 'Issue bills, record payments and expenses; the dashboard and the books keep up.',
    },
  ];

  protected readonly faqs = [
    {
      q: 'Do residents need to install anything?',
      a: 'No. It runs in the browser on any phone or computer. Residents who allow notifications get visitor alerts.',
    },
    {
      q: 'Can a resident see other flats’ dues?',
      a: 'No. Residents see their own flat’s bills and payments. The committee sees every flat.',
    },
    {
      q: 'Who can change the money records?',
      a: 'Only roles you allow. Entries wait for a second person’s approval, every change is in the audit log, and a lock date stops edits to closed periods.',
    },
    {
      q: 'Can we start in the middle of the year?',
      a: 'Yes. Enter opening balances for each flat’s dues and for the books, and carry on from there.',
    },
    {
      q: 'How do residents pay?',
      a: 'With the UPI QR code on their bill, or by cash, cheque or bank transfer recorded by the treasurer against their flat.',
    },
    {
      q: 'Can one person look after more than one society?',
      a: 'Yes. Anyone with roles in several societies switches between them from the top bar.',
    },
  ];

  /** In-page links without touching the router's URL. */
  protected scrollTo(id: string, event: Event): void {
    event.preventDefault();
    this.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
