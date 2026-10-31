// Builds store-ready packages from extension/ (no dependencies, Node 22+):
//   dist/gram-archiver-<version>-chrome.zip   (Chrome Web Store)
//   dist/gram-archiver-<version>-firefox.zip  (addons.mozilla.org)
// The source folder already loads unpacked in both browsers; packaging only removes
// the manifest keys the other browser ignores, so neither store reports warnings.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');

function walk(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name);
    if (name.startsWith('.')) return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Minimal ZIP writer (deflate, no Zip64; extension packages are small). */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // Fixed timestamp (1980-01-01) keeps the packages reproducible.
  const time = 0;
  const date = (0 << 9) | (1 << 5) | 1;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function manifestFor(target) {
  const m = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
  if (target === 'chrome') {
    delete m.background.scripts;
    delete m.browser_specific_settings;
  } else {
    delete m.background.service_worker;
    delete m.minimum_chrome_version;
  }
  return Buffer.from(`${JSON.stringify(m, null, 2)}\n`);
}

mkdirSync(DIST, { recursive: true });
const version = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8')).version;
const files = walk(SRC).filter((f) => !f.endsWith('.map'));
for (const target of ['chrome', 'firefox']) {
  const entries = files.map((file) => {
    const name = relative(SRC, file).split(sep).join('/');
    return { name, data: name === 'manifest.json' ? manifestFor(target) : readFileSync(file) };
  });
  const out = join(DIST, `gram-archiver-${version}-${target}.zip`);
  writeFileSync(out, zip(entries));
  console.log(`${relative(ROOT, out)}  (${entries.length} files, ${(statSync(out).size / 1024).toFixed(0)} KB)`);
}
