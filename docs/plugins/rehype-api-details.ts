/**
 * Styles two plain-Markdown conventions of the API pages, so the sources (and the Markdown
 * output for llms.txt) stay plain Markdown:
 *
 * - `**Selector:** \`vdnd-x\`` paragraphs get the `vdnd-api-selector` class (label + chip);
 * - a table cell ending in "Added in 3.3.0" shows the version as a `vdnd-since` badge
 *   (screen readers still read "Added in 3.3.0").
 */
interface HastText {
  type: 'text';
  value: string;
}

interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

interface HastOther {
  type: string;
  children?: HastNode[];
}

type HastNode = HastText | HastElement | HastOther;

const ADDED_IN = /\s*Added in (\d+\.\d+\.\d+)\.?\s*$/;

function isElement(node: HastNode | undefined, tagName?: string): node is HastElement {
  return node?.type === 'element' && (!tagName || (node as HastElement).tagName === tagName);
}

function isText(node: HastNode | undefined): node is HastText {
  return node?.type === 'text';
}

function element(tagName: string, className: string, children: HastNode[]): HastElement {
  return { type: 'element', tagName, properties: { className: [className] }, children };
}

function text(value: string): HastText {
  return { type: 'text', value };
}

function sinceBadge(cell: HastElement): void {
  const last = cell.children.at(-1);
  if (!isText(last)) return;
  const match = ADDED_IN.exec(last.value);
  if (!match) return;
  last.value = last.value.slice(0, match.index);
  cell.children.push(
    element('span', 'vdnd-since', [
      element('span', 'vdnd-sr-only', [text('Added in ')]),
      text(match[1]),
    ]),
  );
}

function selectorLine(paragraph: HastElement): void {
  if (paragraph.children.length !== 3) return;
  const [label, space, name] = paragraph.children;
  if (!isElement(label, 'strong') || !isText(space) || !isElement(name, 'code')) return;
  const labelText = label.children[0];
  if (label.children.length !== 1 || !isText(labelText) || labelText.value !== 'Selector:') return;
  paragraph.properties = { ...paragraph.properties, className: ['vdnd-api-selector'] };
  label.children = [text('Selector'), element('span', 'vdnd-api-selector__colon', [text(':')])];
}

function visit(node: HastNode): void {
  if (isElement(node, 'td')) sinceBadge(node);
  if (isElement(node, 'p')) selectorLine(node);
  if ('children' in node) node.children?.forEach(visit);
}

export function rehypeApiDetails() {
  return (tree: HastNode): void => visit(tree);
}
