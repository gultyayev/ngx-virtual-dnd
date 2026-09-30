/**
 * Query by an exact attribute value without interpolating consumer data into a CSS selector.
 *
 * CSS attribute selectors need string-specific escaping that differs from `CSS.escape()`.
 * Filtering candidates by attribute presence avoids selector syntax errors for IDs containing
 * quotes, brackets, backslashes, or other selector-sensitive characters.
 */
export function queryByAttribute<T extends Element>(
  root: ParentNode,
  attributeName: string,
  attributeValue: string,
): T | null {
  const candidates = root.querySelectorAll<T>(`[${attributeName}]`);

  for (const candidate of candidates) {
    if (candidate.getAttribute(attributeName) === attributeValue) {
      return candidate;
    }
  }

  return null;
}

/**
 * The elements carrying an attribute, by its value (the first in document order when several
 * share one, as `queryByAttribute` finds). One query for many lookups, where `queryByAttribute`
 * scans every candidate on each call.
 */
export function mapByAttribute<T extends Element>(
  root: ParentNode,
  attributeName: string,
): Map<string, T> {
  const elements = new Map<string, T>();
  for (const candidate of root.querySelectorAll<T>(`[${attributeName}]`)) {
    const value = candidate.getAttribute(attributeName)!;
    if (!elements.has(value)) {
      elements.set(value, candidate);
    }
  }
  return elements;
}

export function queryAllByAttribute<T extends Element>(
  root: ParentNode,
  attributeName: string,
  attributeValue: string,
): T[] {
  return Array.from(root.querySelectorAll<T>(`[${attributeName}]`)).filter(
    (candidate) => candidate.getAttribute(attributeName) === attributeValue,
  );
}
