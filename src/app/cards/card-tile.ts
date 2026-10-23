import { Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';
import { ScryfallCard, cardDisplayName, cardFaces } from '../scryfall/scryfall.models';
import { CardHover } from '../shared/card-hover/card-hover';
import { CardHoverOverlay } from '../shared/card-hover/card-hover-overlay.service';

@Component({
  selector: 'app-card-tile',
  imports: [TranslatePipe, CardHover],
  template: `
    <button type="button" [attr.aria-label]="name()" (click)="select()">
      <app-card-hover [name]="name()" [previewImage]="largeImage()">
        @if (image(); as src) {
          <img [src]="src" [alt]="name()" loading="lazy" width="488" height="680" />
        } @else {
          <span class="card-placeholder">
            {{ name() }}
            <small>{{ 'card.noImage' | t }}</small>
          </span>
        }
      </app-card-hover>
    </button>
  `,
  styles: `
    :host {
      display: block;
      filter: var(--shadow-stack);
    }
    button {
      display: block;
      width: 100%;
      height: auto;
      padding: 0;
      border: none;
      border-radius: var(--radius-card);
      white-space: normal;
      pointer-events: none;
    }
    button:focus-visible {
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
  `,
})
export class CardTile {
  private readonly hoverOverlay = inject(CardHoverOverlay);

  readonly card = input.required<ScryfallCard>();
  readonly selected = output<ScryfallCard>();

  protected readonly name = computed(() => cardDisplayName(this.card()));
  protected readonly image = computed(() => cardFaces(this.card())[0]?.image?.normal);
  protected readonly largeImage = computed(() => cardFaces(this.card())[0]?.image?.large);

  protected select(): void {
    this.hoverOverlay.hide();
    this.selected.emit(this.card());
  }
}
