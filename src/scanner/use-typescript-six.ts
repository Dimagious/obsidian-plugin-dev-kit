import { useTypescriptSix } from "./typescript-six.js";

/**
 * Imported before ESLint, typescript-eslint and eslint-plugin-obsidianmd (ES modules evaluate their imports in
 * order), so their `typescript` resolves to the kit's TypeScript 6. See typescript-six.ts.
 */
export const scanTypescript = useTypescriptSix();
