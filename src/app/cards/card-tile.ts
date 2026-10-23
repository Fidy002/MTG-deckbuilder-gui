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
        <span class="placeholder">
          <strong>{{ name() }}</strong>
          <small>{{ 'card.noImage' | t }}</small>
        </span>
      }
    </button>
  `,
  styles: `
    button {
      display: block;
      width: 100%;
      padding: 0;
      border: none;
      background: none;
      cursor: pointer;
      border-radius: 4.75% / 3.5%;
      overflow: hidden;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    button:hover,
    button:focus-visible {
      transform: translateY(-3px) scale(1.02);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
    }
    img {
      display: block;
      width: 100%;
      height: auto;
      aspect-ratio: 488 / 680;
      background: var(--surface-2);
    }
    .placeholder {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.5rem;
      aspect-ratio: 488 / 680;
      padding: 1rem;
      background: var(--surface-2);
      color: var(--text);
    }
  `,
})
export class CardTile {
  readonly card = input.required<ScryfallCard>();
  readonly selected = output<ScryfallCard>();

  protected readonly name = computed(() => cardDisplayName(this.card()));
  protected readonly image = computed(() => cardFaces(this.card())[0]?.image?.normal);
}
