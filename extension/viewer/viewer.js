/* Gram Archiver offline viewer. Works from file:// with no network access. */
(() => {
  'use strict';
  const data = window.GRAM_ARCHIVE;
  const app = document.getElementById('app');
  if (!data) {
    app.innerHTML = '<div class="wrap"><div class="empty-state">archive-data.js is missing next to this page.</div></div>';
    return;
  }

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
    return node;
  };
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');
  const date = (iso) => (iso ? new Date(iso).toLocaleString() : '');
  const isVideo = (p) => /\.(mp4|mov|webm|m4v)$/i.test(p);
  const isAudio = (p) => /\.(m4a|mp3|aac)$/i.test(p);

  const p = data.profile || {};
  const records = data.records || {};
  const tabs = [
    ['posts', 'Posts'], ['reels', 'Reels'], ['tagged', 'Tagged'], ['highlights', 'Highlights'], ['stories', 'Stories'],
    ['followers', 'Followers'], ['following', 'Following'],
  ].filter(([k]) => (records[k]?.length) || (k === 'highlights' && data.highlights?.length) || data.people?.[k]?.length);
  let current = tabs[0]?.[0] || 'posts';
  let query = '';
  let sort = 'newest';
  let shown = 0;
  const PAGE = 60;

  function header() {
    const pic = p.profile_pic_file
      ? el('img', { class: 'avatar', src: p.profile_pic_file, alt: '' })
      : el('div', { class: 'avatar empty', text: '@' });
    const links = (p.bio_links || []).map((l) => el('a', { href: l.url || l.lynx_url || '#', target: '_blank', rel: 'noreferrer' }, l.title || l.url || ''));
    if (p.external_url && !links.length) links.push(el('a', { href: p.external_url, target: '_blank', rel: 'noreferrer' }, p.external_url));
    return el('section', { class: 'profile' },
      pic,
      el('div', {},
        el('h1', {}, `@${p.username || data.info?.username || ''}`,
          p.is_verified ? el('span', { class: 'badge verified', text: 'Verified' }) : null,
          p.is_private ? el('span', { class: 'badge', text: 'Private' }) : null,
          p.category ? el('span', { class: 'badge', text: p.category }) : null),
        p.full_name ? el('div', { style: 'font-weight:600' }, p.full_name) : null,
        el('div', { class: 'counts' },
          el('span', {}, el('b', {}, fmt(p.media_count)), ' posts'),
          el('span', {}, el('b', {}, fmt(p.follower_count)), ' followers'),
          el('span', {}, el('b', {}, fmt(p.following_count)), ' following')),
        p.biography ? el('div', { class: 'bio' }, p.biography) : null,
        links.length ? el('div', { class: 'links' }, links) : null,
        el('div', { class: 'meta-line' }, `Archived ${date(data.info?.generated_at)} · ${data.info?.generator || ''}`)));
  }

  function filtered() {
    let list = (records[current] || []).slice();
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((r) => [r.caption, r.shortcode, r.location?.name, r.highlight_title, ...(r.hashtags || []), ...(r.tagged_users || []).map((u) => u.username)]
        .some((v) => v && String(v).toLowerCase().includes(q)));
    }
    if (sort === 'oldest') list.sort((a, b) => (a.taken_at || 0) - (b.taken_at || 0));
    else if (sort === 'likes') list.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
    else if (sort === 'comments') list.sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0));
    else list.sort((a, b) => (b.taken_at || 0) - (a.taken_at || 0));
    return list;
  }

  function thumbFor(r) {
    const files = r.files || [];
    const image = files.find((f) => f.kind === 'image' || f.kind === 'cover');
    if (image) return el('img', { src: image.path, alt: r.accessibility_caption || '', loading: 'lazy' });
    const video = files.find((f) => isVideo(f.path));
    if (video) return el('video', { src: `${video.path}#t=0.1`, preload: 'metadata', muted: true, playsinline: true });
    return el('div', { class: 'missing', text: 'No file saved' });
  }

  function tile(r) {
    const files = r.files || [];
    const multi = new Set(files.map((f) => f.index)).size > 1;
    const vid = files.some((f) => isVideo(f.path));
    return el('button', { class: 'tile', type: 'button', title: (r.caption || '').slice(0, 120), onclick: () => openRecord(r) },
      thumbFor(r),
      multi ? el('span', { class: 'icon', text: `1/${new Set(files.map((f) => f.index)).size}` }) : vid ? el('span', { class: 'icon', text: '▶' }) : null,
      r.pinned ? el('span', { class: 'icon pin', text: 'Pinned' }) : null,
      el('span', { class: 'hover' }, r.like_count != null ? `♥ ${fmt(r.like_count)}` : '', r.comment_count != null ? `💬 ${fmt(r.comment_count)}` : ''));
  }

  function renderGrid(container) {
    const list = filtered();
    const grid = el('div', { class: 'grid' });
    container.append(grid);
    if (!list.length) {
      grid.replaceWith(el('div', { class: 'empty-state', text: query ? 'Nothing matches your search.' : 'Nothing archived here.' }));
      return;
    }
    shown = 0;
    const more = el('button', { class: 'tab more', type: 'button', onclick: () => addMore() }, 'Show more');
    const addMore = () => {
      list.slice(shown, shown + PAGE).forEach((r) => grid.append(tile(r)));
      shown += PAGE;
      if (shown >= list.length) more.remove();
    };
    addMore();
    if (shown < list.length) container.append(more);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) && more.isConnected) addMore();
      });
      io.observe(more);
    }
  }

  function renderHighlights(container) {
    const list = data.highlights || [];
    const wrap = el('div', { class: 'hl-list' });
    for (const h of list) {
      const items = (records.highlights || []).filter((r) => r.highlight_id === h.id).sort((a, b) => (a.taken_at || 0) - (b.taken_at || 0));
      wrap.append(el('button', { class: 'hl', type: 'button', onclick: () => items.length && openRecord(items[0], items) },
        h.cover_file ? el('img', { src: h.cover_file, alt: '' }) : el('div', { class: 'ph' }),
        el('div', {}, h.title || 'Highlight'),
        el('div', { class: 'meta-line' }, `${items.length} item${items.length === 1 ? '' : 's'}`)));
    }
    container.append(list.length ? wrap : el('div', { class: 'empty-state', text: 'No highlights archived.' }));
  }

  function renderPeople(container, which) {
    const list = (data.people?.[which] || []).filter((u) => !query || `${u.username} ${u.full_name}`.toLowerCase().includes(query.toLowerCase()));
    const box = el('div', { class: 'people' });
    list.slice(0, 5000).forEach((u) => box.append(el('div', { class: 'person' },
      el('a', { href: `https://www.instagram.com/${u.username}/`, target: '_blank', rel: 'noreferrer' }, `@${u.username}`),
      el('span', { class: 'meta-line', style: 'margin:0' }, u.full_name || ''))));
    container.append(list.length ? box : el('div', { class: 'empty-state', text: 'Nobody to show.' }));
    if (list.length > 5000) container.append(el('p', { class: 'meta-line' }, `Showing 5,000 of ${list.length.toLocaleString()}. The full list is in data/${which}.csv.`));
  }

  let body;
  function render() {
    app.innerHTML = '';
    const wrap = el('div', { class: 'wrap' });
    wrap.append(header());
    const tabBar = el('nav', { class: 'tabs', role: 'tablist' });
    for (const [k, label] of tabs) {
      const n = k === 'highlights' ? (data.highlights || []).length : (records[k]?.length ?? data.people?.[k]?.length ?? 0);
      tabBar.append(el('button', { class: 'tab', role: 'tab', 'aria-selected': String(k === current), type: 'button', onclick: () => { current = k; render(); } }, label, el('span', { class: 'n', text: fmt(n) })));
    }
    wrap.append(tabBar);
    const search = el('input', { type: 'search', placeholder: 'Search captions, hashtags, places, people…', value: query, oninput: (e) => { query = e.target.value; draw(); } });
    const sorter = el('select', { onchange: (e) => { sort = e.target.value; draw(); } },
      ...[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['likes', 'Most liked'], ['comments', 'Most comments']].map(([v, t]) => el('option', { value: v, selected: v === sort }, t)));
    wrap.append(el('div', { class: 'toolbar' }, search, current === 'highlights' || current === 'followers' || current === 'following' ? null : sorter));
    body = el('div');
    wrap.append(body);
    app.append(wrap, modal);
    draw();
    if (!tabs.length) body.append(el('div', { class: 'empty-state', text: 'This archive has no media yet.' }));
  }

  function draw() {
    body.innerHTML = '';
    if (current === 'highlights') renderHighlights(body);
    else if (current === 'followers' || current === 'following') renderPeople(body, current);
    else renderGrid(body);
  }

  // ---- detail modal -------------------------------------------------------------------
  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === modal) closeModal(); } });
  let seq = [];
  let seqIndex = 0;
  let fileIndex = 0;

  function closeModal() {
    modal.classList.remove('open');
    modal.innerHTML = '';
  }

  function openRecord(r, sequence = null) {
    seq = sequence || filtered();
    seqIndex = Math.max(0, seq.indexOf(r));
    fileIndex = 0;
    drawModal();
    modal.classList.add('open');
  }

  function mediaEl(f) {
    if (isVideo(f.path)) return el('video', { src: f.path, controls: true, autoplay: true, playsinline: true });
    if (isAudio(f.path)) return el('audio', { src: f.path, controls: true });
    return el('img', { src: f.path, alt: '' });
  }

  function drawModal() {
    const r = seq[seqIndex];
    if (!r) return closeModal();
    const visual = (r.files || []).filter((f) => !isAudio(f.path) && f.kind !== 'cover');
    const audio = (r.files || []).filter((f) => isAudio(f.path));
    const covers = (r.files || []).filter((f) => f.kind === 'cover');
    const shownFiles = visual.length ? visual : covers;
    fileIndex = Math.min(fileIndex, Math.max(0, shownFiles.length - 1));
    const stage = el('div', { class: 'stage' }, shownFiles[fileIndex] ? mediaEl(shownFiles[fileIndex]) : el('div', { class: 'missing', text: 'No file saved' }));
    if (shownFiles.length > 1) {
      stage.append(
        el('button', { class: 'nav prev', type: 'button', 'aria-label': 'Previous', onclick: () => { fileIndex = (fileIndex - 1 + shownFiles.length) % shownFiles.length; drawModal(); } }, '‹'),
        el('button', { class: 'nav next', type: 'button', 'aria-label': 'Next', onclick: () => { fileIndex = (fileIndex + 1) % shownFiles.length; drawModal(); } }, '›'),
        el('div', { class: 'dots' }, shownFiles.map((_, i) => el('span', { class: i === fileIndex ? 'on' : '' }))));
    }
    const kv = el('dl', { class: 'kv' });
    const add = (k, v) => { if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) kv.append(el('dt', {}, k), el('dd', {}, v)); };
    add('Date', date(r.taken_at_iso));
    add('Type', [r.category, r.product_type].filter(Boolean).join(' · '));
    add('Likes', r.like_count != null ? fmt(r.like_count) : null);
    add('Comments', r.comment_count != null ? fmt(r.comment_count) : null);
    add('Views', r.view_count ?? r.play_count ? fmt(r.view_count ?? r.play_count) : null);
    add('Location', r.location?.name);
    add('Tagged', (r.tagged_users || []).map((u) => `@${u.username}`).join(' '));
    add('Collaborators', (r.coauthors || []).map((u) => `@${u.username}`).join(' '));
    add('Music', r.music ? [r.music.title, r.music.artist].filter(Boolean).join(' — ') : null);
    add('Highlight', r.highlight_title);
    add('Alt text', r.accessibility_caption);
    if (r.stickers) {
      add('Links', (r.stickers.links || []).map((l) => l.url).join('\n'));
      add('Mentions', (r.stickers.mentions || []).map((u) => `@${u?.username}`).join(' '));
      add('Polls', (r.stickers.polls || []).map((pl) => `${pl.question}: ${pl.options.map((o) => o.text).join(' / ')}`).join('\n'));
    }
    add('Link', r.url ? el('a', { href: r.url, target: '_blank', rel: 'noreferrer' }, r.url) : null);
    const comments = (data.comments || {})[r.pk] || [];
    const commentBox = el('div', {});
    for (const c of comments) {
      commentBox.append(el('div', { class: 'comment' }, el('span', { class: 'who' }, `@${c.user?.username || '?'}`), c.text, ' ', el('span', { class: 'when' }, date(c.created_at_iso))));
      for (const rep of c.replies || []) commentBox.append(el('div', { class: 'comment reply' }, el('span', { class: 'who' }, `@${rep.user?.username || '?'}`), rep.text, ' ', el('span', { class: 'when' }, date(rep.created_at_iso))));
    }
    const side = el('div', { class: 'side' },
      el('header', {},
        el('strong', {}, r.shortcode || r.pk || ''),
        el('span', {},
          el('button', { class: 'close', type: 'button', onclick: () => step(-1), disabled: seqIndex === 0 }, '← Prev'), ' ',
          el('button', { class: 'close', type: 'button', onclick: () => step(1), disabled: seqIndex >= seq.length - 1 }, 'Next →'), ' ',
          el('button', { class: 'close', type: 'button', onclick: closeModal }, '✕'))),
      el('div', { class: 'body' },
        r.caption ? el('p', { class: 'caption' }, r.caption) : null,
        audio.map(mediaEl),
        kv,
        comments.length ? el('h3', { style: 'font-size:14px;margin:16px 0 4px' }, `Comments (${comments.length})`) : null,
        commentBox));
    modal.innerHTML = '';
    modal.append(el('div', { class: 'sheet' }, stage, side));
  }

  function step(d) {
    seqIndex = Math.min(seq.length - 1, Math.max(0, seqIndex + d));
    fileIndex = 0;
    drawModal();
  }

  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });

  render();
})();
