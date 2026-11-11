/* Scales collages that were laid out at one fixed pixel width (site.css reads
   the --fit and --fit-w it sets):
     data-fit="<design width>"        zoomed to fill its parent on desktop (>= 1200px).
                                      Below that it is left alone: site.css stacks
                                      its pieces instead.
     ... plus data-fit-always         zoomed at every width.
     data-fit-small="<design width>"  zoomed below 1200px only (a piece that can't
                                      be stacked, e.g. a rotated image). */
(function () {
  var els = document.querySelectorAll('[data-fit], [data-fit-small]');
  if (!els.length) return;
  var wide = window.matchMedia('(min-width: 1200px)');

  function fit() {
    els.forEach(function (el) {
      var smallOnly = el.hasAttribute('data-fit-small');
      var design = +(smallOnly ? el.dataset.fitSmall : el.dataset.fit);
      var on = smallOnly ? !wide.matches : (wide.matches || el.hasAttribute('data-fit-always'));
      var box = el.parentElement;
      var cs = getComputedStyle(box);
      var room = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      el.style.setProperty('--fit-w', design);
      var scale = on && room > 0 ? (room / design).toFixed(4) : 1;
      el.style.setProperty('--fit', scale);
      if (!smallOnly) box.style.setProperty('--fit', scale);   // lets the parent size itself to match
    });
  }

  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);
}());
