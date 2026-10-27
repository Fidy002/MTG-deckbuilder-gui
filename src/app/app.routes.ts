import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./cards/card-search').then((m) => m.CardSearch) },
  { path: 'decks', pathMatch: 'full', loadComponent: () => import('./decks/deck-gallery').then((m) => m.DeckGallery) },
  { path: 'decks/new', loadComponent: () => import('./decks/deck-wizard').then((m) => m.DeckWizard) },
  { path: 'decks/:id/wizard', loadComponent: () => import('./decks/deck-wizard').then((m) => m.DeckWizard) },
  { path: 'decks/:id', loadComponent: () => import('./decks/my-decks').then((m) => m.MyDecks) },
  { path: '**', redirectTo: '' },
];
