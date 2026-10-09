import { expect, test } from '@playwright/test';
import { PerfPage } from '../perf/fixtures/perf.page';
import { runScenario } from '../perf/fixtures/scenario';
import { MetricsCollector } from '../perf/fixtures/metrics-collector';

test.describe('Benchmark workload delivery', () => {
  test('follows the same logical scroll checkpoints with different geometry and no overscan', async ({
    page,
  }) => {
    const expectedRows = Array.from({ length: 8 }, (_, i) => `row-${(i + 1) * 2}`);
    const distances: number[] = [];
    for (const geometry of [
      { height: 50, padding: 0 },
      { height: 75, padding: 45 },
    ]) {
      await page.setContent(
        '<div data-testid="virtual-scrollport" style="height:100px;overflow:auto;overflow-anchor:none"><div data-testid="virtual-content" style="position:relative"></div></div>',
      );
      await page.evaluate(({ height, padding }) => {
        const viewport = document.querySelector<HTMLElement>('[data-testid="virtual-scrollport"]')!;
        const content = document.querySelector<HTMLElement>('[data-testid="virtual-content"]')!;
        content.style.height = `${30 * height + padding}px`;
        const render = () => {
          const first = Math.max(0, Math.floor((viewport.scrollTop - padding) / height));
          const end = Math.min(
            30,
            Math.ceil((viewport.scrollTop + viewport.clientHeight - padding) / height),
          );
          content.replaceChildren(
            ...Array.from({ length: end - first }, (_, offset) => {
              const index = first + offset;
              const row = document.createElement('div');
              row.dataset['draggableId'] = `row-${index}`;
              row.style.cssText = `position:absolute;top:${padding + index * height}px;height:${height}px;width:100%`;
              row.textContent = String(index);
              return row;
            }),
          );
        };
        viewport.addEventListener('scroll', render);
        render();
      }, geometry);
      const evidence = await new PerfPage(page).scrollCheckpoints({
        selector: '[data-testid="virtual-scrollport"]',
        checkpoints: 8,
        rowPrefix: 'row-',
        rowStep: 2,
      });
      expect(evidence['operations']).toBe(8);
      expect(evidence['checkpointRows']).toEqual(expectedRows);
      expect(evidence['finalTargetRow']).toBe('row-16');
      expect(evidence['maxCheckpointOffsetPx']).toBeLessThanOrEqual(2);
      distances.push(Number(evidence['scrollDistance']));
    }
    expect(distances[0]).toBeLessThan(distances[1]);
  });

  test('settles target alignment when an already rendered row shifts after a scroll update', async ({
    page,
  }) => {
    await page.setContent(
      `<div data-testid="settling-scrollport" style="height:100px;overflow:auto;overflow-anchor:none"><div data-testid="settling-content">${Array.from({ length: 10 }, (_, i) => `<div data-draggable-id="row-${i}" style="height:50px">${i}</div>`).join('')}</div></div>`,
    );
    await page.evaluate(() => {
      const viewport = document.querySelector('[data-testid="settling-scrollport"]')!;
      const content = document.querySelector<HTMLElement>('[data-testid="settling-content"]')!;
      viewport.addEventListener(
        'scroll',
        () => {
          requestAnimationFrame(() => {
            content.style.paddingTop = '40px';
          });
        },
        { once: true },
      );
    });
    const evidence = await new PerfPage(page).scrollCheckpoints({
      selector: '[data-testid="settling-scrollport"]',
      checkpoints: 1,
      rowPrefix: 'row-',
    });
    expect(evidence['checkpointRows']).toEqual(['row-1']);
    expect(evidence['maxCheckpointOffsetPx']).toBeLessThanOrEqual(2);
    const offset = await page
      .getByTestId('settling-scrollport')
      .evaluate(
        (viewport) =>
          viewport.querySelector('[data-draggable-id="row-1"]')!.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top,
      );
    expect(Math.abs(offset)).toBeLessThanOrEqual(2);
  });

  test('records actual drop attributes and the item observed in the destination', async ({
    page,
  }) => {
    await page.setContent(
      '<main data-testid="drop-host" data-last-drop-source-index="3" data-last-drop-destination-index="7"><div data-droppable-id="observed-target"><div data-draggable-id="observed-source-3"></div></div></main>',
    );
    const outcome = await new PerfPage(page).observeDrop({
      hostSelector: '[data-testid="drop-host"]',
      destinationDroppableId: 'observed-target',
      sourceId: 'observed-source-3',
    });
    expect(outcome).toEqual({
      sourceIndex: 3,
      destinationIndex: 7,
      sourceId: 'observed-source-3',
      completed: true,
    });
    await page
      .getByTestId('drop-host')
      .evaluate((host) => host.removeAttribute('data-last-drop-source-index'));
    await expect(
      new PerfPage(page).observeDrop({
        hostSelector: '[data-testid="drop-host"]',
        destinationDroppableId: 'observed-target',
        sourceId: 'observed-source-3',
      }),
    ).rejects.toThrow('Missing or invalid drop outcome data-last-drop-source-index');
    await page
      .getByTestId('drop-host')
      .evaluate((host) => host.setAttribute('data-last-drop-source-index', '3'));
    await page.locator('[data-draggable-id="observed-source-3"]').evaluate((row) => row.remove());
    await expect(
      new PerfPage(page).observeDrop({
        hostSelector: '[data-testid="drop-host"]',
        destinationDroppableId: 'observed-target',
        sourceId: 'observed-source-3',
      }),
    ).rejects.toThrow('not observed in destination');
  });

  test('records positive-control work as script, a long task, and a frame stall', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Renderer counters use the Chromium CDP protocol');
    const previousControl = process.env['PERF_CONTROL_WORK_MS'];
    process.env['PERF_CONTROL_WORK_MS'] = '150';
    const collector = new MetricsCollector(page);
    try {
      await page.setContent('<main>Positive-control measurement</main>');
      await collector.init();
      await collector.setCpuThrottling(1);
      const sample = await collector.measureScenario(async () => {
        await new PerfPage(page).waitForFrames(3);
        return { operations: 1, completed: true };
      });
      // These are detection floors for one known 150 ms task, rather than
      // assertions on exact timings that vary with browser/runner scheduling.
      expect(sample.scriptDuration).toBeGreaterThanOrEqual(125);
      expect(sample.longTasks.some((task) => task.duration >= 100)).toBe(true);
      expect(sample.totalBlockingTime).toBeGreaterThanOrEqual(50);
      expect(sample.maxFrameGap).toBeGreaterThanOrEqual(100);
      expect(sample.frameOverBudgetMs).toBeGreaterThanOrEqual(80);
      expect(sample.workload['injectedWorkMs']).toBe(150);
    } finally {
      try {
        await collector.dispose();
      } finally {
        if (previousControl === undefined) delete process.env['PERF_CONTROL_WORK_MS'];
        else process.env['PERF_CONTROL_WORK_MS'] = previousControl;
      }
    }
  });

  test('throttles measured work and snapshots while leaving browser preparation at normal speed', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'CPU throttling uses the Chromium CDP protocol');
    const context = page.context();
    const originalNewSession = context.newCDPSession;
    const previousIterations = process.env['PERF_ITERATIONS'];
    const previousWarmups = process.env['PERF_WARMUP_ITERATIONS'];
    let acknowledgedRate = Number.NaN;
    const phases = { setup: [] as number[], work: [] as number[], verify: [] as number[] };
    const counterRates: number[] = [];
    // Keep real protocol calls: record only rates acknowledged by Chromium, not mocked
    // collector state or timing ratios that fluctuate with runner speed.
    context.newCDPSession = async (target) => {
      const session = await originalNewSession.call(context, target);
      const originalSend = session.send.bind(session);
      session.send = (async (...args: Parameters<typeof originalSend>) => {
        const result = await originalSend(...args);
        if (args[0] === 'Emulation.setCPUThrottlingRate') {
          acknowledgedRate = Number((args[1] as { rate: number }).rate);
        }
        if (args[0] === 'Performance.getMetrics') counterRates.push(acknowledgedRate);
        return result;
      }) as typeof session.send;
      return session;
    };
    process.env['PERF_ITERATIONS'] = '1';
    process.env['PERF_WARMUP_ITERATIONS'] = '1';
    try {
      const perfPage = new PerfPage(page);
      await runScenario(
        page,
        testInfo,
        {
          scenario: 'cpu-throttle-phase-probe',
          kind: 'fixed-work',
          cpuThrottle: 4,
          workload: { operations: 1 },
        },
        {
          setup: async () => {
            phases.setup.push(acknowledgedRate);
            await page.setContent('<main>Prepared benchmark document</main>');
            await perfPage.waitForFrames();
          },
          run: async () => {
            phases.work.push(acknowledgedRate);
            await perfPage.waitForFrames(3);
            return { operations: 1, completed: true };
          },
          verify: async () => {
            phases.verify.push(acknowledgedRate);
            await expect(page.locator('main')).toHaveText('Prepared benchmark document');
          },
        },
      );
      expect(phases).toEqual({ setup: [1, 1], work: [4, 4], verify: [1, 1] });
      expect(counterRates).toEqual([4, 4, 4, 4]);
      expect(acknowledgedRate).toBe(1);
    } finally {
      context.newCDPSession = originalNewSession;
      if (previousIterations === undefined) delete process.env['PERF_ITERATIONS'];
      else process.env['PERF_ITERATIONS'] = previousIterations;
      if (previousWarmups === undefined) delete process.env['PERF_WARMUP_ITERATIONS'];
      else process.env['PERF_WARMUP_ITERATIONS'] = previousWarmups;
    }
  });

  test('rejects a missing scroll container instead of reporting an empty workload', async ({
    page,
  }) => {
    await page.setContent('<main>No scroll fixture</main>');
    const perfPage = new PerfPage(page);
    await expect(
      perfPage.scrollCheckpoints({
        selector: '#missing',
        checkpoints: 8,
        rowPrefix: 'row-',
      }),
    ).rejects.toThrow('Missing scroll container #missing');
  });

  test('delivers every scroll checkpoint to the browser before advancing', async ({ page }) => {
    await page.setContent(`
      <div id="scrollport" style="height:100px;overflow:auto">
        ${Array.from({ length: 10 }, (_, i) => `<div data-draggable-id="row-${i}" style="height:50px">${i}</div>`).join('')}
      </div>
    `);
    await page.evaluate(() => {
      const scrollport = document.getElementById('scrollport')!;
      scrollport.dataset['positions'] = '[]';
      scrollport.addEventListener('scroll', () => {
        const positions = JSON.parse(scrollport.dataset['positions']!) as number[];
        positions.push(scrollport.scrollTop);
        scrollport.dataset['positions'] = JSON.stringify(positions);
      });
    });
    const evidence = await new PerfPage(page).scrollCheckpoints({
      selector: '#scrollport',
      checkpoints: 8,
      rowPrefix: 'row-',
    });
    expect(evidence['operations']).toBe(8);
    expect(evidence['checkpointRows']).toEqual(Array.from({ length: 8 }, (_, i) => `row-${i + 1}`));
    expect(evidence['scrollDistance']).toBe(400);
    // Consecutive synchronous writes collapse into one native scroll event. All eight
    // events prove that a slower browser still receives the complete input sequence.
    await expect(page.locator('#scrollport')).toHaveAttribute(
      'data-positions',
      JSON.stringify([50, 100, 150, 200, 250, 300, 350, 400]),
    );
  });
});
