#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { inspectFile, applySession } from "./runtime.mjs";
import { checkFile } from "./qa.mjs";
const help = `Local Canvas Runtime v1. Prints JSON. Document scripts stay disabled.
inspect <file.html> [--page <id>] [--element <id>] [--details] [--base-url <loopback-url>]
  Reads saved bytes, real CSS-pixel geometry, styles, resources and capabilities.
apply <session.json> <request.json>
  Stages an atomic sparse patch in a live AI work copy. Required revision identifies that work copy.
  Omitted style properties stay unchanged; null removes a declaration. Does not commit the document.
check <file.html> [--base-url <loopback-url>]
  Reuses existing saved-file QA. No automatic fixes.
Exit: 0=ok/applied/no-op, 2=issues/incomplete, 1=invalid input/conflict/execution error.`;
try {
  const [mode, file, ...args] = process.argv.slice(2);
  if (mode === "--help") {
    console.log(help);
  } else {
    let result;
    if (mode === "apply" && file && args.length === 1) {
      const raw = await readFile(args[0], "utf8");
      if (raw.length > 100000) throw new Error("Patch request is too large.");
      result = await applySession(file, JSON.parse(raw));
    } else if (["inspect", "check"].includes(mode) && file) {
      const options = {};
      for (let i = 0; i < args.length; i++) {
        const name = {
          "--page": "pageId",
          "--element": "elementId",
          "--details": "details",
          "--base-url": "baseUrl",
        }[args[i]];
        if (
          !name ||
          Object.hasOwn(options, name) ||
          (mode === "check" && name !== "baseUrl")
        )
          throw new Error("Unknown or duplicate option.");
        if (name === "details") options[name] = true;
        else {
          if (!args[i + 1]) throw new Error("Option value is missing.");
          options[name] = args[++i];
        }
      }
      result = await (mode === "inspect"
        ? inspectFile(file, options)
        : checkFile(file, options));
    } else throw new Error(help);
    console.log(JSON.stringify(result));
    if (result.status === "issues") process.exitCode = 2;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      schemaVersion: 1,
      status: "failed",
      error: { code: "RUNTIME_FAILED", message: error.message.slice(0, 512) },
      committed: false,
    }),
  );
  process.exitCode = 1;
}
