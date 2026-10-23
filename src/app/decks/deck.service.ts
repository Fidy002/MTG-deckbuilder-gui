import { Injectable, effect, signal } from '@angular/core';
import { DeckEntry, countEntries, isSameCard, parseDecklist, serializeDecklist } from './decklist';

const STORAGE_KEY = 'mtg-deckbuilder.decks';

export interface Deck {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export type NewDeckCard = Pick<DeckEntry, 'name' | 'set' | 'collectorNumber'>;

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

  private patch(id: string, changes: Partial<Pick<Deck, 'name' | 'text'>>): void {
    const updatedAt = new Date().toISOString();
    this.state.update((decks) =>
      decks
        .map((deck) => (deck.id === id ? { ...deck, ...changes, updatedAt } : deck))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }
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
