import { Injectable, inject } from '@angular/core';
import { Observable, concatMap, from, map, of, reduce, tap } from 'rxjs';
import { ScryfallCard, cardNameVariants } from '../scryfall/scryfall.models';
import { ScryfallService } from '../scryfall/scryfall.service';
import { DeckEntry } from './decklist';

export interface ResolvedCard {
  card: ScryfallCard;
  localized: boolean;
}

export function cardKey(entry: Pick<DeckEntry, 'name' | 'set' | 'collectorNumber'>): string {
  return [entry.name.toLowerCase(), entry.set ?? '', entry.collectorNumber ?? ''].join('|');
}

const NAMES_PER_QUERY = 15;
const PRINTS_PER_QUERY = 20;

// Preference per entry: exact printing in that language → any printing in that language → English.
@Injectable({ providedIn: 'root' })
export class DeckCardsService {
  private readonly scryfall = inject(ScryfallService);

  private readonly cache = new Map<string, ResolvedCard | null>();

  resolve(entries: readonly DeckEntry[], language: string): Observable<Map<string, ResolvedCard | null>> {
    const unique = [...new Map(entries.map((e) => [cardKey(e), e])).values()];
    const missing = unique.filter((e) => !this.cache.has(`${language}|${cardKey(e)}`));

    const lookup$: Observable<unknown> =
      missing.length === 0
        ? of(undefined)
        : this.find(missing, language).pipe(
            concatMap((found) => {
              const stillMissing = missing.filter((e) => !found.has(cardKey(e)));
              const fallback$ =
                language === 'en' || stillMissing.length === 0
                  ? of(new Map<string, ScryfallCard>())
                  : this.find(stillMissing, 'en');
              return fallback$.pipe(
                tap((english) => {
                  for (const entry of missing) {
                    const key = cardKey(entry);
                    const localizedCard = found.get(key);
                    const englishCard = english.get(key);
                    this.cache.set(
                      `${language}|${key}`,
                      localizedCard
                        ? { card: localizedCard, localized: true }
                        : englishCard
                          ? { card: englishCard, localized: false }
                          : null,
                    );
                  }
                }),
              );
            }),
          );

    return lookup$.pipe(
      map(
        () =>
          new Map(
            unique.map((e): [string, ResolvedCard | null] => [
              cardKey(e),
              this.cache.get(`${language}|${cardKey(e)}`) ?? null,
            ]),
          ),
      ),
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
