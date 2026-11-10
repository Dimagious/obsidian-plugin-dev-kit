import { describe, expect, it } from "vitest";
import { findNodeOnlyReferences } from "./bundle-check.js";

describe("findNodeOnlyReferences", () => {
    it("passes browser-safe code", () => {
        const code = 'class A{run(){return document.title+"process"+Math.max(1,2)}}module.exports=A;';
        expect(findNodeOnlyReferences(code)).toEqual([]);
    });

    it("passes an empty bundle", () => {
        expect(findNodeOnlyReferences("")).toEqual([]);
    });

    it.each(["env", "emitWarning", "platform", "version", "cwd", "argv"])("flags process.%s", (property) => {
        const problems = findNodeOnlyReferences(`var x=process.${property};`);
        expect(problems).toContain(`a \`process\` reference: ${JSON.stringify(`process.${property}`)}`);
    });

    it("flags process with whitespace around the dot", () => {
        expect(findNodeOnlyReferences("process . env.X")).toHaveLength(1);
    });

    it("does not flag a word that merely ends in process", () => {
        expect(findNodeOnlyReferences("var x=preprocess.env;")).toEqual([]);
    });

    it.each(['require("node:fs")', "require('node:path')", 'require( "node:os")'])("flags %s", (call) => {
        const problems = findNodeOnlyReferences(call);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("a `node:` builtin import");
    });

    it("does not flag require of a non-node: module", () => {
        expect(findNodeOnlyReferences('require("obsidian")')).toEqual([]);
    });

    it.each(["__dirname", "__filename"])("flags %s", (name) => {
        expect(findNodeOnlyReferences(`path.join(${name},"x")`)).toEqual([
            `\`__dirname\` or \`__filename\`: ${JSON.stringify(name)}`,
        ]);
    });

    it.each(["LOG_TOKENS", "LOG_STREAM", "emitWarning"])("flags the dependency marker %s even when minified", (marker) => {
        const problems = findNodeOnlyReferences(`a.${marker}=1`);
        expect(problems).toContain(`\`${marker}\`, which only the Node build of a dependency contains`);
    });

    it("reports every problem, not only the first", () => {
        const problems = findNodeOnlyReferences('process.env.LOG_TOKENS;require("node:fs");__dirname');
        expect(problems).toHaveLength(4);
    });
});
