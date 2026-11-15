import { expect, test } from "@playwright/test";

const editor = (page: import("@playwright/test").Page, name = "Dockerfile") => page.getByLabel(`Contents of ${name}`);

test("the example Dockerfile opens with squiggles, and a lightbulb fix can be undone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("tab", { name: /Dockerfile/, selected: true })).toBeVisible();
  await expect(page.getByText(/Grade F/)).toBeVisible();
  await expect(page.getByText("Container runs as root").first()).toBeVisible();

  await page.getByRole("button", { name: "Quick fixes for line 19" }).click();
  await page.getByRole("menuitem", { name: /Fix: CMD in shell form/ }).click();
  await expect(editor(page)).toHaveValue(/CMD \["npm", "start"\]/);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(editor(page)).toHaveValue(/CMD npm start/);
});

test("the fix preview applies only the ticked fixes and downloads the file", async ({ page }) => {
  await page.goto("/?file=sample:Dockerfile");
  await page.getByRole("tab", { name: "Fix preview" }).click();
  await page.getByLabel(/CMD in shell form/).uncheck();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download fixed file" }).click();
  expect((await download).suggestedFilename()).toBe("Dockerfile");
  await page.getByRole("button", { name: "Apply to the file" }).click();
  await expect(editor(page)).toHaveValue(/USER node/);
  await expect(editor(page)).toHaveValue(/CMD npm start/);
});

test("a new file is checked as you type and kept after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New file" }).click();
  await page.getByLabel("New file name").fill("sshd_config");
  await page.keyboard.press("Enter");
  await editor(page, "sshd_config").fill("PermitRootLogin yes\nPasswordAuthentication yes\n");
  await expect(page.getByText("Root can log in with a password").first()).toBeVisible();
  await page.reload();
  await expect(editor(page, "sshd_config")).toHaveValue(/PermitRootLogin yes/);
  await page.getByRole("button", { name: "Delete sshd_config" }).click();
  await expect(page.getByLabel("Contents of sshd_config")).toHaveCount(0);
});

test("the rulebook and the test bench open as tabs", async ({ page }) => {
  await page.goto("/rules");
  await page.getByPlaceholder("Search the rules").fill("off-by-slash");
  await expect(page.getByText("alias path traversal (off-by-slash)")).toBeVisible();
  await page.getByRole("button", { name: "Test bench" }).click();
  await expect(page.getByText("false alarms on hardened configs")).toBeVisible();
  await expect(page.getByText("Mozilla modern OpenSSH")).toBeVisible();
});
