import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';
import { ScryfallCard, cardDisplayName, cardFaces } from '../scryfall/scryfall.models';
import { Badge, CardBadges } from '../shared/card-badges/card-badges';
import { CardHalf, CardHover } from '../shared/card-hover/card-hover';
import { CardHoverOverlay } from '../shared/card-hover/card-hover-overlay.service';

@Component({
  selector: 'app-card-tile',
  imports: [TranslatePipe, CardBadges, CardHover],
  template: `
    <button
      type="button"
      class="tile"
      [attr.aria-label]="name()"
      (click)="activate($event)"
    >
      <app-card-hover
        [name]="name()"
        [previewImage]="largeImage()"
        [splitHalves]="addable()"
        (halfChange)="half.set($event)"
      >
        @if (image(); as src) {
          <img [src]="src" [alt]="name()" loading="lazy" width="488" height="680" />
        } @else {
          <span class="card-placeholder">
            {{ name() }}
            <small>{{ 'card.noImage' | t }}</small>
          </span>
        }
        @if (badges()?.length) {
          <app-card-badges [badges]="badges()!" />
        }
        @if (addable()) {
          <span class="add-zone" [class.active]="half() === 'lower'" aria-hidden="true">
            <span class="add-label">{{ 'card.addCard' | t }}</span>
            <svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
          </span>
        }
      </app-card-hover>
    </button>
    @if (addable()) {
      <button type="button" class="visually-hidden" (click)="addToDeck()">{{ 'card.addToDeck' | t }}</button>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      filter: var(--shadow-stack);
    }
    .tile {
      display: block;
      width: 100%;
      height: auto;
      padding: 0;
      border: none;
      border-radius: var(--radius-card);
      white-space: normal;
      pointer-events: none;
    }
    .tile:focus-visible {
      outline: none;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      aspect-ratio: var(--card-ratio);
      border-radius: inherit;
      background: var(--color-surface-sunken);
    }
    .card-placeholder {
      border-radius: inherit;
    }

    // Lower half of the card: white gradient from the bottom edge up to the middle of the card.
    // The vertical corner radius is doubled because this element is only half as tall as the card.
    .add-zone {
      position: absolute;
      inset: auto 0 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      gap: var(--space-1);
      height: 50%;
      padding-bottom: var(--space-3);
      border-radius: 0 0 4.5% 4.5% / 0 0 6.5% 6.5%;
      background: linear-gradient(to top, var(--color-highlight), transparent);
      color: var(--color-bg);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--transition-fast);

      .icon {
        width: 22px;
        height: 22px;
        stroke-width: 2.4;
      }

      &.active {
        opacity: 1;
      }
    }
    .add-label {
      font-size: var(--text-sm);
      font-weight: 600;
      opacity: 0;
      transform: translateY(6px) scale(0.9);
      transition:
        opacity var(--transition-fast),
        transform var(--transition-fast);
    }
    .add-zone.active .add-label {
      opacity: 1;
      transform: none;
    }
    :host(:hover) .add-zone:not(.active) {
      opacity: var(--add-zone-dim-opacity);
    }
  `,
})
export class CardTile {
  private readonly hoverOverlay = inject(CardHoverOverlay);

  readonly card = input.required<ScryfallCard>();
  readonly addable = input(false);
  // Toggle mode: a click on the whole card picks it.
  readonly toggle = input(false);
  // Why a suggested card fits the deck.
  readonly badges = input<readonly Badge[]>();
  readonly selected = output<ScryfallCard>();
  readonly add = output<ScryfallCard>();

  protected readonly half = signal<CardHalf | undefined>(undefined);
  protected readonly name = computed(() => cardDisplayName(this.card()));
  protected readonly image = computed(() => cardFaces(this.card())[0]?.image?.normal);
  protected readonly largeImage = computed(() => cardFaces(this.card())[0]?.image?.large);

  // Decided by the click position itself, so it never depends on a hover state that might lag behind.
  protected activate(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const onLowerHalf = event.detail > 0 && event.clientY > rect.top + rect.height / 2;
    if (this.toggle()) {
      this.hoverOverlay.hide();
      this.addToDeck();
    } else if (this.addable() && onLowerHalf) {
      this.addToDeck();
    } else {
      this.hoverOverlay.hide();
      this.selected.emit(this.card());
    }
  }

  protected addToDeck(): void {
    this.add.emit(this.card());
  }
}
