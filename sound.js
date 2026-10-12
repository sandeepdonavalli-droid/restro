'use strict';
// Sound: one volume level for RESTRO (0–100) plus optional touch sounds.
// In the Android app, window.RESTRODevice.setVolume(level) (optional) also sets the
// device's media volume. In a browser it controls the sounds RESTRO itself plays.
(() => {
  const VOLUME_KEY = 'restro.sound.volume.v1', TOUCH_KEY = 'restro.sound.touch.v1';
  let volume = 70, touchSounds = false, audio = null, lastTap = 0;
  try {
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    if (localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(saved)) volume = Math.max(0, Math.min(100, Math.round(saved)));
    touchSounds = localStorage.getItem(TOUCH_KEY) === 'true';
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

  function label() { return volume === 0 ? 'Muted' : `${volume}%`; }
  function paint() {
    for (const id of ['quick-volume-range', 'settings-volume-range']) { const input = document.getElementById(id); if (input) input.value = String(volume); }
    for (const id of ['quick-volume-value', 'settings-volume-value']) { const out = document.getElementById(id); if (out) out.textContent = label(); }
    document.querySelectorAll('.volume-glyph').forEach(icon => icon.classList.toggle('muted', volume === 0));
    const touch = document.getElementById('settings-touch-sounds'); if (touch) touch.checked = touchSounds;
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
    paint(); if (touchSounds) play('tap');
    window.dispatchEvent(new CustomEvent('restro:volume-changed', { detail: { volume } }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const id of ['quick-volume-range', 'settings-volume-range']) {
      const input = document.getElementById(id); if (!input) continue;
      input.addEventListener('input', () => setVolume(input.value));
      input.addEventListener('change', () => play('tick')); // preview when the slider is released
    }
    document.getElementById('settings-touch-sounds')?.addEventListener('change', event => setTouchSounds(event.target.checked));
    paint();
  });
  // Touch sounds: a soft click on buttons and switches.
  document.addEventListener('pointerdown', event => {
    if (!touchSounds || event.button !== 0) return;
    if (!event.target.closest?.('button,[role="switch"],input[type="checkbox"],.app-tile,a')) return;
    const now = performance.now(); if (now - lastTap < 60) return; lastTap = now;
    play('tap');
  }, true);

  window.RestroSound = Object.freeze({
    get volume() { return volume; },
    get touchSounds() { return touchSounds; },
    label, setVolume, setTouchSounds, play
  });
})();
