import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, defer, map, of, shareReplay, switchMap, throwError } from 'rxjs';
import { CardSearchResult, ScryfallCard, ScryfallList, ScryfallSet } from './scryfall.models';

const API_URL = 'https://api.scryfall.com';

const EXCLUDED_SET_TYPES = new Set(['token', 'memorabilia', 'minigame', 'vanguard', 'treasure_chest']);

@Injectable({ providedIn: 'root' })
export class ScryfallService {
  private readonly http = inject(HttpClient);

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
    return this.http.get<ScryfallCard>(url).pipe(catchError(notFoundAs(undefined)));
  }

  findCards(query: string, unique: 'cards' | 'prints'): Observable<ScryfallCard[]> {
    const params = new HttpParams().set('q', query).set('unique', unique);
    return this.http.get<ScryfallList<ScryfallCard>>(`${API_URL}/cards/search`, { params }).pipe(
      map((list) => list.data),
      catchError(notFoundAs<ScryfallCard[]>([])),
    );
  }

  readonly sets$: Observable<ScryfallSet[]> = defer(() =>
    this.http.get<ScryfallList<ScryfallSet>>(`${API_URL}/sets`),
  ).pipe(
    map((list) =>
      list.data
        .filter((set) => set.card_count > 0 && !EXCLUDED_SET_TYPES.has(set.set_type))
        .sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? '')),
    ),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  private searchInLanguage(query: string, language: string): Observable<CardSearchResult> {
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
    );
  }
}

function notFoundAs<T>(value: T) {
  return (error: unknown): Observable<T> =>
    error instanceof HttpErrorResponse && error.status === 404 ? of(value) : throwError(() => error);
}
