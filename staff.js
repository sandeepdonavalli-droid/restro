'use strict';
// Staff accounts: the people the owner sets up in Employees (name, role, PIN), and who is signed in on this tablet.
// - Every person has a 4-digit PIN of their own; the PIN alone says who is signing in, so no two people share one.
// - PINs are never kept as typed: each is stored as a PBKDF2 hash with its own random salt, so it can't be read back.
// - For now the accounts are kept on this tablet. In Phase 2 they move to the cloud under the restaurant's account, so
//   every tablet shares them; only the load/save functions below change, the screens stay the same. They are never
//   part of the code or the website.
// - Who is signed in lasts for this app session; locking the screen signs them out.
(() => {
  const KEY = 'restro.staff.v1', SESSION = 'restro.staff.session.v1', ITERATIONS = 20000, MAX_NAME = 40;
  const ROLES = Object.freeze([
    Object.freeze({ id: 'owner', name: 'Owner' }),
    Object.freeze({ id: 'manager', name: 'Manager' }),
    Object.freeze({ id: 'server', name: 'Server' })
  ]);
  const roleIds = new Set(ROLES.map(r => r.id));
  const roleOrder = id => ROLES.findIndex(r => r.id === id);

  // ---------- storage (this tablet for now; the cloud in Phase 2) ----------
  const clean = p => (p && typeof p.id === 'string' && typeof p.name === 'string' && roleIds.has(p.role) && p.pin && typeof p.pin.salt === 'string' && typeof p.pin.hash === 'string')
    ? { id: p.id, name: p.name.slice(0, MAX_NAME), role: p.role, pin: { salt: p.pin.salt, hash: p.pin.hash, iterations: Number(p.pin.iterations) || ITERATIONS }, createdAt: Number(p.createdAt) || Date.now() }
    : null;
  let people = [];
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) people = saved.map(clean).filter(Boolean); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(people)); } catch {} };

  // ---------- PIN hashing ----------
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  async function derive(pin, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return b64(new Uint8Array(bits));
  }
  async function hashPin(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { salt: b64(salt), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS };
  }
  const matches = async (person, pin) => (await derive(pin, unb64(person.pin.salt), person.pin.iterations)) === person.pin.hash;
  const validPin = pin => typeof pin === 'string' && /^\d{4}$/.test(pin);
  async function holderOf(pin, exceptId) {
    for (const person of people) if (person.id !== exceptId && await matches(person, pin)) return person;
    return null;
  }

  // ---------- who is signed in ----------
  let currentId = null;
  try { currentId = sessionStorage.getItem(SESSION); } catch {}
  if (!people.some(p => p.id === currentId)) currentId = null;
  const view = p => p ? Object.freeze({ id: p.id, name: p.name, role: p.role, roleName: ROLES[roleOrder(p.role)].name }) : null;
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  function setCurrent(id) {
    currentId = id;
    try { if (id) sessionStorage.setItem(SESSION, id); else sessionStorage.removeItem(SESSION); } catch {}
    emit('restro:staff-signed-in', { person: view(people.find(p => p.id === id) || null) });
  }
  const ownersLeft = exceptId => people.filter(p => p.role === 'owner' && p.id !== exceptId).length;
  const changed = () => { save(); emit('restro:staff-changed', {}); };

  window.RestroStaff = Object.freeze({
    roles: ROLES,
    maxName: MAX_NAME,
    hasAccounts: () => people.length > 0,
    // Owners first, then managers, then servers; by name within each.
    list: () => people.map(view).sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name)),
    get current() { return view(people.find(p => p.id === currentId) || null); },
    validPin,
    // add / update resolve to { person } or { error: { field, message } }
    async add({ name, role, pin }) {
      name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
      if (!name) return { error: { field: 'name', message: 'Enter a name.' } };
      if (!people.length) role = 'owner'; // the first account is the owner's
      if (!roleIds.has(role)) return { error: { field: 'role', message: 'Choose a role.' } };
      if (!validPin(pin)) return { error: { field: 'pin', message: 'Enter 4 digits.' } };
      if (await holderOf(pin)) return { error: { field: 'pin', message: 'Someone else already uses this PIN. Choose another.' } };
      const person = { id: `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, role, pin: await hashPin(pin), createdAt: Date.now() };
      people.push(person); changed();
      return { person: view(person) };
    },
    async update(id, { name, role, pin }) {
      const person = people.find(p => p.id === id);
      if (!person) return { error: { field: 'name', message: 'This employee no longer exists.' } };
      name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
      if (!name) return { error: { field: 'name', message: 'Enter a name.' } };
      if (!roleIds.has(role)) return { error: { field: 'role', message: 'Choose a role.' } };
      if (person.role === 'owner' && role !== 'owner' && !ownersLeft(id)) return { error: { field: 'role', message: 'There must be at least one owner.' } };
      if (pin) {
        if (!validPin(pin)) return { error: { field: 'pin', message: 'Enter 4 digits, or leave it empty to keep the PIN.' } };
        if (await holderOf(pin, id)) return { error: { field: 'pin', message: 'Someone else already uses this PIN. Choose another.' } };
        person.pin = await hashPin(pin);
      }
      person.name = name; person.role = role; changed();
      if (id === currentId) emit('restro:staff-signed-in', { person: view(person) });
      return { person: view(person) };
    },
    // Returns { ok } or { error }
    remove(id) {
      const person = people.find(p => p.id === id);
      if (!person) return { ok: true };
      if (id === currentId) return { error: 'You can’t delete yourself while you’re signed in.' };
      if (person.role === 'owner' && !ownersLeft(id)) return { error: 'There must be at least one owner.' };
      people = people.filter(p => p.id !== id); changed();
      return { ok: true };
    },
    // The person a PIN belongs to, or null
    async verify(pin) { return validPin(pin) ? view(await holderOf(pin)) : null; },
    signIn(id) { if (people.some(p => p.id === id)) setCurrent(id); },
    signOut() { if (currentId) setCurrent(null); }
  });
})();
