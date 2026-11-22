// Token launch radar, model radar-3 (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or
// --input <file|dir>), scores every rankable pre-token protocol with the
// model in lib/model.ts, validates it out-of-sample (leave-one-out,
// walk-forward, blind rank), writes the ranked board to /output/board.json,
// and writes the dashboard's data as /output/data.js. It copies this
// repository's dashboard/ to /output/dashboard/, generates
// /output/dashboard/1_model.js with the validation constants and live anchors
// (so the page can self-check in the browser), and decodes the screenshots
// from screenshots/*.jpg.b64 (base64 text, so the pictures travel as text)
// into /output/screenshots/. Last, it writes /output/dossier.json, the
// summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/3_app.css and dashboard/2_app.js read
// /output/data.js, which this program writes from the same board, plus the
// generated dashboard/1_model.js this program writes beside them.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PLAIN_IMAGE = /\.(png|jpe?g)$/i;
const ENCODED_IMAGE = /\.(png|jpe?g)\.b64$/i;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const rawSnapshot = readFileSync(inputFile, 'utf8');
const snapshotHash = createHash('sha256').update(rawSnapshot).digest('hex');
const snapshot = parseSnapshot(rawSnapshot);
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'board.json'),
  `${JSON.stringify({ rows: board, _metadata: { snapshot_hash: snapshotHash, spearman_benchmark: radar.validation.spearman_benchmark, live_anchors: radar.validation.anchors } })}\n`,
);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, recursively, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    const st = statSync(path);
    if (st.isDirectory()) copied.push(...copyFiles(path, join(to, name)).map((n) => `${name}/${n}`));
    else if (st.isFile()) {
      copyFileSync(path, join(to, name));
      copied.push(name);
    }
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashboardFiles.some((f) => f.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dashboardFiles.some((f) => f.endsWith('.js'))) fail('dashboard/ holds no .js file');

// The dashboard's generated model file: validation constants and live anchors,
// so the page can re-derive the Spearman benchmark in the browser and light the
// integrity strip. Written after the copy, so it is part of /output/dashboard/.
// The strip shows the short hash; board.json's _metadata carries the full one.
const pageValidation = {
  spearman_benchmark: radar.validation.spearman_benchmark,
  loo_3x_hit_rate: radar.validation.loo_3x_hit_rate,
  loo_2x_hit_rate: radar.validation.loo_2x_hit_rate,
  loo_median_log_error: radar.validation.loo_median_log_error,
  loo_mean_log_error: radar.validation.loo_mean_log_error,
  loo_median_ape: radar.validation.loo_median_ape,
  loo_recall_top20: radar.validation.loo_recall_top20.ratio,
  walk_forward: radar.validation.walk_forward,
  snapshot_hash: snapshotHash.slice(0, 8),
  total_live_anchors: radar.validation.anchors.length,
};
writeFileSync(
  join(out, 'dashboard', '1_model.js'),
  `// Generated by main.ts at build time — do not edit by hand.\nwindow.VALIDATION = ${JSON.stringify(pageValidation)};\nwindow.LIVE_ANCHORS = ${JSON.stringify(radar.validation.anchors)};\n`,
);

/** Whether the bytes are a whole PNG or JPEG, by their magic. */
function isImage(bytes: Buffer): boolean {
  if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  return false;
}

/** Decode the repo's screenshots into /output/screenshots, plain or base64. */
function writeScreenshots(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  const written: string[] = [];
  if (!existsSync(from)) return written;
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    const encoded = ENCODED_IMAGE.exec(name);
    const plain = PLAIN_IMAGE.exec(name);
    if (encoded === null && plain === null) continue;
    const target = encoded !== null ? name.slice(0, -4) : name;
    if (!IMAGE_NAME.test(target)) fail(`screenshots/${target}: a name is letters, digits and . _ -, 1 to 128 characters`);
    const bytes = encoded !== null ? Buffer.from(readFileSync(path, 'utf8').replace(/\s+/g, ''), 'base64') : readFileSync(path);
    if (!isImage(bytes)) fail(`screenshots/${name}: not a whole PNG or JPEG`);
    if (bytes.length > SCREENSHOT_CAPS.max_bytes) fail(`screenshots/${target} is ${bytes.length} bytes, past the 512 KiB cap`);
    writeFileSync(join(to, target), bytes);
    written.push(target);
  }
  return written;
}

const shots = writeScreenshots(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: validation LOO 3x hit ${(radar.validation.loo_3x_hit_rate * 100).toFixed(1)}%, MdALE ${radar.validation.loo_median_log_error}, Spearman ${radar.validation.loo_spearman}, Recall@20 ${radar.validation.loo_recall_top20.ratio}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
