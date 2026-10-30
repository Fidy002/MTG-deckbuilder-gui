import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./cards/card-search').then((m) => m.CardSearch) },
  { path: 'decks', pathMatch: 'full', loadComponent: () => import('./decks/deck-gallery').then((m) => m.DeckGallery) },
  // The deck wizard for a new deck, a tab of its own.
  { path: 'assistent', loadComponent: () => import('./decks/deck-wizard').then((m) => m.DeckWizard) },
  { path: 'decks/new', redirectTo: 'assistent' },
  { path: 'decks/:id/wizard', loadComponent: () => import('./decks/deck-wizard').then((m) => m.DeckWizard) },
  { path: 'decks/:id', loadComponent: () => import('./decks/my-decks').then((m) => m.MyDecks) },
  { path: '**', redirectTo: '' },
];
