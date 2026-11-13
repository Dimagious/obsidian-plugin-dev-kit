/** Vitest setup file: after each test, remove the temp folders its helpers made and it did not remove. */
import { afterEach } from "vitest";
import { removeRegisteredTempDirs } from "./temp-registry.js";

afterEach(() => {
    removeRegisteredTempDirs();
});
