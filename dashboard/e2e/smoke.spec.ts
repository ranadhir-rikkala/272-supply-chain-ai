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

// The inbox lists the riskiest and most expensive items first, so with live data the
// orders a planner can approve on their own (under the limit) may be a few pages in.
async function findApprovableCard(page: Page, maxPages = 40) {
  const approvable = page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: "Approve", exact: true }) })
    .first();
  const next = page.getByRole("button", { name: "Next" });
  for (let i = 0; i < maxPages; i++) {
    await expect(page.getByRole("article").first()).toBeVisible();
    if (await approvable.isVisible()) return approvable;
    if (!(await next.isEnabled())) break;
    const firstTitle = await page.getByRole("article").first().getAttribute("aria-label");
    await next.click();
    await expect(page.getByRole("article").first()).not.toHaveAttribute("aria-label", firstTitle ?? "");
  }
  throw new Error(`No recommendation under the approval limit in the first ${maxPages} pages`);
}

test("a planner signs in and approves a small order", async ({ page }) => {
  await signIn(page, "pat.planner");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Approvals/ }).click();
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  const smallOrder = await findApprovableCard(page);
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
