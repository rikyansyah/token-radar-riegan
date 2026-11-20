// Token launch radar: the program (Node 22, standard library only).
//
// It reads the sealed snapshot (from /input/snapshot.json, or wherever
// --input points), scores every rankable pre-token protocol with the model
// in lib/model.ts, and writes the hand-in into the output directory: the
// ranked board at board.json, the dashboard's dataset at data.js, a copy of
// dashboard/ and screenshots/, and finally dossier.json, the summary the
// judge reads, built by the vendored library in vendor/makefun-board.ts.
//
// Away from the grader's container the output directory defaults to
// MAKEFUN_OUTPUT_DIR when that is set, and a run looks like:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// The caps the dossier is written under: the text cap shapes its bytes, the
// screenshot caps only refuse. They mirror the gate's own numbers.
const DOSSIER_TEXT_MAX = 65536;
const SHOT_CAPS = { max: 4, max_bytes: 524288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--name` in the arguments, in either spelling, or the fallback. */
function optionValue(name: string, fallback: string): string {
  const flag = '--' + name;
  const at = process.argv.indexOf(flag);
  if (at !== -1 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const prefix = flag + '=';
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit === undefined ? fallback : hit.slice(prefix.length);
}

/** Complain on stderr and stop with the given code. */
function die(code: number, message: string): never {
  process.stderr.write(message);
  process.exit(code);
}

const inputArg = optionValue('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  die(2, 'token radar: no snapshot at ' + inputFile + ': pass --input <snapshot.json|directory> or mount the sealed /input\n');
}
const outDir = optionValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const built = buildRadar(snapshot);
const problem = boardIssue(built.board, snapshot);
if (problem !== null) {
  die(1, 'token radar: the model wrote a board the gate refuses: ' + problem + '\n');
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: built.board }) + '\n');
writeFileSync(join(outDir, 'data.js'), dataScript(built.radar));

/** Copy a directory's regular files across, flat, skipping dot-names; returns the names copied. */
function copyFlat(fromDir: string, toDir: string): string[] {
  const copied: string[] = [];
  if (!existsSync(fromDir)) return copied;
  mkdirSync(toDir, { recursive: true });
  for (const name of readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const source = join(fromDir, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(toDir, name));
    copied.push(name);
  }
  return copied;
}

copyFlat(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyFlat(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  die(1, 'token radar: screenshots/ holds ' + shots.length + ' image' + (shots.length === 1 ? '' : 's') + ': hand in 3, the board, a detail view and a filtered view\n');
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    die(1, 'token radar: screenshots/' + name + ': a name is letters, digits and . _ -, 1 to 128 characters\n');
  }
}

// The dossier goes last: the scorer rebuilds it from this same output and
// compares the two byte for byte, so nothing may be written after it.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_MAX, screenshots: SHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4194304 } }));

const summaryLines = [
  'token radar: ' + snapshot.protocols.length + ' protocols, ' + snapshot.watchlist.length + ' on the watchlist, ' +
    built.board.length + ' rows scored (' + built.radar.early_size + ' early, ' + built.radar.live_size + ' live set aside)',
  'token radar: wrote ' + join(outDir, 'board.json') + ', ' + join(outDir, 'data.js') + ', ' + join(outDir, 'dashboard') +
    ' (3 files), ' + join(outDir, 'screenshots') + ' (' + shots.length + ' images) and ' + join(outDir, 'dossier.json'),
];
process.stdout.write(summaryLines.join('\n') + '\n');


