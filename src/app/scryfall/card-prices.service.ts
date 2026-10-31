import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, concatMap, defer, from, map, of, reduce, switchMap } from 'rxjs';
import { PersistentCache } from './persistent-cache';
import { SCRYFALL_API_URL as API_URL } from './scryfall-rate-limit';
import { ScryfallCard } from './scryfall.models';

export interface CardPrice {
  // Cardmarket trend price in euros, as Scryfall reports it once a day.
  eur?: number;
  eurFoil?: number;
  cardmarketUrl?: string;
}

interface CollectionResponse {
  data: ScryfallCard[];
  not_found: { set: string; collector_number: string }[];
}

// Scryfall updates prices once a day.
const PRICE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'price:';
const IDENTIFIERS_PER_REQUEST = 75;

export function printKey(card: Pick<ScryfallCard, 'set' | 'collector_number'>): string {
  return `${card.set}|${card.collector_number}`;
}

export function cardmarketSearchUrl(name: string): string {
  return `https://www.cardmarket.com/de/Magic/Products/Search?searchString=${encodeURIComponent(name)}`;
}

// Scryfall's links carry its referral parameters (referrer=scryfall, utm_*); Cloudflare blocks those when the visit
// doesn't come from Scryfall, so only the product id is kept.
export function cardmarketProductUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get('idProduct');
    parsed.search = id ? `?idProduct=${encodeURIComponent(id)}` : '';
    return parsed.toString();
  } catch {
    return url;
  }
}

// Scryfall only keeps prices on the English printing, so cards in other languages are looked up by set and number.
@Injectable({ providedIn: 'root' })
export class CardPricesService {
  private readonly http = inject(HttpClient);
  private readonly persistent = inject(PersistentCache);
  private readonly cache = new Map<string, CardPrice>();

  /** Prices keyed by printKey(card). */
  prices(cards: readonly ScryfallCard[]): Observable<Map<string, CardPrice>> {
    const keys = [...new Set(cards.map(printKey))];
    return defer(async () => {
      const notInMemory = keys.filter((key) => !this.cache.has(key));
      if (notInMemory.length) {
        const stored = await this.persistent.getMany<CardPrice>(notInMemory.map((key) => CACHE_PREFIX + key));
        for (const [key, value] of stored) {
          this.cache.set(key.slice(CACHE_PREFIX.length), value);
        }
      }
      return keys.filter((key) => !this.cache.has(key));
    }).pipe(
      switchMap((missing) => (missing.length ? this.fetch(missing) : of(undefined))),
      map(() => new Map(keys.flatMap((key): [string, CardPrice][] => (this.cache.has(key) ? [[key, this.cache.get(key)!]] : [])))),
    );
  }

  private fetch(keys: readonly string[]): Observable<unknown> {
    const batches: string[][] = [];
    for (let i = 0; i < keys.length; i += IDENTIFIERS_PER_REQUEST) {
      batches.push(keys.slice(i, i + IDENTIFIERS_PER_REQUEST));
    }
    return from(batches).pipe(
      concatMap((batch) =>
        this.http
          .post<CollectionResponse>(`${API_URL}/cards/collection`, {
            identifiers: batch.map((key) => {
              const [set, collector_number] = key.split('|');
              return { set, collector_number };
            }),
          })
          .pipe(map((response) => this.store(batch, response.data))),
      ),
      reduce(() => undefined, undefined),
    );
  }

  private store(batch: readonly string[], cards: readonly ScryfallCard[]): void {
    const found = new Map(cards.map((card) => [printKey(card), card]));
    const entries: [string, CardPrice][] = batch.map((key) => {
      const card = found.get(key);
      const price: CardPrice = card
        ? { eur: parsePrice(card.prices?.eur), eurFoil: parsePrice(card.prices?.eur_foil), cardmarketUrl: card.purchase_uris?.cardmarket && cardmarketProductUrl(card.purchase_uris.cardmarket) }
        : {};
      this.cache.set(key, price);
      return [CACHE_PREFIX + key, price];
    });
    void this.persistent.setMany(entries, PRICE_TTL_MS);
  }
}

export function parsePrice(value: string | null | undefined): number | undefined {
  const price = value ? parseFloat(value) : NaN;
  return Number.isFinite(price) ? price : undefined;
}

/** The price one copy of an entry costs: the foil price for foil entries, the cheaper one when only one is known. */
export function entryPrice(price: CardPrice | undefined, foil: boolean | undefined): number | undefined {
  return foil ? (price?.eurFoil ?? price?.eur) : (price?.eur ?? price?.eurFoil);
}
