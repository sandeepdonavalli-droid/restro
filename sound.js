'use strict';
// Sound: one volume level for RESTRO (0–100) plus optional touch sounds.
// In the Android app, window.RESTRODevice.setVolume(level) (optional) also sets the
// device's media volume. In a browser it controls the sounds RESTRO itself plays.
(() => {
  const VOLUME_KEY = 'restro.sound.volume.v1', TOUCH_KEY = 'restro.sound.touch.v2', STYLE_KEY = 'restro.sound.touchStyle.v2';
  let volume = 70, touchSounds = true, audio = null, lastTap = 0, touchStyle = 'click'; // defaults: touch sounds on, Click
  try {
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    if (localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(saved)) volume = Math.max(0, Math.min(100, Math.round(saved)));
    if (localStorage.getItem(TOUCH_KEY) !== null) touchSounds = localStorage.getItem(TOUCH_KEY) === 'true';
    const style = localStorage.getItem(STYLE_KEY); if (style) touchStyle = style;
  } catch {}

  function context() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    audio ||= new Context();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  }
  // Short synthesized tones, so no sound files are needed.
  function play(kind = 'tick') {
    if (!volume) return;
    const ctx = context(); if (!ctx) return;
    const tones = { tick: [[880, 0, .09], [1320, .07, .12]], tap: [[1500, 0, .035]], alert: [[660, 0, .14], [990, .16, .2]] }[kind] || [[880, 0, .1]];
    const level = Math.pow(volume / 100, 1.6) * (kind === 'tap' ? .12 : .3);
    for (const [frequency, start, length] of tones) {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), at = ctx.currentTime + start;
      osc.type = kind === 'tap' ? 'triangle' : 'sine'; osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .008); gain.gain.exponentialRampToValueAtTime(.0001, at + length);
      osc.connect(gain).connect(ctx.destination); osc.start(at); osc.stop(at + length + .02);
    }
  }

  // ---------- Touch sound styles (all synthesized) ----------
  let noiseBuffer = null;
  function noise(ctx) {
    if (noiseBuffer) return noiseBuffer;
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * .25, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }
  function envelope(ctx, at, peak, length) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(peak, at + .003); gain.gain.exponentialRampToValueAtTime(.0001, at + length);
    gain.connect(ctx.destination); return gain;
  }
  function tone(ctx, level, { type = 'sine', from, to = from, start = 0, length = .05, peak = 1 }) {
    const at = ctx.currentTime + start, osc = ctx.createOscillator();
    osc.type = type; osc.frequency.setValueAtTime(from, at); if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + length);
    osc.connect(envelope(ctx, at, level * peak, length)); osc.start(at); osc.stop(at + length + .02);
  }
  function burst(ctx, level, { filter = 'bandpass', freq = 3000, q = 1, start = 0, length = .02, peak = 1 }) {
    const at = ctx.currentTime + start, src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    src.buffer = noise(ctx); f.type = filter; f.frequency.value = freq; f.Q.value = q;
    src.connect(f).connect(envelope(ctx, at, level * peak, length)); src.start(at); src.stop(at + length + .02);
  }
  const STYLES = [
    { id: 'soft', name: 'Soft tap', detail: 'Gentle and quiet', play: (c, l) => tone(c, l, { type: 'sine', from: 1200, to: 900, length: .045, peak: .9 }) },
    { id: 'click', name: 'Click', detail: 'Crisp mechanical click', play: (c, l) => burst(c, l, { filter: 'highpass', freq: 2500, length: .012, peak: 1.6 }) },
    { id: 'pop', name: 'Pop', detail: 'Round bubble pop', play: (c, l) => tone(c, l, { type: 'sine', from: 600, to: 180, length: .07, peak: 1.4 }) },
    { id: 'wood', name: 'Wood block', detail: 'Warm, woody knock', play: (c, l) => { tone(c, l, { type: 'triangle', from: 820, to: 700, length: .06, peak: 1.2 }); burst(c, l, { freq: 1800, q: 4, length: .015, peak: .6 }); } },
    { id: 'glass', name: 'Glass', detail: 'Bright, light chime', play: (c, l) => { tone(c, l, { from: 2600, length: .18, peak: .5 }); tone(c, l, { from: 3900, length: .12, peak: .25 }); } },
    { id: 'keys', name: 'Keyboard', detail: 'Like a laptop key', play: (c, l) => { burst(c, l, { freq: 4200, q: .8, length: .018, peak: 1.2 }); tone(c, l, { type: 'sine', from: 160, to: 110, length: .04, peak: .9 }); } },
    { id: 'drop', name: 'Droplet', detail: 'Short rising blip', play: (c, l) => tone(c, l, { type: 'sine', from: 500, to: 1400, length: .06, peak: 1 }) },
    { id: 'beep', name: 'POS beep', detail: 'Classic register beep', play: (c, l) => tone(c, l, { type: 'square', from: 1850, length: .05, peak: .35 }) }
  ];
  if (!STYLES.some(style => style.id === touchStyle)) touchStyle = 'click';
  function playTouch(id = touchStyle) {
    if (!volume) return;
    const ctx = context(); if (!ctx) return;
    (STYLES.find(style => style.id === id) || STYLES[0]).play(ctx, Math.pow(volume / 100, 1.6) * .22);
  }
  function setTouchStyle(id) {
    if (!STYLES.some(style => style.id === id)) return;
    touchStyle = id; try { localStorage.setItem(STYLE_KEY, id); } catch {}
    paint(); playTouch(id);
    window.dispatchEvent(new CustomEvent('restro:volume-changed', { detail: { volume } }));
  }
  function renderStyles() {
    const list = document.getElementById('settings-touch-styles'); if (!list) return;
    list.replaceChildren();
    for (const style of STYLES) {
      const label = document.createElement('label'); label.className = 'settings-item touch-style';
      label.innerHTML = '<input type="radio" name="touch-style"><span class="settings-row-copy"><strong></strong><span></span></span><button type="button" class="touch-style-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg></button>';
      const input = label.querySelector('input'); input.value = style.id; input.id = `touch-style-${style.id}`;
      label.querySelector('strong').textContent = style.name; label.querySelector('.settings-row-copy span').textContent = style.detail;
      input.addEventListener('change', () => setTouchStyle(style.id));
      const preview = label.querySelector('.touch-style-play'); preview.setAttribute('aria-label', `Play ${style.name}`);
      preview.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); playTouch(style.id); });
      label.addEventListener('click', event => { if (input.checked && event.target !== input && !event.target.closest('.touch-style-play')) playTouch(style.id); });
      list.append(label);
    }
  }

  function label() { return volume === 0 ? 'Muted' : `${volume}%`; }
  function paint() {
    for (const id of ['quick-volume-range', 'settings-volume-range']) { const input = document.getElementById(id); if (input) input.value = String(volume); }
    for (const id of ['quick-volume-value', 'settings-volume-value']) { const out = document.getElementById(id); if (out) out.textContent = label(); }
    document.querySelectorAll('.volume-glyph').forEach(icon => icon.classList.toggle('muted', volume === 0));
    const touch = document.getElementById('settings-touch-sounds'); if (touch) touch.checked = touchSounds;
    document.querySelectorAll('input[name="touch-style"]').forEach(input => { input.checked = input.value === touchStyle; });
    const list = document.getElementById('settings-touch-styles'); if (list) list.classList.toggle('touch-off', !touchSounds);
  }
  function setVolume(value) {
    volume = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch {}
    try { const host = window.RESTRODevice; if (typeof host?.setVolume === 'function') Promise.resolve(host.setVolume(volume)).catch(() => {}); } catch {}
    paint();
    window.dispatchEvent(new CustomEvent('restro:volume-changed', { detail: { volume } }));
  }
  function setTouchSounds(on) {
    touchSounds = Boolean(on);
    try { localStorage.setItem(TOUCH_KEY, String(touchSounds)); } catch {}
    paint(); if (touchSounds) playTouch();
    window.dispatchEvent(new CustomEvent('restro:volume-changed', { detail: { volume } }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const id of ['quick-volume-range', 'settings-volume-range']) {
      const input = document.getElementById(id); if (!input) continue;
      input.addEventListener('input', () => setVolume(input.value));
      input.addEventListener('change', () => play('tick')); // preview when the slider is released
    }
    document.getElementById('settings-touch-sounds')?.addEventListener('change', event => setTouchSounds(event.target.checked));
    renderStyles(); paint();
  });
  // Touch sounds: a soft click on buttons and switches.
  document.addEventListener('pointerdown', event => {
    if (!touchSounds || event.button !== 0) return;
    if (!event.target.closest?.('button,[role="button"],[role="switch"],input[type="checkbox"],input[type="radio"],select,.app-tile,.shortcut,.page-dot,a')) return;
    if (event.target.closest('.touch-style')) return; // the picker plays its own preview
    const now = performance.now(); if (now - lastTap < 60) return; lastTap = now;
    playTouch();
  }, true);

  window.RestroSound = Object.freeze({
    get volume() { return volume; },
    get touchSounds() { return touchSounds; },
    get touchStyle() { return STYLES.find(style => style.id === touchStyle); },
    styles: STYLES.map(({ id, name, detail }) => ({ id, name, detail })),
    label, setVolume, setTouchSounds, setTouchStyle, playTouch, play
  });
})();
