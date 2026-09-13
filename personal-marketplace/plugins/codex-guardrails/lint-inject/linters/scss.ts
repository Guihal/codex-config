import { defineLinter } from "./constructor.ts";
import { parsePrettierList } from "../parse.ts";

export const scss = defineLinter({
  name: "scss",
  exts: [".scss"],
  cold: [{ bin: "prettier", args: (files) => ["--list-different", ...files], parse: parsePrettierList, configless: true }],
});
