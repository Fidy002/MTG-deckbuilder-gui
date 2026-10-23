import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from './i18n/translate.pipe';
import { LanguageSettings } from './settings/language-settings';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, LanguageSettings],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {}
