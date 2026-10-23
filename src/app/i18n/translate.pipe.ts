import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService, TranslationKey, TranslationParams } from './i18n.service';

// Impure so the template re-renders when the UI language signal changes.
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: TranslationKey, params?: TranslationParams): string {
    return this.i18n.translate(key, params);
  }
}
