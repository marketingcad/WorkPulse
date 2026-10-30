/**
 * Renders the finished tutorial video from the recorded clips (`pnpm tutorial:render`):
 * a synthetic voiceover per scene, each clip trimmed to its scene and held until its narration
 * ends, the zooms from its .markers.json, the callouts from the script, title, chapter and end
 * cards, chapter marks, and captions timed to the real audio (as an .srt next to the MP4).
 *
 * Output in e2e/tutorial/video (git-ignored): workpulse-tutorial.mp4, workpulse-tutorial.en.srt,
 * workpulse-tutorial-thumbnail.png and youtube-chapters.txt. TUTORIAL_MUSIC=<audio file> mixes a
 * music track in quietly under the voice. Work files and the voice cache are in e2e/.tmp/tutorial-render, so a
 * re-run only redoes the scenes whose clip, words or voice changed.
 *
 * Voice, from TUTORIAL_TTS:
 * - `piper` (default): Piper, a free open-source voice that runs on this computer. TUTORIAL_VOICE
 *   (default "en_US-lessac-high") names a voice from https://huggingface.co/rhasspy/piper-voices.
 *   Piper and the voice are downloaded into e2e/.tmp/piper on first use.
 * - `windows`: a built-in Windows voice, TUTORIAL_VOICE (default "Microsoft Zira Desktop"). Robotic.
 * - `openai`: OPENAI_API_KEY; TUTORIAL_VOICE (default "alloy"), TUTORIAL_TTS_MODEL (default "gpt-4o-mini-tts").
 * - `elevenlabs`: ELEVENLABS_API_KEY; TUTORIAL_VOICE is the voice id.
 *
 * Needs ffmpeg (`winget install Gyan.FFmpeg`), or FFMPEG and FFPROBE set to its executables.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clock, srtTime, timedCues } from './format';
import { CHAPTERS, slug, VIDEO, type Scene } from './scenes';

const HERE = import.meta.dirname;
const CLIPS = path.join(HERE, 'clips');
const WORK = path.resolve(HERE, '../.tmp/tutorial-render');
const OUT = path.join(HERE, 'video');
const NAME = 'workpulse-tutorial';

/** Silence before and after the narration in each scene. */
const LEAD = 0.4;
const TAIL = 0.8;
/** The fastest a scene's footage is played to keep up with its narration. */
const MAX_SPEED = 1.5;
/** Background music level under the voice (TUTORIAL_MUSIC): about −20 dB. */
const MUSIC_VOLUME = 0.1;
/** Zoom: how long it holds, how long the ease in and out takes, and its largest factor (subtle). */
const ZOOM_HOLD = 3.5;
const ZOOM_EASE = 0.6;
const ZOOM_MAX = 1.6;
const BG = '0x111A3A';
const ACCENT = '0xA5B4FC';
const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];

type Tts = 'piper' | 'windows' | 'openai' | 'elevenlabs';
const TTS = (process.env.TUTORIAL_TTS ?? 'piper') as Tts;
const VOICE = process.env.TUTORIAL_VOICE ?? { piper: 'en_US-lessac-high', windows: 'Microsoft Zira Desktop', openai: 'alloy', elevenlabs: '' }[TTS];
const PIPER = path.resolve(HERE, '../.tmp/piper');
const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const MODEL = process.env.TUTORIAL_TTS_MODEL ?? (TTS === 'openai' ? 'gpt-4o-mini-tts' : 'eleven_multilingual_v2');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Marker {
  at: number;
  label: string;
  box?: Box;
}
/** One piece of the final cut, in order. */
interface Segment {
  file: string;
  seconds: number;
  scene?: Scene;
  /** the chapter this segment opens */
  chapter?: string;
}

function tool(name: 'ffmpeg' | 'ffprobe'): string {
  const set = process.env[name.toUpperCase()];
  if (set) return set;
  if (spawnSync(name, ['-version']).status === 0) return name;
  // winget installs ffmpeg without updating the PATH of shells that are already open.
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(root)) {
    for (const pkg of readdirSync(root).filter((d) => d.startsWith('Gyan.FFmpeg'))) {
      for (const build of readdirSync(path.join(root, pkg))) {
        const exe = path.join(root, pkg, build, 'bin', `${name}.exe`);
        if (existsSync(exe)) return exe;
      }
    }
  }
  throw new Error(`${name} not found: install ffmpeg (winget install Gyan.FFmpeg) or set ${name.toUpperCase()}`);
}
const FFMPEG = tool('ffmpeg');
const FFPROBE = tool('ffprobe');

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: WORK, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code} for ${args.at(-1)}\n${err}`))));
  });
}

function seconds(file: string): number {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const s = Number(r.stdout.trim());
  if (!Number.isFinite(s) || s <= 0) throw new Error(`cannot read the length of ${file}: ${r.stderr}`);
  return s;
}

const hash = (...parts: string[]) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Narration as a voice should read it: no symbols it would spell out. */
const spoken = (text: string) => text.replace(/\s*›\s*/g, ', ').replace(/\s*→\s*/g, ' to ');

// ─── Voice ───────────────────────────────────────────────────────────────────

async function voices(scenes: Scene[]): Promise<Map<string, string>> {
  const dir = path.join(WORK, 'voice');
  mkdirSync(dir, { recursive: true });
  const ext = TTS === 'windows' || TTS === 'piper' ? 'wav' : 'mp3';
  const files = new Map<string, string>();
  const todo: Array<{ text: string; out: string }> = [];
  for (const s of scenes) {
    const out = path.join(dir, `${s.id}.${hash(TTS, VOICE, MODEL, s.narration)}.${ext}`);
    files.set(s.id, out);
    if (!existsSync(out)) todo.push({ text: spoken(s.narration), out });
  }
  if (todo.length) console.log(`[render] voice: ${todo.length} scene(s) with ${TTS} "${VOICE}"`);
  if (TTS === 'windows' && todo.length) {
    const jobs = path.join(dir, 'jobs.json');
    const script = path.join(dir, 'speak.ps1');
    writeFileSync(jobs, JSON.stringify(todo.map((j) => ({ text: j.text, out: `${j.out}.part` }))), 'utf8');
    writeFileSync(
      script,
      [
        'param([string]$Jobs, [string]$Voice)',
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        '$s.SelectVoice($Voice)',
        'foreach ($j in (Get-Content -Raw -Encoding UTF8 $Jobs | ConvertFrom-Json)) { $s.SetOutputToWaveFile($j.out); $s.Speak($j.text) }',
        '$s.SetOutputToNull()',
      ].join('\r\n'),
      'utf8',
    );
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Jobs', jobs, '-Voice', VOICE], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Windows speech failed: ${r.stderr || r.stdout}`);
    for (const j of todo) renameSync(`${j.out}.part`, j.out);
  }
  if (TTS === 'piper' && todo.length) {
    const { exe, model } = await piper();
    for (const j of todo) {
      const r = spawnSync(exe, ['--model', model, '--output_file', `${j.out}.part`, '--sentence_silence', '0.3', '--length_scale', '1.05'], { input: j.text, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`Piper failed: ${r.stderr}`);
      renameSync(`${j.out}.part`, j.out);
    }
  }
  if (TTS === 'openai' || TTS === 'elevenlabs') for (const j of todo) writeFileSync(j.out, await speakOnline(j.text));
  return files;
}

async function download(url: string, to: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  writeFileSync(`${to}.part`, Buffer.from(await res.arrayBuffer()));
  renameSync(`${to}.part`, to);
}

/** Piper and the voice model, downloaded on first use. */
async function piper(): Promise<{ exe: string; model: string }> {
  if (process.platform !== 'win32') throw new Error('TUTORIAL_TTS=piper downloads the Windows build; elsewhere install Piper and use the OpenAI or ElevenLabs voice, or extend this');
  const exe = path.join(PIPER, 'piper', 'piper.exe');
  if (!existsSync(exe)) {
    console.log('[render] downloading Piper');
    mkdirSync(PIPER, { recursive: true });
    const zip = path.join(PIPER, 'piper.zip');
    await download(PIPER_RELEASE, zip);
    // Windows' own tar opens zip files.
    const r = spawnSync(path.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', PIPER]);
    if (r.status !== 0) throw new Error(`cannot unpack Piper: ${r.stderr}`);
  }
  // "en_US-lessac-high" lives at en/en_US/lessac/high/ in the voice repository.
  const name = /^([a-z]+)_([A-Z]+)-(.+)-(x_low|low|medium|high)$/.exec(VOICE);
  if (!name) throw new Error(`TUTORIAL_VOICE="${VOICE}" is not a Piper voice name like en_US-lessac-high`);
  const model = path.join(PIPER, 'voices', `${VOICE}.onnx`);
  if (!existsSync(model)) {
    console.log(`[render] downloading the Piper voice ${VOICE}`);
    mkdirSync(path.dirname(model), { recursive: true });
    const base = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${name[1]}/${name[1]}_${name[2]}/${name[3]}/${name[4]}/${VOICE}`;
    await download(`${base}.onnx.json`, `${model}.json`);
    await download(`${base}.onnx`, model);
  }
  return { exe, model };
}

async function speakOnline(text: string): Promise<Buffer> {
  const key = process.env[TTS === 'openai' ? 'OPENAI_API_KEY' : 'ELEVENLABS_API_KEY'];
  if (!key) throw new Error(`TUTORIAL_TTS=${TTS} needs ${TTS === 'openai' ? 'OPENAI_API_KEY' : 'ELEVENLABS_API_KEY'}`);
  const res =
    TTS === 'openai'
      ? await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            voice: VOICE,
            input: text,
            response_format: 'mp3',
            ...(MODEL.startsWith('gpt-') ? { instructions: 'A professional, friendly product trainer. Calm pace, a little slower than conversation.' } : {}),
          }),
        })
      : await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE || '')}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, model_id: MODEL }),
        });
  if (!res.ok) throw new Error(`${TTS} speech failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── Pictures ────────────────────────────────────────────────────────────────

/** The words of a scene's callouts: the quoted text of each overlay. Title and end cards are drawn separately. */
function callouts(s: Scene): string[] {
  return s.overlays
    .filter((o) => !/^(Title card|Subtitle|End card)/.test(o) && !o.includes('e.g.'))
    .map((o) => {
      const quoted = [...o.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
      if (!quoted.length) return o.slice(o.indexOf(':') + 1).trim();
      return quoted.join('').length > 60 ? quoted.join('\n') : quoted.join('   ·   ');
    });
}

/** A drawtext filter. The text goes through a file named after it, so it needs no escaping and a change re-renders. */
function text(t: string, o: { size: number; bold?: boolean; color?: string; y: string; box?: boolean; from?: number; to?: number }): string {
  const file = `text/${hash(t)}.txt`;
  writeFileSync(path.join(WORK, file), t, 'utf8');
  const opts = [
    `textfile=${file}`,
    // Segoe UI has no check marks; Segoe UI Symbol has them and the letters too.
    `fontfile=fonts/${/[✓✔]/.test(t) ? 'seguisym' : o.bold ? 'segoeuib' : 'segoeui'}.ttf`,
    'expansion=none',
    `fontsize=${o.size}`,
    `fontcolor=${o.color ?? 'white'}`,
    'line_spacing=12',
    'x=(w-text_w)/2',
    `y=${o.y}`,
  ];
  if (o.box) opts.push(`box=1`, `boxcolor=${BG}@0.9`, 'boxborderw=26');
  if (o.from !== undefined && o.to !== undefined) {
    const [a, b] = [round(o.from), round(o.to)];
    opts.push(`enable='between(t,${a},${b})'`, `alpha='min(1,min((t-${a})/0.3,(${b}-t)/0.3))'`);
  }
  return `drawtext=${opts.join(':')}`;
}

/** Eased zoom-ins on each marked box, from the clip's .markers.json (times from the trimmed start). */
function zoompan(marks: Marker[]): string | null {
  const boxes = marks.filter((m): m is Marker & { box: Box } => !!m.box && m.at >= 0).sort((a, b) => a.at - b.at);
  const zooms = boxes
    .map((m, i) => {
      const end = Math.min(m.at + ZOOM_HOLD, (boxes[i + 1]?.at ?? Infinity) - 0.05);
      const factor = Math.min(ZOOM_MAX, (1920 * 0.6) / m.box.width, (1080 * 0.6) / m.box.height);
      return { a: round(m.at), b: round(end), e: round(Math.min(ZOOM_EASE, (end - m.at) / 3)), z: round(factor), cx: m.box.x + m.box.width / 2, cy: m.box.y + m.box.height / 2 };
    })
    .filter((z) => z.z >= 1.08 && z.b > z.a + 0.5);
  if (!zooms.length) return null;
  // Each zoom rises and falls with a smoothstep; zooms never overlap, so their sums are the active one.
  const p = (z: (typeof zooms)[number]) => `min(clip((it-${z.a})/${z.e},0,1),clip((${z.b}-it)/${z.e},0,1))`;
  const zoom = `1+${zooms.map((z) => `${round(z.z - 1)}*(${p(z)})*(${p(z)})*(3-2*(${p(z)}))`).join('+')}`;
  const active = zooms.map((z) => `between(it,${z.a},${z.b})`).join('+');
  const cx = `${zooms.map((z) => `between(it,${z.a},${z.b})*${z.cx}`).join('+')}+(1-(${active}))*iw/2`;
  const cy = `${zooms.map((z) => `between(it,${z.a},${z.b})*${z.cy}`).join('+')}+(1-(${active}))*ih/2`;
  return `zoompan=z='${zoom}':x='clip(${cx}-iw/zoom/2,0,iw-iw/zoom)':y='clip(${cy}-ih/zoom/2,0,ih-ih/zoom)':d=1:fps=30:s=1920x1080`;
}

// ─── Segments ────────────────────────────────────────────────────────────────

/** Encodes one segment unless an identical one is already there. */
async function encode(name: string, inputs: string[], graph: string, length: number, stamp = ''): Promise<string> {
  const file = `seg/${name}.mp4`;
  const filter = `seg/${name}.filter.txt`;
  const key = hash(inputs.join(' '), graph, String(length), ENCODE.join(' '), stamp);
  const keyFile = path.join(WORK, `seg/${name}.key`);
  if (existsSync(path.join(WORK, file)) && existsSync(keyFile) && readFileSync(keyFile, 'utf8') === key) return file;
  writeFileSync(path.join(WORK, filter), graph, 'utf8');
  await ffmpeg([...inputs, '-/filter_complex', filter, '-map', '[v]', '-map', '[a]', '-t', String(round(length)), ...ENCODE, file]);
  writeFileSync(keyFile, key);
  return file;
}

const audioIn = (voice: string | undefined) => (voice ? ['-i', voice] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']);
const audioGraph = (length: number, fadeOut: number | null) =>
  `[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${LEAD * 1000}:all=1,apad,atrim=0:${round(length)}${fadeOut ? `,afade=t=out:st=${round(length - fadeOut)}:d=${fadeOut}` : ''}[a]`;

async function scene(s: Scene, voice: string, first: boolean, last: boolean): Promise<Segment> {
  const base = `${s.id}-${slug(s.title)}`;
  const clip = path.join(CLIPS, `${base}.webm`);
  const markersFile = path.join(CLIPS, `${base}.markers.json`);
  if (!existsSync(clip) || !existsSync(markersFile)) throw new Error(`no clip for scene ${s.id}: run pnpm tutorial:record first (${clip})`);
  const markers = (JSON.parse(readFileSync(markersFile, 'utf8')) as { markers: Marker[] }).markers;
  const start = markers.find((m) => m.label.startsWith('scene start'))?.at ?? 0;
  const end = markers.find((m) => m.label.startsWith('scene end'))?.at ?? seconds(clip);
  const speech = seconds(voice);
  // Where the clicking outlasts the words, play the footage faster (up to 1.5×) rather than leave a silence.
  const speed = Math.min(MAX_SPEED, Math.max(1, (end - start) / (LEAD + speech + TAIL + 1)));
  const picture = (end - start) / speed;
  const length = Math.max(picture, LEAD + speech + TAIL);

  const shown = callouts(s);
  const slot = (length - 1.5) / Math.max(1, shown.length);
  const notes = shown.map((t, i) => text(t, { size: 40, bold: true, y: 'h-text_h-150', box: true, from: 1.5 + i * slot, to: 1.5 + i * slot + Math.min(5, slot - 0.4) }));
  const zoom = zoompan(markers.map((m) => ({ ...m, at: (m.at - start) / speed })));
  const video = [
    `setpts=(PTS-STARTPTS)/${round(speed)}`,
    'fps=30',
    'scale=1920:1080',
    `tpad=stop_mode=clone:stop_duration=${round(length - picture + 0.1)}`,
    ...(zoom ? [zoom] : []),
    ...notes,
    ...(first ? ['fade=t=in:st=0:d=0.4'] : []),
    ...(last ? [`fade=t=out:st=${round(length - 0.4)}:d=0.4`] : []),
    'format=yuv420p',
  ];
  const graph = `[0:v]${video.join(',')}[v];\n${audioGraph(length, last ? 0.4 : null)}`;
  const st = statSync(clip);
  // A re-recorded clip has the same name: its size and time tell the cache it changed.
  const file = await encode(s.id, ['-ss', String(start), '-to', String(end), '-i', clip, ...audioIn(voice)], graph, length, `${st.size} ${st.mtimeMs}`);
  return { file, seconds: length, scene: s };
}

async function card(name: string, lines: Array<Parameters<typeof text>[1] & { t: string }>, length: number, voice?: string, fadeOut = 0.5): Promise<Segment> {
  const video = [...lines.map((l) => text(l.t, l)), 'fade=t=in:st=0:d=0.5', `fade=t=out:st=${round(length - fadeOut)}:d=${fadeOut}`, 'format=yuv420p'];
  const graph = `[0:v]${video.join(',')}[v];\n${audioGraph(length, fadeOut)}`;
  const file = await encode(name, ['-f', 'lavfi', '-i', `color=c=${BG}:s=1920x1080:r=30`, ...audioIn(voice)], graph, length);
  return { file, seconds: length };
}

/** Runs jobs a few at a time (each ffmpeg already uses several cores), keeping their order. */
async function pool<T>(jobs: Array<() => Promise<T>>, size = 3): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]!();
        if (++done % 10 === 0 || done === jobs.length) console.log(`[render] ${done}/${jobs.length} segments`);
      }
    }),
  );
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  for (const d of ['seg', 'text', 'fonts']) mkdirSync(path.join(WORK, d), { recursive: true });
  mkdirSync(OUT, { recursive: true });
  // drawtext reads fonts by relative path: a drive letter's colon would need escaping in the filter.
  for (const f of ['segoeui.ttf', 'segoeuib.ttf', 'seguisym.ttf']) copyFileSync(path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', f), path.join(WORK, 'fonts', f));

  const scenes = CHAPTERS.flatMap((c) => c.scenes);
  const voice = await voices(scenes);
  const tagline = 'Track • Focus • Achieve';

  const jobs: Array<() => Promise<Segment>> = [
    () =>
      card('00-title', [
        { t: 'WorkPulse', size: 132, bold: true, y: 'h/2-190' },
        { t: 'Complete Tutorial', size: 64, y: 'h/2-20' },
        { t: tagline, size: 40, color: ACCENT, y: 'h/2+90' },
      ], 4).then((s) => ({ ...s, chapter: CHAPTERS[0]!.title })),
  ];
  for (const [ci, c] of CHAPTERS.entries()) {
    if (ci > 0)
      jobs.push(() =>
        card(`${String(c.n).padStart(2, '0')}-chapter`, [
          { t: `Chapter ${c.n}`, size: 40, color: ACCENT, y: 'h/2-90' },
          { t: c.title, size: 84, bold: true, y: 'h/2-20' },
        ], 3).then((s) => ({ ...s, chapter: c.title })),
      );
    for (const [si, s] of c.scenes.entries()) {
      const v = voice.get(s.id)!;
      if (s.app === 'edit')
        // The only scene made in the editor is the closing one: the end card, read over.
        jobs.push(async () => ({
          ...(await card(s.id, [
            { t: 'WorkPulse', size: 132, bold: true, y: 'h/2-200' },
            { t: tagline, size: 48, color: ACCENT, y: 'h/2-20' },
            { t: 'Help is always in the app: Help › Search', size: 40, y: 'h/2+90' },
          ], LEAD + seconds(v) + 2, v, 1)),
          scene: s,
        }));
      else jobs.push(() => scene(s, v, si === 0, si === c.scenes.length - 1));
    }
  }
  const segments = await pool(jobs);

  // Captions and chapter marks from the real lengths.
  const srt: string[] = [];
  const chapters: Array<{ title: string; at: number }> = [];
  let t = 0;
  for (const g of segments) {
    if (g.chapter) chapters.push({ title: g.chapter, at: chapters.length ? t : 0 });
    if (g.scene) for (const [a, b, p] of timedCues(g.scene.narration, t + LEAD, seconds(voice.get(g.scene.id)!))) srt.push(String(srt.length / 4 + 1), `${srtTime(a)} --> ${srtTime(b)}`, p, '');
    t += g.seconds;
  }
  const total = t;
  writeFileSync(path.join(WORK, 'list.txt'), segments.map((g) => `file '${g.file}'`).join('\n'), 'utf8');
  writeFileSync(path.join(WORK, 'captions.srt'), srt.join('\n'), 'utf8');
  writeFileSync(
    path.join(WORK, 'metadata.txt'),
    [
      ';FFMETADATA1',
      `title=${VIDEO.title}`,
      ...chapters.flatMap((c, i) => ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.at * 1000)}`, `END=${Math.round((chapters[i + 1]?.at ?? total) * 1000)}`, `title=${c.title}`]),
    ].join('\n'),
    'utf8',
  );

  const mp4 = path.join(OUT, `${NAME}.mp4`);
  console.log('[render] joining the segments');
  // Captions stay in the .srt next to the MP4: an embedded caption track corrupts the MP4's first chapter mark.
  const music = process.env.TUTORIAL_MUSIC;
  if (music && !existsSync(music)) throw new Error(`TUTORIAL_MUSIC: no file at ${music}`);
  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'metadata.txt',
    ...(music
      ? [
          '-stream_loop', '-1', '-i', path.resolve(music),
          // Quietly under the voice, looped for the whole video, faded in and out.
          '-filter_complex', `[2:a]volume=${MUSIC_VOLUME},atrim=0:${round(total)},afade=t=in:d=2,afade=t=out:st=${round(total - 4)}:d=4[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`,
          '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
        ]
      : ['-map', '0:v', '-map', '0:a', '-c', 'copy']),
    '-map_metadata', '1', '-map_chapters', '1', '-movflags', '+faststart', mp4,
  ]);
  await thumbnail();
  copyFileSync(path.join(WORK, 'captions.srt'), path.join(OUT, `${NAME}.en.srt`));
  writeFileSync(path.join(OUT, 'youtube-chapters.txt'), `${chapters.map((c) => `${clock(c.at)} ${c.title}`).join('\n')}\n`, 'utf8');
  console.log(`[render] ${path.relative(process.cwd(), mp4)} · ${clock(total)} · ${segments.length} segments · voice: ${TTS} "${VOICE}"${music ? ` · music: ${path.basename(music)}` : ''}`);
}

/** The thumbnail from the script's concept (scenes.ts VIDEO.thumbnail), built from frames of the real app. */
async function thumbnail(): Promise<void> {
  const frame = (id: string, before: number) => {
    const s = CHAPTERS.flatMap((c) => c.scenes).find((x) => x.id === id)!;
    const base = path.join(CLIPS, `${s.id}-${slug(s.title)}`);
    const end = (JSON.parse(readFileSync(`${base}.markers.json`, 'utf8')) as { markers: Marker[] }).markers.find((m) => m.label.startsWith('scene end'))!.at;
    return ['-ss', String(round(end - before)), '-i', `${base}.webm`];
  };
  const filter = 'seg/thumbnail.filter.txt';
  writeFileSync(
    path.join(WORK, filter),
    [
      // The Overview (01.1) as the main picture, the desktop timer card (07.3) floating over its right edge.
      // Both frames are seeked to; their times start at 0 to line up with the background's only frame.
      '[1:v]setpts=PTS-STARTPTS,scale=800:-1,pad=iw+8:ih+8:4:4:white[ov];',
      '[2:v]setpts=PTS-STARTPTS,crop=564:228:826:136,scale=500:-1,pad=iw+8:ih+8:4:4:white[tm];',
      '[0:v][ov]overlay=48:250[a];',
      '[a]drawbox=x=752:y=318:w=516:h=218:color=black@0.35:t=fill[b];',
      `[b][tm]overlay=744:310,${[
        text('WorkPulse', { size: 104, bold: true, y: '22' }).replace('x=(w-text_w)/2', 'x=44'),
        text('Complete Tutorial', { size: 76, bold: true, color: '0xFFD23F', y: '140' }).replace('x=(w-text_w)/2', 'x=48'),
        text('Time • Approvals • Payroll', { size: 30, bold: true, y: 'h-text_h-52', box: true }).replace('x=(w-text_w)/2', 'x=w-text_w-56').replace('boxborderw=26', 'boxborderw=18'),
      ].join(',')}[v]`,
    ].join('\n'),
    'utf8',
  );
  await ffmpeg([
    '-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x5B5FD6:c1=0x2E3192:x0=0:y0=0:x1=1280:y1=720:nb_colors=2',
    ...frame('01.1', 3), ...frame('07.3', 5),
    '-/filter_complex', filter, '-map', '[v]', '-frames:v', '1', path.join(OUT, `${NAME}-thumbnail.png`),
  ]);
}

await main();
