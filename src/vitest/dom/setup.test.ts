// @vitest-environment jsdom
import { afterAll, expect, it } from "vitest";
import { uninstallObsidianDom } from "./index.js";
import "./setup.js";

afterAll(uninstallObsidianDom);

it("the setup file installs the helpers on import", () => {
    expect(document.body.createDiv({ cls: "ok" }).className).toBe("ok");
    expect(activeDocument).toBe(document);
});
