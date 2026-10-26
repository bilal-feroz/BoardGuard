import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR; // when set, save documentation screenshots

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function startScenario(page: Page, title: string) {
  await page.goto("/");
  await expect(page.getByText("API offline")).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(title) }).click();
}

test("scenario 02: glare triggers recapture, reinspection changes the decision", async ({ page }) => {
  await startScenario(page, "Possible solder bridge under glare");
  await expect(page.getByText("Agent requests a recapture")).toBeVisible();
  await expect(page.getByText(/Reduce specular glare/).first()).toBeVisible();
  await page.waitForTimeout(1200);
  await shot(page, "s02-recapture-requested");

  await page.getByRole("button", { name: /TQFP-144 recaptured with diffuse light/ }).click();
  await expect(page.getByText("Technician review required")).toBeVisible();
  await expect(page.getByText("Not reproduced", { exact: false }).first()).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "s02-reinspected");

  // Technician dismisses C01 and confirms C02.
  await page.getByRole("button", { name: /^C01/ }).first().click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("button", { name: /^C02/ }).first().click();
  await page.getByRole("button", { name: "Confirm suspicion" }).click();
  await expect(page.getByText(/Electrical verification pending/).first()).toBeVisible();

  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByText("Evidence chain")).toBeVisible();
  await expect(page.getByText("R-M3").first()).toBeVisible();
  await shot(page, "evidence");
});

test("scenario 03: before/after registration and confirmation", async ({ page }) => {
  await startScenario(page, "Before / after verification");
  await expect(page.getByText("After-repair capture")).toBeVisible();
  await page.getByRole("button", { name: /Same region after cleaning/ }).click();
  await expect(page.getByText("Confirm visual checks").first()).toBeVisible();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText("REGISTERED").first()).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "verify-split");
  await page.getByRole("tab", { name: "Difference map" }).click();
  await page.waitForTimeout(600);
  await shot(page, "verify-diff");
  await page.getByRole("button", { name: "Confirm visual checks" }).click();
  await expect(page.getByText("Visual reinspection completed").first()).toBeVisible();
  await shot(page, "verify-complete");
});

test("scenario 04: unusable capture is rejected before analysis and stops safely", async ({ page }) => {
  await startScenario(page, "Unusable capture");
  await expect(page.getByText("Agent requests a recapture")).toBeVisible();
  await expect(page.getByText("OVEREXPOSED").first()).toBeVisible();
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Stopped safely").first()).toBeVisible();
});

test("scenario 05: unregistrable real pair withholds the overlay", async ({ page }) => {
  await startScenario(page, "Real rework pair");
  await page.getByRole("button", { name: /PSU section after capacitor replacement/ }).click();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText(/Registration failed — aligned overlay and change map withheld/)).toBeVisible();
  await shot(page, "verify-withheld");
});

test("system screen shows live OpenCV 5 runtime", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.getByText(/^5\.\d+\.\d+ \(opencv-python-headless\)/)).toBeVisible();
  await page.getByRole("button", { name: "Run probe" }).click();
  await expect(page.getByText("X-BoardGuard-Runtime")).toBeVisible();
  await shot(page, "system");
});

test("upload rejects a non-image with a specific error", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New inspection" }).click();
  await expect(page.getByText("Capture required")).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("UNSUPPORTED_FORMAT")).toBeVisible();
});
