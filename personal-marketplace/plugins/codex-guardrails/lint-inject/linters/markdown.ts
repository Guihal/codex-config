import { defineLinter } from "./constructor.ts";
import { parseMarkdownlintJson } from "../parse.ts";
import { MARKDOWNLINT_CONFIG_DEFAULT } from "../auto-config-definitions.ts";

export const markdown = defineLinter({
  name: "markdown",
  exts: [".md"],
  cold: [{ bin: "markdownlint", args: (files) => ["--json", ...files], parse: parseMarkdownlintJson, autoConfig: MARKDOWNLINT_CONFIG_DEFAULT }],
});
