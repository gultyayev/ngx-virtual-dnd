/**
 * Styles plain-Markdown conventions of the docs, so the sources (and the Markdown output for
 * llms.txt) stay plain Markdown:
 *
 * - `**Selector:** \`vdnd-x\`` paragraphs get the `vdnd-api-selector` class (label + chip);
 * - `**required**` alone in a table cell gets the `vdnd-required` class (an outlined badge),
 *   and a cell that is only "—" gets `vdnd-api-none` (a faint dash);
 * - the cells of a table's "Type" and "Default" columns get `vdnd-api-type` and
 *   `vdnd-api-default`, and code in a cell can wrap after `<` and `.` (`<wbr>`);
 * - a long camelCase word in a heading (a class name) can wrap between its words (`<wbr>`).
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

/** Break opportunities in code: after `<` before a name (`TemplateRef<VirtualScroll…`) and
 * after `.` before a name (`DropEvent.destination`). */
const CODE_BREAK = /(?<=[<.])(?=[A-Za-z(])/;

/** Break opportunities in a long identifier: before each word of a camelCase name. */
const CAMEL_BREAK = /(?<=[a-z])(?=[A-Z])/;

/** Headings words at least this long get camelCase break opportunities. */
const LONG_WORD = 20;

/** Table header text → class for the cells of that column. */
const COLUMN_CLASSES: Record<string, string> = {
  type: 'vdnd-api-type',
  default: 'vdnd-api-default',
};

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

function wbr(): HastElement {
  return { type: 'element', tagName: 'wbr', properties: {}, children: [] };
}

function addClass(node: HastElement, className: string): void {
  const current = node.properties['className'];
  const list = Array.isArray(current) ? current : current ? [current] : [];
  node.properties = { ...node.properties, className: [...list, className] };
}

function textOf(node: HastNode): string {
  if (isText(node)) return node.value;
  return 'children' in node ? (node.children ?? []).map(textOf).join('') : '';
}

/** `parts` joined by `<wbr>` elements. */
function withBreaks(parts: string[]): HastNode[] {
  return parts.flatMap((part, index) => (index === 0 ? [text(part)] : [wbr(), text(part)]));
}

/** A cell that is only a dash ("no default") gets `vdnd-api-none`. */
function emptyCell(cell: HastElement): void {
  if (textOf(cell).trim() === '—') addClass(cell, 'vdnd-api-none');
}

function requiredBadge(cell: HastElement): void {
  const content = cell.children.filter((child) => !isText(child) || child.value.trim() !== '');
  const [strong] = content;
  if (content.length !== 1 || !isElement(strong, 'strong')) return;
  if (textOf(strong).trim() !== 'required') return;
  addClass(strong, 'vdnd-required');
}

/** Marks a break point while splitting; never part of the docs' text. */
const BREAK = '\u0000';

/** `value` split where code may wrap: after `<` and `.`, and between the words of a long name. */
function codeParts(value: string): string[] {
  return value
    .replace(new RegExp(`\\w{${LONG_WORD},}`, 'g'), (name) => name.split(CAMEL_BREAK).join(BREAK))
    .split(CODE_BREAK)
    .join(BREAK)
    .split(BREAK);
}

/** Lets code in a table cell wrap after `<` and `.`, and inside a long name between its words,
 * instead of mid-word. */
function codeBreaks(cell: HastElement): void {
  for (const code of cell.children) {
    if (!isElement(code, 'code')) continue;
    code.children = code.children.flatMap((child): HastNode[] =>
      isText(child) ? withBreaks(codeParts(child.value)) : [child],
    );
  }
}

function apiColumns(table: HastElement): void {
  const head = table.children.find((child) => isElement(child, 'thead'));
  const body = table.children.find((child) => isElement(child, 'tbody'));
  if (!isElement(head) || !isElement(body)) return;
  const headRow = head.children.find((child) => isElement(child, 'tr'));
  if (!isElement(headRow)) return;
  const columns = headRow.children
    .filter((cell) => isElement(cell, 'th'))
    .map((cell) => COLUMN_CLASSES[textOf(cell).trim().toLowerCase()]);
  if (!columns.some(Boolean)) return;
  for (const row of body.children) {
    if (!isElement(row, 'tr')) continue;
    row.children
      .filter((cell): cell is HastElement => isElement(cell, 'td'))
      .forEach((cell, index) => {
        const className = columns[index];
        if (className) addClass(cell, className);
      });
  }
}

/**
 * Lets a long camelCase name in a heading wrap between its words on narrow screens. The name is
 * wrapped in a span: the outline copies the heading's HTML and renders it as HTML only when it
 * holds an element pair, so a bare `<wbr>` would show up there as text.
 */
function headingBreaks(heading: HastElement): void {
  heading.children = heading.children.flatMap((child): HastNode[] => {
    if (!isText(child)) return [child];
    return child.value
      .split(/(\s+)/)
      .filter((word) => word !== '')
      .map((word) =>
        word.length >= LONG_WORD
          ? element('span', 'vdnd-name', withBreaks(word.split(CAMEL_BREAK)))
          : text(word),
      );
  });
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
  if (isElement(node, 'table')) apiColumns(node);
  if (isElement(node, 'td')) {
    requiredBadge(node);
    emptyCell(node);
    codeBreaks(node);
  }
  if (isElement(node, 'h2') || isElement(node, 'h3')) headingBreaks(node);
  if (isElement(node, 'p')) selectorLine(node);
  if ('children' in node) node.children?.forEach(visit);
}

export function rehypeApiDetails() {
  return (tree: HastNode): void => visit(tree);
}
