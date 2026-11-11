import { describe, expect, it } from "vitest";
import { hasTool, realToolsGate } from "../test-support/ffmpeg-gate.js";
import { createFfmpegTool, probeFfmpeg } from "./ffmpeg-run.js";

const ffmpegAvailable = hasTool("ffmpeg");
const versionGate = realToolsGate("reads the version line of a real ffmpeg", ffmpegAvailable);
const encodersGate = realToolsGate("lists encoders of a real ffmpeg", ffmpegAvailable);

describe("probeFfmpeg", () => {
    it("reports a command that does not exist", async () => {
        const probe = await probeFfmpeg("opdk-no-such-ffmpeg-binary");
        expect(probe.ok).toBe(false);
        expect(probe.error).toMatch(/opdk-no-such-ffmpeg-binary could not run/);
    });

    it("reports a command that exits non-zero", async () => {
        // `node -version` is not a valid node flag combination: node exits 9.
        const probe = await probeFfmpeg(process.execPath);
        expect(probe.ok).toBe(false);
    });

    it.skipIf(versionGate.skip)(versionGate.title, async () => {
        const probe = await probeFfmpeg("ffmpeg");
        expect(probe.ok).toBe(true);
        expect(probe.version).toMatch(/^ffmpeg version /);
    });
});

describe("createFfmpegTool", () => {
    // `node` stands in for ffmpeg: the tool only runs a command and reads its exit code and streams.
    const tool = createFfmpegTool(process.execPath);

    it("returns stdout of a command that succeeds", async () => {
        expect((await tool.capture(["-e", "process.stdout.write('abc')"])).toString()).toBe("abc");
        await expect(tool.run(["-e", "0"])).resolves.toBeUndefined();
    });

    it("fails with the exit code and the tail of stderr", async () => {
        const lines = Array.from({ length: 12 }, (_, i) => `noise ${String(i)}`).join("\\n");
        await expect(tool.run(["-e", `console.error('${lines}\\nthe real reason'); process.exit(3)`])).rejects.toThrow(
            /exited with code 3:\n(noise \d+\n)+the real reason$/,
        );
    });

    it("fails a run that exits 0 but prints errors (ffmpeg skips a frame it cannot decode and still exits 0)", async () => {
        await expect(tool.run(["-e", "console.error('png: chunk too big')"])).rejects.toThrow(/exited with code 0 but reported errors:\npng: chunk too big$/);
        // Reading a picture back is not an encode: stderr does not decide there.
        await expect(tool.capture(["-e", "console.error('note'); process.stdout.write('ok')"])).resolves.toEqual(Buffer.from("ok"));
    });

    it("kills a command that runs past the timeout and says so", async () => {
        const impatient = createFfmpegTool(process.execPath, 300);
        await expect(impatient.run(["-e", "setTimeout(() => {}, 30000)"])).rejects.toThrow(/did not finish in 0\.3 s and was killed/);
        await expect(impatient.capture(["-e", "setTimeout(() => {}, 30000)"])).rejects.toThrow(/was killed/);
    });

    it("says it could not run a missing binary", async () => {
        await expect(createFfmpegTool("opdk-no-such-ffmpeg-binary").run([])).rejects.toThrow(/opdk-no-such-ffmpeg-binary could not run/);
    });

    it.skipIf(encodersGate.skip)(encodersGate.title, async () => {
        expect(await createFfmpegTool("ffmpeg").encoders()).toContain("png");
    });
});
