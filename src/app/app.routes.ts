import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./cards/card-search').then((m) => m.CardSearch) },
  { path: 'decks', loadComponent: () => import('./decks/my-decks').then((m) => m.MyDecks) },
  { path: 'decks/:id', loadComponent: () => import('./decks/my-decks').then((m) => m.MyDecks) },
  { path: '**', redirectTo: '' },
];
