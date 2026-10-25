import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18nService, TranslationKey } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { COLOR_ORDER, ScryfallCard, cardDisplayName, cardFaces, deckCardName, manaSymbolUrl } from '../scryfall/scryfall.models';
import { SettingsService } from '../settings/settings.service';
import { CardSearch } from '../cards/card-search';
import { DeckOverview } from './deck-overview';
import { CardHover } from '../shared/card-hover/card-hover';
import { BRACKETS, Bracket } from './deck-brackets';
import { DeckCardsService, cardKey } from './deck-cards.service';
import { CONSTRUCTED_FORMATS, canBeCommander } from './deck-legality';
import {
  COMMANDER_LANDS,
  CONSTRUCTED_LANDS,
  DeckSuggestions,
  SuggestionGroup,
  SuggestionRole,
  basicLands,
  deckCreatureTypes,
  preferredSets,
} from './deck-suggestions';
import { DeckService } from './deck.service';
import { DeckEntry, DeckFormat, parseDecklist, serializeDecklist } from './decklist';
import { ScryfallService } from '../scryfall/scryfall.service';

type Step = 'format' | 'level' | 'cards' | 'colors' | 'commander' | 'suggestions';

const COMMANDER_STEPS: readonly Step[] = ['format', 'level', 'cards', 'commander', 'suggestions'];
const CONSTRUCTED_STEPS: readonly Step[] = ['format', 'level', 'cards', 'colors', 'suggestions'];

const COMMANDER_SIZE = 100;
const CONSTRUCTED_SIZE = 60;
const CONSTRUCTED_COPIES = 4;
const COMMANDER_OPTIONS = 18;

interface OwnedCard {
  entry: DeckEntry;
  card?: ScryfallCard;
}

@Component({
  selector: 'app-deck-wizard',
  imports: [NgTemplateOutlet, TranslatePipe, RouterLink, CardHover, CardSearch, DeckOverview],
  templateUrl: './deck-wizard.html',
  styleUrl: './deck-wizard.scss',
})
export class DeckWizard {
  private readonly deckService = inject(DeckService);
  private readonly deckCards = inject(DeckCardsService);
  private readonly suggestionsService = inject(DeckSuggestions);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly scryfall = inject(ScryfallService);

  protected readonly manaSymbolUrl = manaSymbolUrl;
  protected readonly brackets = BRACKETS;
  protected readonly constructedFormats = CONSTRUCTED_FORMATS;
  protected readonly colorOrder = COLOR_ORDER;

  protected readonly format = signal<DeckFormat>('commander');
  protected readonly bracket = signal<Bracket>(2);
  protected readonly legalityFormat = signal(CONSTRUCTED_FORMATS[0].id);
  protected readonly ownedText = signal('');
  protected readonly owned = signal<OwnedCard[]>([]);
  protected readonly colors = signal<string[]>([]);
  private readonly ownedColors = signal<string[]>([]);
  protected readonly commanderOptions = signal<ScryfallCard[]>([]);
  protected readonly commander = signal<ScryfallCard | undefined>(undefined);
  protected readonly groups = signal<SuggestionGroup[]>([]);
  protected readonly deselected = signal(new Set<string>());
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);

  protected readonly step = signal<Step>('format');
  protected readonly steps = computed(() => (this.format() === 'commander' ? COMMANDER_STEPS : CONSTRUCTED_STEPS));
  protected readonly stepIndex = computed(() => this.steps().indexOf(this.step()));

  protected readonly preferredSets = computed(() =>
    preferredSets(
      this.owned().map((o) => ({ set: o.entry.set ?? o.card?.set, basic: !!o.card?.type_line?.startsWith('Basic') })),
    ),
  );

  protected readonly notFound = computed(() => this.owned().filter((o) => !o.card).map((o) => o.entry.name));
  protected readonly ownedCount = computed(() => this.owned().reduce((sum, o) => sum + o.entry.count, 0));

  // Legendary creatures among the own cards come first; Scryfall's most played commanders follow.
  protected readonly ownedCommanders = computed(() =>
    this.owned().flatMap((o) => (o.card && canBeCommander(o.card, false) ? [o.card] : [])),
  );

  protected readonly selectedCount = computed(
    () => this.groups().reduce((sum, g) => sum + g.cards.filter((c) => !this.deselected().has(c.name)).length, 0),
  );

  protected stepLabel(step: Step): TranslationKey {
    return step === 'level' ? (this.format() === 'commander' ? 'wizard.stepBracket' : 'wizard.stepFormatLegality') : `wizard.step.${step}`;
  }

  protected roleLabel(role: SuggestionRole): TranslationKey {
    return `wizard.role.${role}`;
  }

  protected bracketLevelKey(bracket: Bracket): TranslationKey {
    return `bracket.level${bracket}`;
  }

  protected image(card: ScryfallCard): string | undefined {
    return cardFaces(card)[0]?.image?.normal;
  }

  protected largeImage(card: ScryfallCard): string | undefined {
    return cardFaces(card)[0]?.image?.large;
  }

  protected name(card: ScryfallCard): string {
    return cardDisplayName(card);
  }

  protected chooseFormat(format: DeckFormat): void {
    this.format.set(format);
    this.step.set('level');
  }

  protected back(): void {
    const index = this.stepIndex();
    if (index > 0) {
      this.step.set(this.steps()[index - 1]);
    }
  }

  protected toggleColor(color: string): void {
    this.colors.update((colors) =>
      colors.includes(color) ? colors.filter((c) => c !== color) : COLOR_ORDER.filter((c) => c === color || colors.includes(c)),
    );
  }

  protected isSelected(card: ScryfallCard): boolean {
    return !this.deselected().has(card.name);
  }

  protected toggleSuggestion(card: ScryfallCard): void {
    this.deselected.update((names) => {
      const next = new Set(names);
      if (next.has(card.name)) {
        next.delete(card.name);
      } else {
        next.add(card.name);
      }
      return next;
    });
  }

  protected readonly lastAdded = signal<string | undefined>(undefined);
  protected readonly ownedView = signal<'overview' | 'text'>('overview');
  protected readonly ownedEntries = computed(() => parseDecklist(this.ownedText()));
  protected readonly cardLanguage = this.settings.cardLanguage;
  protected readonly deckSort = this.settings.deckSort;

  // Cards picked in the search end up in the text list, so both ways can be mixed and edited.
  protected addOwned(card: ScryfallCard): void {
    const entry = { name: deckCardName(card), set: card.set, collectorNumber: card.collector_number };
    this.deckCards.remember(entry, this.settings.cardLanguage(), card);
    const entries = parseDecklist(this.ownedText());
    const existing = entries.find((e) => e.name.toLowerCase() === entry.name.toLowerCase() && e.section === 'main');
    if (existing) {
      existing.count++;
    } else {
      entries.push({ ...entry, count: 1, section: 'main' });
    }
    this.ownedText.set(serializeDecklist(entries));
    this.lastAdded.set(cardDisplayName(card));
  }

  protected onOwnedInput(event: Event): void {
    this.ownedText.set((event.target as HTMLTextAreaElement).value);
  }

  // Reads the own cards, then moves on: commander decks to the commander choice, 60 card decks to the colors.
  protected async submitCards(): Promise<void> {
    await this.run(async () => {
      const entries = parseDecklist(this.ownedText()).filter((e) => e.section !== 'maybeboard' && e.section !== 'sideboard');
      const resolved = entries.length
        ? await firstValueFrom(this.deckCards.resolve(entries, this.settings.cardLanguage()))
        : new Map<string, never>();
      const owned = entries.map((entry): OwnedCard => {
        return { entry, card: resolved.get(cardKey(entry))?.card };
      });
      this.owned.set(owned);
      const identity = new Set(owned.flatMap((o) => o.card?.color_identity ?? []));
      this.ownedColors.set(COLOR_ORDER.filter((c) => identity.has(c)));
      this.colors.set(this.ownedColors());

      if (this.format() === 'commander') {
        const marked = owned.find((o) => o.entry.section === 'commander' && o.card)?.card;
        this.commander.set(marked);
        const commanders = await firstValueFrom(this.suggestionsService.commanders(this.colors(), this.bracket()));
        this.commanderOptions.set(await this.localize(commanders.slice(0, COMMANDER_OPTIONS)));
        this.step.set('commander');
      } else {
        this.step.set('colors');
      }
    });
  }

  // Clicking selects (or deselects) the commander; the suggestions only load on "next".
  protected selectCommander(card: ScryfallCard): void {
    this.commander.set(this.commander()?.name === card.name ? undefined : card);
  }

  protected async continueWithCommander(card: ScryfallCard | undefined): Promise<void> {
    this.commander.set(card);
    this.colors.set(card ? COLOR_ORDER.filter((c) => card.color_identity?.includes(c)) : this.ownedColors());
    await this.loadSuggestions();
  }

  protected async loadSuggestions(): Promise<void> {
    await this.run(async () => {
      const ownedCards = this.owned().flatMap((o) => (o.card ? [o.card] : []));
      const commander = this.commander();
      const catalog = await firstValueFrom(this.scryfall.creatureTypes$).catch(() => [] as string[]);
      const groups = await firstValueFrom(
        this.suggestionsService.cards(
          {
            format: this.format() === 'commander' ? 'commander' : this.legalityFormat(),
            colors: this.colors(),
            bracket: this.format() === 'commander' ? this.bracket() : undefined,
            exclude: [...ownedCards.map((c) => c.name), ...(commander ? [commander.name] : [])],
            creatureTypes: deckCreatureTypes(commander, ownedCards, catalog),
            preferredSets: this.preferredSets(),
            ownedNonLands: this.owned()
              .filter((o) => !o.card?.type_line?.includes('Land') && (!commander || o.card?.name !== commander.name))
              .reduce((sum, o) => sum + o.entry.count, commander ? 1 : 0),
          },
          ownedCards.filter((c) => c.game_changer).length,
        ),
      );
      const localized = await this.localize(groups.flatMap((g) => g.cards));
      let index = 0;
      this.groups.set(groups.map((g) => ({ ...g, cards: g.cards.map(() => localized[index++]) })));
      this.deselected.set(new Set());
      this.step.set('suggestions');
    });
  }

  protected create(): void {
    const commanderDeck = this.format() === 'commander';
    const commander = commanderDeck ? this.commander() : undefined;
    const entries: DeckEntry[] = [];
    if (commander) {
      entries.push({ count: 1, name: deckCardName(commander), section: 'commander' });
    }
    for (const { entry } of this.owned()) {
      if (commander && entry.name.toLowerCase() === deckCardName(commander).toLowerCase()) {
        continue;
      }
      entries.push({ ...entry, section: 'main' });
    }
    for (const group of this.groups()) {
      for (const card of group.cards.filter((c) => this.isSelected(c))) {
        const copies = commanderDeck || group.role === 'lands' ? 1 : CONSTRUCTED_COPIES;
        entries.push({ count: copies, ...this.printing(card), section: 'main' });
      }
    }

    const size = commanderDeck ? COMMANDER_SIZE : CONSTRUCTED_SIZE;
    const targetLands = commanderDeck ? COMMANDER_LANDS : CONSTRUCTED_LANDS;
    const total = entries.reduce((sum, e) => sum + e.count, 0);
    const lands = this.landCount(entries);
    entries.push(...basicLands(this.colors(), Math.max(0, Math.min(size - total, targetLands - lands))));

    const name = commander ? cardDisplayName(commander) : this.i18n.translate('decks.defaultName');
    const deck = this.deckService.create(name, serializeDecklist(entries), this.format());
    if (commanderDeck) {
      this.deckService.setBracket(deck.id, this.bracket());
    } else {
      this.deckService.setLegalityFormat(deck.id, this.legalityFormat());
    }
    this.router.navigate(['/decks', deck.id]);
  }

  protected createEmpty(): void {
    const deck = this.deckService.create(this.i18n.translate('decks.defaultName'), '', this.format());
    this.router.navigate(['/decks', deck.id]);
  }

  private landCount(entries: readonly DeckEntry[]): number {
    const lands = new Set([
      ...this.owned().flatMap((o) => (o.card?.type_line?.includes('Land') ? [o.card.name.toLowerCase()] : [])),
      ...this.groups()
        .filter((g) => g.role === 'lands')
        .flatMap((g) => g.cards.map((c) => c.name.toLowerCase())),
    ]);
    return entries.filter((e) => lands.has(e.name.toLowerCase())).reduce((sum, e) => sum + e.count, 0);
  }

  // Suggestions are ranked on the English cards; this swaps in the printings in the card language where they exist.
  // Cards from the own sets keep that printing; for all others any printing (in the card language) will do.
  private printing(card: ScryfallCard): Pick<DeckEntry, 'name' | 'set' | 'collectorNumber'> {
    return this.preferredSets().includes(card.set)
      ? { name: deckCardName(card), set: card.set, collectorNumber: card.collector_number }
      : { name: deckCardName(card) };
  }

  private async localize(cards: readonly ScryfallCard[]): Promise<ScryfallCard[]> {
    const entries = cards.map((card): DeckEntry => ({ count: 1, ...this.printing(card), section: 'main' }));
    if (!entries.length) {
      return [];
    }
    const resolved = await firstValueFrom(this.deckCards.resolve(entries, this.settings.cardLanguage()));
    return cards.map((card, i) => resolved.get(cardKey(entries[i]))?.card ?? card);
  }

  private async run(task: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failed.set(false);
    try {
      await task();
    } catch {
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
