import { test, expect, type Page } from "@playwright/test";

const vesselSelector = "[data-vessel-id]";

async function openPageWithoutTiles(page: Page) {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/");
  await page.locator(vesselSelector).first().waitFor();
}

test("на странице отображаются ровно три судна", async ({ page }) => {
  await openPageWithoutTiles(page);

  await expect(page.locator(vesselSelector)).toHaveCount(3);
});

test("клик по судну открывает карточку с его id", async ({ page }) => {
  await openPageWithoutTiles(page);
  const vessel = page.locator(vesselSelector).nth(1);
  const vesselId = await vessel.getAttribute("data-vessel-id");

  await vessel.click();

  await expect(page.locator('[aria-label="Карточка судна"]')).toContainText(vesselId ?? "");
});

test("повторный клик по тому же судну не закрывает карточку", async ({ page }) => {
  await openPageWithoutTiles(page);
  const vessel = page.locator(vesselSelector).first();

  await vessel.click();
  const card = page.locator('[aria-label="Карточка судна"]');
  await expect(card).toBeVisible();

  await vessel.click();

  await expect(card).toBeVisible();
});
