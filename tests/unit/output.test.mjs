import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipWriter } from '../../extension/archive/core/writer-zip.js';
import { muxTracks } from '../../extension/archive/core/mux.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const hasUnzip = spawnSync('unzip', ['-v']).status === 0;

test('zip writer (parts mode) produces valid ZIP parts', { skip: !hasUnzip && 'unzip not installed' }, async () => {
  const saved = [];
  const saver = { async saveBlob(name, blob) { saved.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) }); } };
  const zip = new ZipWriter({ mode: 'parts', partSize: 1, baseName: 'example/example_run', saver });
  await zip.init();
  await zip.saveJson('example/data/a.json', { a: 1 });
  await zip.saveText('example/data/a.json', 'dup name');
  await zip.saveBlob('example/posts/x.bin', new Blob([new Uint8Array(1000)]));
  await zip.close();
  assert.ok(saved.length >= 2, 'part size forces several parts');
  const dir = mkdtempSync(join(tmpdir(), 'ga-zip-'));
  const names = [];
  for (const [i, part] of saved.entries()) {
    const file = join(dir, `p${i}.zip`);
    writeFileSync(file, part.bytes);
    names.push(...execFileSync('unzip', ['-Z1', file]).toString().trim().split('\n').filter(Boolean));
    execFileSync('unzip', ['-tq', file]);
  }
  assert.deepEqual(names.sort(), ['example/data/a (2).json', 'example/data/a.json', 'example/posts/x.bin']);
  assert.match(saved[0].name, /example\/example_run\.part001\.zip$/);
});

test('mux joins DASH video and audio tracks into one playable MP4', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ga-mux-'));
  const v = join(dir, 'v.mp4');
  const a = join(dir, 'a.m4a');
  const out = join(dir, 'out.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', v]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', a]);
  const vb = readFileSync(v);
  const ab = readFileSync(a);
  const bytes = await muxTracks(vb.buffer.slice(vb.byteOffset, vb.byteOffset + vb.byteLength), ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength));
  writeFileSync(out, Buffer.from(bytes));
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out]).toString().trim().split('\n');
  assert.deepEqual(probe.sort(), ['aac', 'h264']);
  execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-']);
});
