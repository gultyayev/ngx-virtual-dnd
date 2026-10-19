import { expect, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';

/**
 * The default preview is a clone of the row. Its ids are namespaced so they never repeat an id
 * of the document, references inside it follow them, and rules that style the row through an id
 * (the clone no longer matches) keep their effect: the clone looks like the row, pseudo-elements
 * included. The rows of the main demo get ids and id-based rules here.
 */
test.describe('Drag preview of a row with ids', () => {
  let demoPage: DemoPage;

  test.beforeEach(async ({ page }) => {
    demoPage = new DemoPage(page);
    await demoPage.goto();
  });

  test('keeps the id-styled look of the row without repeating its ids', async ({ page }) => {
    const id = await demoPage.getItemId('list1', 0);
    const row = page.locator(`[data-draggable-id="${id}"]`);
    await row.evaluate((element) => {
      element.id = 'e2e-row';
      element.insertAdjacentHTML(
        'beforeend',
        '<i id="e2e-flag"></i><span data-e2e="after-flag">Flag</span>' +
          '<svg width="12" height="12"><defs>' +
          '<linearGradient id="e2e-fill"><stop offset="0" stop-color="red"></stop></linearGradient>' +
          '<rect id="e2e-shape" width="12" height="12"></rect></defs>' +
          '<rect data-e2e="filled" width="12" height="12" fill="url(#e2e-fill)"></rect>' +
          '<use data-e2e="use" href="#e2e-shape"></use></svg>',
      );
      const style = document.createElement('style');
      style.textContent =
        '#e2e-row { letter-spacing: 4px; outline: 2px dashed rgb(0, 128, 0); }' +
        '#e2e-row::before { content: "*"; color: rgb(255, 0, 0); }' +
        '#e2e-flag + [data-e2e="after-flag"] { font-style: italic; }' +
        '#e2e-flag::after { content: "!"; }';
      document.head.appendChild(style);
    });

    await demoPage.startDrag(row);

    const preview = await demoPage.dragPreview.evaluate((box) => {
      const clone = box.querySelector<HTMLElement>(':scope > * > *');
      if (!clone) {
        return null;
      }
      const query = (selector: string) => clone.querySelector(selector)!;
      const ids = [clone, ...Array.from(clone.querySelectorAll('[id]'))].map((el) => el.id);
      return {
        ids,
        duplicated: ids.filter((id) => document.querySelectorAll(`[id="${id}"]`).length !== 1),
        letterSpacing: getComputedStyle(clone).letterSpacing,
        outlineStyle: getComputedStyle(clone).outlineStyle,
        before: getComputedStyle(clone, '::before').content,
        beforeColor: getComputedStyle(clone, '::before').color,
        afterFlag: getComputedStyle(query('[data-e2e="after-flag"]')).fontStyle,
        flagAfter: getComputedStyle(query('i'), '::after').content,
        gradientId: query('linearGradient').id,
        fill: getComputedStyle(query('[data-e2e="filled"]')).fill,
        shapeId: query('defs rect').id,
        useHref: query('[data-e2e="use"]').getAttribute('href'),
      };
    });

    expect(preview).not.toBeNull();
    expect(preview!.ids).toHaveLength(4);
    expect(preview!.ids).not.toContain('e2e-row');
    expect(preview!.duplicated).toEqual([]);
    expect(preview!.letterSpacing).toBe('4px');
    expect(preview!.outlineStyle).toBe('dashed');
    expect(preview!.before).toBe('"*"');
    expect(preview!.beforeColor).toBe('rgb(255, 0, 0)');
    expect(preview!.afterFlag).toBe('italic');
    expect(preview!.flagAfter).toBe('"!"');
    expect(preview!.gradientId).not.toBe('e2e-fill');
    expect(preview!.fill).toContain(`#${preview!.gradientId}`);
    expect(preview!.shapeId).not.toBe('e2e-shape');
    expect(preview!.useHref).toBe(`#${preview!.shapeId}`);

    await page.mouse.up();
    await expect(demoPage.dragPreview).not.toBeVisible();
  });
});
