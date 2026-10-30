import { Component, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { DeckService } from './deck.service';

// Asked before a new deck: build it with the deck wizard, or start with an empty commander deck.
@Component({
  selector: 'app-new-deck-dialog',
  imports: [TranslatePipe],
  host: { '(document:keydown.escape)': 'closed.emit()' },
  templateUrl: './new-deck-dialog.html',
  styleUrl: './new-deck-dialog.scss',
})
export class NewDeckDialog {
  private readonly deckService = inject(DeckService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  readonly closed = output<void>();

  protected openWizard(): void {
    this.closed.emit();
    this.router.navigate(['/assistent']);
  }

  protected createEmpty(): void {
    const deck = this.deckService.create(this.i18n.translate('decks.defaultName'), '', 'commander');
    this.closed.emit();
    this.router.navigate(['/decks', deck.id]);
  }
}
