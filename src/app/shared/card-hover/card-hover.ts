import { Component, DestroyRef, ElementRef, inject, input, output, signal } from '@angular/core';
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
  readonly halfChange = output<CardHalf | undefined>();

  protected readonly overlay = inject(CardHoverOverlay);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly hovered = signal(false);
  protected readonly half = signal<CardHalf | undefined>(undefined);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hovered() && this.overlay.hide());
  }

  protected enter(event: MouseEvent): void {
    if (this.disabled()) {
      return;
    }
    this.hovered.set(true);
    this.setHalf(event);
    this.overlay.enter(this.host.nativeElement, event.target as HTMLElement, event, this.previewFor(this.half()), this.name());
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
      this.overlay.schedulePreview(this.host.nativeElement, this.previewFor(half), this.name());
    }
  }

  private previewFor(half: CardHalf | undefined): string | undefined {
    return this.splitHalves() && half === 'lower' ? undefined : this.previewImage();
  }
}
