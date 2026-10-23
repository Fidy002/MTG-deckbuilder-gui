import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';
import { ScryfallCard, cardDisplayName, cardFaces } from '../scryfall/scryfall.models';

@Component({
  selector: 'app-card-tile',
  imports: [TranslatePipe],
  template: `
    <button type="button" (click)="selected.emit(card())" [title]="name()">
      @if (image(); as src) {
        <img [src]="src" [alt]="name()" loading="lazy" width="488" height="680" />
      } @else {
        <span class="card-placeholder">
          {{ name() }}
          <small>{{ 'card.noImage' | t }}</small>
        </span>
      }
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
      overflow: hidden;
      white-space: normal;
      transition: transform var(--transition-fast);
    }
    button:hover,
    button:focus-visible {
      transform: translateY(-2px);
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      aspect-ratio: var(--card-ratio);
      background: var(--color-surface-sunken);
    }
    .card-placeholder {
      border-radius: inherit;
    }
  `,
})
export class CardTile {
  readonly card = input.required<ScryfallCard>();
  readonly selected = output<ScryfallCard>();

  protected readonly name = computed(() => cardDisplayName(this.card()));
  protected readonly image = computed(() => cardFaces(this.card())[0]?.image?.normal);
}
