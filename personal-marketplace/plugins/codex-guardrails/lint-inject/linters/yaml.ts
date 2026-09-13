import { defineLinter } from "./constructor.ts";
import { parsePrettierList, parseYamllint } from "../parse.ts";

/**
 * YAML: yamllint (parsable) + prettier (форматирование).
 * Зависимость: yamllint (Arch: `sudo pacman -S yamllint`); prettier — из node_modules проекта.
 */
export const yaml = defineLinter({
  name: "yaml",
  exts: [".yaml", ".yml"],
  cold: [
    { bin: "yamllint", args: (files) => ["-f", "parsable", ...files], parse: parseYamllint, configless: true },
    { bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true },
  ],
});
