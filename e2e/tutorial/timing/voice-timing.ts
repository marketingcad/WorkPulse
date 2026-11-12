/**
 * When each narration word is spoken in a scene's voice file.
 *
 * - ElevenLabs voices come with character times (saved next to the voice as <voice>.alignment.json).
 * - Any other voice is aligned with whisper.cpp, which runs on this computer: the Windows build and its
 *   base.en model (~150 MB) download into e2e/.tmp/whisper on first use, as Piper does.
 * - The recognized words are matched to the script (align.ts). When that fails, or matches fewer than
 *   MIN_MATCH of the words, or TUTORIAL_ALIGN=off, the word-count estimate is used, with a warning.
 *
 * Results are cached in <work>/align, keyed by the voice file's bytes, the narration and ALIGN_VERSION.
 *
 * Try it on one voice file: node ../node_modules/tsx/dist/cli.mjs tutorial/timing/voice-timing.ts <scene id> <voice file>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { alignToScript, estimateWords, MIN_MATCH } from './align';
import { normalize } from './anchors';
import type { Aligner, WordTime } from './types';

/** Bump when the alignment changes, so cached results are redone. */
export const ALIGN_VERSION = 1;

const WHISPER_DIR = path.resolve(import.meta.dirname, '../../.tmp/whisper');
const WHISPER_RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip';
const WHISPER_MODEL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';

/** Downloads a file, writing it under its final name only once it is complete. */
export async function download(url: string, to: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  writeFileSync(`${to}.part`, Buffer.from(await res.arrayBuffer()));
  renameSync(`${to}.part`, to);
}

/** Unpacks a zip with Windows' own tar, which opens zip files. */
export function unzip(zip: string, into: string): void {
  const r = spawnSync(path.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', into], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cannot unpack ${path.basename(zip)}: ${r.stderr}`);
}

/** Words from whisper-cli's JSON (`-oj`, one word per item with `-ml 1 -sow`), in seconds. */
export function parseWhisper(json: unknown): WordTime[] {
  const items = (json as { transcription?: Array<{ offsets: { from: number; to: number }; text: string }> }).transcription;
  if (!Array.isArray(items)) throw new Error('not whisper output: no "transcription" list');
  return items
    .map((x) => ({ word: x.text.trim(), start: x.offsets.from / 1000, end: x.offsets.to / 1000 }))
    .filter((x) => x.word && !/^\[.*\]$/.test(x.word) && normalize(x.word));
}

/** Words from ElevenLabs' character times (the `alignment` of a with-timestamps response). */
export function charsToWords(a: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }): WordTime[] {
  const words: WordTime[] = [];
  let word: WordTime | null = null;
  a.characters.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (word) words.push(word);
      word = null;
    } else if (word) {
      word.word += c;
      word.end = a.character_end_times_seconds[i]!;
    } else word = { word: c, start: a.character_start_times_seconds[i]!, end: a.character_end_times_seconds[i]! };
  });
  if (word) words.push(word);
  return words;
}

let whisperReady: Promise<{ exe: string; model: string }> | null = null;

/** whisper-cli and the base.en model, downloaded once. */
function whisper(): Promise<{ exe: string; model: string }> {
  whisperReady ??= (async () => {
    if (process.platform !== 'win32') throw new Error('the whisper.cpp download is the Windows build');
    mkdirSync(WHISPER_DIR, { recursive: true });
    const exe = path.join(WHISPER_DIR, 'Release', 'whisper-cli.exe');
    if (!existsSync(exe)) {
      console.log('[render] downloading whisper.cpp');
      const zip = path.join(WHISPER_DIR, 'whisper.zip');
      await download(WHISPER_RELEASE, zip);
      unzip(zip, WHISPER_DIR);
      if (!existsSync(exe)) throw new Error(`no whisper-cli.exe in ${WHISPER_RELEASE} (found ${readdirSync(WHISPER_DIR).join(', ')})`);
    }
    const model = path.join(WHISPER_DIR, 'ggml-base.en.bin');
    if (!existsSync(model)) {
      console.log('[render] downloading the whisper base.en model (~150 MB)');
      await download(WHISPER_MODEL, model);
    }
    return { exe, model };
  })();
  return whisperReady;
}

/** The words whisper.cpp hears in a voice file. */
async function hear(id: string, voiceFile: string, ffmpeg: string, dir: string): Promise<WordTime[]> {
  const { exe, model } = await whisper();
  const wav = path.join(dir, `${id}.16k.wav`);
  const out = path.join(dir, `${id}.whisper`);
  const convert = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', voiceFile, '-ar', '16000', '-ac', '1', wav], { encoding: 'utf8' });
  if (convert.status !== 0) throw new Error(`ffmpeg could not convert the voice: ${convert.stderr}`);
  const r = spawnSync(exe, ['-m', model, '-f', wav, '-l', 'en', '-ml', '1', '-sow', '-oj', '-of', out, '-np', '-dtw', 'base.en'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`whisper-cli failed: ${r.stderr || r.stdout}`);
  return parseWhisper(JSON.parse(readFileSync(`${out}.json`, 'utf8')));
}

export interface VoiceTiming {
  words: WordTime[];
  aligner: Aligner;
  /** the share of script words the recognizer matched (0 for the estimate) */
  ratio: number;
}

/** One time per script word of the scene's narration, from its voice file. Never throws for alignment trouble. */
export async function wordTimes(scene: { id: string; narration: string }, voiceFile: string, o: { ffmpeg: string; voiceSeconds: number; work: string }): Promise<VoiceTiming> {
  const estimate = (why?: string): VoiceTiming => {
    if (why) console.warn(`[render] ${scene.id}: word times estimated (${why})`);
    return { words: estimateWords(scene.narration, o.voiceSeconds), aligner: 'estimate', ratio: 0 };
  };
  if (process.env.TUTORIAL_ALIGN === 'off') return estimate();

  const dir = path.join(o.work, 'align');
  mkdirSync(dir, { recursive: true });
  const key = createHash('sha256').update(readFileSync(voiceFile)).update(`|${scene.narration}|${ALIGN_VERSION}`).digest('hex').slice(0, 12);
  const cache = path.join(dir, `${scene.id}.${key}.json`);
  if (existsSync(cache)) {
    const cached = JSON.parse(readFileSync(cache, 'utf8')) as VoiceTiming;
    return cached.ratio < MIN_MATCH ? estimate(`only ${Math.round(cached.ratio * 100)}% of the words matched`) : cached;
  }

  let found: VoiceTiming;
  try {
    const sidecar = `${voiceFile}.alignment.json`;
    const fromProvider = existsSync(sidecar);
    const heard = fromProvider ? charsToWords(JSON.parse(readFileSync(sidecar, 'utf8'))) : await hear(scene.id, voiceFile, o.ffmpeg, dir);
    const { words, ratio } = alignToScript(scene.narration, heard, o.voiceSeconds);
    found = { words, aligner: fromProvider ? 'elevenlabs' : 'whisper', ratio };
  } catch (e) {
    return estimate((e as Error).message.split('\n')[0]);
  }
  writeFileSync(cache, JSON.stringify(found), 'utf8');
  return found.ratio < MIN_MATCH ? estimate(`only ${Math.round(found.ratio * 100)}% of the words matched`) : found;
}

// A direct run aligns one voice file and prints what came out.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [id, voice] = process.argv.slice(2);
  if (!id || !voice) throw new Error('usage: voice-timing.ts <scene id> <voice file>');
  const { sceneById } = await import('../scenes');
  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
  const probe = spawnSync(process.env.FFPROBE ?? 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', voice], { encoding: 'utf8' });
  const t = await wordTimes(sceneById(id), voice, { ffmpeg, voiceSeconds: Number(probe.stdout.trim()), work: path.resolve(import.meta.dirname, '../../.tmp/tutorial-render') });
  console.log(`aligner ${t.aligner} · ratio ${t.ratio.toFixed(2)} ·`, t.words.slice(0, 5).map((w) => `${w.word}@${w.start}`).join(' '));
}
