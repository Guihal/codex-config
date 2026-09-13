#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "./injection-rules/errors.mjs";
import { routeHook } from "./injection-rules/router.mjs";

async function main() {
  try {
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const { output, warnings } = routeHook(JSON.parse(raw));
    for (const warning of warnings) process.stderr.write(`${warning}\n`);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    process.stderr.write(`[injection-rules] ${errorMessage(error)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
