import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Under `instant()` the server and router hold every dynamic read, so a route
 * passes only when its static shell commits by itself. Markers sit on shell
 * nodes, never on data, and each dashboard test also asserts a data slot is
 * empty under the lock and filled after it. A soft navigation also asserts the
 * URL inside the lock: it changes only when the router commits. See
 * instant-nav.rig.md.
 */
const repoName = "acme/billing";
const reviewId = "01960000-0000-7000-8000-000000000001";

const shell = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

/** Under the lock the router commits only a prefetched shell, so prefetches must finish first. */
const settle = (page: Page) => page.waitForLoadState("networkidle");

const repoHeading = (page: Page) => page.getByRole("heading", { name: repoName });
const reviewHeading = (page: Page) => page.getByRole("heading", { name: "Store amounts in euros" });
const repoRow = (page: Page) => page.getByRole("link", { name: new RegExp(`^${repoName} Ready$`) });
const reviewRow = (page: Page) => page.getByRole("link", { name: /Store amounts in euros/ });
const retriggerButton = (page: Page) => page.getByRole("button", { name: "Review again" });

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

  for (const { path, marker, data } of [
    { path: "/app", marker: "repositories-shell", data: repoRow },
    { path: "/app/reviews", marker: "reviews-shell", data: reviewRow },
    { path: `/app/repos/${repoName}`, marker: "repository-shell", data: repoHeading },
    { path: `/app/reviews/${reviewId}`, marker: "review-shell", data: reviewHeading },
    {
      path: `/app/reviews/${reviewId}/retrigger`,
      marker: "retrigger-shell",
      data: retriggerButton,
    },
  ]) {
    test(`${path} commits its shell under instant() and holds its data`, async ({
      page,
      baseURL,
    }) => {
      await instant(
        page,
        async () => {
          await page.goto(path);
          await expect(shell(page, marker)).toBeVisible();
          await expect(data(page)).toHaveCount(0);
        },
        { baseURL },
      );

      await expect(data(page)).toBeVisible();
    });
  }

  test("repositories -> repository is a soft navigation with an instant shell", async ({
    page,
  }) => {
    await page.goto("/app");
    const link = repoRow(page);
    await expect(link).toBeVisible();
    await settle(page);
    await instant(page, async () => {
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/app/repos/${repoName}$`));
      await expect(shell(page, "repository-shell")).toBeVisible();
      await expect(repoHeading(page)).toHaveCount(0);
    });
    await expect(repoHeading(page)).toBeVisible();
  });

  test("repositories -> review is a soft navigation with an instant shell", async ({ page }) => {
    await page.goto("/app");
    const link = reviewRow(page);
    await expect(link).toBeVisible();
    await settle(page);
    await instant(page, async () => {
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/app/reviews/${reviewId}$`));
      await expect(shell(page, "review-shell")).toBeVisible();
      await expect(reviewHeading(page)).toHaveCount(0);
    });
    await expect(reviewHeading(page)).toBeVisible();
  });

  // notFound() fires after the shell flushed with 200. See "Walls" in instant-nav.rig.md.
  for (const path of ["/app/repos/x/y", "/app/reviews/abc", "/app/reviews/abc/retrigger"]) {
    test(`${path} answers 200 with the not-found page`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
    });
  }
});

test.describe("review findings", () => {
  test.use({ storageState: "e2e/.auth/demo.json" });

  test("show P0-P3 severity, and scenario and evidence only where stored", async ({ page }) => {
    await page.goto(`/app/reviews/${reviewId}`);
    await expect(reviewHeading(page)).toBeVisible();
    const findings = page.getByRole("listitem");
    await expect(findings).toHaveCount(2);
    // P1 sorts before P3.
    await expect(findings.nth(0)).toContainText("P1Cents stored as euros");
    await expect(findings.nth(0)).toContainText("Scenario: Any charge above 1 euro.");
    await expect(findings.nth(0)).toContainText("Evidence: src/charge.ts:12 divides");
    await expect(findings.nth(1)).toContainText("P3Unused import");
    await expect(findings.nth(1)).not.toContainText("Scenario:");
    await expect(findings.nth(1)).not.toContainText("Evidence:");
  });
});
