import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  inject,
  input,
  numberAttribute,
  signal,
  viewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

import { ThemeStore } from '../core/theme';

Chart.register(...registerables);

/** Theme colours a series can use; resolved from the CSS tokens so light and dark both work. */
export type SeriesColor = 'primary' | 'accent' | 'success' | 'warning' | 'tertiary' | 'neutral';

export interface ChartSeries {
  label: string;
  data: number[];
  color?: SeriesColor;
}

const TOKENS: Record<SeriesColor, string> = {
  primary: 'var(--mat-sys-primary)',
  accent: 'var(--app-accent)',
  success: 'var(--app-success)',
  warning: 'var(--app-warning)',
  tertiary: 'var(--mat-sys-tertiary)',
  neutral: 'var(--mat-sys-outline)',
};
/** Order used when a series (or a doughnut slice) has no colour of its own. */
const CYCLE: SeriesColor[] = ['primary', 'accent', 'success', 'tertiary', 'warning', 'neutral'];

const WHOLE_RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const COMPACT_RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * A Chart.js chart drawn in the app's theme colours. Redraws when its inputs change or the theme
 * switches between light and dark.
 *   <app-chart type="bar" [labels]="months" [series]="[{ label: 'Billed', data: billed }]" money />
 * A doughnut uses the first series' data with one colour per label.
 */
@Component({
  selector: 'app-chart',
  template: `<div class="frame" [style.height.px]="height()">
    <canvas #canvas role="img" [attr.aria-label]="ariaLabel()"></canvas>
  </div>`,
  styles: `
    :host {
      display: block;
    }
    .frame {
      position: relative;
    }
  `,
})
export class ChartView {
  readonly type = input<'bar' | 'line' | 'doughnut'>('bar');
  readonly labels = input.required<string[]>();
  readonly series = input.required<ChartSeries[]>();
  /** Values are rupees: axis and tooltips formatted as ₹. */
  readonly money = input(false, { transform: booleanAttribute });
  /** Bars stacked on top of each other (bar charts only). */
  readonly stacked = input(false, { transform: booleanAttribute });
  readonly height = input(240, { transform: numberAttribute });
  /** What the chart shows, for screen readers. */
  readonly ariaLabel = input('Chart');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly document = inject(DOCUMENT);
  private readonly theme = inject(ThemeStore);
  /** Bumped when the OS switches light/dark, for the "system" theme. */
  private readonly osScheme = signal(0);
  private chart: Chart | null = null;

  constructor() {
    const media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    const onSchemeChange = () => this.osScheme.update((n) => n + 1);
    media?.addEventListener('change', onSchemeChange);
    inject(DestroyRef).onDestroy(() => media?.removeEventListener('change', onSchemeChange));

    afterRenderEffect((onCleanup) => {
      this.theme.mode();
      this.osScheme();
      const config = this.config();
      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, config);
      onCleanup(() => {
        this.chart?.destroy();
        this.chart = null;
      });
    });
  }

  private config(): ChartConfiguration {
    const type = this.type();
    const series = this.series();
    const money = this.money();
    const text = this.resolve('var(--mat-sys-on-surface-variant)');
    const grid = this.resolve('var(--app-card-border)');
    const format = (value: number) => (money ? WHOLE_RUPEES.format(value) : value.toLocaleString('en-IN'));

    if (type === 'doughnut') {
      const values = series[0]?.data ?? [];
      return {
        type,
        data: {
          labels: this.labels(),
          datasets: [
            {
              label: series[0]?.label ?? '',
              data: values,
              backgroundColor: values.map((_, i) => this.resolve(TOKENS[CYCLE[i % CYCLE.length]])),
              borderWidth: 0,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right', labels: { color: text, boxWidth: 12 } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${format(Number(ctx.raw))}` } },
          },
        },
      };
    }

    const stacked = this.stacked() && type === 'bar';
    return {
      type,
      data: {
        labels: this.labels(),
        datasets: series.map((s, i) => {
          const color = this.resolve(TOKENS[s.color ?? CYCLE[i % CYCLE.length]]);
          return {
            label: s.label,
            data: s.data,
            backgroundColor: color,
            borderColor: color,
            borderRadius: type === 'bar' ? 4 : 0,
            tension: 0.3,
            pointRadius: type === 'line' ? 2 : 0,
          };
        }),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked, ticks: { color: text }, grid: { display: false } },
          y: {
            stacked,
            beginAtZero: true,
            ticks: {
              color: text,
              precision: 0,
              callback: (value) => (money ? COMPACT_RUPEES.format(Number(value)) : Number(value).toLocaleString('en-IN')),
            },
            grid: { color: grid },
          },
        },
        plugins: {
          legend: { display: series.length > 1, labels: { color: text, boxWidth: 12 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${format(Number(ctx.raw))}` } },
        },
      },
    };
  }

  /** A CSS colour (tokens included, light-dark() resolved) as the browser computes it right now. */
  private resolve(css: string): string {
    const probe = this.document.createElement('span');
    probe.style.color = css;
    probe.style.display = 'none';
    this.canvas().nativeElement.parentElement!.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }
}
