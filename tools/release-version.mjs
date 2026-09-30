// Keep committed release labels aligned; no build step or runtime dependency.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = resolve(root, 'package.json');
const modulePath = resolve(root, 'app/version.js');
const workerPath = resolve(root, 'service-worker.js');
const [manifestText, moduleText, workerText] = await Promise.all(
  [manifestPath, modulePath, workerPath].map((path) => readFile(path, 'utf8'))
);
const manifest = JSON.parse(manifestText);
const arg = process.argv[2];
const version = arg === '--check' ? manifest.version : arg;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) {
  throw new Error('Use node tools/release-version.mjs MAJOR.MINOR.PATCH, or --check.');
}
const modulePattern = /export const APP_VERSION = "[^"]+";/;
const workerPattern = /const CACHE_NAME = "mdnotes-shell-v[^"]+";/;
if (!modulePattern.test(moduleText) || !workerPattern.test(workerText)) {
  throw new Error('Release markers are missing; no files were changed.');
}
const nextModule = moduleText.replace(modulePattern, `export const APP_VERSION = "${version}";`);
const nextWorker = workerText.replace(workerPattern, `const CACHE_NAME = "mdnotes-shell-v${version}";`);
if (arg === '--check') {
  if (nextModule !== moduleText || nextWorker !== workerText) throw new Error('Release labels differ from package.json.');
  console.log(`Release labels agree: v${version}`);
} else {
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(modulePath, nextModule);
  await writeFile(workerPath, nextWorker);
  console.log(`Release set to v${version}; sync compatibility unchanged.`);
}
