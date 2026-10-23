import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ScryfallService } from './scryfall.service';

describe('ScryfallService', () => {
  let service: ScryfallService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ScryfallService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('combines query, set filter and language', () => {
    service.searchCards('bolt', 'de', ['m10', 'lea']).subscribe();
    const request = http.expectOne((r) => r.url.endsWith('/cards/search'));
    expect(request.request.params.get('q')).toBe('(bolt) (set:m10 or set:lea) lang:de');
    request.flush({ object: 'list', data: [{ id: '1' }], has_more: false, total_cards: 1 });
  });

  it('allows a set filter without a query', () => {
    service.searchCards('', 'en', ['m10']).subscribe();
    const request = http.expectOne((r) => r.url.endsWith('/cards/search'));
    expect(request.request.params.get('q')).toBe('(set:m10) lang:en');
    request.flush({ object: 'list', data: [{ id: '1' }], has_more: false, total_cards: 1 });
  });
});
