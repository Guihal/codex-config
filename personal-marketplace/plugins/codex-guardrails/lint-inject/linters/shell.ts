import { defineLinter } from "./constructor.ts";
import { parseShellcheckJson } from "../parse.ts";

export const shell = defineLinter({
  name: "shell",
  exts: [".sh"],
  cold: [{ bin: "shellcheck", args: (files) => ["--format=json", ...files], parse: parseShellcheckJson, configless: true }],
});
