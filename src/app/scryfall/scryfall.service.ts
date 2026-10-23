import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, defer, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { SCRYFALL_API_URL as API_URL } from './scryfall-rate-limit';
import { CardSearchResult, ScryfallCard, ScryfallList, ScryfallSet } from './scryfall.models';

const SETS_STORAGE_KEY = 'mtg-deckbuilder.sets';
const SETS_TTL_MS = 24 * 60 * 60 * 1000;

const EXCLUDED_SET_TYPES = new Set(['token', 'memorabilia', 'minigame', 'vanguard', 'treasure_chest']);

@Injectable({ providedIn: 'root' })
export class ScryfallService {
  private readonly http = inject(HttpClient);
  private readonly searchCache = new Map<string, CardSearchResult>();
  private readonly printingCache = new Map<string, ScryfallCard | undefined>();

  searchCards(query: string, language: string, setCodes: readonly string[] = []): Observable<CardSearchResult> {
    const fullQuery = [query && `(${query})`, setCodes.length && `(${setCodes.map((code) => `set:${code}`).join(' or ')})`]
      .filter(Boolean)
      .join(' ');

    return this.searchInLanguage(fullQuery, language).pipe(
      switchMap((result) =>
        result.cards.length === 0 && language !== 'en'
          ? this.searchInLanguage(fullQuery, 'en').pipe(
              map((fallback) => (fallback.cards.length ? { ...fallback, isFallback: true } : result)),
            )
          : of(result),
      ),
    );
  }

  loadNextPage(previous: CardSearchResult): Observable<CardSearchResult> {
    if (!previous.nextPage) {
      return of(previous);
    }
    return this.http.get<ScryfallList<ScryfallCard>>(previous.nextPage).pipe(
      map((list) => ({
        ...previous,
        cards: [...previous.cards, ...list.data],
        nextPage: list.has_more ? list.next_page : undefined,
      })),
    );
  }

  getPrintingInLanguage(card: ScryfallCard, language: string): Observable<ScryfallCard | undefined> {
    if (card.lang === language) {
      return of(card);
    }
    const url = `${API_URL}/cards/${encodeURIComponent(card.set)}/${encodeURIComponent(card.collector_number)}/${language}`;
    if (this.printingCache.has(url)) {
      return of(this.printingCache.get(url));
    }
    return this.http.get<ScryfallCard>(url).pipe(
      catchError(notFoundAs<ScryfallCard | undefined>(undefined)),
      tap((printing) => this.printingCache.set(url, printing)),
    );
  }

  findCards(query: string, unique: 'cards' | 'prints'): Observable<ScryfallCard[]> {
    const params = new HttpParams().set('q', query).set('unique', unique);
    return this.http.get<ScryfallList<ScryfallCard>>(`${API_URL}/cards/search`, { params }).pipe(
      map((list) => list.data),
      catchError(notFoundAs<ScryfallCard[]>([])),
    );
  }

  readonly sets$: Observable<ScryfallSet[]> = defer(() => {
    const stored = readStoredSets();
    return stored
      ? of(stored)
      : this.http.get<ScryfallList<ScryfallSet>>(`${API_URL}/sets`).pipe(
          map((list) =>
            list.data
              .filter((set) => set.card_count > 0 && !EXCLUDED_SET_TYPES.has(set.set_type))
              .sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? ''))
              .map(({ object, code, name, set_type, released_at, card_count, digital, icon_svg_uri }) => ({
                object, code, name, set_type, released_at, card_count, digital, icon_svg_uri,
              })),
          ),
          tap(storeSets),
        );
  }).pipe(shareReplay({ bufferSize: 1, refCount: false }));

  private searchInLanguage(query: string, language: string): Observable<CardSearchResult> {
    const cacheKey = `${language}|${query}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      return of(cached);
    }
    const params = new HttpParams()
      .set('q', `${query} lang:${language}`)
      .set('unique', 'cards')
      .set('order', 'name');

    const empty: ScryfallList<ScryfallCard> = { object: 'list', data: [], has_more: false, total_cards: 0 };

    return this.http.get<ScryfallList<ScryfallCard>>(`${API_URL}/cards/search`, { params }).pipe(
      // Scryfall answers "no results" with a 404.
      catchError(notFoundAs(empty)),
      map((list) => ({
        cards: list.data,
        totalCards: list.total_cards ?? list.data.length,
        nextPage: list.has_more ? list.next_page : undefined,
        language,
        isFallback: false,
      })),
      tap((result) => this.searchCache.set(cacheKey, result)),
    );
  }
}

function readStoredSets(): ScryfallSet[] | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(SETS_STORAGE_KEY) ?? 'null') as { expiresAt: number; sets: ScryfallSet[] } | null;
    return stored && stored.expiresAt > Date.now() ? stored.sets : undefined;
  } catch {
    return undefined;
  }
}

function storeSets(sets: ScryfallSet[]): void {
  try {
    localStorage.setItem(SETS_STORAGE_KEY, JSON.stringify({ expiresAt: Date.now() + SETS_TTL_MS, sets }));
  } catch {
  }
}

function notFoundAs<T>(value: T) {
  return (error: unknown): Observable<T> =>
    error instanceof HttpErrorResponse && error.status === 404 ? of(value) : throwError(() => error);
}
