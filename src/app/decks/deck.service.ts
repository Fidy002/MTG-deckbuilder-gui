import { Injectable, effect, signal } from '@angular/core';
import { DeckEntry, countEntries, isSameCard, parseDecklist, serializeDecklist } from './decklist';

const STORAGE_KEY = 'mtg-deckbuilder.decks';

export interface Deck {
  id: string;
  name: string;
  text: string;
  language?: string;
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

  create(name: string, text = ''): Deck {
    const now = new Date().toISOString();
    const deck: Deck = { id: crypto.randomUUID(), name, text, createdAt: now, updatedAt: now };
    this.state.update((decks) => [deck, ...decks]);
    return deck;
  }

  rename(id: string, name: string): void {
    this.patch(id, { name });
  }

  updateText(id: string, text: string): void {
    this.patch(id, { text });
  }

  setLanguage(id: string, language: string | undefined): void {
    this.patch(id, { language });
  }

  delete(id: string): void {
    this.state.update((decks) => decks.filter((deck) => deck.id !== id));
  }

  addCard(id: string, card: NewDeckCard): void {
    const deck = this.get(id);
    if (!deck) {
      return;
    }
    const entries = parseDecklist(deck.text);
    const added: DeckEntry = { ...card, count: 1, section: 'main' };
    const existing = entries.find((entry) => isSameCard(entry, added));
    if (existing) {
      existing.count++;
    } else {
      entries.push(added);
    }
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

  private patch(id: string, changes: Partial<Pick<Deck, 'name' | 'text' | 'language'>>): void {
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

export function countCards(text: string): number {
  return countEntries(parseDecklist(text), ['commander', 'companion', 'main']);
}

function readStoredDecks(): Deck[] {
  try {
    const decks = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(decks) ? (decks as Deck[]) : [];
  } catch {
    return [];
  }
}
