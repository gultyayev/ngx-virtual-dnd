import {
  Children,
  type KeyboardEvent,
  type ReactNode,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
} from 'react';

type ElementProps = { title?: string; children?: ReactNode };

/** The `title` of the code block in `node`. MDX wraps each block's `pre` in a fragment. */
function findTitle(node: ReactNode): string | undefined {
  if (!isValidElement<ElementProps>(node)) return undefined;
  if (node.props.title) return node.props.title;
  return Children.toArray(node.props.children).map(findTitle).find(Boolean);
}

/** `node` with the code block's title removed: the tab shows it instead. */
function withoutTitle(node: ReactNode): ReactNode {
  if (!isValidElement<ElementProps>(node)) return node;
  if (node.props.title) return cloneElement(node, { title: undefined });
  if (node.props.children === undefined) return node;
  return cloneElement(node, undefined, ...Children.toArray(node.props.children).map(withoutTitle));
}

/**
 * Code blocks as tabs, labelled by each block's `title`:
 *
 * <CodeTabs>
 * ```angular-html title="template.html"
 * …
 * ```
 * ```ts title="quick-start.ts"
 * …
 * ```
 * </CodeTabs>
 */
export default function CodeTabs({ children }: { children: ReactNode }) {
  const blocks = Children.toArray(children).filter((child) => isValidElement(child));
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  if (import.meta.env.SSG_MD) return <>{children}</>;

  const select = (index: number): void => {
    const next = (index + blocks.length) % blocks.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const keys: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: blocks.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(keys[event.key]);
  };

  return (
    <div className="vdnd-code-tabs">
      <div className="vdnd-code-tabs__bar" role="tablist" onKeyDown={onKeyDown}>
        {blocks.map((block, index) => (
          <button
            key={index}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={index === active}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={index === active ? 0 : -1}
            className="vdnd-code-tabs__tab"
            onClick={() => setActive(index)}
          >
            {findTitle(block) ?? `Tab ${index + 1}`}
          </button>
        ))}
      </div>
      {blocks.map((block, index) => (
        <div
          key={index}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={index !== active}
          className="vdnd-code-tabs__panel"
        >
          {withoutTitle(block)}
        </div>
      ))}
    </div>
  );
}
