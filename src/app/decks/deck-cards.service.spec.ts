import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DeckCardsService, ResolvedCard, cardKey } from './deck-cards.service';
import { DeckEntry } from './decklist';

const card = (name: string, lang: string, set = 'm10', collector_number = '1') => ({
  object: 'card',
  name,
  lang,
  set,
  collector_number,
});
const list = (data: unknown[]) => ({ object: 'list', data, has_more: false });

describe('DeckCardsService', () => {
  let service: DeckCardsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DeckCardsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('prefers the exact printing in the card language and falls back to English', () => {
    const bolt: DeckEntry = { count: 4, name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', section: 'main' };
    const mountain: DeckEntry = { count: 20, name: 'Mountain', section: 'main' };
    let result: Map<string, ResolvedCard | null> | undefined;

    service.resolve([bolt, mountain], 'de').subscribe((r) => (result = r));

    const query = () => http.expectOne((r) => r.url.endsWith('/cards/search'));

    let request = query();
    expect(request.request.params.get('q')).toBe('((set:m10 cn:"146")) lang:de');
    request.flush(list([card('Lightning Bolt', 'de', 'm10', '146')]));

    request = query();
    expect(request.request.params.get('q')).toBe('(!"Mountain") lang:de');
    request.flush({ object: 'error', status: 404 }, { status: 404, statusText: 'Not Found' });

    request = query();
    expect(request.request.params.get('q')).toBe('(!"Mountain") lang:en');
    request.flush(list([card('Mountain', 'en')]));

    expect(result?.get(cardKey(bolt))).toMatchObject({ localized: true, card: { lang: 'de' } });
    expect(result?.get(cardKey(mountain))).toMatchObject({ localized: false, card: { lang: 'en' } });

    service.resolve([bolt, mountain], 'de').subscribe();
  });
});
