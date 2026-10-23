import { TestBed } from '@angular/core/testing';
import { SettingsService } from '../settings/settings.service';
import { I18nService } from './i18n.service';

describe('I18nService', () => {
  let i18n: I18nService;

  beforeEach(() => {
    localStorage.clear();
    i18n = TestBed.inject(I18nService);
  });

  it('fills placeholders', () => {
    i18n.setLanguage('en');
    expect(i18n.translate('search.resultCount', { count: 3 })).toBe('3 cards found');
  });

  it('switches to German after the translation file has loaded', async () => {
    i18n.setLanguage('de');
    TestBed.tick();
    await vi.waitFor(() => expect(i18n.translate('settings.cardLanguage')).toBe('Kartensprache'));
    expect(TestBed.inject(SettingsService).uiLanguage()).toBe('de');
  });
});
