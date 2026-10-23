import { Injectable } from '@angular/core';

const DB_NAME = 'mtg-deckbuilder';
const STORE = 'scryfall';

interface CacheRecord<T> {
  key: string;
  value: T;
  expiresAt: number;
}

// IndexedDB instead of localStorage: card objects are too large for the ~5 MB localStorage quota.
@Injectable({ providedIn: 'root' })
export class PersistentCache {
  private db?: Promise<IDBDatabase | undefined>;

  async getMany<T>(keys: readonly string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const db = await this.open();
    if (!db || keys.length === 0) {
      return result;
    }
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const now = Date.now();
    await Promise.all(
      keys.map(
        (key) =>
          new Promise<void>((resolve) => {
            const request = store.get(key);
            request.onsuccess = () => {
              const record = request.result as CacheRecord<T> | undefined;
              if (record && record.expiresAt > now) {
                result.set(key, record.value);
              }
              resolve();
            };
            request.onerror = () => resolve();
          }),
      ),
    );
    return result;
  }

  async setMany<T>(entries: Iterable<[string, T]>, ttlMs: number): Promise<void> {
    const db = await this.open();
    if (!db) {
      return;
    }
    const expiresAt = Date.now() + ttlMs;
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const [key, value] of entries) {
      store.put({ key, value, expiresAt } satisfies CacheRecord<T>);
    }
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  private open(): Promise<IDBDatabase | undefined> {
    this.db ??= new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(undefined);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    });
    return this.db;
  }
}
