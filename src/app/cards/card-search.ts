import { Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { SettingsService } from '../settings/settings.service';
import { cardLanguageName } from '../scryfall/card-languages';
import { CardSearchResult, ScryfallCard } from '../scryfall/scryfall.models';
import { ScryfallService } from '../scryfall/scryfall.service';
import { CardPreview } from './card-preview';
import { CardTile } from './card-tile';
import { SetSelect } from './set-select';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 350;
const LOAD_MORE_THRESHOLD_PX = 600;
const GHOST_SLOTS = 10;

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; result: CardSearchResult };

@Component({
  selector: 'app-card-search',
  imports: [TranslatePipe, CardTile, CardPreview, SetSelect],
  host: { '[class.compact]': 'compact()' },
  templateUrl: './card-search.html',
  styleUrl: './card-search.scss',
})
export class CardSearch {
  private readonly scryfall = inject(ScryfallService);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);

  readonly compact = input(false);
  readonly language = input<string>();
  readonly picked = output<ScryfallCard>();

  private readonly searchLanguage = computed(() => this.language() ?? this.settings.cardLanguage());

  protected readonly minQueryLength = MIN_QUERY_LENGTH;
  protected readonly ghostSlots = Array.from({ length: GHOST_SLOTS }, (_, i) => i);
  protected readonly query = signal('');
  protected readonly selectedSets = signal<string[]>([]);
  protected readonly state = signal<SearchState>({ status: 'idle' });
  protected readonly loadingMore = signal(false);
  protected readonly selectedCard = signal<ScryfallCard | undefined>(undefined);

  protected readonly result = computed(() => {
    const state = this.state();
    return state.status === 'done' ? state.result : undefined;
  });

  protected readonly fallbackLanguage = computed(() => {
    const result = this.result();
    return result?.isFallback ? cardLanguageName(this.searchLanguage(), this.i18n.language()) : undefined;
  });

  constructor() {
    const query$ = toObservable(this.query).pipe(
      debounceTime(DEBOUNCE_MS),
      map((q) => q.trim()),
      distinctUntilChanged(),
    );

    combineLatest([query$, toObservable(this.selectedSets), toObservable(this.searchLanguage)])
      .pipe(
        switchMap(([query, sets, language]) => this.search(query, sets, language)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
  }

  // In the compact single row the mouse wheel scrolls sideways; the page only scrolls once the row is at its end.
  protected onRowWheel(event: WheelEvent, row: HTMLElement): void {
    if (!this.compact() || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }
    const atStart = row.scrollLeft <= 0 && event.deltaY < 0;
    const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1 && event.deltaY > 0;
    if (!atStart && !atEnd) {
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    }
  }

  protected onRowScroll(row: HTMLElement): void {
    if (this.compact() && row.scrollLeft + row.clientWidth >= row.scrollWidth - LOAD_MORE_THRESHOLD_PX) {
      this.loadMore();
    }
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected loadMore(): void {
    const result = this.result();
    if (!result?.nextPage || this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.scryfall.loadNextPage(result).subscribe({
      next: (next) => {
        if (this.result() === result) {
          this.state.set({ status: 'done', result: next });
        }
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  private search(query: string, sets: string[], language: string): Observable<SearchState> {
    if (query.length < MIN_QUERY_LENGTH && !(query.length === 0 && sets.length > 0)) {
      return of({ status: 'idle' });
    }
    return this.scryfall.searchCards(query, language, sets).pipe(
      map((result): SearchState => ({ status: 'done', result })),
      startWith<SearchState>({ status: 'loading' }),
      catchError(() => of<SearchState>({ status: 'error' })),
    );
  }
}
