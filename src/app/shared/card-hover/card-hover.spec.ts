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

  it('does nothing while disabled', () => {
    const { hitArea, overlay } = render(true);
    hitArea.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(600);
    expect(overlay.embers().length).toBe(0);
    expect(overlay.preview()).toBeUndefined();
  });
});
