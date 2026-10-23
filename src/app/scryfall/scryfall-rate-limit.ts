import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, defer, switchMap, throwError, timer } from 'rxjs';

export const SCRYFALL_API_URL = 'https://api.scryfall.com';

type Bucket = 'search' | 'other';

// https://scryfall.com/docs/api/rate-limits
const MIN_INTERVAL_MS: Record<Bucket, number> = { search: 500, other: 100 };
const SEARCH_ENDPOINTS = /^\/cards\/(search|named|random|collection)(\/|$|\?)/;
const COOLDOWN_AFTER_429_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class ScryfallRateLimiter {
  private readonly nextSlot: Record<Bucket, number> = { search: 0, other: 0 };
  private cooldownUntil = 0;

  reserve(bucket: Bucket, now = Date.now()): number {
    const start = Math.max(now, this.nextSlot[bucket], this.cooldownUntil);
    this.nextSlot[bucket] = start + MIN_INTERVAL_MS[bucket];
    return start - now;
  }

  startCooldown(now = Date.now()): void {
    this.cooldownUntil = now + COOLDOWN_AFTER_429_MS;
  }
}

export function bucketOf(url: string): Bucket {
  return SEARCH_ENDPOINTS.test(url.slice(SCRYFALL_API_URL.length)) ? 'search' : 'other';
}

export const scryfallRateLimitInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(SCRYFALL_API_URL)) {
    return next(request);
  }
  return send(inject(ScryfallRateLimiter), bucketOf(request.urlWithParams), request, next, false);
};

function send(
  limiter: ScryfallRateLimiter,
  bucket: Bucket,
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  isRetry: boolean,
): Observable<HttpEvent<unknown>> {
  return defer(() => timer(limiter.reserve(bucket))).pipe(
    switchMap(() => next(request)),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 429) {
        limiter.startCooldown();
        if (!isRetry) {
          return send(limiter, bucket, request, next, true);
        }
      }
      return throwError(() => error);
    }),
  );
}
