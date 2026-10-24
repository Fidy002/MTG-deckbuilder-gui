import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, input, model, signal } from '@angular/core';
import { Flag, FlagCode } from './flag';

export interface LanguageOption {
  code: string;
  label: string;
  flag?: FlagCode;
}

@Component({
  selector: 'app-language-select',
  imports: [Flag, NgTemplateOutlet],
  host: {
    '[class.icon-only]': 'iconOnly()',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  template: `
    <span class="caps-label" [class.visually-hidden]="iconOnly()">{{ label() }}</span>
    <button
      type="button"
      class="trigger"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label() + ': ' + (selected()?.label ?? '')"
      [title]="iconOnly() ? label() + ': ' + (selected()?.label ?? '') : ''"
      (click)="open.set(!open())"
    >
      @if (selected(); as option) {
        @if (iconOnly()) {
          @if (option.flag) {
            <app-flag [code]="option.flag" />
          } @else {
            <svg class="icon globe" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
            </svg>
          }
        } @else {
          <ng-container *ngTemplateOutlet="optionContent; context: { $implicit: option }" />
        }
      }
      @if (!iconOnly()) {
        <svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      }
    </button>

    @if (open()) {
      <ul class="panel dropdown" role="listbox" [attr.aria-label]="label()">
        @for (option of options(); track option.code) {
          <li role="option" [attr.aria-selected]="option.code === value()">
            <button type="button" [class.active]="option.code === value()" (click)="choose(option.code)">
              <ng-container *ngTemplateOutlet="optionContent; context: { $implicit: option }" />
            </button>
          </li>
        }
      </ul>
    }

    <ng-template #optionContent let-option>
      @if (option.flag) {
        <app-flag [code]="option.flag" />
      } @else {
        <svg class="icon globe" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
        </svg>
      }
      <span class="text">{{ option.label }}</span>
    </ng-template>
  `,
  styles: `
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .trigger {
      justify-content: flex-start;
      gap: var(--space-2);
      min-width: 10rem;
      padding: 0 var(--space-3);
      background: var(--color-surface-sunken);
    }
    .trigger:hover:not(:disabled) {
      color: var(--color-text);
    }
    .chevron {
      margin-left: auto;
      color: var(--color-accent);
    }
    .globe {
      width: 20px;
      height: 15px;
      color: var(--color-text-muted);
    }
    .text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    :host(.icon-only) .trigger {
      justify-content: center;
      width: var(--control-height);
      min-width: 0;
      padding: 0;
    }
    .dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      z-index: 30;
      min-width: max(100%, 12rem);
      max-height: 360px;
      margin: var(--space-1) 0 0;
      padding: var(--space-1) 0;
      overflow-y: auto;
      list-style: none;
      border-color: var(--color-line-strong);
    }
    .dropdown button {
      justify-content: flex-start;
      width: 100%;
      padding: 0 var(--space-3);
      border: none;
      border-left: var(--accent-stroke) solid transparent;
      border-radius: 0;
      color: var(--color-text-muted);
    }
    .dropdown button:hover:not(:disabled) {
      color: var(--color-text);
    }
    .dropdown button.active {
      border-left-color: var(--color-accent);
      color: var(--color-text);
    }
  `,
})
export class LanguageSelect {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly label = input.required<string>();
  readonly options = input.required<LanguageOption[]>();
  readonly value = model.required<string>();
  readonly iconOnly = input(false);

  protected readonly open = signal(false);
  protected readonly selected = computed(() => this.options().find((o) => o.code === this.value()));

  protected choose(code: string): void {
    this.value.set(code);
    this.open.set(false);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
