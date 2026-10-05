import { expect, test, type Page } from "@playwright/test";

const vesselSelector = "[data-vessel-id]";
const cardSelector = '[aria-label="Карточка судна"]';
const buttonName = "Загрузить настоящие позиции";

async function openMap(page: Page) {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/");
  await page.locator(vesselSelector).first().waitFor();
}

async function cardValue(page: Page, index: number): Promise<string> {
  return page.locator(cardSelector).locator("dd").nth(index).innerText();
}

test("page.clock: движение обновляет позицию маркера и карточки", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T12:00:00.000Z") });
  await openMap(page);

  const vessel = page.locator('[data-vessel-id="demo-1"]');
  await vessel.click();
  const card = page.locator(cardSelector);
  const coordinatesBefore = await cardValue(page, 2);

  await page.clock.runFor(6_000);

  await expect(card.locator("dd").nth(2)).not.toHaveText(coordinatesBefore);
  expect(await cardValue(page, 2)).not.toBe(coordinatesBefore);
});

test("page.clock: судно после конца маршрута стоит с последними данными", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T12:00:00.000Z") });
  await openMap(page);

  const vessel = page.locator('[data-vessel-id="demo-1"]');
  await vessel.click();
  const card = page.locator(cardSelector);

  await page.clock.runFor(18_000);

  await expect(card.locator("dd").nth(3)).toHaveText("0 уз");
  const finalCoordinates = await cardValue(page, 2);
  const finalCourse = await cardValue(page, 4);
  const finalTimestamp = await cardValue(page, 5);
  expect(finalCourse).not.toBe("");
  expect(finalTimestamp).not.toBe("");

  await page.clock.runFor(4_000);

  await expect(card.locator("dd").nth(2)).toHaveText(finalCoordinates);
  await expect(card.locator("dd").nth(3)).toHaveText("0 уз");
  await expect(card.locator("dd").nth(4)).toHaveText(finalCourse);
  await expect(card.locator("dd").nth(5)).toHaveText(finalTimestamp);
});

test("подменённый ответ error показывает ошибку и очищает суда", async ({ page }) => {
  const message = "Источник вернул ошибку";
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        attemptedAt: "2026-01-01T12:00:00.000Z",
        error: { code: "provider_error", message },
      }),
    }),
  );
  await openMap(page);

  await page.getByRole("button", { name: buttonName }).click();

  await expect(page.locator(vesselSelector)).toHaveCount(0);
  await expect(page.locator(".data-source")).toHaveText("Данных на карте нет");
  await expect(page.locator(".status-message")).toHaveText(
    "Не удалось получить данные: Источник вернул ошибку",
  );
});

test("подменённый пустой ответ показывает empty state и очищает суда", async ({ page }) => {
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        vessels: [],
        collectedAt: "2026-01-01T12:00:00.000Z",
        windowSeconds: 15,
        count: 0,
        truncated: false,
        reason: "window_elapsed",
      }),
    }),
  );
  await openMap(page);

  await page.getByRole("button", { name: buttonName }).click();

  await expect(page.locator(vesselSelector)).toHaveCount(0);
  await expect(page.locator(".data-source")).toContainText("судов: 0");
  await expect(page.locator(".status-message")).toHaveText(
    "За время сбора позиции не получены",
  );
});

test("подменённый success с null speed/course переиспользует neutral icon и карточку", async ({ page }) => {
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        vessels: [
          {
            id: "synthetic-neutral-1",
            name: "Синтетическое судно",
            lat: 51.01,
            lon: 1.21,
            speedKnots: null,
            courseDeg: null,
            timestamp: "2026-01-01T12:00:00.000Z",
            source: "aisstream",
          },
        ],
        collectedAt: "2026-01-01T12:00:01.000Z",
        windowSeconds: 15,
        count: 1,
        truncated: false,
        reason: "window_elapsed",
      }),
    }),
  );
  await openMap(page);

  await page.getByRole("button", { name: buttonName }).click();

  const vessel = page.locator('[data-vessel-id="synthetic-neutral-1"]');
  await expect(vessel).toHaveAttribute("data-icon", "neutral");
  await vessel.click();
  const card = page.locator(cardSelector);
  await expect(card.locator("dd").nth(3)).toHaveText("Нет данных");
  await expect(card.locator("dd").nth(4)).toHaveText("Нет данных");
});
