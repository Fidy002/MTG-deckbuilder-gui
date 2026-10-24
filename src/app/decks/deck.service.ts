import { Injectable, effect, signal } from '@angular/core';
import { Bracket } from './deck-brackets';
import { DeckEntry, DeckFormat, countEntries, isSameCard, parseDecklist, serializeDecklist } from './decklist';

const STORAGE_KEY = 'mtg-deckbuilder.decks';

export interface Deck {
  id: string;
  name: string;
  text: string;
  language?: string;
  format?: DeckFormat;
  legalityFormat?: string;
  // Decks saved before this existed follow the old global setting.
  legalityCheck?: boolean;
  // Name of the card whose art represents the deck in the deck gallery.
  coverCard?: string;
  bracket?: Bracket;
  colors?: string[];
  createdAt: string;
  updatedAt: string;
}

export type NewDeckCard = Pick<DeckEntry, 'name' | 'set' | 'collectorNumber'>;
export type EntryChanges = Partial<Pick<DeckEntry, 'section' | 'category'>>;

@Injectable({ providedIn: 'root' })
export class DeckService {
  private readonly state = signal<Deck[]>(readStoredDecks());

  readonly decks = this.state.asReadonly();

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state()));
      } catch {
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) {
          this.state.set(readStoredDecks());
        }
      });
    }
  }

  get(id: string): Deck | undefined {
    return this.state().find((deck) => deck.id === id);
  }

  create(name: string, text = '', format?: DeckFormat): Deck {
    const now = new Date().toISOString();
    const deck: Deck = {
      id: crypto.randomUUID(),
      name,
      text,
      ...(format && { format }),
      legalityCheck: false,
      createdAt: now,
      updatedAt: now,
    };
    this.state.update((decks) => [deck, ...decks]);
    return deck;
  }

  rename(id: string, name: string): void {
    this.patch(id, { name });
  }

  updateText(id: string, text: string): void {
    this.patch(id, { text });
  }

  setFormat(id: string, format: DeckFormat): void {
    this.patch(id, { format });
  }

  setLegalityFormat(id: string, legalityFormat: string): void {
    this.patch(id, { legalityFormat });
  }

  setLegalityCheck(id: string, legalityCheck: boolean): void {
    this.patch(id, { legalityCheck });
  }

  setCoverCard(id: string, coverCard: string | undefined): void {
    this.patch(id, { coverCard });
  }

  setBracket(id: string, bracket: Bracket | undefined): void {
    this.patch(id, { bracket });
  }

  setLanguage(id: string, language: string | undefined): void {
    this.patch(id, { language });
  }

  // Derived from the resolved cards; stored so the deck list can show colors without loading every deck.
  setColors(id: string, colors: string[]): void {
    const deck = this.get(id);
    if (!deck || deck.colors?.join('') === colors.join('')) {
      return;
    }
    this.state.update((decks) => decks.map((d) => (d.id === id ? { ...d, colors } : d)));
  }

  delete(id: string): void {
    this.state.update((decks) => decks.filter((deck) => deck.id !== id));
  }

  addCard(id: string, card: NewDeckCard): void {
    const deck = this.get(id);
    if (!deck) {
      return;
    }
    const added: DeckEntry = { ...card, count: 1, section: 'main' };
    // Another copy fills up the card that is already in the deck, even if it is a different printing;
    // several lines of that card in the main deck are merged into the first one on the way.
    const sameName = (entry: DeckEntry) =>
      entry.section === 'main' && !entry.foil && entry.name.toLowerCase() === added.name.toLowerCase();
    const entries = parseDecklist(deck.text);
    const existing = entries.find((entry) => isSameCard(entry, added)) ?? entries.find(sameName);
    if (!existing) {
      this.updateText(id, serializeDecklist([...entries, added]));
      return;
    }
    const merged = entries.filter((entry) => entry !== existing && sameName(entry));
    existing.count += 1 + merged.reduce((sum, entry) => sum + entry.count, 0);
    this.updateText(id, serializeDecklist(entries.filter((entry) => !merged.includes(entry))));
  }

  setCount(id: string, entry: DeckEntry, count: number): void {
    const deck = this.get(id);
    if (!deck) {
      return;
    }
    const entries = parseDecklist(deck.text)
      .map((current) => (isSameCard(current, entry) ? { ...current, count } : current))
      .filter((current) => current.count > 0);
    this.updateText(id, serializeDecklist(entries));
  }

  updateEntry(id: string, entry: DeckEntry, changes: EntryChanges): void {
    const deck = this.get(id);
    if (!deck) {
      return;
    }
    const entries: DeckEntry[] = [];
    for (const current of parseDecklist(deck.text)) {
      const updated = isSameCard(current, entry) ? withChanges(current, changes) : current;
      const duplicate = entries.find((e) => isSameCard(e, updated) && e.category === updated.category);
      if (duplicate) {
        duplicate.count += updated.count;
      } else {
        entries.push(updated);
      }
    }
    this.updateText(id, serializeDecklist(entries));
  }

  private patch(id: string, changes: Partial<Pick<Deck, 'name' | 'text' | 'language' | 'format' | 'legalityFormat' | 'legalityCheck' | 'coverCard' | 'bracket'>>): void {
    const updatedAt = new Date().toISOString();
    this.state.update((decks) =>
      decks
        .map((deck) => (deck.id === id ? { ...deck, ...changes, updatedAt } : deck))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }
}

function withChanges(entry: DeckEntry, changes: EntryChanges): DeckEntry {
  const updated = { ...entry, ...changes };
  if (!updated.category) {
    delete updated.category;
  }
  return updated;
}

/** The chosen cover card, else the (first) commander, else the first card of the deck. */
export function deckCoverEntry(deck: Pick<Deck, 'text' | 'coverCard'>): DeckEntry | undefined {
  const entries = parseDecklist(deck.text).filter((e) => e.section !== 'maybeboard');
  const cover = deck.coverCard?.toLowerCase();
  return (
    (cover && entries.find((e) => e.name.toLowerCase() === cover)) ||
    entries.find((e) => e.section === 'commander') ||
    entries.find((e) => e.section === 'main') ||
    entries[0]
  );
}

export function countCards(text: string): number {
  return countEntries(parseDecklist(text), ['commander', 'companion', 'main']);
}

export function countSideboard(text: string): number {
  return countEntries(parseDecklist(text), ['sideboard']);
}

function readStoredDecks(): Deck[] {
  try {
    const decks = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(decks) ? (decks as Deck[]) : [];
  } catch {
    return [];
  }
}
