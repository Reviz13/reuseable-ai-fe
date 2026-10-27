import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PROFIT_QUESTION, fetchThisWeekProfit, formatRupiah } from "./profit";

const FORBIDDEN = "Hanya owner yang dapat melihat profit.";
const REFUND_QUESTION = "Bagaimana cara refund transaksi?";

// Playwright CSS locators pierce open shadow roots, so "ai-assistant .launcher" reaches inside the widget.
const widget = (page: Page) => page.locator("ai-assistant");
const avatarActive = (page: Page, state: string): Locator =>
  page.locator(`ai-assistant .launcher img[data-state="${state}"][data-active]`);
const assistantMessages = (page: Page) => page.locator("ai-assistant .msg.assistant");
const userMessages = (page: Page) => page.locator("ai-assistant .msg.user");

async function openWidget(page: Page): Promise<void> {
  await expect(widget(page).locator(".launcher")).toBeVisible();
  await widget(page).locator(".launcher").click();
  await expect(widget(page).locator(".panel")).toBeVisible();
}

async function ask(page: Page, question: string): Promise<void> {
  const input = widget(page).locator(".form input[type=text]");
  await expect(input).toBeEnabled();
  await input.fill(question);
  await widget(page).locator(".form .send").click();
}

/** Resolves true once `state` is the active avatar frame. Started before sending: happy only lasts 2 s. */
function watchAvatar(page: Page, state: string): Promise<void> {
  return expect
    .poll(() => avatarActive(page, state).count(), { intervals: [50], timeout: 30_000, message: `avatar ${state} active` })
    .toBeGreaterThan(0);
}

async function waitForAnswerDone(page: Page): Promise<Locator> {
  const last = assistantMessages(page).last();
  // Feedback buttons appear only after the server's `done` event.
  await expect(last.locator(".feedback")).toBeVisible();
  return last;
}

test.describe("POS pilot demo (/demo/pos)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo/pos");
    await expect(page.getByRole("button", { name: "Owner" })).toHaveAttribute("aria-pressed", "true");
    const mode = await widget(page).evaluate((el) => el.shadowRoot?.mode ?? null);
    expect(mode, "widget shadow root must be open").toBe("open");
  });

  test("owner: exact profit from mock-pos and a happy avatar", async ({ page }) => {
    await openWidget(page);
    const happy = watchAvatar(page, "happy");
    await ask(page, PROFIT_QUESTION);
    const answer = await waitForAnswerDone(page);
    await happy;
    const { profit } = await fetchThisWeekProfit();
    await expect(answer).toContainText(formatRupiah(profit));
    await expect(answer).not.toContainText(FORBIDDEN);
  });

  test("cashier: role toggle remounts the widget; FORBIDDEN copy and a sad avatar", async ({ page }) => {
    // Leave something in the owner widget so the remount is observable.
    await openWidget(page);
    await widget(page).locator(".form input[type=text]").fill("draft");

    await page.getByRole("button", { name: "Kasir" }).click();
    await expect(page.getByRole("button", { name: "Kasir" })).toHaveAttribute("aria-pressed", "true");
    // key={role}: a fresh <ai-assistant>, closed, with no conversation.
    await expect(widget(page)).toHaveCount(1);
    await expect(widget(page).locator(".panel")).toHaveCount(0);

    await openWidget(page);
    await expect(widget(page).locator(".form input[type=text]")).toHaveValue("");
    const sad = watchAvatar(page, "sad");
    await ask(page, PROFIT_QUESTION);
    const answer = await waitForAnswerDone(page);
    await sad;
    await expect(answer).toContainText(FORBIDDEN);
    await expect(answer).not.toContainText(/Rps?d/);
    await expect(avatarActive(page, "sad")).toHaveCount(1);
    await expect(userMessages(page)).toHaveCount(1);
  });
});

test.describe("admin upload -> cited answer", () => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  const external = process.env.E2E_EXTERNAL === "1";

  test("admin uploads sop-refund.md; owner answer cites it", async ({ page }) => {
    test.skip(
      !email || !password || !external,
      "needs live Supabase + seeded admin: start `pnpm dev`, then run `pnpm test:e2e` with E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD set (LOCAL_MODE disables admin routes)",
    );
    test.setTimeout(240_000);

    await page.goto("/login");
    await page.locator("#email").fill(email!);
    await page.locator("#password").fill(password!);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.waitForURL(/\/admin\//);

    await page.goto("/admin/pos/knowledge");
    await page.locator("#file").setInputFiles(resolve(__dirname, "../apps/ai-service/test/fixtures/sop-refund.md"));
    await page.locator("form:has(#file) button[type=submit]").click();
    const row = page.locator("tr", { hasText: "sop-refund" }).first();
    await expect(async () => {
      await page.reload();
      await expect(row.locator(".badge")).toHaveText("ready", { timeout: 2_000 });
    }).toPass({ timeout: 180_000, intervals: [2_000] });

    await page.goto("/demo/pos");
    await openWidget(page);
    await ask(page, REFUND_QUESTION);
    const answer = await waitForAnswerDone(page);
    await expect(answer.locator(".chip", { hasText: "sop-refund" })).toBeVisible();
  });
});
