#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createResourceServer, localResourceUrl, readSavedSnapshot } from './saved-file.mjs';
import { measureDocumentText } from './text-measure.mjs';
import { QA_OUTPUT } from './src/qa-result.js';

const help = `Read-only layout and text-contrast QA for a saved HTML snapshot. Prints one bounded JSON result.
Usage: node html-design/qa.mjs check <file.html> [--base-url <loopback-url>]
Checks text overflow/clipping, element bounds, image decoding, unmarked painted containers, reliable rendered Chinese line breaks and WCAG AA text contrast (local axe-core).
Relative resources use a temporary read-only server rooted at the input directory.
--base-url uses an existing loopback file URL, including original resources for an AI work copy.
Reads saved bytes only; no document scripts, writes, editor takeover or automatic fixes.
Exit: 0=checked without issues, 2=issues or incomplete coverage, 1=input/execution error.`;

export async function checkFile(input, { baseUrl, signal } = {}) {
  if (!/\.html?$/i.test(input)) throw new Error('Input must be an HTML file.');
  if (baseUrl) baseUrl = localResourceUrl(baseUrl);
  const { inputPath, resourceRoot, snapshot, revision } = await readSavedSnapshot(input, { baseUrl, signal });
  if (inputPath.length > QA_OUTPUT.pathCodeUnits) throw new Error('QA source path exceeds 4096 UTF-16 units.');
  let resources;
  try {
    if (!baseUrl) {
      resources = await createResourceServer(resourceRoot);
      baseUrl = `${resources.origin}/${encodeURIComponent(path.basename(inputPath))}`;
    }
    const result = await measureDocumentText({ mode: 'qa', html: snapshot.toString('utf8'), baseUrl }, { signal });
    return { ...result, source: { kind: 'saved-file', path: inputPath, revision } };
  } finally { await resources?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('QA interrupted.'));
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') console.log(help);
    else {
      if (args[0] !== 'check' || !args[1] || (args.length !== 2 && !(args.length === 4 && args[2] === '--base-url' && args[3]))) throw new Error('Expected check <file.html> [--base-url <loopback-url>]. Use --help.');
      const result = await checkFile(args[1], { baseUrl: args[3], signal: controller.signal });
      console.log(JSON.stringify(result));
      if (result.status !== 'ok') process.exitCode = 2;
    }
  } catch (error) {
    console.error(JSON.stringify({ schemaVersion: 1, status: 'error', error: { code: 'QA_FAILED', message: error.message.slice(0, 512) } }));
    process.exitCode = 1;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
