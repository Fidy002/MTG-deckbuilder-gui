import { Component, computed, input } from '@angular/core';
import { manaSymbolUrl } from '../scryfall/scryfall.models';

type Part = { text: string } | { symbol: string; label: string };

// Renders Scryfall text like "{2}{W}: Draw a card." with the official mana symbol images.
@Component({
  selector: 'app-mana-text',
  template: `@for (part of parts(); track $index) {@if ('symbol' in part) {<img
        class="symbol"
        [src]="url(part.symbol)"
        [alt]="part.label"
        [title]="part.label"
      />} @else {<span>{{ part.text }}</span>}}`,
  styles: `
    .symbol {
      display: inline-block;
      width: var(--inline-symbol-size);
      height: var(--inline-symbol-size);
      margin: 0 1px;
      vertical-align: -0.15em;
    }
  `,
})
export class ManaText {
  readonly text = input.required<string>();

  protected readonly parts = computed((): Part[] =>
    this.text()
      .split(/(\{[^}]+\})/)
      .filter(Boolean)
      .map((chunk) =>
        chunk.startsWith('{') && chunk.endsWith('}')
          ? { symbol: chunk.slice(1, -1).replace(/\//g, ''), label: chunk }
          : { text: chunk },
      ),
  );

  protected url(symbol: string): string {
    return manaSymbolUrl(symbol);
  }
}
