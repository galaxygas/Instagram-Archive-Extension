// ZIP output built with client-zip 2.5.1 (MIT, streaming, Zip64, no compression).
//
// - "stream" mode (Chrome): the archive is streamed straight to a file the user picked
//   with showSaveFilePicker(), so memory use stays flat for any size.
// - "parts" mode (Firefox, or Chrome without the picker): Firefox has no File System
//   Access API, so the ZIP is cut into separate, complete ZIP files of a set size; each
//   is held in memory once and then saved with downloads.download().
import { makeZip } from '../../lib/client-zip/index.js';
import { joinPath } from './naming.js';
import { DownloadError } from './writer-folder.js';

class Part {
  constructor(sink) {
    this.queue = [];
    this.waiting = null;
    this.closed = false;
    this.bytes = 0;
    this.sink = sink;
    this.done = this.pump();
  }

  push(entry) {
    this.queue.push(entry);
    this.wake();
  }

  close() {
    this.closed = true;
    this.wake();
  }

  wake() {
    const w = this.waiting;
    this.waiting = null;
    w?.();
  }

  async *entries() {
    for (;;) {
      if (!this.queue.length) {
        if (this.closed) return;
        await new Promise((resolve) => { this.waiting = resolve; });
        continue;
      }
      const entry = this.queue.shift();
      let input;
      try {
        input = await entry.make();
      } catch (error) {
        entry.reject(error);
        continue;
      }
      yield { name: entry.name, input, lastModified: entry.lastModified };
      // client-zip asks for the next entry only after this one was fully written.
      entry.resolve({ bytes: entry.size ?? 0 });
    }
  }

  async pump() {
    const reader = makeZip(this.entries()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      this.bytes += value.byteLength;
      await this.sink.write(value);
    }
    await this.sink.close();
  }
}

export class ZipWriter {
  /**
   * @param {object} o
   * @param {'stream'|'parts'} o.mode
   * @param {FileSystemFileHandle} [o.fileHandle] for stream mode
   * @param {number} [o.partSize] bytes, for parts mode
   * @param {string} o.baseName e.g. "Gram Archiver/natgeo/natgeo_2026-10-31"
   * @param {import('./writer-folder.js').FolderWriter} o.saver used to save parts
   */
  constructor({ mode, fileHandle, partSize = 1024 ** 3, baseName, saver, log = () => {} }) {
    this.kind = 'zip';
    this.mode = mode;
    this.fileHandle = fileHandle;
    this.partSize = partSize;
    this.baseName = baseName;
    this.saver = saver;
    this.log = log;
    this.names = new Set();
    this.partNo = 0;
    this.part = null;
    this.files = 0;
    this.bytes = 0;
    this.savedParts = [];
  }

  async init() {
    await this.newPart();
  }

  async newPart() {
    this.partNo += 1;
    if (this.mode === 'stream') {
      const writable = await this.fileHandle.createWritable();
      this.part = new Part({
        write: (chunk) => writable.write(chunk),
        close: () => writable.close(),
      });
      return;
    }
    const chunks = [];
    const partNo = this.partNo;
    this.part = new Part({
      write: (chunk) => { chunks.push(chunk); },
      close: async () => {
        const blob = new Blob(chunks, { type: 'application/zip' });
        chunks.length = 0;
        const name = `${this.baseName}.part${String(partNo).padStart(3, '0')}.zip`;
        await this.saver.saveBlob(name, blob);
        this.savedParts.push(name);
        this.log('info', `Saved ${name} (${(blob.size / 1024 ** 2).toFixed(1)} MB).`);
      },
    });
  }

  async rotateIfNeeded() {
    if (this.mode !== 'parts' || !this.part || this.part.bytes < this.partSize) return;
    const old = this.part;
    old.close();
    await old.done;
    await this.newPart();
  }

  uniqueName(path) {
    let name = joinPath(path);
    if (!this.names.has(name)) {
      this.names.add(name);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let i = 2;
    while (this.names.has(`${stem} (${i})${ext}`)) i += 1;
    name = `${stem} (${i})${ext}`;
    this.names.add(name);
    return name;
  }

  async enqueue(path, make) {
    await this.rotateIfNeeded();
    // Light back-pressure so the job does not run far ahead of the ZIP stream.
    while (this.part.queue.length > 8) await new Promise((r) => setTimeout(r, 200));
    const name = this.uniqueName(path);
    const result = await new Promise((resolve, reject) => {
      this.part.push({ name, make, lastModified: new Date(), resolve, reject });
    });
    this.files += 1;
    return result;
  }

  saveUrl(path, url) {
    return this.enqueue(path, async () => {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) {
        const err = new DownloadError(`HTTP ${res.status} for media`, `HTTP_${res.status}`);
        if (res.status === 403 || res.status === 410) err.expired = true;
        throw err;
      }
      return res;
    });
  }

  saveBlob(path, blob) {
    return this.enqueue(path, async () => blob);
  }

  saveText(path, text) {
    return this.enqueue(path, async () => text);
  }

  saveJson(path, value) {
    return this.saveText(path, JSON.stringify(value, null, 2));
  }

  async fetchBlob(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      const err = new DownloadError(`HTTP ${res.status} for media`, `HTTP_${res.status}`);
      if (res.status === 403 || res.status === 410) err.expired = true;
      throw err;
    }
    return res.blob();
  }

  async close() {
    if (!this.part) return;
    this.part.close();
    await this.part.done;
    this.part = null;
  }
}
