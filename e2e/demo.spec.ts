import { expect, test } from "@playwright/test";

test("the example Dockerfile is marked up and the corrected copy can be downloaded", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dockerfile" })).toBeVisible();
  await expect(page.getByLabel(/Grade F/)).toBeVisible();
  await expect(page.getByText("Container runs as root").first()).toBeVisible();

  await page.getByRole("tab", { name: "Corrected copy" }).click();
  await expect(page.getByText('CMD ["npm", "start"]')).toBeVisible();
  await expect(page.getByText("USER node")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the fixed file" }).click();
  expect((await download).suggestedFilename()).toBe("Dockerfile");
});

test("unticking a fix leaves that line alone in the corrected copy", async ({ page }) => {
  await page.goto("/?file=sample:Dockerfile");
  await page.getByText("CMD in shell form").first().click();
  await page.locator("label", { hasText: "fix this" }).filter({ visible: true }).last().click();
  await expect(page.getByText("leave it").filter({ visible: true })).toHaveCount(1);
  await page.getByRole("tab", { name: "Corrected copy" }).click();
  await expect(page.getByText("CMD npm start")).toBeVisible();
  await expect(page.getByText('CMD ["npm", "start"]')).toHaveCount(0);
});

test("a pasted file is inspected in the browser and kept after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add a file" }).click();
  await page.getByLabel("File name").fill("sshd_config");
  await page.getByLabel("Contents").fill("PermitRootLogin yes\nPasswordAuthentication yes\n");
  await page.getByRole("button", { name: "Inspect it" }).click();
  await expect(page.getByText("Root can log in with a password").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "sshd_config" })).toBeVisible();
  await page.getByRole("button", { name: "Remove from the desk" }).click();
  await expect(page.getByText("Paste a file or drop one")).toBeVisible();
});

test("the rulebook and the test bench load", async ({ page }) => {
  await page.goto("/rules");
  await page.getByPlaceholder("Search the rules").fill("off-by-slash");
  await expect(page.getByText("alias path traversal (off-by-slash)")).toBeVisible();
  await page.goto("/bench");
  await expect(page.getByText("false alarms on hardened configs")).toBeVisible();
  await expect(page.getByText("Mozilla modern OpenSSH")).toBeVisible();
});
