import {
  type CodeBlockProps,
  CodeButtonGroup,
  IconArrowDown,
  SvgWrapper,
  useCodeButtonGroup,
} from '@rspress/core/theme-original';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconFile } from './icons';
// The base code block styles ship with the component this one replaces.
import '@rspress/core/dist/theme/components/CodeBlock/index.css';

const DEFAULT_FOLD_HEIGHT = 300;

/** Shiki language IDs shown as the language a reader knows. */
const LANG_LABELS: Record<string, string> = {
  'angular-ts': 'ts',
  'angular-html': 'html',
  typescript: 'ts',
  javascript: 'js',
  shell: 'sh',
  bash: 'sh',
};

/** Languages that get no label: plain text, or a label that adds nothing. */
const UNLABELLED = new Set(['txt', 'text', 'plaintext', '']);

/** `src/app/x/quick-start.ts` → the directory part in a muted color, the file name in full. */
function CodeTitle({ title }: { title: string }) {
  const slash = title.lastIndexOf('/');
  const isPath = slash > 0 && !title.includes(' ');
  return (
    <span className="vdnd-codeblock__path">
      {isPath ? (
        <>
          <span className="vdnd-codeblock__dir">{title.slice(0, slash + 1)}</span>
          <span className="vdnd-codeblock__file">{title.slice(slash + 1)}</span>
        </>
      ) : (
        <span className="vdnd-codeblock__file">{title}</span>
      )}
    </span>
  );
}

/**
 * Replaces Rspress's CodeBlock (same props and fold behavior). A titled block shows a title bar
 * with a file icon, the path and the copy button; an untitled one shows its language in the
 * corner, and its buttons on hover.
 */
export function CodeBlock({
  containerElementClassName,
  title,
  lang = 'txt',
  wrapCode: wrapCodeProp = false,
  lineNumbers = false,
  fold = false,
  height,
  codeButtonGroupProps,
  children,
}: CodeBlockProps) {
  const { wrapCode, toggleWrapCode, copyElementRef } = useCodeButtonGroup(wrapCodeProp);
  const [expanded, setExpanded] = useState(false);
  const [needFold, setNeedFold] = useState(false);
  const codeBlockRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasScroll = !fold && height !== undefined;
  const label = LANG_LABELS[lang] ?? lang;

  useEffect(() => {
    if (!fold || !contentRef.current) {
      setNeedFold(false);
      return;
    }
    setNeedFold(contentRef.current.scrollHeight > (height ?? DEFAULT_FOLD_HEIGHT));
  }, [fold, height]);

  const toggleFold = useCallback(() => {
    if (!expanded) {
      setExpanded(true);
      return;
    }
    setExpanded(false);
    requestAnimationFrame(() => {
      const top = codeBlockRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) window.scrollBy({ top: top - 16, behavior: 'smooth' });
    });
  }, [expanded]);

  if (import.meta.env.SSG_MD) return <>{children}</>;

  const buttons = (
    <CodeButtonGroup
      {...codeButtonGroupProps}
      // Wrapping is offered on hover in untitled blocks; the title bar keeps only copy.
      showWrapCodeButton={title ? false : codeButtonGroupProps?.showWrapCodeButton}
      copyElementRef={copyElementRef}
      wrapCode={wrapCode}
      toggleWrapCode={toggleWrapCode}
    />
  );
  const folded = needFold && !expanded;
  const maxHeight = folded ? (height ?? DEFAULT_FOLD_HEIGHT) : hasScroll ? height : undefined;

  return (
    <div
      ref={codeBlockRef}
      className={[
        'rp-codeblock',
        `language-${lang}`,
        title ? 'vdnd-codeblock--titled' : '',
        containerElementClassName ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {title ? (
        <div className="rp-codeblock__title">
          <IconFile size={14} className="vdnd-codeblock__icon" />
          <CodeTitle title={title} />
          {buttons}
        </div>
      ) : (
        !UNLABELLED.has(label) && (
          <span className="vdnd-codeblock__lang" aria-hidden="true">
            {label}
          </span>
        )
      )}
      <div
        ref={contentRef}
        className={[
          'rp-codeblock__content',
          wrapCode ? 'rp-codeblock__content--wrap-code' : '',
          lineNumbers ? 'rp-codeblock__content--line-numbers' : '',
          folded ? 'rp-codeblock__content--fold' : '',
          hasScroll ? 'rp-codeblock__content--scroll' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={maxHeight === undefined ? undefined : { maxHeight }}
      >
        <div
          ref={copyElementRef}
          className="rp-codeblock__content__scroll-container rp-scrollbar rp-scrollbar--always"
        >
          {children}
        </div>
        {!title && buttons}
      </div>
      {needFold && (
        <button
          type="button"
          className={`rp-codeblock__fold-btn${expanded ? ' rp-codeblock__fold-btn--expanded' : ''}`}
          onClick={toggleFold}
          aria-label={expanded ? 'Collapse code' : 'Expand code'}
          aria-expanded={expanded}
        >
          <SvgWrapper icon={IconArrowDown} className="rp-codeblock__fold-btn__icon" />
        </button>
      )}
    </div>
  );
}
