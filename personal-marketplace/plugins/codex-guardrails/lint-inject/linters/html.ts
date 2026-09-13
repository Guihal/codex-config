import { defineLinter } from "./constructor.ts";
import { parsePrettierList } from "../parse.ts";

/** HTML: prettier --list-different (из node_modules проекта; prettier в PATH не нужен). */
export const html = defineLinter({
  name: "html",
  exts: [".html", ".htm"],
  cold: [{ bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true }],
});
