import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { Deck, DeckService } from '../decks/deck.service';
import { I18nService, TranslationKey } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { SettingsService } from '../settings/settings.service';
import { CardPricesService, cardmarketProductUrl, cardmarketSearchUrl, printKey } from '../scryfall/card-prices.service';
import { cardLanguageName } from '../scryfall/card-languages';
import {
  ScryfallCard,
  cardDisplayName,
  cardFaces,
  deckCardName,
  hasMultipleImages,
} from '../scryfall/scryfall.models';
import { ScryfallService } from '../scryfall/scryfall.service';
import { ManaText } from './mana-text';

@Component({
  selector: 'app-card-preview',
  imports: [TranslatePipe, ManaText],
  host: { '(document:keydown.escape)': 'closed.emit()' },
  templateUrl: './card-preview.html',
  styleUrl: './card-preview.scss',
})
export class CardPreview {
  private readonly scryfall = inject(ScryfallService);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);
  private readonly deckService = inject(DeckService);
  private readonly priceService = inject(CardPricesService);

  readonly card = input.required<ScryfallCard>();
  readonly language = input<string>();
  readonly closed = output<void>();

  private readonly request = computed(() => ({
    card: this.card(),
    language: this.language() ?? this.settings.cardLanguage(),
  }));

  private readonly localized = toSignal(
    toObservable(this.request).pipe(
      switchMap(({ card, language }) =>
        this.scryfall
          .getPrintingInLanguage(card, language)
          .pipe(map((printing) => ({ language, printing: printing ?? card, missing: !printing }))),
      ),
    ),
  );

  protected readonly shown = computed(() => this.localized()?.printing ?? this.card());
  protected readonly faces = computed(() => cardFaces(this.shown()));
  protected readonly name = computed(() => cardDisplayName(this.shown()));
  protected readonly canFlip = computed(() => hasMultipleImages(this.shown()));
  protected readonly rarityKey = computed((): TranslationKey => `rarity.${this.shown().rarity}`);

  protected readonly faceIndex = linkedSignal({ source: this.card, computation: () => 0 });
  protected readonly image = computed(
    () => this.faces()[this.canFlip() ? this.faceIndex() : 0]?.image?.large,
  );

  protected readonly missingLanguage = computed(() => {
    const state = this.localized();
    return state?.missing ? cardLanguageName(state.language, this.i18n.language()) : undefined;
  });

  protected readonly price = toSignal(
    toObservable(this.shown).pipe(
      switchMap((card) =>
        this.priceService.prices([card]).pipe(
          map((prices) => ({ card, price: prices.get(printKey(card)) })),
          catchError(() => of({ card, price: undefined })),
        ),
      ),
    ),
  );

  // undefined while the price of the shown printing is loading.
  protected readonly priceInfo = computed(() => {
    const state = this.price();
    if (state?.card !== this.shown()) {
      return undefined;
    }
    const format = (value?: number) => (value === undefined ? undefined : formatEuro(value, this.i18n.language()));
    return {
      eur: format(state.price?.eur),
      eurFoil: format(state.price?.eurFoil),
      url: state.price?.cardmarketUrl ? cardmarketProductUrl(state.price.cardmarketUrl) : cardmarketSearchUrl(this.card().name),
    };
  });

  protected readonly decks = this.deckService.decks;

  protected readonly targetDeckId = linkedSignal<Deck[], string | undefined>({
    source: this.decks,
    computation: (decks, previous) =>
      previous && decks.some((d) => d.id === previous.value) ? previous.value : decks[0]?.id,
  });

  protected readonly addedTo = linkedSignal<ScryfallCard, string | undefined>({
    source: this.card,
    computation: () => undefined,
  });

  protected flip(): void {
    this.faceIndex.update((i) => (i + 1) % this.faces().length);
  }

  protected addToDeck(): void {
    const deck =
      this.deckService.get(this.targetDeckId() ?? '') ??
      this.deckService.create(this.i18n.translate('decks.defaultName'), '', 'commander');
    const card = this.shown();
    this.deckService.addCard(deck.id, {
      name: deckCardName(card),
      set: card.set,
      collectorNumber: card.collector_number,
    });
    this.targetDeckId.set(deck.id);
    this.addedTo.set(deck.name.trim() || this.i18n.translate('decks.untitled'));
  }

  protected selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
}

export function formatEuro(value: number, language: string): string {
  return new Intl.NumberFormat(language, { style: 'currency', currency: 'EUR' }).format(value);
}
