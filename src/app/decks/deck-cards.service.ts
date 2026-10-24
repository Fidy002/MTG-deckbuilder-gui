import { Injectable, inject } from '@angular/core';
import { Observable, concatMap, defer, from, map, of, reduce, switchMap, tap } from 'rxjs';
import { ScryfallCard, cardNameVariants } from '../scryfall/scryfall.models';
import { PersistentCache } from '../scryfall/persistent-cache';
import { ScryfallService } from '../scryfall/scryfall.service';
import { DeckEntry } from './decklist';

export interface ResolvedCard {
  card: ScryfallCard;
  localized: boolean;
}

export function cardKey(entry: Pick<DeckEntry, 'name' | 'set' | 'collectorNumber'>): string {
  return [entry.name.toLowerCase(), entry.set ?? '', entry.collectorNumber ?? ''].join('|');
}

const NAMES_PER_QUERY = 40;
// Each printing is its own (set cn) group, and Scryfall rejects searches with 20 or more nested conditions.
const PRINTS_PER_QUERY = 18;

// Scryfall asks to cache card data for at least 24 hours; gameplay data rarely changes.
const CARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'card:';

// Preference per entry: exact printing in that language → any printing in that language → English.
@Injectable({ providedIn: 'root' })
export class DeckCardsService {
  private readonly scryfall = inject(ScryfallService);
  private readonly persistent = inject(PersistentCache);

  private readonly cache = new Map<string, ResolvedCard | null>();

  resolve(entries: readonly DeckEntry[], language: string): Observable<Map<string, ResolvedCard | null>> {
    const unique = [...new Map(entries.map((e) => [cardKey(e), e])).values()];
    const keyOf = (e: DeckEntry) => `${language}|${cardKey(e)}`;

    return defer(async () => {
      const notInMemory = unique.filter((e) => !this.cache.has(keyOf(e)));
      if (notInMemory.length) {
        const stored = await this.persistent.getMany<ResolvedCard | null>(notInMemory.map((e) => CACHE_PREFIX + keyOf(e)));
        for (const [key, value] of stored) {
          this.cache.set(key.slice(CACHE_PREFIX.length), value);
        }
      }
      return unique.filter((e) => !this.cache.has(keyOf(e)));
    }).pipe(
      switchMap((missing) => (missing.length ? this.fetch(missing, language) : of(undefined))),
      map(() => new Map(unique.map((e): [string, ResolvedCard | null] => [cardKey(e), this.cache.get(keyOf(e)) ?? null]))),
    );
  }

  // Cards picked from a search result are already complete; no need to ask Scryfall again.
  remember(entry: Pick<DeckEntry, 'name' | 'set' | 'collectorNumber'>, language: string, card: ScryfallCard): void {
    if (card.lang !== language) {
      return;
    }
    const key = `${language}|${cardKey(entry)}`;
    const result = { card, localized: true };
    this.cache.set(key, result);
    void this.persistent.setMany([[CACHE_PREFIX + key, result]], CARD_TTL_MS);
  }

  private fetch(missing: readonly DeckEntry[], language: string): Observable<unknown> {
    return this.find(missing, language).pipe(
      concatMap((found) => {
        const stillMissing = missing.filter((e) => !found.has(cardKey(e)));
        const fallback$ =
          language === 'en' || stillMissing.length === 0 ? of(new Map<string, ScryfallCard>()) : this.find(stillMissing, 'en');
        return fallback$.pipe(
          tap((english) => {
            const resolved: [string, ResolvedCard][] = [];
            const notFound: [string, null][] = [];
            for (const entry of missing) {
              const key = `${language}|${cardKey(entry)}`;
              const localizedCard = found.get(cardKey(entry));
              const englishCard = english.get(cardKey(entry));
              const result = localizedCard
                ? { card: localizedCard, localized: true }
                : englishCard
                  ? { card: englishCard, localized: false }
                  : null;
              this.cache.set(key, result);
              if (result) {
                resolved.push([CACHE_PREFIX + key, result]);
              } else {
                notFound.push([CACHE_PREFIX + key, null]);
              }
            }
            void this.persistent.setMany(resolved, CARD_TTL_MS);
            void this.persistent.setMany(notFound, NOT_FOUND_TTL_MS);
          }),
        );
      }),
    );
  }

  private find(entries: readonly DeckEntry[], language: string): Observable<Map<string, ScryfallCard>> {
    const found = new Map<string, ScryfallCard>();
    const withPrint = entries.filter((e) => e.set && e.collectorNumber);

    const prints$ = this.batched(withPrint, PRINTS_PER_QUERY, (batch) =>
      this.scryfall
        .findCards(
          `(${batch.map((e) => `(set:${e.set} cn:"${quote(e.collectorNumber!)}")`).join(' or ')}) lang:${language}`,
          'prints',
        )
        .pipe(
          tap((cards) => {
            for (const entry of batch) {
              const card = cards.find((c) => c.set === entry.set && c.collector_number === entry.collectorNumber);
              if (card) {
                found.set(cardKey(entry), card);
              }
            }
          }),
        ),
    );

    return prints$.pipe(
      concatMap(() => {
        const byName = entries.filter((e) => !found.has(cardKey(e)));
        return this.batched(byName, NAMES_PER_QUERY, (batch) =>
          this.scryfall
            .findCards(`(${batch.map((e) => `!"${quote(e.name)}"`).join(' or ')}) lang:${language}`, 'cards')
            .pipe(
              tap((cards) => {
                for (const entry of batch) {
                  const card = matchByName(cards, entry.name);
                  if (card) {
                    found.set(cardKey(entry), card);
                  }
                }
              }),
            ),
        );
      }),
      map(() => found),
    );
  }

  private batched<T>(items: readonly T[], size: number, request: (batch: T[]) => Observable<unknown>) {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return from(batches).pipe(
      concatMap((batch) => request(batch)),
      reduce(() => undefined, undefined),
    );
  }
}

function matchByName(cards: ScryfallCard[], name: string): ScryfallCard | undefined {
  const lower = name.toLowerCase();
  return (
    cards.find((c) => c.name.toLowerCase() === lower || c.printed_name?.toLowerCase() === lower) ??
    cards.find((c) => cardNameVariants(c).includes(lower))
  );
}

function quote(value: string): string {
  return value.replace(/"/g, '');
}
