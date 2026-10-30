import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from './i18n/translate.pipe';
import { LanguageSettings } from './settings/language-settings';
import { CardHoverOverlayHost } from './shared/card-hover/card-hover-overlay';
import { CardMarquee } from './shared/card-marquee/card-marquee';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, LanguageSettings, CardHoverOverlayHost, CardMarquee],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {}
