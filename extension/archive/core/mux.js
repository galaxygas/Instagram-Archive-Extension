// Mux a DASH video track and audio track into one regular (non-fragmented) MP4 with
// mp4box.js 2.5.0, copying samples without re-encoding.
//
// Adapted from HOAIAN2/Instagram-Downloader 6.0.5 src/muxer/muxer-frame.js
// (MIT License, Copyright (c) 2022 HOAI AN LE). See THIRD_PARTY_NOTICES.md.
import { BoxParser, createFile, MP4BoxBuffer } from '../../lib/mp4box/mp4box.all.mjs';

function extractTrack(arrayBuffer, kind) {
  return new Promise((resolve, reject) => {
    const file = createFile();
    const samples = [];
    let ready = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (ready && samples.length) resolve({ ...ready, samples });
      else reject(new Error(ready ? `No ${kind} samples found` : `Missing ${kind} track`));
    };
    file.onError = (e) => { if (!settled) { settled = true; reject(new Error(String(e))); } };
    file.onReady = (info) => {
      const track = info.tracks.find((t) => (kind === 'video' ? t.video : t.audio));
      if (!track) return finish();
      const sampleEntry = file.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
      ready = { track, sampleEntry };
      file.onSamples = (_id, _user, batch) => {
        samples.push(...batch);
        // Non-fragmented files announce their sample count up front.
        if (track.nb_samples && samples.length >= track.nb_samples) finish();
      };
      file.setExtractionOptions(track.id, null, { nbSamples: 1000 });
      file.start();
    };
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0));
    file.flush();
    // mp4box parses synchronously; for fragmented files (nb_samples unknown) finish
    // once the whole buffer has been processed.
    setTimeout(finish, 0);
  });
}

function mediaDuration(source) {
  const first = Math.min(...source.samples.map((s) => s.dts));
  return Math.max(...source.samples.map((s) => s.dts + s.duration)) - first;
}

function addOutputTrack(output, source, id, movieTimescale) {
  const { track, sampleEntry } = source;
  const isVideo = Boolean(track.video);
  const duration = mediaDuration(source);
  return output.addTrack({
    id,
    type: sampleEntry.type,
    timescale: track.timescale,
    duration: Math.round((duration * movieTimescale) / track.timescale),
    media_duration: duration,
    width: track.video?.width,
    height: track.video?.height,
    hdlr: isVideo ? 'vide' : 'soun',
    language: track.language || 'und',
    channel_count: track.audio?.channel_count,
    samplerate: track.audio?.sample_rate,
    samplesize: track.audio?.sample_size,
    description_boxes: sampleEntry.boxes,
  });
}

function addCopiedSample(output, trackId, s) {
  output.addSample(trackId, s.data, {
    duration: s.duration,
    cts: s.cts,
    dts: s.dts,
    is_sync: s.is_sync,
    is_leading: s.is_leading,
    depends_on: s.depends_on,
    is_depended_on: s.is_depended_on,
    has_redundancy: s.has_redundancy,
    degradation_priority: s.degradation_priority,
    subsamples: s.subsamples,
  });
}

function runLength(values) {
  const counts = [];
  const entries = [];
  for (const v of values) {
    if (entries.length && entries[entries.length - 1] === v) counts[counts.length - 1] += 1;
    else { entries.push(v); counts.push(1); }
  }
  return { counts, entries };
}

function chunksOf(trackId, samples, target = 1) {
  const chunks = [];
  let start = 0;
  let startTime = samples[0].dts / samples[0].timescale;
  for (let i = 1; i < samples.length; i++) {
    const t = samples[i].dts / samples[i].timescale;
    if (t - startTime < target) continue;
    chunks.push({ trackId, start, end: i - 1, time: startTime });
    start = i;
    startTime = t;
  }
  chunks.push({ trackId, start, end: samples.length - 1, time: startTime });
  return chunks;
}

function configureSampleTable(output, track, chunks) {
  const stbl = output.getTrackById(track.id).mdia.minf.stbl;
  const durations = runLength(track.samples.map((s) => s.duration));
  stbl.stts.sample_counts = durations.counts;
  stbl.stts.sample_deltas = durations.entries;
  stbl.stsz.sample_size = 0;
  stbl.stsz.sample_sizes = track.samples.map((s) => s.data.byteLength);
  stbl.stsc.first_chunk = [];
  stbl.stsc.samples_per_chunk = [];
  stbl.stsc.sample_description_index = [];
  let previous = -1;
  chunks.forEach((chunk, index) => {
    const n = chunk.end - chunk.start + 1;
    if (n === previous) return;
    stbl.stsc.first_chunk.push(index + 1);
    stbl.stsc.samples_per_chunk.push(n);
    stbl.stsc.sample_description_index.push(1);
    previous = n;
  });
  const sync = track.samples.flatMap((s, i) => (s.is_sync ? [i + 1] : []));
  if (sync.length && sync.length !== track.samples.length) {
    const stss = stbl.addBox(new BoxParser.box.stss());
    stss.sample_numbers = sync;
  }
  const offsets = track.samples.map((s) => s.cts - s.dts);
  if (offsets.some(Boolean)) {
    const v = runLength(offsets);
    const ctts = stbl.addBox(new BoxParser.box.ctts());
    ctts.version = offsets.some((o) => o < 0) ? 1 : 0;
    ctts.sample_counts = v.counts;
    ctts.sample_offsets = v.entries;
  }
  stbl.stco.chunk_offsets = chunks.map(() => 0);
}

function flatMp4(output, tracks) {
  output.boxes = output.boxes.filter((b) => b.type !== 'moof' && b.type !== 'mdat');
  output.moov.boxes = output.moov.boxes.filter((b) => b.type !== 'mvex');
  delete output.moov.mvex;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const chunks = tracks
    .flatMap((t) => chunksOf(t.id, t.samples))
    .sort((a, b) => a.time - b.time || a.trackId - b.trackId);
  const perTrack = new Map(tracks.map((t) => [t.id, []]));
  let size = 0;
  for (const c of chunks) {
    c.dataOffset = size;
    perTrack.get(c.trackId).push(c);
    const samples = byId.get(c.trackId).samples;
    for (let i = c.start; i <= c.end; i++) size += samples[i].data.byteLength;
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    const samples = byId.get(c.trackId).samples;
    for (let i = c.start; i <= c.end; i++) {
      data.set(samples[i].data, offset);
      offset += samples[i].data.byteLength;
    }
  }
  for (const t of tracks) configureSampleTable(output, t, perTrack.get(t.id));
  const dataStart = output.getBuffer().buffer.byteLength + 8;
  for (const t of tracks) {
    output.getTrackById(t.id).mdia.minf.stbl.stco.chunk_offsets = perTrack.get(t.id).map((c) => dataStart + c.dataOffset);
  }
  output.moofs = [];
  output.mdats = [];
  const mdat = new BoxParser.box.mdat();
  mdat.data = data;
  output.addBox(mdat);
  return output.getBuffer().buffer;
}

/**
 * @param {ArrayBuffer} videoBuffer
 * @param {ArrayBuffer|null} audioBuffer
 * @returns {Promise<ArrayBuffer>} MP4 file bytes
 */
export async function muxTracks(videoBuffer, audioBuffer) {
  const video = await extractTrack(videoBuffer, 'video');
  const audio = audioBuffer ? await extractTrack(audioBuffer, 'audio') : null;
  const output = createFile();
  const movieTimescale = video.track.timescale;
  const videoId = addOutputTrack(output, video, 1, movieTimescale);
  const audioId = audio ? addOutputTrack(output, audio, 2, movieTimescale) : null;
  for (const s of video.samples) addCopiedSample(output, videoId, s);
  if (audio) for (const s of audio.samples) addCopiedSample(output, audioId, s);
  const tracks = [{ id: videoId, samples: video.samples }];
  if (audio) tracks.push({ id: audioId, samples: audio.samples });
  return flatMp4(output, tracks);
}

/** Download both DASH tracks and mux them. Returns a video/mp4 Blob. */
export async function muxDash(dash, fetchBlob) {
  const [v, a] = await Promise.all([
    fetchBlob(dash.video.url).then((b) => b.arrayBuffer()),
    dash.audio ? fetchBlob(dash.audio.url).then((b) => b.arrayBuffer()) : Promise.resolve(null),
  ]);
  const bytes = await muxTracks(v, a);
  return new Blob([bytes], { type: 'video/mp4' });
}
