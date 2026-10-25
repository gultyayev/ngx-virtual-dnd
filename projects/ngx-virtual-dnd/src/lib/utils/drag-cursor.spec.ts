import { Injector, PLATFORM_ID, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { bindDragCursor } from './drag-cursor';

describe('bindDragCursor', () => {
  const styleCount = (): number => document.querySelectorAll('#vdnd-cursor-styles').length;

  const bind = (platformId: string): void => {
    const injector = Injector.create({
      providers: [{ provide: PLATFORM_ID, useValue: platformId }],
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

  it('touches no document on the server', () => {
    bind('server');
    TestBed.tick();

    expect(styleCount()).toBe(0);
    expect(document.body.classList.contains('vdnd-dragging')).toBe(false);
  });
});
