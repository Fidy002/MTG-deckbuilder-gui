import { Component, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslatePipe } from '../i18n/translate.pipe';
import { SettingsService } from '../settings/settings.service';
import { deckCardName } from '../scryfall/scryfall.models';
import { DeckCardsService, cardKey } from './deck-cards.service';
import { DeckEntry, isSameCard, parseDecklist, serializeDecklist } from './decklist';

@Component({
  selector: 'app-import-dialog',
  imports: [TranslatePipe],
  host: { '(document:keydown.escape)': 'closed.emit()' },
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.scss',
})
export class ImportDialog {
  private readonly deckCards = inject(DeckCardsService);
  private readonly settings = inject(SettingsService);

  readonly replacesDeck = input(false);
  readonly imported = output<string>();
  readonly closed = output<void>();

  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<'empty' | 'clipboard' | undefined>(undefined);

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
    this.error.set(undefined);
  }

  protected async pasteFromClipboard(): Promise<void> {
    try {
      this.text.set(await navigator.clipboard.readText());
      this.error.set(undefined);
    } catch {
      this.error.set('clipboard');
    }
  }

  protected async import(): Promise<void> {
    const entries = parseDecklist(this.text(), { blankLineStartsSideboard: true });
    if (entries.length === 0) {
      this.error.set('empty');
      return;
    }
    this.busy.set(true);
    try {
      this.imported.emit(serializeDecklist(await this.normalizeNames(entries)));
    } finally {
      this.busy.set(false);
    }
  }

  private async normalizeNames(entries: DeckEntry[]): Promise<DeckEntry[]> {
    // Foreign names are only found when searching in their language: try card and UI language.
    const languages = [...new Set([this.settings.cardLanguage(), this.settings.uiLanguage()])];
    const names = new Map<string, string>();
    try {
      for (const language of languages) {
        const open = entries.filter((e) => !names.has(cardKey(e)));
        if (open.length === 0) {
          break;
        }
        const resolved = await firstValueFrom(this.deckCards.resolve(open, language));
        for (const [key, result] of resolved) {
          if (result) {
            names.set(key, deckCardName(result.card));
          }
        }
      }
    } catch {
    }

    const merged: DeckEntry[] = [];
    for (const entry of entries) {
      const normalized = { ...entry, name: names.get(cardKey(entry)) ?? entry.name };
      const existing = merged.find((e) => isSameCard(e, normalized));
      if (existing) {
        existing.count += normalized.count;
      } else {
        merged.push(normalized);
      }
    }
    return merged;
  }
}
