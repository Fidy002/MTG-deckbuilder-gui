import { Component, ElementRef, computed, effect, inject, model, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { ScryfallSet } from '../scryfall/scryfall.models';
import { ScryfallService } from '../scryfall/scryfall.service';

type SetsState = { status: 'loading' } | { status: 'error' } | { status: 'done'; sets: ScryfallSet[] };

@Component({
  selector: 'app-set-select',
  imports: [TranslatePipe],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  templateUrl: './set-select.html',
  styleUrl: './set-select.scss',
})
export class SetSelect {
  private readonly scryfall = inject(ScryfallService);
  private readonly i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly selected = model<string[]>([]);

  protected readonly open = signal(false);
  protected readonly filter = signal('');

  private readonly filterInput = viewChild<ElementRef<HTMLInputElement>>('filterInput');

  constructor() {
    effect(() => this.filterInput()?.nativeElement.focus());
  }

  protected readonly state = toSignal(
    this.scryfall.sets$.pipe(
      map((sets): SetsState => ({ status: 'done', sets })),
      startWith<SetsState>({ status: 'loading' }),
      catchError(() => of<SetsState>({ status: 'error' })),
    ),
    { requireSync: true },
  );

  private readonly sets = computed(() => {
    const state = this.state();
    return state.status === 'done' ? state.sets : [];
  });

  private readonly selectedCodes = computed(() => new Set(this.selected()));

  protected readonly visibleSets = computed(() => {
    const term = this.filter().trim().toLowerCase();
    const selected = this.selectedCodes();
    const matches = this.sets().filter(
      (set) => !term || set.name.toLowerCase().includes(term) || set.code.includes(term),
    );
    return [...matches.filter((s) => selected.has(s.code)), ...matches.filter((s) => !selected.has(s.code))];
  });

  protected readonly summary = computed(() => {
    const selected = this.selected();
    if (selected.length === 0) {
      return this.i18n.translate('sets.all');
    }
    if (selected.length === 1) {
      return this.sets().find((s) => s.code === selected[0])?.name ?? selected[0].toUpperCase();
    }
    return this.i18n.translate('sets.selectedCount', { count: selected.length });
  });

  protected isSelected(code: string): boolean {
    return this.selectedCodes().has(code);
  }

  protected toggleSet(code: string): void {
    this.selected.update((codes) => (codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]));
  }

  protected clear(): void {
    this.selected.set([]);
  }

  protected onFilterInput(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
