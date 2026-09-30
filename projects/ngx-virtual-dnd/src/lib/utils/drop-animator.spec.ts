import { DropAnimator, findDropTarget, revealDropTargetIn } from './drop-animator';

interface FakeAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancel: jest.Mock;
  onfinish: (() => void) | null;
}

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }) as DOMRect;

describe('DropAnimator', () => {
  const originalAnimate = Element.prototype.animate;
  let animations: Map<Element, FakeAnimation[]>;

  const last = (el: Element): FakeAnimation => animations.get(el)!.at(-1)!;

  beforeEach(() => {
    animations = new Map();
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      const animation: FakeAnimation = { keyframes, options, cancel: jest.fn(), onfinish: null };
      animations.set(this, [...(animations.get(this) ?? []), animation]);
      return animation as unknown as Animation;
    } as typeof Element.prototype.animate;
  });

  afterEach(() => {
    Element.prototype.animate = originalAnimate;
  });

  const createGhost = (): HTMLElement => {
    const ghost = document.createElement('div');
    ghost.style.transform = 'translate3d(10px, 20px, 0px)';
    ghost.getBoundingClientRect = () => rect(10, 20, 200, 50);
    return ghost;
  };

  it('glides the ghost onto the target and hides the target meanwhile', () => {
    const ghost = createGhost();
    const element = document.createElement('div');
    const animator = new DropAnimator({ dropDuration: 150, dropEasing: 'linear' });

    animator.play(ghost, { element, rect: rect(40, 120, 180, 60) }, jest.fn());

    const glide = last(ghost);
    expect(glide.keyframes[0]).toEqual({
      transform: 'translate3d(10px, 20px, 0px) translate(0px, 0px)',
      width: '200px',
      height: '50px',
    });
    expect(glide.keyframes[1]).toEqual({
      transform: 'translate3d(10px, 20px, 0px) translate(30px, 100px)',
      width: '180px',
      height: '60px',
    });
    expect(glide.options).toEqual(
      expect.objectContaining({ duration: 150, easing: 'linear', fill: 'forwards' }),
    );
    expect(last(element).keyframes).toEqual([{ opacity: 0 }, { opacity: 0 }]);
    expect(last(element).options.duration).toBe(150);
  });

  it('fades the ghost out in place without a target', () => {
    const ghost = createGhost();
    const animator = new DropAnimator({});

    animator.play(ghost, null, jest.fn());

    expect(last(ghost).keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(last(ghost).options.duration).toBe(200);
  });

  it('reveals the target and reports completion when the glide finishes', () => {
    const ghost = createGhost();
    const element = document.createElement('div');
    const onDone = jest.fn();
    const animator = new DropAnimator({});
    animator.play(ghost, { element, rect: rect(0, 0, 200, 50) }, onDone);

    last(ghost).onfinish?.();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(last(element).cancel).toHaveBeenCalled();
  });

  it('cancel() reveals the target immediately without reporting completion', () => {
    const ghost = createGhost();
    const element = document.createElement('div');
    const onDone = jest.fn();
    const animator = new DropAnimator({});
    animator.play(ghost, { element, rect: rect(0, 0, 200, 50) }, onDone);
    const glide = last(ghost);

    animator.cancel();
    glide.onfinish?.();

    expect(glide.cancel).toHaveBeenCalled();
    expect(last(element).cancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('reveals the target when a pooled row holds it, and only then', () => {
    const ghost = createGhost();
    const row = document.createElement('div');
    const element = row.appendChild(document.createElement('div'));
    const animator = new DropAnimator({});
    animator.play(ghost, { element, rect: rect(0, 0, 200, 50) }, jest.fn());
    const hide = last(element);

    revealDropTargetIn([document.createElement('div')]);
    expect(hide.cancel).not.toHaveBeenCalled();

    revealDropTargetIn([document.createComment('anchor'), row]);
    expect(hide.cancel).toHaveBeenCalled();
    // The ghost still glides
    expect(last(ghost).cancel).not.toHaveBeenCalled();
  });

  it('is disabled when the duration is 0', () => {
    expect(new DropAnimator({ dropDuration: 0 }).isEnabled()).toBe(false);
    expect(new DropAnimator({}).isEnabled()).toBe(true);
  });

  it('is disabled when the user prefers reduced motion', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    try {
      expect(new DropAnimator({}).isEnabled()).toBe(false);
      expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('queries the reduced-motion preference once, and follows its changes', () => {
    const originalMatchMedia = window.matchMedia;
    // A MediaQueryList is live: its `matches` follows the preference
    const query = { matches: false };
    window.matchMedia = jest.fn().mockReturnValue(query);
    try {
      const animator = new DropAnimator({});
      expect(animator.isEnabled()).toBe(true);

      query.matches = true;

      expect(animator.isEnabled()).toBe(false);
      expect(window.matchMedia).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});

describe('findDropTarget', () => {
  /** Stands in for the droppable registry lookup. */
  const lists = new Map<string, HTMLElement>();
  const getDroppable = (id: string): HTMLElement | null => lists.get(id) ?? null;

  const createList = (id: string, bounds: DOMRect, parent: Node = document.body): HTMLElement => {
    const list = document.createElement('div');
    list.setAttribute('data-droppable-id', id);
    list.getBoundingClientRect = () => bounds;
    parent.appendChild(list);
    lists.set(id, list);
    return list;
  };

  const addItem = (list: HTMLElement, id: string, box: DOMRect): HTMLElement => {
    const item = document.createElement('div');
    item.setAttribute('data-draggable-id', id);
    item.getBoundingClientRect = () => box;
    list.appendChild(item);
    return item;
  };

  afterEach(() => {
    document.body.innerHTML = '';
    lists.clear();
  });

  it('finds the item in the first listed droppable that renders it', () => {
    const source = createList('source', rect(0, 0, 200, 400));
    const target = createList('target', rect(300, 0, 200, 400));
    addItem(source, 'item-1', rect(0, 0, 200, 50));
    const landed = addItem(target, 'item-1', rect(300, 100, 200, 50));

    const result = findDropTarget('item-1', ['target', 'source'], getDroppable);

    expect(result?.element).toBe(landed);
    expect(result?.rect.top).toBe(100);
  });

  it('falls back to the source list when the destination does not render the item', () => {
    const source = createList('source', rect(0, 0, 200, 400));
    createList('target', rect(300, 0, 200, 400));
    const original = addItem(source, 'item-1', rect(0, 50, 200, 50));

    expect(findDropTarget('item-1', ['target', 'source'], getDroppable)?.element).toBe(original);
  });

  it('finds the item in a list the lookup returns from inside a shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const list = createList('list', rect(0, 0, 200, 400), shadow);
    const item = addItem(list, 'item-1', rect(0, 50, 200, 50));

    expect(findDropTarget('item-1', ['list'], getDroppable)?.element).toBe(item);
  });

  it('returns null when the item is scrolled out of its list', () => {
    const list = createList('list', rect(0, 0, 200, 400));
    addItem(list, 'item-1', rect(0, 450, 200, 50));

    expect(findDropTarget('item-1', ['list'], getDroppable)).toBeNull();
  });

  it('returns null when the item is hidden or not rendered anywhere', () => {
    const list = createList('list', rect(0, 0, 200, 400));
    addItem(list, 'hidden', rect(0, 0, 0, 0));

    expect(findDropTarget('hidden', ['list'], getDroppable)).toBeNull();
    expect(findDropTarget('missing', ['list', null], getDroppable)).toBeNull();
  });
});
