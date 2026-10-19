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

    it("should copy a rejected shorthand's longhands when the source sets one inline", () => {
      fakeComputedStyles({
        background: 'rgb(10, 20, 30) none repeat scroll 0% 0%',
        'background-color': 'rgb(10, 20, 30)',
        'background-image': 'url("card.png")',
      });
      // cloneNode() copies the inline background-color: it must not pass for the shorthand's
      const source = attach(document.createElement('div'));
      source.style.backgroundColor = 'rgb(10, 20, 30)';

      const clone = service.cloneElement(source);

      expect(clone.style.backgroundImage).toBe('url("card.png")');
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

    it('should take a focusable root out of the tab order and the accessibility tree', () => {
      const source = document.createElement('div');
      source.setAttribute('tabindex', '0');
      source.setAttribute('role', 'listitem');

      const clone = service.cloneElement(source);

      expect(clone.getAttribute('tabindex')).toBe('-1');
      expect(clone.getAttribute('aria-hidden')).toBe('true');
      expect(clone.hasAttribute('inert')).toBe(true);
    });

    it('should disable an interactive root like an interactive descendant', () => {
      const source = document.createElement('button');
      source.setAttribute('onclick', 'alert(1)');

      const clone = service.cloneElement(source);

      expect(clone.style.pointerEvents).toBe('none');
      expect(clone.getAttribute('tabindex')).toBe('-1');
      expect(clone.hasAttribute('disabled')).toBe(true);
      expect(clone.hasAttribute('onclick')).toBe(false);
    });

    it('should take focusable descendants out of the tab order', () => {
      const source = document.createElement('div');
      source.innerHTML = '<div class="cell" tabindex="0"></div>';

      const clone = service.cloneElement(source);

      expect(clone.querySelector('.cell')!.getAttribute('tabindex')).toBe('-1');
    });

    describe('ids', () => {
      /** Every id in the clone, which must be unique in the document once the clone is shown */
      const idsIn = (root: Element): string[] =>
        [root, ...Array.from(root.querySelectorAll('[id]'))].map((el) => el.id).filter(Boolean);

      it('should not duplicate an id of the row or its descendants in the document', () => {
        const source = attach(document.createElement('div'));
        source.id = 'task-1';
        source.innerHTML =
          '<label id="task-1-title">Title</label>' +
          '<svg><defs><linearGradient id="fill"></linearGradient></defs>' +
          '<rect fill="url(#fill)"></rect></svg>';

        const clone = attach(service.cloneElement(source));

        const ids = idsIn(clone);
        expect(ids).toHaveLength(3);
        for (const id of ids) {
          expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
        }
        // The source keeps its own ids, so document lookups still find it
        expect(document.getElementById('task-1')).toBe(source);
        expect(document.getElementById('fill')).toBe(source.querySelector('linearGradient'));
      });

      it('should give each clone ids of its own', () => {
        const source = attach(document.createElement('div'));
        source.id = 'task-1';

        const first = attach(service.cloneElement(source));
        const second = attach(service.cloneElement(source));

        expect(first.id).not.toBe(second.id);
      });

      it('should point SVG references inside the clone at the elements of the clone', () => {
        const source = attach(document.createElement('div'));
        source.innerHTML =
          '<svg><defs><linearGradient id="fill"></linearGradient>' +
          '<path id="shape" d="M0 0h4v4z"></path></defs>' +
          '<rect class="attr" fill="url(#fill)"></rect>' +
          '<rect class="inline" style="stroke: url(&quot;#fill&quot;)"></rect>' +
          '<use class="href" href="#shape"></use>' +
          '<use class="xlink"></use></svg>';
        source
          .querySelector('.xlink')!
          .setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#shape');

        const clone = attach(service.cloneElement(source));

        const gradient = clone.querySelector('linearGradient')!;
        const shape = clone.querySelector('path')!;
        expect(gradient.id).not.toBe('fill');
        expect(shape.id).not.toBe('shape');
        expect(clone.querySelector('.attr')!.getAttribute('fill')).toBe(`url(#${gradient.id})`);
        expect((clone.querySelector('.inline') as SVGElement).style.stroke).toContain(
          `#${gradient.id}`,
        );
        expect(clone.querySelector('.href')!.getAttribute('href')).toBe(`#${shape.id}`);
        expect(
          clone.querySelector('.xlink')!.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
        ).toBe(`#${shape.id}`);
      });

      it('should point id references inside the clone at the elements of the clone', () => {
        const source = attach(document.createElement('div'));
        source.innerHTML =
          '<label id="title" for="done">Title</label>' +
          '<input id="done" type="checkbox" aria-labelledby="title page-heading" ' +
          'aria-describedby="hint">' +
          '<span id="hint">Hint</span>';

        const clone = attach(service.cloneElement(source));

        const title = clone.querySelector('label')!;
        const input = clone.querySelector('input')!;
        const hint = clone.querySelector('span')!;
        expect(title.id).not.toBe('title');
        expect(title.getAttribute('for')).toBe(input.id);
        // A reference to an id outside the clone stays as it is
        expect(input.getAttribute('aria-labelledby')).toBe(`${title.id} page-heading`);
        expect(input.getAttribute('aria-describedby')).toBe(hint.id);
      });

      it('should leave references to ids outside the clone alone', () => {
        const source = attach(document.createElement('div'));
        source.id = 'task-1';
        source.innerHTML =
          '<svg><use href="#sprite-check"></use><rect fill="url(#page-gradient)"></rect></svg>';

        const clone = attach(service.cloneElement(source));

        expect(clone.querySelector('use')!.getAttribute('href')).toBe('#sprite-check');
        expect(clone.querySelector('rect')!.getAttribute('fill')).toBe('url(#page-gradient)');
      });

      describe('styling by id', () => {
        // The clone's ids are not the row's, so it keeps the row's look through inline styles

        it("should keep the root's id-styled grid columns", () => {
          addStyles('#task { display: grid; grid-template-columns: 40px 120px; }');
          const source = attach(document.createElement('div'));
          source.id = 'task';
          source.innerHTML = '<span>Done</span><span>Title</span>';

          const clone = attach(service.cloneElement(source));

          expect(window.getComputedStyle(source).gridTemplateColumns).toBe('40px 120px');
          expect(window.getComputedStyle(clone).gridTemplateColumns).toBe('40px 120px');
        });

        it('should keep rules that reach descendants and siblings through an id', () => {
          addStyles(
            '#task .title { letter-spacing: 3px; }' +
              '#task > .meta { text-transform: uppercase; }' +
              '#flag + .after-flag { font-style: italic; }' +
              '#flag ~ .later { white-space: nowrap; }',
          );
          const source = attach(document.createElement('div'));
          source.id = 'task';
          source.innerHTML =
            '<span class="title">Title</span><span class="meta">Meta</span>' +
            '<i id="flag"></i><span class="after-flag">A</span><span class="later">B</span>';

          const clone = attach(service.cloneElement(source));

          const computed = (selector: string) =>
            window.getComputedStyle(clone.querySelector(selector)!);
          expect(computed('.title').letterSpacing).toBe('3px');
          expect(computed('.meta').textTransform).toBe('uppercase');
          expect(computed('.after-flag').fontStyle).toBe('italic');
          expect(computed('.later').whiteSpace).toBe('nowrap');
        });

        it('should keep the id-styled look of SVG elements', () => {
          addStyles('#icon path { stroke-width: 3px; }');
          const source = attach(document.createElement('div'));
          source.innerHTML = '<svg id="icon"><path d="M0 0h4"></path></svg>';

          const clone = attach(service.cloneElement(source));

          expect((clone.querySelector('path') as SVGElement).style.strokeWidth).toBe('3px');
        });

        it('should not move the root by its id-styled placement', () => {
          addStyles(
            '#task { position: absolute; top: 300px; left: 40px; margin: 6px 20px; ' +
              'translate: 10px 4px; }',
          );
          const source = attach(document.createElement('div'));
          source.id = 'task';

          const clone = attach(service.cloneElement(source));

          const computed = window.getComputedStyle(clone);
          expect(computed.position).toBe('relative');
          expect(computed.top).toBe('auto');
          expect(computed.left).toBe('auto');
          expect(computed.marginTop).toBe('0px');
          expect(computed.marginLeft).toBe('0px');
          expect(clone.style.translate).toBe('none');
        });

        it("should not make the clone's elements targets of pointer events", () => {
          const source = attach(document.createElement('div'));
          source.id = 'task';
          source.innerHTML = '<span>Title</span>';

          const clone = service.cloneElement(source);

          expect(clone.style.pointerEvents).toBe('');
          expect(clone.querySelector('span')!.style.pointerEvents).toBe('');
        });

        it('should not freeze the focus ring of a focused row', () => {
          addStyles('.row:focus { outline-style: solid; outline-width: 3px; }');
          const source = attach(document.createElement('div'));
          source.id = 'task';
          source.className = 'row';
          source.tabIndex = 0;
          source.focus();

          const clone = service.cloneElement(source);

          expect(window.getComputedStyle(source).outlineWidth).toBe('3px');
          expect(clone.style.outlineWidth).toBe('');
        });

        it('should keep an id-styled outline of a row that is not focused', () => {
          addStyles('#task { outline-style: solid; outline-width: 3px; }');
          const source = attach(document.createElement('div'));
          source.id = 'task';

          const clone = service.cloneElement(source);

          expect(clone.style.outlineWidth).toBe('3px');
        });

        it('should copy only the listed properties of a row without ids', () => {
          // Copying every property is costly, and class rules still match the clone
          addStyles('.row { display: grid; grid-template-columns: 40px 120px; }');
          const source = attach(document.createElement('div'));
          source.className = 'row';
          source.innerHTML = '<span>Title</span>';

          const clone = service.cloneElement(source);

          expect(clone.style.display).toBe('grid');
          expect(clone.style.gridTemplateColumns).toBe('');
        });
      });
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

    describe("the root's placement", () => {
      // The preview box is the row's border box (getBoundingClientRect()), so whatever placed
      // the row on the page would offset its clone inside that box.

      it('should not carry the margins of the root, while a child keeps its own', () => {
        addStyles(
          '.card { margin: 6px 20px; height: 38px; border: 2px solid; }' +
            '.card .label { margin: 4px 8px; }',
        );
        const source = attach(document.createElement('div'));
        source.className = 'card';
        source.innerHTML = '<span class="label">Label</span>';

        const clone = service.cloneElement(source);

        expect(clone.style.marginTop).toBe('0px');
        expect(clone.style.marginRight).toBe('0px');
        expect(clone.style.marginBottom).toBe('0px');
        expect(clone.style.marginLeft).toBe('0px');
        expect((clone.querySelector('.label') as HTMLElement).style.margin).toBe('4px 8px');
      });

      it('should not carry the inline position and offsets of the root, while a child keeps its own', () => {
        // A standalone *vdndVirtualFor row is placed this way
        const source = attach(document.createElement('div'));
        source.style.position = 'absolute';
        source.style.top = '1200px';
        source.style.left = '10px';
        source.style.right = '0px';
        source.innerHTML = '<span style="position: absolute; top: 5px; left: 3px">Badge</span>';

        const clone = service.cloneElement(source);

        expect(clone.style.position).toBe('relative');
        expect(clone.style.top).toBe('auto');
        expect(clone.style.left).toBe('auto');
        expect(clone.style.right).toBe('auto');
        expect(clone.style.bottom).toBe('auto');
        const badge = clone.querySelector('span') as HTMLElement;
        expect(badge.style.position).toBe('absolute');
        expect(badge.style.top).toBe('5px');
        expect(badge.style.left).toBe('3px');
      });

      it('should neutralize a position and offsets the root gets from a stylesheet', () => {
        // The clone keeps the row's classes, so their rules still apply to it
        addStyles('.row { position: fixed; top: 300px; left: 40px; }');
        const source = attach(document.createElement('div'));
        source.className = 'row';

        const clone = service.cloneElement(source);

        expect(clone.style.position).toBe('relative');
        expect(clone.style.top).toBe('auto');
        expect(clone.style.left).toBe('auto');
      });

      it('should keep a relatively positioned root a containing block', () => {
        addStyles('.row { position: relative; }');
        const source = attach(document.createElement('div'));
        source.className = 'row';

        const clone = attach(service.cloneElement(source));

        // Left to the class rule, which the clone keeps
        expect(clone.style.position).toBe('');
        expect(window.getComputedStyle(clone).position).toBe('relative');
      });

      it("should drop the translation of the root's transform but keep its rotation and scale", () => {
        fakeComputedStyles({ transform: 'matrix(0.96, 0.28, -0.28, 0.96, 12, 30)' });
        const source = attach(document.createElement('div'));

        const clone = service.cloneElement(source);

        expect(clone.style.transform).toBe('matrix(0.96, 0.28, -0.28, 0.96, 0, 0)');
      });

      it("should drop the translation of the root's 3D transform", () => {
        fakeComputedStyles({
          transform: 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 120, 4, 1)',
        });
        const source = attach(document.createElement('div'));

        const clone = service.cloneElement(source);

        expect(clone.style.transform).toBe(
          'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)',
        );
      });

      it("should keep a child's translation", () => {
        addStyles('.card .label { transform: translateX(4px); }');
        const source = attach(document.createElement('div'));
        source.className = 'card';
        source.innerHTML = '<span class="label">Label</span>';

        const clone = service.cloneElement(source);

        expect((clone.querySelector('.label') as HTMLElement).style.transform).toBe(
          'translateX(4px)',
        );
      });
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
