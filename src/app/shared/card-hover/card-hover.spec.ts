import { TestBed } from '@angular/core/testing';
import { CardHover } from './card-hover';
import { CardHoverOverlay } from './card-hover-overlay.service';

describe('CardHover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia ??= (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => vi.useRealTimers());

  function render(disabled = false) {
    const fixture = TestBed.createComponent(CardHover);
    fixture.componentRef.setInput('name', 'Lightning Bolt');
    fixture.componentRef.setInput('previewImage', 'https://example.test/bolt.jpg');
    fixture.componentRef.setInput('disabled', disabled);
    fixture.detectChanges();
    const hitArea = (fixture.nativeElement as HTMLElement).querySelector('.hit-area')!;
    return { fixture, hitArea, overlay: TestBed.inject(CardHoverOverlay) };
  }

  it('spawns embers right away and shows the preview after 500 ms', () => {
    const { fixture, hitArea, overlay } = render();
    hitArea.dispatchEvent(new MouseEvent('mouseenter', { clientY: 100 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.classList).toContain('hovered');
    expect(overlay.embers().length).toBe(12);
    vi.advanceTimersByTime(499);
    expect(overlay.preview()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(overlay.preview()).toMatchObject({ image: 'https://example.test/bolt.jpg', name: 'Lightning Bolt' });

    hitArea.dispatchEvent(new MouseEvent('mouseleave'));
    expect(overlay.preview()).toBeUndefined();
  });

  it('reports which half of the card the pointer is over', () => {
    const { fixture, hitArea } = render();
    const host = fixture.nativeElement as HTMLElement;
    host.getBoundingClientRect = () => ({ top: 0, height: 200, left: 0, width: 100, right: 100, bottom: 200 }) as DOMRect;
    const halves: unknown[] = [];
    fixture.componentInstance.halfChange.subscribe((half) => halves.push(half));

    hitArea.dispatchEvent(new MouseEvent('mouseenter', { clientY: 50 }));
    hitArea.dispatchEvent(new MouseEvent('mousemove', { clientY: 150 }));
    fixture.detectChanges();
    expect(host.classList).toContain('lower');
    hitArea.dispatchEvent(new MouseEvent('mouseleave'));

    expect(halves).toEqual(['upper', 'lower', undefined]);
  });

  it('in split mode shows the preview only over the upper half', () => {
    const { fixture, hitArea, overlay } = render();
    fixture.componentRef.setInput('splitHalves', true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.getBoundingClientRect = () => ({ top: 0, height: 200, left: 0, width: 100, right: 100, bottom: 200 }) as DOMRect;

    hitArea.dispatchEvent(new MouseEvent('mouseenter', { clientY: 150 }));
    vi.advanceTimersByTime(600);
    expect(overlay.preview()).toBeUndefined();

    hitArea.dispatchEvent(new MouseEvent('mousemove', { clientY: 50 }));
    vi.advanceTimersByTime(500);
    expect(overlay.preview()).toBeDefined();

    hitArea.dispatchEvent(new MouseEvent('mousemove', { clientY: 150 }));
    expect(overlay.preview()).toBeUndefined();
  });

  it('does nothing while disabled', () => {
    const { hitArea, overlay } = render(true);
    hitArea.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(600);
    expect(overlay.embers().length).toBe(0);
    expect(overlay.preview()).toBeUndefined();
  });
});
