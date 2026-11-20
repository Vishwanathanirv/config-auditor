import { expect, test } from "@playwright/test";

const editor = (page: import("@playwright/test").Page, name = "Dockerfile") => page.getByLabel(`Contents of ${name}`);

// Returning visitors: the first-visit briefing has been seen. The briefing has its own tests below.
test.beforeEach(async ({ page }, info) => {
  if (!info.title.startsWith("first visit")) await page.addInitScript(() => localStorage.setItem("redline-briefed", "1"));
});

test("first visit: the idea, then a risky Dockerfile with its fixes in one click", async ({ page }) => {
  await page.goto("/");
  const briefing = page.getByRole("dialog", { name: /red pen before it ships/ });
  await expect(briefing).toBeVisible();
  await expect(briefing.getByRole("button", { name: "Fix a risky Dockerfile →" })).toBeFocused();
  await briefing.getByRole("button", { name: "Fix a risky Dockerfile →" }).click();
  await expect(briefing).toBeHidden();
  await expect(page).toHaveURL(/file=sample%3ADockerfile/);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "What is Redline?" }).click();
  await expect(page.getByRole("dialog", { name: /red pen before it ships/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("first visit: the briefing and how it works have no accessibility violations", async ({ page }) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const check = async () => {
    const r = await new AxeBuilder({ page }).include("[role=dialog]").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  };
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(600);
  await check();
  await page.getByRole("dialog").getByRole("button", { name: "How it works" }).click();
  await expect(page.getByRole("dialog", { name: "Follow one file across the desk" })).toBeVisible();
  await check();
});

test("how it works follows a pasted file from recognising it to its grade", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "How it works" }).click();
  const how = page.getByRole("dialog", { name: "Follow one file across the desk" });
  const stage = (n: RegExp) => how.getByRole("list", { name: "Stages" }).getByRole("button", { name: n });
  await stage(/Explain/).click();
  await expect(how.getByText("Secret baked into the image")).toBeVisible();
  await how.getByRole("radio", { name: "Paste your own" }).click();
  await how.getByRole("textbox", { name: "File name" }).fill("nginx.conf");
  await how.getByRole("textbox", { name: "File contents" }).fill("server {\n  listen 443 ssl;\n  ssl_protocols TLSv1 TLSv1.2;\n}\n");
  await stage(/Recognise/).click();
  await expect(how.getByText("nginx", { exact: true })).toBeVisible();
  await stage(/Mark/).click();
  await expect(how.getByText(/Allows TLSv1/)).toBeVisible();
  await stage(/Grade/).click();
  await expect(how.getByRole("img", { name: /As written: grade/ })).toBeVisible();
  await how.getByRole("button", { name: "Put it on the desk →" }).click();
  await expect(how).toBeHidden();
  await expect(page.getByRole("tab", { name: /nginx\.conf/ })).toBeVisible();
});

test("the example Dockerfile opens with squiggles, and a lightbulb fix can be undone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("tab", { name: /Dockerfile/, selected: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Grade F/ })).toBeVisible();
  await expect(page.getByText("Container runs as root").first()).toBeVisible();

  await page.getByRole("button", { name: /^Corrections for line 19/ }).click();
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

test("the manual and the lab report open on the desk", async ({ page }) => {
  await page.goto("/rules");
  await page.getByPlaceholder("Search the rules").fill("off-by-slash");
  await expect(page.getByText("alias path traversal (off-by-slash)")).toBeVisible();
  await page.getByRole("button", { name: "Lab report" }).click();
  await expect(page.getByText("0 false alarms on hardened configs")).toBeVisible();
  await expect(page.getByRole("table", { name: /held-out files/ })).toBeVisible();
  await expect(page.getByText("Mozilla modern OpenSSH")).toBeVisible();
});

test("a note opens with why it matters, and Fix it corrects the sheet", async ({ page }) => {
  await page.goto("/?file=sample:Dockerfile");
  const notes = page.getByRole("region", { name: "Inspector's notes" });
  await notes.getByRole("button", { name: /Container runs as root/ }).click();
  await expect(notes.getByText("Why it matters")).toBeVisible();
  await notes.getByRole("button", { name: "Fix it" }).click();
  await expect(editor(page)).toHaveValue(/USER node/);
  await expect(page.getByRole("status")).toContainText("Fixed Container runs as root");
});

test("fix all is one keystroke and the stamp changes", async ({ page }) => {
  await page.goto("/?file=sample:Dockerfile");
  await expect(page.getByRole("img", { name: /Grade F \(7\/100\)/ })).toBeVisible();
  await editor(page).focus();
  await page.keyboard.press("Control+.");
  await expect(page.getByRole("img", { name: /Grade F/ })).not.toHaveAccessibleName(/7\/100/);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("img", { name: /Grade F \(7\/100\)/ })).toBeVisible();
});

test("on a phone the sheet fits the screen and the notes are footnotes", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole("complementary", { name: "Margin notes" })).toBeHidden();
  await expect(page.getByRole("region", { name: "Inspector's notes" }).getByText("Secret baked into the image").first()).toBeVisible();
  await page.close();
});

// One dark theme, whatever the system asks for: check it under both preferences.
for (const scheme of ["light", "dark"] as const) {
  test.describe(`system prefers ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    test("the desk stays dark", async ({ page }) => {
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
