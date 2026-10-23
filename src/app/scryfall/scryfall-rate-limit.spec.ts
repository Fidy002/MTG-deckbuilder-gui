import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ScryfallRateLimiter, bucketOf, scryfallRateLimitInterceptor } from './scryfall-rate-limit';

describe('ScryfallRateLimiter', () => {
  it('spaces search requests 500 ms apart and other requests 100 ms apart', () => {
    const limiter = new ScryfallRateLimiter();
    expect([0, 0, 0].map(() => limiter.reserve('search', 1000))).toEqual([0, 500, 1000]);
    expect([0, 0].map(() => limiter.reserve('other', 1000))).toEqual([0, 100]);
  });

  it('waits 30 s after a 429', () => {
    const limiter = new ScryfallRateLimiter();
    limiter.startCooldown(1000);
    expect(limiter.reserve('other', 1000)).toBe(30_000);
  });

  it('classifies endpoints', () => {
    expect(bucketOf('https://api.scryfall.com/cards/search?q=bolt')).toBe('search');
    expect(bucketOf('https://api.scryfall.com/cards/collection')).toBe('search');
    expect(bucketOf('https://api.scryfall.com/cards/m10/146/de')).toBe('other');
    expect(bucketOf('https://api.scryfall.com/sets')).toBe('other');
  });
});

describe('scryfallRateLimitInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([scryfallRateLimitInterceptor])), provideHttpClientTesting()],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('sends the second search only after 500 ms', () => {
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    http.get('https://api.scryfall.com/cards/search?q=a').subscribe();
    http.get('https://api.scryfall.com/cards/search?q=b').subscribe();

    vi.advanceTimersByTime(0);
    expect(backend.match(() => true).length).toBe(1);
    vi.advanceTimersByTime(500);
    expect(backend.match(() => true).length).toBe(1);
  });

  it('retries once after the 30 s cooldown when Scryfall answers 429', () => {
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    let result: unknown;
    http.get('https://api.scryfall.com/sets').subscribe((r) => (result = r));

    vi.advanceTimersByTime(0);
    backend.expectOne('https://api.scryfall.com/sets').flush(null, { status: 429, statusText: 'Too Many Requests' });
    vi.advanceTimersByTime(29_000);
    backend.expectNone('https://api.scryfall.com/sets');
    vi.advanceTimersByTime(1_000);
    backend.expectOne('https://api.scryfall.com/sets').flush({ ok: true });
    expect(result).toEqual({ ok: true });
  });
});
