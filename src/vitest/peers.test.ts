import { describe, expect, it } from "vitest";
import { assertUnitPeers, findUnitPeerProblems } from "./peers.js";

const reader = (versions: Record<string, string>) => (name: string) => versions[name];
const messages = (versions: Record<string, string>, dom: boolean): string[] => findUnitPeerProblems(reader(versions), dom).map((p) => p.message);

describe("findUnitPeerProblems", () => {
    it("is empty for Vitest 5, the same coverage version and jsdom 30", () => {
        expect(messages({ vitest: "5.1.0", "@vitest/coverage-v8": "5.1.0", jsdom: "30.1.1" }, true)).toEqual([]);
        expect(messages({ vitest: "5.0.0", "@vitest/coverage-v8": "5.0.0", jsdom: "31.0.0" }, true)).toEqual([]);
    });

    it("names an old Vitest and the coverage package that goes with it", () => {
        const problems = findUnitPeerProblems(reader({ vitest: "3.2.4", "@vitest/coverage-v8": "3.2.4" }), false);
        expect(problems.map((p) => p.message)).toEqual([
            '"vitest" 3.2.4 is installed; the kit needs ^5.0.0.',
            '"@vitest/coverage-v8" 3.2.4 is installed; the kit needs ^5.0.0.',
        ]);
        expect(problems.map((p) => p.install)).toEqual(["vitest@^5.0.0", "@vitest/coverage-v8@^5.0.0"]);
    });

    it("rejects Vitest 6, which the kit has not been tested on", () => {
        expect(messages({ vitest: "6.0.0", "@vitest/coverage-v8": "6.0.0" }, false)[0]).toContain('"vitest" 6.0.0');
    });

    it("reports Vitest as not installed", () => {
        expect(messages({ "@vitest/coverage-v8": "5.1.0" }, false)).toEqual(['"vitest" is not installed; the kit needs ^5.0.0.']);
    });

    it("reports a missing coverage package with the version of the installed Vitest", () => {
        const problems = findUnitPeerProblems(reader({ vitest: "5.1.0" }), false);
        expect(problems).toEqual([
            { message: '"@vitest/coverage-v8" is not installed; the kit needs the same version as "vitest" (5.1.0).', install: "@vitest/coverage-v8@5.1.0" },
        ]);
    });

    it("reports a coverage package of another version, even inside major 5", () => {
        const problems = findUnitPeerProblems(reader({ vitest: "5.1.0", "@vitest/coverage-v8": "5.0.2" }), false);
        expect(problems).toEqual([
            { message: '"@vitest/coverage-v8" 5.0.2 is installed next to "vitest" 5.1.0; the two must be the same version.', install: "@vitest/coverage-v8@5.1.0" },
        ]);
    });

    it("checks jsdom only when asked", () => {
        const versions = { vitest: "5.1.0", "@vitest/coverage-v8": "5.1.0", jsdom: "26.1.0" };
        expect(messages(versions, false)).toEqual([]);
        expect(messages(versions, true)).toEqual(['"jsdom" 26.1.0 is installed; the kit needs >=30.0.0.']);
    });

    it("reports jsdom as not installed", () => {
        expect(messages({ vitest: "5.1.0", "@vitest/coverage-v8": "5.1.0" }, true)).toEqual(['"jsdom" is not installed; the kit needs >=30.0.0.']);
    });
});

describe("assertUnitPeers", () => {
    it("does not throw when the versions fit", () => {
        expect(() => {
            assertUnitPeers(reader({ vitest: "5.1.0", "@vitest/coverage-v8": "5.1.0" }), false);
        }).not.toThrow();
    });

    it("throws one error with every problem and one install command", () => {
        expect(() => {
            assertUnitPeers(reader({ vitest: "3.2.4", "@vitest/coverage-v8": "3.2.4", jsdom: "26.1.0" }), true);
        }).toThrow(
            /"vitest" 3\.2\.4[^]*"@vitest\/coverage-v8" 3\.2\.4[^]*"jsdom" 26\.1\.0[^]*Run: npm install --save-dev vitest@\^5\.0\.0 @vitest\/coverage-v8@\^5\.0\.0 "jsdom@>=30\.0\.0"/,
        );
    });
});
