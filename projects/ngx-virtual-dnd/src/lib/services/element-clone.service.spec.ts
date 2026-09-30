import { TestBed } from '@angular/core/testing';
import { ElementCloneService } from './element-clone.service';

describe('ElementCloneService', () => {
  let service: ElementCloneService;
  let styleSheet: HTMLStyleElement;
  let attached: HTMLElement[];

  /**
   * Styles come from a stylesheet, not inline `style`: cloneNode() copies inline styles
   * by itself, so only stylesheet rules prove the computed styles were copied onto the clone.
   */
  const addStyles = (css: string): void => {
    styleSheet.textContent = css;
  };

  const attach = (el: HTMLElement): HTMLElement => {
    document.body.appendChild(el);
    attached.push(el);
    return el;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ElementCloneService);
    styleSheet = document.createElement('style');
    document.head.appendChild(styleSheet);
    attached = [];
  });

  afterEach(() => {
    styleSheet.remove();
    attached.forEach((el) => el.remove());
    jest.restoreAllMocks();
  });

  /**
   * Stand in for the engine's computed styles (jsdom computes no shorthand), recording the
   * properties read. Properties missing from `values` read as ''.
   */
  const fakeComputedStyles = (values: Record<string, string>): string[] => {
    const reads: string[] = [];
    jest.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          getPropertyValue: (property: string) => {
            reads.push(property);
            return values[property] ?? '';
          },
        }) as unknown as CSSStyleDeclaration,
    );
    return reads;
  };

  describe('cloneElement', () => {
    it('should clone element structure', () => {
      const source = document.createElement('div');
      source.innerHTML = '<span>Hello</span><span>World</span>';

      const clone = service.cloneElement(source);

      expect(clone.children.length).toBe(2);
      expect(clone.textContent).toBe('HelloWorld');
    });

    it('should copy computed background color from stylesheet rules', () => {
      addStyles('.card { background-color: rgb(255, 0, 0); }');
      const source = attach(document.createElement('div'));
      source.className = 'card';

      const clone = service.cloneElement(source);

      expect(clone.style.backgroundColor).toBe('rgb(255, 0, 0)');
    });

    it('should copy computed font styles from stylesheet rules', () => {
      addStyles('.card { font-size: 16px; font-weight: bold; }');
      const source = attach(document.createElement('div'));
      source.className = 'card';

      const clone = service.cloneElement(source);

      expect(clone.style.fontSize).toBe('16px');
      expect(clone.style.fontWeight).toBe('bold');
    });

    it('should copy a shorthand the engine serializes without reading its longhands', () => {
      const reads = fakeComputedStyles({
        background: 'rgb(10, 20, 30)',
        'background-color': 'rgb(10, 20, 30)',
        font: 'italic 600 15px / 21px Georgia, serif',
        'font-family': 'Georgia, serif',
      });
      const source = attach(document.createElement('div'));

      const clone = service.cloneElement(source);

      expect(clone.style.getPropertyValue('background')).toBe('rgb(10, 20, 30)');
      // The shorthand carries more than the longhands a fallback copies, such as font-style
      expect(clone.style.fontStyle).toBe('italic');
      expect(clone.style.lineHeight).toBe('21px');
      for (const longhand of ['background-color', 'background-image', 'font-family', 'font-size']) {
        expect(reads).not.toContain(longhand);
      }
    });

    it("should copy a shorthand's longhands when the engine does not serialize it", () => {
      // e.g. `font` with `font-variant-ligatures: none`, which the shorthand can't express
      fakeComputedStyles({
        'font-family': 'Arial',
        'font-size': '13px',
        'font-weight': '700',
        'line-height': '20px',
      });
      const source = attach(document.createElement('div'));

      const clone = service.cloneElement(source);

      expect(clone.style.fontFamily).toBe('Arial');
      expect(clone.style.fontSize).toBe('13px');
      expect(clone.style.fontWeight).toBe('700');
      expect(clone.style.lineHeight).toBe('20px');
    });

    it("should copy a shorthand's longhands when the clone rejects the shorthand's value", () => {
      // jsdom can't parse this serialization of `background`, as an engine might fail its own
      fakeComputedStyles({
        background: 'rgb(10, 20, 30) none repeat scroll 0% 0%',
        'background-color': 'rgb(10, 20, 30)',
      });
      const source = attach(document.createElement('div'));

      const clone = service.cloneElement(source);

      expect(clone.style.backgroundColor).toBe('rgb(10, 20, 30)');
    });

    it('should disable animations and transitions on clone', () => {
      const source = attach(document.createElement('div'));
      source.style.transition = 'all 0.3s ease';
      source.style.animation = 'fade 1s';

      const clone = service.cloneElement(source);

      expect(clone.style.animation).toBe('none');
      expect(clone.style.transition).toBe('none');
    });

    it('should remove draggable attributes from the root and its descendants', () => {
      const source = document.createElement('div');
      source.setAttribute('vdndDraggable', 'item-1');
      source.setAttribute('data-draggable-id', 'item-1');
      source.setAttribute('data-droppable-id', 'list-1');
      source.innerHTML = '<div data-draggable-id="nested" data-droppable-id="nested-list"></div>';

      const clone = service.cloneElement(source);

      expect(clone.hasAttribute('vdndDraggable')).toBe(false);
      expect(clone.hasAttribute('data-draggable-id')).toBe(false);
      expect(clone.hasAttribute('data-droppable-id')).toBe(false);
      expect(clone.querySelector('[data-draggable-id], [data-droppable-id]')).toBeNull();
    });

    it('should disable interactive elements', () => {
      const source = document.createElement('div');
      source.innerHTML = `
        <button>Click me</button>
        <input type="text" />
        <a href="#">Link</a>
      `;

      const clone = service.cloneElement(source);

      const button = clone.querySelector('button') as HTMLButtonElement;
      const input = clone.querySelector('input') as HTMLInputElement;
      const link = clone.querySelector('a') as HTMLAnchorElement;

      expect(button.style.pointerEvents).toBe('none');
      expect(button.getAttribute('tabindex')).toBe('-1');
      expect(button.getAttribute('aria-hidden')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(true);

      expect(input.style.pointerEvents).toBe('none');
      expect(link.style.pointerEvents).toBe('none');
    });

    it('should keep cloned radio buttons out of the source radio group', () => {
      const source = attach(document.createElement('div'));
      source.innerHTML =
        '<input type="radio" name="priority" value="low">' +
        '<input type="radio" name="priority" value="high" checked>';

      const clone = attach(service.cloneElement(source));
      // Browsers apply the radio group rule as soon as the checked clone is connected, which
      // unchecks the source's radio. jsdom only applies it when checkedness is set, so set it.
      clone.querySelectorAll('input')[1].checked = true;

      const sourceRadios = source.querySelectorAll('input');
      expect(sourceRadios[1].checked).toBe(true);
      expect(sourceRadios[0].checked).toBe(false);
    });

    it('should recursively copy styles to child elements', () => {
      addStyles('.card .label { color: rgb(0, 0, 255); }');
      const source = attach(document.createElement('div'));
      source.className = 'card';
      source.innerHTML = '<span class="label">Label</span>';

      const clone = service.cloneElement(source);
      const clonedChild = clone.querySelector('span') as HTMLSpanElement;

      expect(clonedChild.style.color).toBe('rgb(0, 0, 255)');
    });

    it('should remove Angular-specific attributes', () => {
      const source = document.createElement('div');
      source.setAttribute('ng-reflect-value', 'test');
      source.setAttribute('_ngcontent-abc-123', '');

      const clone = service.cloneElement(source);

      expect(clone.hasAttribute('ng-reflect-value')).toBe(false);
      expect(clone.hasAttribute('_ngcontent-abc-123')).toBe(false);
    });

    it('should remove vdnd-draggable-dragging class', () => {
      const source = document.createElement('div');
      source.classList.add('item', 'vdnd-draggable-dragging', 'vdnd-draggable-disabled');

      const clone = service.cloneElement(source);

      expect(clone.classList.contains('item')).toBe(true);
      expect(clone.classList.contains('vdnd-draggable-dragging')).toBe(false);
      expect(clone.classList.contains('vdnd-draggable-disabled')).toBe(false);
    });

    it('should handle elements with no children', () => {
      addStyles('.chip { padding: 10px; }');
      const source = attach(document.createElement('span'));
      source.className = 'chip';
      source.textContent = 'Simple text';

      const clone = service.cloneElement(source);

      expect(clone.textContent).toBe('Simple text');
      expect(clone.style.padding).toBe('10px');
    });
  });

  describe('special elements handling', () => {
    it('should replace video elements with poster image', () => {
      const source = document.createElement('div');
      const video = document.createElement('video');
      video.poster = 'https://example.com/poster.jpg';
      source.appendChild(video);

      const clone = service.cloneElement(source);
      const img = clone.querySelector('img') as HTMLImageElement;

      expect(clone.querySelector('video')).toBeNull();
      expect(img).not.toBeNull();
      expect(img.src).toBe('https://example.com/poster.jpg');
    });

    it('should replace video without poster with an empty placeholder', () => {
      const source = document.createElement('div');
      const video = document.createElement('video');
      source.appendChild(video);

      const clone = service.cloneElement(source);

      expect(clone.querySelector('video')).toBeNull();
      expect(clone.querySelector('img')).toBeNull();
      expect(clone.children.length).toBe(1);
      expect((clone.children[0] as HTMLElement).tagName).toBe('DIV');
    });

    it('should replace iframes with a placeholder of the same size', () => {
      const source = attach(document.createElement('div'));
      const iframe = document.createElement('iframe');
      iframe.style.width = '300px';
      iframe.style.height = '200px';
      source.appendChild(iframe);

      const clone = service.cloneElement(source);

      expect(clone.querySelector('iframe')).toBeNull();
      const placeholder = clone.children[0] as HTMLElement;
      expect(placeholder.tagName).toBe('DIV');
      expect(placeholder.style.width).toBe('300px');
      expect(placeholder.style.height).toBe('200px');
    });
  });
});
