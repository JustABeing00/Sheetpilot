import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const PRIMARY_CSV = fileURLToPath(
  new URL('../samples/account-faults/primary_accounts.csv', import.meta.url),
);
const EVENTS_CSV = fileURLToPath(
  new URL('../samples/account-faults/fault_events.csv', import.meta.url),
);

test('the app shell loads and reports the API as connected', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('API connected')).toBeVisible();
});

test('workspace settings explain that authentication is disabled', async ({ page }) => {
  await page.goto('/workspace');
  await expect(page.getByText('Workspace management is unavailable')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Workspace' })).toHaveCount(0);
});

test('uploads two files, runs, reviews every exception and downloads the report', async ({
  page,
}) => {
  test.slow();

  await page.goto('/runs/new');
  await expect(page.getByRole('heading', { name: 'New run' })).toBeVisible();

  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles(PRIMARY_CSV);
  await fileInputs.nth(1).setInputFiles(EVENTS_CSV);
  await page.getByRole('button', { name: 'Start run' }).click();

  await page.waitForURL(/\/runs\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Run summary' })).toBeVisible();

  // The in-process dispatcher executes the run; the page polls until it finishes.
  await expect(page.locator('.badge', { hasText: 'Finished' }).first()).toBeVisible({
    timeout: 90_000,
  });

  // Resolve every exception exactly the way a reviewer would, one card at a time.
  const accept = page.getByRole('button', { name: 'Accept suggestion' });
  await accept.first().waitFor({ state: 'visible', timeout: 60_000 });
  let remaining = await accept.count();
  expect(remaining).toBeGreaterThan(0);
  while (remaining > 0) {
    await accept.first().click();
    await expect(accept).toHaveCount(remaining - 1, { timeout: 60_000 });
    remaining -= 1;
  }

  await expect(page.getByText('Everything is resolved — your report is ready')).toBeVisible({
    timeout: 60_000,
  });

  const downloadStarted = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download XLSX report/ }).click();
  const download = await downloadStarted;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(await download.failure()).toBeNull();
});
