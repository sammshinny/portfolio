/* Starts looping videos only while they are on screen, and doesn't download them
   until they are about to be.
   Applies to every <video> with the `autoplay` attribute, or with `data-lazy-play`,
   except hero videos (those have their own player). Silent videos only. */
(function () {
  var vids = [].slice.call(document.querySelectorAll('video[autoplay], video[data-lazy-play]'))
    .filter(function (v) { return v.id !== 'hero-video' && v.id !== 'bg-video'; });
  if (!vids.length) return;

  var near = new Set();   // videos currently within ~300px of the screen

  vids.forEach(function (v) {
    v.removeAttribute('autoplay');
    v.muted = true;
    v.preload = 'none';
  });

  function visible(v) {
    // slider slides that aren't showing are hidden with visibility
    return getComputedStyle(v).visibility !== 'hidden' && v.offsetParent !== null;
  }

  function refresh() {
    vids.forEach(function (v) {
      var go = near.has(v) && visible(v);   // the browser itself pauses muted video in background tabs
      if (go && v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      else if (!go && !v.paused) v.pause();
    });
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { e.isIntersecting ? near.add(e.target) : near.delete(e.target); });
    refresh();
  }, { rootMargin: '300px 0px' });

  vids.forEach(function (v) { io.observe(v); });
  document.addEventListener('visibilitychange', refresh);
  document.addEventListener('click', function () { setTimeout(refresh, 60); });   // slider moved on
}());
