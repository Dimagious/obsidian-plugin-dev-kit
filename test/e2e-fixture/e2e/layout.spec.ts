/**
 * The live check of `obsidian.checkLayout()` and `layoutProblems()`: the page scripts run in the real Obsidian window
 * against elements the spec adds to it, measured by the real layout engine, and Tab is pressed on the real keyboard.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

/** Adds markup to the window. It goes over as source text, because the kit's TypeScript has no DOM types. */
async function addBox(win: Page, html: string): Promise<void> {
    await win.evaluate(
        `(() => {
            document.getElementById("opdk-layout-box")?.remove();
            const box = document.createElement("div");
            box.id = "opdk-layout-box";
            box.style.cssText = "position:fixed;left:0;top:0;width:300px;z-index:99999;background:#fff;color:#000";
            box.innerHTML = ${JSON.stringify(html)};
            document.body.append(box);
        })()`,
    );
}

const ROOT = "#opdk-layout-box";

test.describe("overflow", () => {
    test("passes for content that fits", async ({ win, obsidian }) => {
        await addBox(win, '<div style="width:200px">fits</div>');
        await obsidian.checkLayout({ root: ROOT, touchTargets: false });
    });

    test("fails with the element that is wider than its box", async ({ win, obsidian }) => {
        await addBox(win, '<div style="width:100px;height:20px;overflow:hidden"><div class="wide" style="width:400px;height:10px"></div></div>');
        const problems = await obsidian.layoutProblems({ root: ROOT, touchTargets: false });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ check: "overflow", where: "div" });
        await expect(obsidian.checkLayout({ root: ROOT, touchTargets: false })).rejects.toThrow(/1 problem inside "#opdk-layout-box":\n {2}- horizontal overflow: div \(scrollWidth 400 > clientWidth 100\)/);
    });

    test("reports a vertical scroll pane whose content spills sideways: its computed overflow-x is auto too", async ({ win, obsidian }) => {
        await addBox(win, '<div class="pane" style="width:200px;height:50px;overflow-y:auto"><div style="width:900px;height:10px"></div></div>');
        expect(await win.evaluate(`getComputedStyle(document.querySelector(".pane")).overflowX`)).toBe("auto");
        const problems = await obsidian.layoutProblems({ root: ROOT, touchTargets: false });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ check: "overflow", where: "div.pane" });
    });

    test("leaves out what overflow.ignore names, and a check that is turned off", async ({ win, obsidian }) => {
        await addBox(win, '<pre style="width:100px;overflow-x:auto;white-space:pre">0123456789012345678901234567890123456789012345678901234567890123456789</pre>');
        expect(await obsidian.layoutProblems({ root: ROOT, touchTargets: false })).toHaveLength(1);
        expect(await obsidian.layoutProblems({ root: ROOT, touchTargets: false, overflow: { ignore: "pre" } })).toEqual([]);
        await addBox(win, '<div style="width:100px;overflow:hidden"><div style="width:400px;height:10px"></div></div>');
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: true })).toEqual([]);
    });

    test("passes an ellipsis name and a screen-reader-only span, and still fails the real overflow next to them", async ({ win, obsidian }) => {
        const names = '<div class="setting-item-name" style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">A setting with a rather long name</div>';
        const srOnly = '<span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">Only for screen readers</span>';
        await addBox(win, names + srOnly);
        await obsidian.checkLayout({ root: ROOT, touchTargets: false });
        await addBox(win, `${names}${srOnly}<div class="real" style="width:100px;overflow:hidden"><div style="width:400px;height:10px"></div></div>`);
        const problems = await obsidian.layoutProblems({ root: ROOT, touchTargets: false });
        expect(problems.map((problem) => problem.where)).toEqual(["div.real"]);
    });

    test("fails when the root is not there, even with every check off", async ({ obsidian }) => {
        await expect(obsidian.checkLayout({ root: "#nothing-here" })).rejects.toThrow('nothing matches the root "#nothing-here"');
        await expect(obsidian.checkLayout({ root: "#nothing-here", overflow: false, touchTargets: false })).rejects.toThrow('nothing matches the root "#nothing-here"');
    });

    test("refuses to pass with every check off", async ({ win, obsidian }) => {
        await addBox(win, "<p>text</p>");
        await expect(obsidian.checkLayout({ root: ROOT, overflow: false, touchTargets: false })).rejects.toThrow("nothing to check");
    });

    test("passes on the ordinary settings modal of Obsidian", async ({ obsidian }) => {
        await obsidian.openSettings();
        await obsidian.checkLayout({ root: ".modal.mod-settings", touchTargets: false });
        await obsidian.closeSettings();
    });
});

test.describe("touch targets", () => {
    const small = '<button class="tiny" style="width:20px;height:20px;padding:0">x</button><button class="big" style="width:60px;height:48px">ok</button><button style="display:none;width:5px;height:5px">h</button>';

    test("lists the targets under 44 px when asked, skipping the big and the hidden ones", async ({ win, obsidian }) => {
        await addBox(win, small);
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: true })).toEqual([
            { check: "touch-target", where: "button.tiny", detail: "20 x 20 px" },
        ]);
        await expect(obsidian.checkLayout({ root: ROOT, overflow: false, touchTargets: true })).rejects.toThrow(/touch target too small: button\.tiny \(20 x 20 px\)/);
    });

    test("is off by default on the desktop and on by default in the mobile emulation", async ({ win, obsidian }) => {
        await addBox(win, small);
        await expect(obsidian.layoutProblems({ root: ROOT, overflow: false })).rejects.toThrow("nothing to check");
        await obsidian.mobile();
        await addBox(win, small);
        const problems = await obsidian.layoutProblems({ root: ROOT, overflow: false });
        expect(problems.map((problem) => problem.where)).toEqual(["button.tiny"]);
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: { ignore: ".tiny" } })).toEqual([]);
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: { minSize: 20 } })).toEqual([]);
    });
});

test.describe("focus ring", () => {
    // Obsidian styles a plain <button> in a modal or a settings tab and gives it a resting box-shadow (--input-shadow),
    // so "has a box-shadow" is true before anything is focused. The fixture's Obsidian sets that variable to none, so
    // the box restores the value its themes use. The resting rule is :where() to stay below Obsidian's :focus-visible rule.
    const obsidianButtons =
        "<style>#opdk-layout-box{--input-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 1px 1px rgba(0,0,0,.3)}:where(#opdk-layout-box) button,:where(#opdk-layout-box) select{box-shadow:var(--input-shadow)}" +
        "#opdk-layout-box .stripped:focus,#opdk-layout-box .stripped:focus-visible{outline:none !important;box-shadow:var(--input-shadow) !important}" +
        "#opdk-layout-box .ring:focus-visible{outline:2px solid blue}</style>";
    const wrap = (inner: string): string => `${obsidianButtons}<div class="modal"><div class="vertical-tab-content">${inner}</div></div>`;

    test("passes an Obsidian button whose focus ring is the theme's, and a custom outline", async ({ win, obsidian }) => {
        await addBox(win, wrap('<button class="mod-cta">Save</button><select><option>a</option></select><button class="ring">Custom</button>'));
        expect(await win.evaluate(`getComputedStyle(document.querySelector("#opdk-layout-box button")).boxShadow`)).not.toBe("none");
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: false, focusRing: true })).toEqual([]);
    });

    test("names a button whose ring was removed even though it keeps its resting box-shadow", async ({ win, obsidian }) => {
        await addBox(win, wrap('<button class="mod-cta">Save</button><button class="stripped">Cancel</button>'));
        const problems = await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: false, focusRing: true });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ check: "focus-ring", where: "button.stripped" });
        await expect(obsidian.checkLayout({ root: ROOT, overflow: false, touchTargets: false, focusRing: { from: "button.mod-cta" } })).rejects.toThrow(/no focus ring: button\.stripped/);
    });

    test("starts at the first focusable that is shown, so a hidden or disabled first button is not the walk", async ({ win, obsidian }) => {
        await addBox(win, wrap('<button style="display:none">hidden</button><button disabled>off</button><button class="stripped">Bare</button>'));
        const problems = await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: false, focusRing: true });
        expect(problems.map((problem) => problem.where)).toEqual(["button.stripped"]);
    });

    test("fails, never passes, when nothing in the root can take focus", async ({ win, obsidian }) => {
        await addBox(win, '<p>text</p><button style="display:none">hidden</button>');
        await expect(obsidian.checkLayout({ root: ROOT, overflow: false, touchTargets: false, focusRing: true })).rejects.toThrow("nothing inside");
    });

    test("refuses a start that is outside the root", async ({ win, obsidian }) => {
        await addBox(win, wrap("<button>In</button>"));
        await expect(obsidian.checkLayout({ root: ROOT, overflow: false, touchTargets: false, focusRing: { from: "body" } })).rejects.toThrow(/is not inside/);
    });

    test("ends a trap without a problem, and reports focus leaving the root when stayInside is on", async ({ win, obsidian }) => {
        await addBox(win, wrap('<button class="ring" id="first">a</button><button class="ring" id="last">b</button>'));
        await win.evaluate(
            `document.getElementById("last").addEventListener("keydown", (event) => { if (event.key === "Tab" && !event.shiftKey) { event.preventDefault(); document.getElementById("first").focus(); } })`,
        );
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: false, focusRing: { stayInside: true } })).toEqual([]);
        await addBox(win, wrap('<button class="ring">a</button>'));
        const problems = await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: false, focusRing: { stayInside: true } });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ check: "focus-escape" });
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: false, focusRing: true })).toEqual([]);
    });
});

test.describe("focus ring on Obsidian's own UI", () => {
    const only = { overflow: false, touchTargets: false } as const;

    test("passes a click-first start: a mouse click does not make the first stop look ring-less", async ({ win, obsidian }) => {
        await addBox(win, '<div class="modal"><div class="vertical-tab-content"><button class="a">A</button><button class="b">B</button></div></div>');
        await win.locator(`${ROOT} button.b`).click();
        expect(await obsidian.layoutProblems({ root: ROOT, ...only, focusRing: true })).toEqual([]);
    });

    test("passes a .setting-item that rings itself on ::after, and a range slider that rings its thumb", async ({ win, obsidian }) => {
        await addBox(
            win,
            '<div class="modal"><div class="vertical-tab-content"><div class="setting-item mod-toggle" tabindex="0"><div class="setting-item-info"><div class="setting-item-name">Name</div></div><div class="setting-item-control"></div></div>' +
                '<input type="range" class="slider" min="0" max="10"></div></div>',
        );
        expect(await obsidian.layoutProblems({ root: ROOT, ...only, focusRing: true })).toEqual([]);
    });

    test("fails, never loses the walk, when a control replaces itself on blur; focusRing.ignore skips it", async ({ win, obsidian }) => {
        await addBox(win, '<div class="modal"><button class="a">a</button><button class="swap">swap</button></div>');
        await win.evaluate(`(() => { const b = document.querySelector("#opdk-layout-box .swap"); b.addEventListener("blur", () => b.replaceWith(b.cloneNode(true))); })()`);
        await expect(obsidian.checkLayout({ root: ROOT, ...only, focusRing: true })).rejects.toThrow(/button\.swap did not take focus back/);
        await addBox(win, '<div class="modal"><button class="a">a</button><button class="swap">swap</button></div>');
        await win.evaluate(`(() => { const b = document.querySelector("#opdk-layout-box .swap"); b.addEventListener("blur", () => b.replaceWith(b.cloneNode(true))); })()`);
        await obsidian.checkLayout({ root: ROOT, ...only, focusRing: { ignore: ".swap" } });
    });

    test("passes every core tab of the real settings modal", async ({ win, obsidian }) => {
        await obsidian.openSettings();
        const tabs = win.locator(".modal.mod-settings .vertical-tab-nav-item");
        const count = await tabs.count();
        expect(count).toBeGreaterThan(3);
        const failures: string[] = [];
        for (let index = 0; index < count; index++) {
            const tab = tabs.nth(index);
            const name = ((await tab.textContent()) ?? String(index)).trim();
            await tab.click();
            // A tab that is only text (a plugin's, here) has no Tab stop: the check says so instead of passing.
            if ((await win.locator(".modal.mod-settings .vertical-tab-content").locator("button, input, select, [tabindex='0']").count()) === 0) {
                continue;
            }
            const problems = await obsidian
                .layoutProblems({ root: ".modal.mod-settings .vertical-tab-content", ...only, focusRing: { maxStops: 100 } })
                .catch((error: unknown) => [{ check: "focus-ring", where: name, detail: String(error) }]);
            if (problems.length > 0) {
                failures.push(`${name}: ${JSON.stringify(problems)}`);
            }
        }
        await obsidian.closeSettings();
        expect(failures).toEqual([]);
    });

    test("passes the command palette once its search field is ignored: Obsidian shows the caret there, no ring", async ({ win, obsidian }) => {
        await win.evaluate(`globalThis.app.commands.executeCommandById("command-palette:open")`);
        await win.locator(".prompt").waitFor();
        expect(await obsidian.layoutProblems({ root: ".prompt", ...only, focusRing: { ignore: ".prompt-input" } })).toEqual([]);
        const bare = await obsidian.layoutProblems({ root: ".prompt", ...only, focusRing: true });
        expect(bare.map((problem) => problem.where)).toEqual(["input.prompt-input"]);
    });

    test("names a range input whose thumb ring was removed, by comparing pixels", async ({ win, obsidian }) => {
        await addBox(win, '<div class="modal"><div class="vertical-tab-content"><input type="range" class="slider flat" min="0" max="10"></div></div><style>.flat::-webkit-slider-thumb{box-shadow:none !important;border-color:transparent !important;outline:none !important}</style>');
        const problems = await obsidian.layoutProblems({ root: ROOT, ...only, focusRing: true });
        expect(problems.map((problem) => problem.where)).toEqual(["input.slider.flat"]);
    });
});
