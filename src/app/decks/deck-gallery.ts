import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { I18nService, TranslationKey } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { cardFaces, manaSymbolUrl } from '../scryfall/scryfall.models';
import { SettingsService } from '../settings/settings.service';
import { DeckCardsService, ResolvedCard, cardKey } from './deck-cards.service';
import { DeckService, countCards, countSideboard, deckCoverEntry } from './deck.service';
import { DeckEntry, detectFormat, parseDecklist } from './decklist';
import { ImportDialog } from './import-dialog';

interface CoverRequest {
  language: string;
  entry: DeckEntry;
}

@Component({
  selector: 'app-deck-gallery',
  imports: [TranslatePipe, RouterLink, ImportDialog],
  templateUrl: './deck-gallery.html',
  styleUrl: './deck-gallery.scss',
})
export class DeckGallery {
  private readonly deckService = inject(DeckService);
  private readonly deckCards = inject(DeckCardsService);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  protected readonly manaSymbolUrl = manaSymbolUrl;
  protected readonly importing = signal(false);

  private readonly covers = computed(() =>
    this.deckService.decks().map((deck) => {
      const entry = deckCoverEntry(deck);
      return entry && { language: deck.language ?? this.settings.cardLanguage(), entry };
    }),
  );

  // Cover cards of all decks, resolved in one batch per language (cached like the cards of an opened deck).
  private readonly resolvedCovers = toSignal(
    toObservable(this.covers).pipe(
      switchMap((covers) => {
        const byLanguage = new Map<string, DeckEntry[]>();
        for (const cover of covers.filter((c): c is CoverRequest => !!c)) {
          byLanguage.set(cover.language, [...(byLanguage.get(cover.language) ?? []), cover.entry]);
        }
        if (!byLanguage.size) {
          return of(new Map<string, ResolvedCard | null>());
        }
        return forkJoin(
          [...byLanguage].map(([language, entries]) =>
            this.deckCards.resolve(entries, language).pipe(
              map((cards) => [...cards].map(([key, card]) => [`${language}|${key}`, card] as const)),
              catchError(() => of([])),
            ),
          ),
        ).pipe(map((groups) => new Map(groups.flat())));
      }),
    ),
    { initialValue: new Map<string, ResolvedCard | null>() },
  );

  protected readonly tiles = computed(() => {
    const resolved = this.resolvedCovers();
    const covers = this.covers();
    return this.deckService.decks().map((deck, index) => {
      const cover = covers[index];
      const card = cover && resolved.get(`${cover.language}|${cardKey(cover.entry)}`)?.card;
      const cardCount = countCards(deck.text);
      const format = deck.format ?? detectFormat(parseDecklist(deck.text));
      return {
        id: deck.id,
        name: deck.name,
        cardCount,
        sideboardCount: countSideboard(deck.text),
        colors: cardCount ? (deck.colors?.length ? deck.colors : deck.colors && ['C']) : undefined,
        bracket: format === 'commander' ? deck.bracket : undefined,
        formatLabel: (format === 'commander' ? 'decks.formatCommander' : 'decks.formatConstructed') as TranslationKey,
        art: card ? cardFaces(card)[0]?.image?.art_crop : undefined,
      };
    });
  });

  protected create(): void {
    const deck = this.deckService.create(this.i18n.translate('decks.defaultName'), '', 'commander');
    this.router.navigate(['/decks', deck.id]);
  }

  protected onImported(text: string): void {
    const deck = this.deckService.create(this.i18n.translate('decks.importedName'), text, detectFormat(parseDecklist(text)));
    this.importing.set(false);
    this.router.navigate(['/decks', deck.id]);
  }
}
