import { CSP_NONCE, Injector, PLATFORM_ID, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { bindDragCursor } from './drag-cursor';

describe('bindDragCursor', () => {
  const styleCount = (): number => document.querySelectorAll('#vdnd-cursor-styles').length;

  const bind = (platformId: string, nonce: string | null = null): void => {
    const injector = Injector.create({
      providers: [
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: CSP_NONCE, useValue: nonce },
      ],
      parent: TestBed.inject(Injector),
    });
    runInInjectionContext(injector, () => bindDragCursor(signal(true), signal(false)));
  };

  beforeEach(() => {
    document.getElementById('vdnd-cursor-styles')?.remove();
    document.body.classList.remove('vdnd-dragging', 'vdnd-dragging-touch');
  });

  it('adds the cursor styles once', () => {
    bind('browser');
    bind('browser');

    expect(styleCount()).toBe(1);
  });

  it("gives the cursor styles the app's CSP nonce, so a strict style-src applies them", () => {
    bind('browser', 'nonce-of-the-app');

    expect(document.getElementById('vdnd-cursor-styles')!.nonce).toBe('nonce-of-the-app');
  });

  it('sets no nonce when the app has none', () => {
    bind('browser');

    expect(document.getElementById('vdnd-cursor-styles')!.hasAttribute('nonce')).toBe(false);
  });

  it('touches no document on the server', () => {
    bind('server');
    TestBed.tick();

    expect(styleCount()).toBe(0);
    expect(document.body.classList.contains('vdnd-dragging')).toBe(false);
  });
});
