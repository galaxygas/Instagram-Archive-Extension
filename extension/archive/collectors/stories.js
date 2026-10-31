// Current stories (the last 24 hours).
export async function collectStories(job) {
  const reels = await job.api.reelsMedia([job.userId]);
  const reel = reels.find((r) => String(r.id) === String(job.userId) || String(r.user?.pk) === String(job.userId)) || reels[0];
  let items = reel?.items || [];
  if (!items.length) {
    const story = await job.api.userStory(job.userId);
    items = story?.reel?.items || [];
    if (story?.broadcast) job.log('info', 'This account appears to be live right now. Enable "Live broadcast" to record it.');
  }
  if (!items.length) {
    job.log('info', 'Stories: no active stories.');
    return;
  }
  job.log('info', `Stories: ${items.length} active.`);
  await Promise.all(items.map((item) => job.processItem(item, 'stories', { dir: 'stories' })));
}
