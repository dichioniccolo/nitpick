import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Under `instant()` the server and router hold every dynamic read, so a route
 * passes only when its static shell commits by itself. Markers sit on shell
 * nodes, never on data. A soft navigation also asserts the URL inside the
 * lock: it changes only when the router commits. See instant-nav.rig.md.
 */
const repoName = "acme/billing";
const reviewId = "01960000-0000-7000-8000-000000000001";

const shell = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

/** Under the lock the router commits only a prefetched shell, so prefetches must finish first. */
const settle = (page: Page) => page.waitForLoadState("networkidle");

test("the build exposes the testing API, so no test passes vacuously", async ({ request }) => {
  const plain = await (await request.get("/")).text();

  const locked = await (
    await request.get("/", { headers: { cookie: "next-instant-navigation-testing=1" } })
  ).text();

  expect(locked).not.toEqual(plain);
});

test("/ commits its shell under instant()", async ({ page, baseURL }) => {
  await instant(
    page,
    async () => {
      await page.goto("/");
      await expect(shell(page, "landing-shell")).toBeVisible();
    },
    { baseURL },
  );
});

test("/app sends a visitor without a session to the landing page", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/signin=required/);
});

test.describe("dashboard", () => {
  test.use({ storageState: "e2e/.auth/demo.json" });

  for (const { path, marker } of [
    { path: "/app", marker: "repositories-shell" },
    { path: `/app/repos/${repoName}`, marker: "repository-shell" },
    { path: `/app/reviews/${reviewId}`, marker: "review-shell" },
  ]) {
    test(`${path} commits its shell under instant()`, async ({ page, baseURL }) => {
      await instant(
        page,
        async () => {
          await page.goto(path);
          await expect(shell(page, marker)).toBeVisible();
        },
        { baseURL },
      );
    });
  }

  test("repositories -> repository is a soft navigation with an instant shell", async ({
    page,
  }) => {
    await page.goto("/app");
    const link = page.getByRole("link", { name: new RegExp(`^${repoName} Ready$`) });
    await expect(link).toBeVisible();
    await settle(page);
    await instant(page, async () => {
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/app/repos/${repoName}$`));
      await expect(shell(page, "repository-shell")).toBeVisible();
    });
    await expect(page.getByRole("heading", { name: repoName })).toBeVisible();
  });

  test("repositories -> review is a soft navigation with an instant shell", async ({ page }) => {
    await page.goto("/app");
    const link = page.getByRole("link", { name: /Store amounts in euros/ });
    await expect(link).toBeVisible();
    await settle(page);
    await instant(page, async () => {
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/app/reviews/${reviewId}$`));
      await expect(shell(page, "review-shell")).toBeVisible();
    });
    await expect(page.getByRole("heading", { name: "Store amounts in euros" })).toBeVisible();
  });
});
