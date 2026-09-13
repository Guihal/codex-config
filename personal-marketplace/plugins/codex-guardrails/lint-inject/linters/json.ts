import { defineLinter } from "./constructor.ts";
import { parsePrettierList } from "../parse.ts";

export const json = defineLinter({
  name: "json",
  exts: [".json"],
  cold: [{ bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true }],
});
