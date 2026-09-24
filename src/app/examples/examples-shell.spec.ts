import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ExamplesShellComponent } from './examples-shell';

// The real debug mirror imports the library, which the app's jest setup does not resolve.
jest.mock('../drag-state-debug/drag-state-debug', () => {
  const { Component } = jest.requireActual<typeof import('@angular/core')>('@angular/core');
  @Component({ selector: 'app-drag-state-debug', template: '' })
  class DragStateDebugStubComponent {}
  return { DragStateDebugComponent: DragStateDebugStubComponent };
});

describe('ExamplesShellComponent', () => {
  let parentFrame: HTMLIFrameElement | null = null;
  let resizeCallback: (() => void) | null = null;
  const disconnect = jest.fn();

  /** Simulate running inside an iframe: window.parent becomes another window. */
  const embed = (): Window => {
    parentFrame = document.createElement('iframe');
    document.body.appendChild(parentFrame);
    const parent = parentFrame.contentWindow as Window;
    jest.spyOn(window, 'parent', 'get').mockReturnValue(parent);
    return parent;
  };

  const render = async (height: number) => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ExamplesShellComponent);
    const host = fixture.nativeElement as HTMLElement;
    jest.spyOn(host, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect);
    await fixture.whenStable();
    return { fixture, host };
  };

  beforeEach(() => {
    resizeCallback = null;
    disconnect.mockClear();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: () => void) {
        resizeCallback = callback;
      }
      observe(): void {
        // The test triggers resizes through resizeCallback.
      }
      disconnect = disconnect;
    };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
    parentFrame?.remove();
    parentFrame = null;
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  it('reports its height to the embedding page', async () => {
    const parent = embed();
    const post = jest.spyOn(parent, 'postMessage').mockImplementation(() => undefined);

    await render(412.4);

    expect(post).toHaveBeenCalledWith({ type: 'vdnd-example-size', height: 413 }, '*');
  });

  it('reports again only when the height changes', async () => {
    const parent = embed();
    const post = jest.spyOn(parent, 'postMessage').mockImplementation(() => undefined);
    const { host } = await render(400);
    post.mockClear();

    resizeCallback?.();
    expect(post).not.toHaveBeenCalled();

    jest.spyOn(host, 'getBoundingClientRect').mockReturnValue({ height: 520 } as DOMRect);
    resizeCallback?.();
    expect(post).toHaveBeenCalledWith({ type: 'vdnd-example-size', height: 520 }, '*');
  });

  it('does not report when it is not embedded', async () => {
    const post = jest.spyOn(window, 'postMessage').mockImplementation(() => undefined);

    await render(400);

    expect(post).not.toHaveBeenCalled();
    expect(resizeCallback).toBeNull();
  });

  it('stops observing once destroyed', async () => {
    const parent = embed();
    jest.spyOn(parent, 'postMessage').mockImplementation(() => undefined);
    const { fixture } = await render(400);

    fixture.destroy();

    expect(disconnect).toHaveBeenCalled();
  });
});
