// Runs in the YouTube tab after a user clicks Capture. It reads rendered DOM
// video cards only; it does not inspect cookies, API requests, account data,
// authentication, or YouTube's internal recommendation endpoints.
async function captureYouTubeCustomFeed(options = {}) {
  const steps = Math.max(0, Math.min(12, Number(options.steps) || 0));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const found = new Map();
  const diagnostics = {cards: 0, links: 0, skippedShorts: 0, skippedLives: 0, inspected: 0};
  function readable(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  function collect() {
    const selectors = [
      'ytd-rich-item-renderer', 'ytd-rich-grid-media', 'ytd-video-renderer',
      'ytd-grid-video-renderer', 'yt-lockup-view-model', 'ytd-rich-grid-slim-media',
      'ytd-compact-video-renderer'
    ];
    const root = document.querySelector('ytd-browse[page-subtype="home"]') ||
                 document.querySelector('ytd-browse') ||
                 document.querySelector('main');
    if (!root) return;
    // Prefer YouTube's rendered content tiles. Never collect unrelated page links.
    const cards = [...root.querySelectorAll(selectors.join(','))]
      .filter(card => !card.parentElement?.closest(selectors.join(',')));
    diagnostics.cards += cards.length;
    for (const card of cards) {
      diagnostics.inspected++;
      const anchor = card.querySelector('a[href*="/watch?"], a[href*="watch?v="]');
      if (!anchor) continue;
      let url;
      try { url = new URL(anchor.getAttribute('href'), location.origin); }
      catch { continue; }
      if (url.pathname !== '/watch') continue;
      const id = url.searchParams.get('v');
      if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) continue;
      const titleElement = card.querySelector('#video-title, #video-title-link, h3, .yt-lockup-metadata-view-model__title, yt-formatted-string[title]');
      const title = readable(titleElement?.getAttribute('title') || titleElement?.textContent || anchor.getAttribute('title') || anchor.getAttribute('aria-label') || anchor.textContent).slice(0, 220);
      if (!title) continue;
      const creatorElement = card.querySelector('ytd-channel-name, #channel-name, .yt-content-metadata-view-model__metadata-row, .yt-lockup-metadata-view-model__metadata');
      const creator = readable(creatorElement?.textContent).slice(0, 120);
      const badgeText = readable((card.querySelector('#badges, #metadata-line, .yt-badge-shape, .badge-shape-wiz, .yt-lockup-metadata-view-model__metadata')?.textContent) || '');
      const allText = readable(card.textContent).slice(0, 600);
      // Exclude obviously tagged live videos and Shorts. The Guide also checks
      // duration and live status with YouTube Data API before scheduling.
      if (/\b(shorts|#shorts)\b/i.test(title) || /\/shorts\//i.test(anchor.href)) { diagnostics.skippedShorts++; continue; }
      if (/(^|\s)(LIVE|STREAMING NOW|UPCOMING)(\s|$)/i.test(badgeText) || /\bwatching now\b/i.test(allText)) { diagnostics.skippedLives++; continue; }
      diagnostics.links++;
      found.set(id, {id, title, creator, url: `https://www.youtube.com/watch?v=${id}`, source: 'visible-custom-feed', capturedAt: new Date().toISOString()});
    }
  }
  collect();
  for (let i = 0; i < steps; i++) {
    window.scrollBy({top: Math.max(500, Math.round(window.innerHeight * 0.88)), behavior: 'instant'});
    await delay(800);
    collect();
  }
  return {videos: [...found.values()], pageTitle: document.title, location: location.href, diagnostics};
}
