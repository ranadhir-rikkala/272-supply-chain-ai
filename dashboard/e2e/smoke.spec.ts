import { expect, test, type Page } from "@playwright/test";

const live = !!process.env.E2E_BASE_URL;

async function signIn(page: Page, username: string) {
  await page.goto("/");
  if (live) {
    await page.getByRole("button", { name: "Sign in with company SSO" }).click();
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(process.env.DEMO_USER_PASSWORD ?? "");
    await page.locator("#kc-login").click();
  } else {
    await page.getByRole("button", { name: new RegExp(username) }).click();
  }
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

test("a planner signs in and approves a small order", async ({ page }) => {
  await signIn(page, "pat.planner");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Approvals/ }).click();
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  const smallOrder = page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: "Approve", exact: true }) })
    .first();
  await smallOrder.getByLabel(/Comment/).fill("Approved in smoke test");
  await smallOrder.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Approved\. Draft order D[PT]O-\d{6} created\./)).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Orders" }).click();
  await expect(page.getByRole("cell", { name: /D[PT]O-\d{6}/ }).first()).toBeVisible();
});

test("a viewer does not see admin or audit pages", async ({ page }) => {
  await signIn(page, "vic.viewer");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Audit" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByText("Not available for your role")).toBeVisible();
});
