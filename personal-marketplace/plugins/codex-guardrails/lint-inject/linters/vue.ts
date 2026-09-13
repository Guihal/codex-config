import { defineLinter } from "./constructor.ts";
import { parseEslintJson, parseTscOutput } from "../parse.ts";
import { TS_CONFIG_DEFAULT } from "../auto-config-definitions.ts";

export const vue = defineLinter({
  name: "vue",
  exts: [".vue"],
  cold: [{ bin: "eslint", args: (files) => ["--format", "json", ...files], parse: parseEslintJson }],
  daemon: { bin: "vue-tsc", parse: parseTscOutput, autoConfig: TS_CONFIG_DEFAULT },
});
