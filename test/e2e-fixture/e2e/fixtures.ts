import path from "node:path";
import { createObsidianTest } from "../../../src/e2e/index.js";

const root = path.join(import.meta.dirname, "..");

export const FIXTURE_ID = "opdk-e2e-fixture";
export const SECOND_ID = "opdk-e2e-second";
export const SEED_VAULT = path.join(root, "vault");
export const SEEDED_GREETING = "hello from data.json";

export const { test, expect, onlyWhen } = createObsidianTest({
    seedVault: SEED_VAULT,
    plugins: [{ dir: path.join(root, "plugins", FIXTURE_ID) }, { dir: path.join(root, "plugins", SECOND_ID) }],
    data: { [FIXTURE_ID]: { greeting: SEEDED_GREETING } },
});
