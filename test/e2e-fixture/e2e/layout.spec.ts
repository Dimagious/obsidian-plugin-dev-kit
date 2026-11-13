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

    test("leaves out a box that scrolls on purpose, and a check that is turned off", async ({ win, obsidian }) => {
        await addBox(win, '<div style="width:100px;overflow-x:auto"><div style="width:400px;height:10px"></div></div>');
        expect(await obsidian.layoutProblems({ root: ROOT, touchTargets: false })).toEqual([]);
        await addBox(win, '<div style="width:100px;overflow:hidden"><div style="width:400px;height:10px"></div></div>');
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: false })).toEqual([]);
    });

    test("fails when the root is not there", async ({ obsidian }) => {
        await expect(obsidian.checkLayout({ root: "#nothing-here" })).rejects.toThrow('nothing matches the root "#nothing-here"');
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
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false })).toEqual([]);
        await obsidian.mobile();
        await addBox(win, small);
        const problems = await obsidian.layoutProblems({ root: ROOT, overflow: false });
        expect(problems.map((problem) => problem.where)).toEqual(["button.tiny"]);
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: { ignore: ".tiny" } })).toEqual([]);
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: { minSize: 20 } })).toEqual([]);
    });
});

test.describe("focus ring", () => {
    const style = "<style>#opdk-layout-box button{all:unset;display:block;width:80px;height:30px}#opdk-layout-box .ring:focus{outline:2px solid blue}#opdk-layout-box .shadow:focus{box-shadow:0 0 0 2px blue}</style>";

    test("passes when every stop shows an outline or a box-shadow, and the walk ends where focus leaves the root", async ({ win, obsidian }) => {
        await addBox(win, `${style}<button class="ring" tabindex="0">a</button><button class="shadow" tabindex="0">b</button>`);
        expect(await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: false, focusRing: true })).toEqual([]);
    });

    test("names the stop that has none", async ({ win, obsidian }) => {
        await addBox(win, `${style}<button class="ring" tabindex="0">a</button><button class="bare" tabindex="0">b</button>`);
        const problems = await obsidian.layoutProblems({ root: ROOT, overflow: false, touchTargets: false, focusRing: true });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ check: "focus-ring", where: "button.bare" });
        await expect(obsidian.checkLayout({ root: ROOT, overflow: false, touchTargets: false, focusRing: { from: ".ring" } })).rejects.toThrow(/no focus ring: button\.bare/);
    });

    test("fails when nothing in the root can take focus", async ({ win, obsidian }) => {
        await addBox(win, "<p>text</p>");
        await expect(obsidian.checkLayout({ root: ROOT, overflow: false, touchTargets: false, focusRing: true })).rejects.toThrow("nothing inside");
    });
});
