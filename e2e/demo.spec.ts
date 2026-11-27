import { expect, test } from "@playwright/test";

const editor = (page: import("@playwright/test").Page, name = "Dockerfile") => page.getByLabel(`Contents of ${name}`);

test("the first screen is the example Dockerfile, labelled, with no dialog", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Example", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /How it works|What is Redline/ })).toHaveCount(0);
});

test("the example Dockerfile opens annotated, and a line fix can be undone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("tab", { name: /Dockerfile/, selected: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Grade F/ })).toBeVisible();
  await expect(page.getByText("Container runs as root").first()).toBeVisible();

  await page.getByRole("button", { name: /^Findings on line 19/ }).click();
  await page.getByRole("button", { name: /Fix: CMD in shell form/ }).click();
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

test("the rules and the benchmark open", async ({ page }) => {
  await page.goto("/rules");
  await page.getByPlaceholder("Search the rules").fill("off-by-slash");
  await expect(page.getByText("alias path traversal (off-by-slash)")).toBeVisible();
  await page.getByRole("button", { name: "Benchmark" }).click();
  await expect(page.getByText("0 false alarms on hardened configs")).toBeVisible();
  await expect(page.getByRole("table", { name: /held-out files/ })).toBeVisible();
  await expect(page.getByText("Mozilla modern OpenSSH")).toBeVisible();
});

test("a finding opens with why it matters, and Fix it corrects the file", async ({ page }) => {
  await page.goto("/?file=sample:Dockerfile");
  const notes = page.getByRole("region", { name: "Findings" });
  await notes.getByRole("button", { name: /Container runs as root/ }).click();
  await expect(notes.getByText("Why it matters")).toBeVisible();
  await notes.getByRole("button", { name: "Fix it" }).click();
  await expect(editor(page)).toHaveValue(/USER node/);
  await expect(page.getByRole("status")).toContainText("Fixed Container runs as root");
});

test("fix all is one keystroke and the grade changes", async ({ page }) => {
  await page.goto("/?file=sample:Dockerfile");
  await expect(page.getByRole("img", { name: /Grade F \(7\/100\)/ })).toBeVisible();
  await editor(page).focus();
  await page.keyboard.press("Control+.");
  await expect(page.getByRole("img", { name: /Grade F/ })).not.toHaveAccessibleName(/7\/100/);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("img", { name: /Grade F \(7\/100\)/ })).toBeVisible();
});

test("on a phone the file fits the screen and findings are listed below", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole("complementary", { name: "Annotations" })).toBeHidden();
  await expect(page.getByRole("region", { name: "Findings" }).getByText("Secret baked into the image").first()).toBeVisible();
  await page.close();
});

// One dark theme, whatever the system asks for: check it under both preferences.
for (const scheme of ["light", "dark"] as const) {
  test.describe(`system prefers ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    test("the console stays dark", async ({ page }) => {
      await page.goto("/");
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
      await expect(page.getByRole("button", { name: /theme/i })).toHaveCount(0);
    });
  });
}

for (const path of ["/", "/?file=sample:nginx/shop.conf", "/rules", "/bench", "/use"]) {
  test(`no accessibility violations on ${path}`, async ({ page }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}

test("a corrupt saved workspace does not break the page", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("redline-files-v1", JSON.stringify([null, { name: 3 }, "x"]));
    localStorage.setItem("redline-edits-v1", "[1,2]");
  });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: /Dockerfile/, selected: true })).toBeVisible();
});

test("the line menu takes focus and Escape returns it; Escape then Tab leaves the editor", async ({ page }) => {
  await page.goto("/");
  const marker = page.getByRole("button", { name: /^Findings on line 19/ });
  await marker.click();
  await expect(page.getByRole("button", { name: /Fix: CMD in shell form/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(marker).toBeFocused();

  await editor(page).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(editor(page)).not.toBeFocused();
});

test("undo is withdrawn once the file is edited by hand", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Findings on line 19/ }).click();
  await page.getByRole("button", { name: /Fix: CMD in shell form/ }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await editor(page).press("End");
  await editor(page).pressSequentially(" ");
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
});
