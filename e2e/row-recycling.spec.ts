import { expect, Page, test } from '@playwright/test';
import { DemoPage, ListName } from './fixtures/demo.page';
import { poll } from './fixtures/polling';

/** Rows scroll through recycled views (`recycleRows`) in both API modes of the main demo. */
for (const api of ['verbose', 'simplified'] as const) {
  test.describe(`Row recycling (${api} API)`, () => {
    let demoPage: DemoPage;

    test.beforeEach(async ({ page }) => {
      demoPage = new DemoPage(page);
      await demoPage.goto({ api, recycleRows: true });
    });

    /** Tag the row elements rendered now, to recognize them after a scroll */
    async function tagRenderedRows(list: ListName): Promise<number> {
      return demoPage.virtualScroll(list).evaluate((container) => {
        const rows = Array.from(container.querySelectorAll('[data-draggable-id]'));
        rows.forEach((row) => row.setAttribute('data-test-tagged', ''));
        return rows.length;
      });
    }

    /** Scroll a list so `firstId` renders, and wait for that render */
    async function scrollTo(list: ListName, scrollTop: number, firstId: string): Promise<void> {
      await expect(async () => {
        await demoPage.scrollList(list, scrollTop);
        expect(await demoPage.getScrollTop(list)).toBe(scrollTop);
      }).toPass({ timeout: 2000 });
      await expect(demoPage.page.locator(`[data-draggable-id="${firstId}"]`)).toBeAttached();
    }

    /** ID of a tagged row (so a recycled one, after a scroll) fully in the list's visible area */
    async function visibleTaggedRowId(list: ListName): Promise<string> {
      const id = await demoPage.virtualScroll(list).evaluate((container) => {
        const view = container.getBoundingClientRect();
        const row = Array.from(container.querySelectorAll('[data-test-tagged]')).find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.height > 0 && rect.top >= view.top && rect.bottom <= view.bottom;
        });
        return row?.getAttribute('data-draggable-id') ?? null;
      });
      if (!id) {
        throw new Error(`${list} shows no recycled row`);
      }
      return id;
    }

    /** Every rendered row shows its own item: `list1-22` is named "Item 23" */
    async function expectRowsShowTheirItems(page: Page): Promise<void> {
      const mismatches = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-draggable-id]'))
          .map((row) => ({
            id: row.getAttribute('data-draggable-id') ?? '',
            text: row.querySelector('[data-testid="demo-item-text"]')?.textContent?.trim() ?? '',
          }))
          .filter(({ id, text }) => text !== `Item ${Number(id.split('-')[1]) + 1}`),
      );
      expect(mismatches, 'rows showing another item than their ID').toEqual([]);
    }

    test('renders the rows that scroll in with the elements of the rows that scroll out', async ({
      page,
    }) => {
      const tagged = await tagRenderedRows('list1');

      // Row 20 at the top: every row rendered before has left the range
      await scrollTo('list1', 1000, 'list1-20');

      await expect(demoPage.list1Container.locator('[data-draggable-id="list1-0"]')).toHaveCount(0);
      await expect(demoPage.list1Container.locator('[data-test-tagged]')).toHaveCount(tagged);
      await expectRowsShowTheirItems(page);
      expect(await demoPage.coversVisibleArea('list1')).toBe(true);
    });

    test('does not carry focus over to the item a recycled row renders next', async ({ page }) => {
      const first = demoPage.list1Container.locator('[data-draggable-id="list1-0"]');
      await first.evaluate((row: HTMLElement) => row.focus({ preventScroll: true }));
      await expect(first).toBeFocused();

      await scrollTo('list1', 1000, 'list1-20');

      const focusedId = await page.evaluate(() =>
        document.activeElement?.getAttribute('data-draggable-id'),
      );
      expect(focusedId ?? null).toBeNull();
    });

    test('drags the item a recycled row renders', async () => {
      await tagRenderedRows('list1');
      await scrollTo('list1', 1000, 'list1-20');
      const id = await visibleTaggedRowId('list1');
      const sourceIndex = Number(id.split('-')[1]);

      const index = (await demoPage.getItemIds('list1')).indexOf(id);
      await demoPage.dragItemToList('list1', index, 'list2', 0);

      await expect(demoPage.host).toHaveAttribute(
        'data-last-drop-source-index',
        String(sourceIndex),
      );
      await expect(demoPage.countBadge('list2')).toHaveText('51');
      await poll(() => demoPage.getItemId('list2', 0)).toBe(id);
      await expectRowsShowTheirItems(demoPage.page);
    });

    test('keyboard-drags the item a recycled row renders', async ({ page }) => {
      await tagRenderedRows('list1');
      await scrollTo('list1', 1000, 'list1-20');
      const id = await visibleTaggedRowId('list1');
      const sourceIndex = Number(id.split('-')[1]);
      const source = demoPage.list1Container.locator(`[data-draggable-id="${id}"]`);
      await source.evaluate((row: HTMLElement) => row.focus({ preventScroll: true }));

      await page.keyboard.press('Space');
      await expect(demoPage.dragPreview).toBeVisible();
      await demoPage.keyboardMoveDown(2);
      await demoPage.keyboardDrop();
      await expect(demoPage.dragPreview).not.toBeVisible();

      await expect(demoPage.host).toHaveAttribute(
        'data-last-drop-source-index',
        String(sourceIndex),
      );
      await expect(demoPage.host).toHaveAttribute(
        'data-last-drop-destination-index',
        String(sourceIndex + 2),
      );
      await poll(() => demoPage.getRenderedIndexOf('list1', id)).toBe(sourceIndex + 2);
      await expectRowsShowTheirItems(page);
    });

    test('drops at the right place after the drag scrolled rows through recycled views', async ({
      page,
    }) => {
      await demoPage.startKeyboardDrag('list1', 0);
      await expect(demoPage.dragPreview).toBeVisible();

      // Far past the rendered rows: the list scrolls, recycling rows, while the item is dragged
      await demoPage.keyboardMoveDown(30);
      await poll(() => demoPage.getScrollTop('list1')).toBeGreaterThan(1000);
      await demoPage.keyboardDrop();
      await expect(demoPage.dragPreview).not.toBeVisible();

      await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '30');
      await poll(() => demoPage.getRenderedIndexOf('list1', 'list1-0')).toBe(30);
      await expectRowsShowTheirItems(page);
    });
  });
}
