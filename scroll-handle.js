'use strict';
// A small handle on the right of a scrolling list, in place of the browser's scroll bar (no track, no arrows): a white
// pill with sky blue lines. It slides down the side as the list scrolls (at the top when the list is at the top), and
// dragging it scrolls the list. While it shows, the list carries the class "rs-on", so a screen can keep room for it.
window.RestroScrollHandle = (() => {
  const watches = new Map();
  let dragging = false;

  // list: the scrolling element. host: the positioned element the list sits in (the handle is placed in it).
  // top(): room to keep at the top of the list (sticky column names). lines: how many sky blue lines. spread: the
  // lines run from the top of the handle to the bottom with equal gaps; otherwise they sit together in the middle.
  // key: one handle per key, so a screen that draws itself again replaces its handle.
  function attach(list, { host = list.parentElement, top = () => 0, lines = 3, spread = false, key } = {}) {
    if (!list || !host) return null;
    if (key && watches.has(key)) { watches.get(key).disconnect(); watches.delete(key); }
    host.querySelectorAll(':scope > .rs-thumb').forEach(old => old.remove());
    list.classList.add('rs-list');
    const thumb = document.createElement('div');
    thumb.className = `rs-thumb${spread ? ' spread' : ''}`;
    thumb.setAttribute('aria-hidden', 'true');
    const grip = document.createElement('span'); grip.className = 'rs-grip';
    for (let i = 0; i < lines; i++) grip.append(document.createElement('i'));
    thumb.append(grip); host.append(thumb);

    // The stretch the handle travels: from the top of the list (under any column names) down to its bottom.
    const room = () => {
      const keep = top() + 6;
      return { start: list.offsetTop + keep, height: Math.max(0, list.clientHeight - keep - 8 - thumb.offsetHeight) };
    };
    const place = () => {
      const max = list.scrollHeight - list.clientHeight, on = max > 1;
      thumb.hidden = !on; list.classList.toggle('rs-on', on);
      if (!on) return;
      const { start, height } = room();
      thumb.style.transform = `translateY(${Math.round(start + height * Math.min(1, list.scrollTop / max))}px)`;
    };
    list.addEventListener('scroll', place, { passive: true });
    const watch = new ResizeObserver(place); watch.observe(list);
    if (key) watches.set(key, watch);

    // Dragging: the handle follows the finger and the list scrolls to match.
    thumb.addEventListener('pointerdown', event => {
      event.preventDefault();
      thumb.setPointerCapture(event.pointerId); thumb.classList.add('dragging'); dragging = true;
      const startY = event.clientY, startTop = list.scrollTop, max = list.scrollHeight - list.clientHeight, { height } = room();
      const move = e => { if (height > 0) list.scrollTop = startTop + (e.clientY - startY) * max / height; };
      const end = () => {
        thumb.classList.remove('dragging'); dragging = false;
        thumb.removeEventListener('pointermove', move); thumb.removeEventListener('pointerup', end); thumb.removeEventListener('pointercancel', end);
      };
      thumb.addEventListener('pointermove', move); thumb.addEventListener('pointerup', end); thumb.addEventListener('pointercancel', end);
    });
    requestAnimationFrame(place);
    return thumb;
  }

  return Object.freeze({ attach, get dragging() { return dragging; } });
})();
