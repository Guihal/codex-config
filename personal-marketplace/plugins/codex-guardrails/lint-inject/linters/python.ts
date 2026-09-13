import { defineLinter } from "./constructor.ts";
import { parseRuffJson } from "../parse.ts";

export const python = defineLinter({
  name: "python",
  exts: [".py"],
  cold: [{ bin: "ruff", args: (files) => ["check", "--output-format", "json", ...files], parse: parseRuffJson, configless: true }],
});
