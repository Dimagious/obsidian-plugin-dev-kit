import { describe, expect, it } from "vitest";
import { stripTerminalControls } from "./terminal-text.js";

describe("stripTerminalControls", () => {
    it("keeps ordinary text, newlines and tabs", () => {
        const text = "## [0.2.0] - 2026-11-20\n\n- `opdk kit upgrade`\tnow é中\n";
        expect(stripTerminalControls(text)).toBe(text);
    });

    it("removes colour and cursor sequences with their parameters", () => {
        expect(stripTerminalControls("a\u001b[31mred\u001b[0m b\u001b[2J\u001b[1;1Hc")).toBe("ared bc");
    });

    it("removes an OSC 52 clipboard write and an OSC 8 hyperlink, ended by BEL or by ESC backslash", () => {
        expect(stripTerminalControls("x\u001b]52;c;cm0gLXJmIH4=\u0007y")).toBe("xy");
        expect(stripTerminalControls("see \u001b]8;;https://evil.example\u001b\\the docs\u001b]8;;\u001b\\ now")).toBe("see the docs now");
        expect(stripTerminalControls("t\u001b]0;pwned\u0007")).toBe("t");
    });

    it("stops an unterminated OSC at the end of its line", () => {
        expect(stripTerminalControls("a\u001b]52;c;AAAA\nnext line")).toBe("a\nnext line");
    });

    it("removes BEL, CR (which overwrites the line), backspace, DEL, a lone ESC and the C1 range", () => {
        expect(stripTerminalControls("a\u0007b\rc\u0008d\u007fe\u001b\nf\u009bg\u009d52h\u0080i")).toBe("abcde\nfg52hi");
    });

    it("removes a two-byte escape such as ESC c (reset)", () => {
        expect(stripTerminalControls("a\u001bcb")).toBe("ab");
    });
});
