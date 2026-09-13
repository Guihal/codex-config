import { defineLinter } from "./constructor.ts";
import { parseEslintJson, parsePrettierList } from "../parse.ts";
import { ESLINT_CONFIG_DEFAULT } from "../auto-config-definitions.ts";

export const js = defineLinter({
  name: "js",
  exts: [".js", ".mjs", ".cjs", ".jsx"],
  cold: [
    { bin: "eslint", args: (files) => ["--format", "json", ...files], parse: parseEslintJson, autoConfig: ESLINT_CONFIG_DEFAULT },
    { bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true },
  ],
});
