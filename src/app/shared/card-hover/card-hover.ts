import { Component, DestroyRef, ElementRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CardHoverOverlay } from './card-hover-overlay.service';

// Hover effect for card images. `hitHeight` limits the reactive area, e.g. to the visible strip of a stacked card.
// With `splitHalves` the lower half is an action area: the glow is only fully bright there,
// and the large preview only opens while the pointer is over the upper half.

export type CardHalf = 'upper' | 'lower';
@Component({
  selector: 'app-card-hover',
  host: {
    '[class.hovered]': 'hovered()',
    '[class.disabled]': 'disabled()',
    '[class.split]': 'splitHalves()',
    '[class.lower]': "half() === 'lower'",
    '[class.marked]': 'marked()',
    '[class.selected]': 'selected()',
  },
  template: `
    <ng-content />
    <span
      class="hit-area"
      aria-hidden="true"
      [style.height]="hitHeight()"
      (mouseenter)="enter($event)"
      (mousemove)="move($event)"
      (mouseleave)="leave()"
    ></span>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      border-radius: inherit;
      // Own stacking context: the glow stays behind cards that lie in front of this one.
      isolation: isolate;
    }

    :host::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      border-radius: inherit;
      pointer-events: none;
      transition:
        opacity var(--transition-fast),
        inset var(--transition-fast);
    }

    // The hit area moves against the hop, so the pointer never slips off the card mid-animation.
    :host(.hovered:not(.disabled)) {
      animation: card-hop var(--highlight-pop-duration) ease-out;

      .hit-area {
        animation: card-hop-steady var(--highlight-pop-duration) ease-out;
      }
    }

    :host(.hovered:not(.disabled))::after,
    :host-context(:focus-visible)::after {
      inset: calc(-1 * var(--highlight-offset));
      background: var(--color-highlight);
      filter: url('#hover-water');
      animation: highlight-pop var(--highlight-pop-duration) ease-out;

      @media (prefers-reduced-motion: reduce) {
        filter: url('#hover-water-still');
      }
    }

    // Marked cards (e.g. not legal in the deck's format) keep a red glow while not hovered.
    :host(.marked:not(.hovered))::after {
      inset: calc(-1 * var(--highlight-offset));
      background: var(--color-illegal-glow);
      filter: url('#hover-water-still');
    }

    // Selected cards (e.g. the chosen commander in the deck wizard) glow gold, also while hovered.
    :host(.selected:not(.hovered))::after {
      inset: calc(-1 * var(--highlight-offset));
      background: var(--color-selected-glow);
      filter: url('#hover-water');
      animation: highlight-pop var(--highlight-pop-duration) ease-out;

      @media (prefers-reduced-motion: reduce) {
        filter: url('#hover-water-still');
      }
    }

    :host(.selected.hovered:not(.disabled))::after {
      background: var(--color-selected-glow);
    }

    // Upper half in split mode: small, faint glow; the full glow pops in once the pointer reaches the lower half.
    :host(.split.hovered:not(.lower))::after {
      inset: calc(-1 * var(--highlight-offset-dim));
      opacity: var(--glow-dim-opacity);
      animation: none;
    }

    .hit-area {
      position: absolute;
      inset: 0 0 auto;
      z-index: 1;
      pointer-events: auto;
      cursor: pointer;
    }

    :host(.disabled) .hit-area {
      cursor: default;
    }

    @keyframes highlight-pop {
      0% {
        inset: 0;
      }
      50% {
        inset: calc(-1 * var(--highlight-overshoot));
      }
      100% {
        inset: calc(-1 * var(--highlight-offset));
      }
    }

    @keyframes card-hop {
      50% {
        transform: translateY(calc(-1 * var(--card-hop-distance)));
      }
    }

    @keyframes card-hop-steady {
      50% {
        transform: translateY(var(--card-hop-distance));
      }
    }
  `,
})
export class CardHover {
  readonly name = input('');
  readonly previewImage = input<string>();
  readonly hitHeight = input('100%');
  readonly disabled = input(false);
  readonly splitHalves = input(false);
  readonly marked = input(false);
  readonly selected = input(false);
  // Shown in red with the large preview, e.g. why the card is not legal.
  readonly warning = input<string>();
  readonly halfChange = output<CardHalf | undefined>();

  protected readonly overlay = inject(CardHoverOverlay);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly hovered = signal(false);
  protected readonly half = signal<CardHalf | undefined>(undefined);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hovered() && this.overlay.hide());

    // Becoming selected replays the hover hop and embers; a card that starts out selected stays calm.
    let initial = true;
    effect(() => {
      const selected = this.selected();
      if (selected && !initial) {
        untracked(() => this.celebrate());
      }
      initial = false;
    });
  }

  private celebrate(): void {
    const host = this.host.nativeElement;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const styles = getComputedStyle(host);
    const distance = parseFloat(styles.getPropertyValue('--card-hop-distance')) || 3;
    const duration = parseFloat(styles.getPropertyValue('--highlight-pop-duration')) || 200;
    host.animate(
      [{ transform: 'none' }, { transform: `translateY(${-distance}px)`, offset: 0.5 }, { transform: 'none' }],
      { duration, easing: 'ease-out' },
    );
    this.overlay.spawnEmbers((host.querySelector('.hit-area') ?? host).getBoundingClientRect());
  }

  protected enter(event: MouseEvent): void {
    if (this.disabled()) {
      return;
    }
    this.hovered.set(true);
    this.setHalf(event);
    this.overlay.enter(this.host.nativeElement, event.target as HTMLElement, event, this.previewFor(this.half()), this.name(), this.warning());
  }

  protected move(event: MouseEvent): void {
    this.overlay.trackPointer(event);
    if (this.hovered()) {
      this.setHalf(event);
    }
  }

  protected leave(): void {
    this.hovered.set(false);
    this.overlay.hide();
    this.updateHalf(undefined);
  }

  private setHalf(event: MouseEvent): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.updateHalf(event.clientY > rect.top + rect.height / 2 ? 'lower' : 'upper');
  }

  private updateHalf(half: CardHalf | undefined): void {
    if (half === this.half()) {
      return;
    }
    const wasHovered = this.half() !== undefined;
    this.half.set(half);
    this.halfChange.emit(half);
    if (this.splitHalves() && wasHovered && half) {
      this.overlay.schedulePreview(this.host.nativeElement, this.previewFor(half), this.name(), this.warning());
    }
  }

  private previewFor(half: CardHalf | undefined): string | undefined {
    return this.splitHalves() && half === 'lower' ? undefined : this.previewImage();
  }
}
