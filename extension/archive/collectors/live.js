// Live broadcast recording (beta).
//
// Method from instarec 1.8.0 (instarec/instagram/client.py, mpd.py, live.py, io.py):
// - MPD URL: /api/v1/live/web_info/?target_user_id= -> dash_abr_playback_url, or the
//   story feed's broadcast.dash_abr_playback_url (covers co-hosted lives).
// - Pick the highest-bandwidth video/mp4 and audio/mp4 representations; download their
//   initialization segments, then poll the MPD every 2 s and fetch each new
//   SegmentTimeline entry ($Time$) for video and audio.
// - The stream has ended when the MPD response carries `x-fb-video-broadcast-ended`,
//   or when no new segment appeared for 180 s.
import { parseLiveManifest } from '../core/dash.js';
import { KIND } from '../core/errors.js';
import { muxTracks } from '../core/mux.js';
import { utcParts } from '../core/naming.js';

const POLL_MS = 2000;
const END_TIMEOUT_MS = 180000;
const PART_MS = 10 * 60 * 1000;

async function fetchBytes(url, signal) {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function findMpd(job) {
  try {
    const info = await job.api.liveWebInfo(job.userId);
    if (info?.dash_abr_playback_url) return { mpd: info.dash_abr_playback_url, info };
  } catch (error) {
    if (error?.name === 'CancelledError' || error?.kind === KIND.FATAL) throw error;
    job.log('debug', `live/web_info: ${error.message}`);
  }
  const story = await job.api.userStory(job.userId);
  const b = story?.broadcast;
  if (b?.dash_abr_playback_url) return { mpd: b.dash_abr_playback_url, info: b };
  return null;
}

export async function collectLive(job) {
  const found = await findMpd(job);
  if (!found) {
    job.log('info', 'Live: the account is not live right now.');
    return;
  }
  const { mpd, info } = found;
  const id = String(info.id ?? info.broadcast_id ?? Date.now());
  const { date, time } = utcParts(Date.now() / 1000);
  const base = `${date}_${time}_live_${id}`;
  job.bump('live', 'found');
  await job.saveJson(job.rel('live', `${base}_info.json`), info);
  job.log('info', `Live: recording broadcast ${id}. It stops when the live ends or after ${job.opts.live.maxMinutes} minutes.`);

  const signal = job.control.signal;
  const first = await fetch(mpd, { credentials: 'omit', cache: 'no-store', signal });
  if (!first.ok) throw new Error(`Live manifest HTTP ${first.status}`);
  const manifest = parseLiveManifest(await first.text(), mpd);
  if (!manifest.video || !manifest.audio) throw new Error('Live manifest has no video/audio representation.');
  const { video, audio } = manifest;
  const [vInit, aInit] = await Promise.all([fetchBytes(video.init, signal), fetchBytes(audio.init, signal)]);

  const startT = video.times.length ? video.times[video.times.length - 1] : 0;
  const seen = new Set();
  let part = 1;
  let vSegs = [];
  let aSegs = [];
  let partStarted = Date.now();
  let lastNew = Date.now();
  const deadline = Date.now() + Math.max(1, Number(job.opts.live.maxMinutes) || 120) * 60000;
  let missing = 0;

  const flush = async () => {
    if (!vSegs.length) return;
    const tag = `${base}_part${String(part).padStart(3, '0')}`;
    const vBlob = new Blob([vInit, ...vSegs], { type: 'video/mp4' });
    const aBlob = new Blob([aInit, ...aSegs], { type: 'audio/mp4' });
    vSegs = [];
    aSegs = [];
    part += 1;
    partStarted = Date.now();
    let muxed = false;
    if (job.opts.live.mux) {
      try {
        const bytes = await muxTracks(await vBlob.arrayBuffer(), await aBlob.arrayBuffer());
        await job.saveBlob(job.rel('live', `${tag}.mp4`), new Blob([bytes], { type: 'video/mp4' }));
        muxed = true;
        job.bump('live', 'files');
      } catch (error) {
        job.log('warn', `Live: could not mux ${tag} (${error.message}); saving separate video and audio files.`);
      }
    }
    if (!muxed) {
      await job.saveBlob(job.rel('live', `${tag}_video.mp4`), vBlob);
      await job.saveBlob(job.rel('live', `${tag}_audio.m4a`), aBlob);
      job.bump('live', 'files', 2);
    }
    job.log('info', `Live: saved ${tag}.`);
  };

  let ended = false;
  let latest = manifest;
  try {
    while (!ended) {
      await job.control.checkpoint();
      const fresh = latest.video.times.filter((t) => t >= startT && !seen.has(t));
      for (const t of fresh) {
        seen.add(t);
        try {
          const [v, a] = await Promise.all([
            fetchBytes(latest.segmentUrl(video, t), signal),
            fetchBytes(latest.segmentUrl(audio, t), signal),
          ]);
          vSegs.push(v);
          aSegs.push(a);
        } catch (error) {
          if (signal.aborted) throw error;
          missing += 1;
        }
      }
      if (fresh.length) lastNew = Date.now();
      job.hooks.status?.({ state: 'live', label: `Recording live: ${seen.size} segments` });
      if (Date.now() - partStarted >= PART_MS) await flush();
      if (Date.now() >= deadline) {
        job.log('info', 'Live: time limit reached.');
        break;
      }
      if (Date.now() - lastNew > END_TIMEOUT_MS) {
        job.log('info', 'Live: no new segments for 180 s; assuming the broadcast ended.');
        break;
      }
      await job.control.sleep(POLL_MS);
      try {
        const res = await fetch(mpd, { credentials: 'omit', cache: 'no-store', signal });
        if (res.headers.has('x-fb-video-broadcast-ended')) ended = true;
        if (res.ok) {
          const parsed = parseLiveManifest(await res.text(), mpd);
          // Segment URLs keep using the representations chosen at the start.
          if (parsed.video) latest = parsed;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        job.log('debug', `Live manifest poll failed: ${error.message}`);
      }
    }
    if (ended) job.log('info', 'Live: the broadcast ended.');
  } finally {
    // Save what was recorded even when the job is cancelled.
    await flush().catch((e) => job.log('warn', `Live: final part not saved: ${e.message}`));
  }
  if (missing) job.log('warn', `Live: ${missing} segment(s) could not be downloaded.`);
  job.bump('live', 'saved');
}
