import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'e2e/screenshots';
const state = (page: Page) => page.evaluate(() => ({ ...document.body.dataset }));

declare global {
  interface Window {
    __golf: { swing(power: number, accuracy?: number): void; fastForward(): void; primary(): void };
  }
}

test('tee off with the 3-click swing and finish a hole', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?test');
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await expect(page.getByText('Greenside Classic')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-menu.png` });

  await page.click('[data-testid=tee-off]');
  await page.keyboard.press('Escape'); // skip the flyover
  await page.waitForFunction(() => document.body.dataset.phase === 'aiming');
  const before = await state(page);
  expect(before.hole).toBe('1');
  expect(before.strokes).toBe('0');
  expect(before.lie).toBe('tee');
  await page.screenshot({ path: `${SHOTS}/02-address.png` });

  // Real 3-click swing from the keyboard.
  await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.body.dataset.phase === 'flight');
  expect((await state(page)).strokes).toBe('1');
  await page.screenshot({ path: `${SHOTS}/03-flight.png` });

  // Let the ball land, then check we're set up for the next shot further down the hole.
  await page.evaluate(() => window.__golf.fastForward());
  await page.waitForFunction(() => {
    window.__golf.fastForward();
    return document.body.dataset.phase === 'aiming';
  });
  const after = await state(page);
  expect(Number(after.toPin)).toBeLessThan(Number(before.toPin));
  await page.screenshot({ path: `${SHOTS}/04-second-shot.png` });

  // Play the rest of the hole with exact swings via the test hook.
  for (let i = 0; i < 400; i++) {
    const s = await state(page);
    if (s.phase === 'holeOver' || s.phase === 'roundOver') break;
    if (s.phase === 'aiming') {
      const toPin = Number(s.toPin);
      const carry = Number(s.carry);
      const power = Math.min(1, s.club === 'pt' ? (toPin + 0.35) / carry : toPin / carry);
      await page.evaluate((p) => window.__golf.swing(p, 0), power);
    } else {
      await page.evaluate(() => window.__golf.fastForward());
      await page.waitForTimeout(250);
    }
  }
  await expect(page.locator('.scorecard')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next: Hole 2' })).toBeVisible();
  const done = await state(page);
  expect(done.played).toBe('1');
  expect(Number(done.totalStrokes)).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: `${SHOTS}/05-scorecard.png` });

  await page.getByRole('button', { name: 'Next: Hole 2' }).click();
  await page.waitForFunction(() => document.body.dataset.hole === '2');
  expect(errors).toEqual([]);
});
