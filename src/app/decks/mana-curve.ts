import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';
import { CURVE_LABELS } from './deck-curve';

// Bar chart of a mana curve. `counts` are the cards per mana value bucket; `target` (shares that add up to 1) marks
// what the play style expects, scaled to `targetTotal` cards. Without counts only the target is drawn (mini preview).
@Component({
  selector: 'app-mana-curve',
  imports: [TranslatePipe],
  host: { '[class.mini]': 'mini()' },
  template: `
    <div class="bars" role="img" [attr.aria-label]="'curve.label' | t">
      @for (bar of bars(); track $index) {
        <div class="bar" [title]="bar.title">
          @if (!mini() && numbers()) {
            <span class="count">{{ bar.count }}</span>
          }
          <div class="track">
            <div class="fill" [class.target-only]="bar.targetOnly" [style.height.%]="bar.height"></div>
            @if (bar.marker !== undefined) {
              <div class="marker" [style.bottom.%]="bar.marker"></div>
            }
          </div>
          @if (!mini()) {
            <span class="label">{{ bar.label }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .bars {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      height: 72px;
    }
    :host(.mini) .bars {
      gap: 2px;
      height: 28px;
    }
    .bar {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      height: 100%;
      min-width: 0;
    }
    .track {
      position: relative;
      flex: 1;
      width: 100%;
    }
    .fill {
      position: absolute;
      inset: auto 0 0;
      min-height: 1px;
      border-radius: 2px 2px 0 0;
      background: var(--color-accent);
    }
    .fill.target-only {
      background: var(--color-text-muted);
      opacity: 0.6;
    }
    .marker {
      position: absolute;
      right: -2px;
      left: -2px;
      height: 2px;
      background: var(--color-text);
      opacity: 0.7;
    }
    .count,
    .label {
      font-size: 0.65rem;
      line-height: 1;
      color: var(--color-text-muted);
    }
  `,
})
export class ManaCurve {
  readonly counts = input<readonly number[]>();
  readonly target = input<readonly number[]>();
  readonly targetTotal = input(0);
  readonly mini = input(false);
  // Common top of the scale for target-only curves, so curves drawn next to each other compare.
  readonly scaleMax = input<number>();
  // The card count above each bar; without it the counts are only in the tooltips.
  readonly numbers = input(true);

  protected readonly bars = computed(() => {
    const counts = this.counts();
    const target = this.target();
    const expected = target?.map((share) => share * this.targetTotal()) ?? [];
    if (!counts) {
      const max = this.scaleMax() ?? Math.max(...(target ?? [0]), 0.0001);
      return CURVE_LABELS.map((label, i) => ({
        label,
        count: 0,
        height: ((target?.[i] ?? 0) / max) * 100,
        targetOnly: true,
        marker: undefined as number | undefined,
        title: label,
      }));
    }
    const max = Math.max(...counts, ...expected, 1);
    return CURVE_LABELS.map((label, i) => ({
      label,
      count: counts[i],
      height: (counts[i] / max) * 100,
      targetOnly: false,
      marker: target ? (expected[i] / max) * 100 : undefined,
      title: target ? `${label}: ${counts[i]} / ${Math.round(expected[i])}` : `${label}: ${counts[i]}`,
    }));
  });
}
