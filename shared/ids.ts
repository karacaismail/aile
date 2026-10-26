// ULID (Crockford base32, 26 karakter). Tarayıcıda crypto, Apps Script'te Math.random kullanır.
const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(n: number): number[] {
  const out: number[] = [];
  const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (g && typeof g.getRandomValues === 'function') {
    const buf = new Uint8Array(n);
    g.getRandomValues(buf);
    for (let i = 0; i < n; i++) out.push(buf[i]);
    return out;
  }
  for (let i = 0; i < n; i++) out.push(Math.floor(Math.random() * 256));
  return out;
}

let lastTime = 0;
let lastRandom: number[] = [];

export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENC[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand: number[];
  if (now === lastTime) {
    // Aynı milisaniyede monoton artış
    rand = lastRandom.slice();
    for (let i = rand.length - 1; i >= 0; i--) {
      if (rand[i] < 31) { rand[i]++; break; }
      rand[i] = 0;
    }
  } else {
    rand = randomBytes(16).map((b) => b % 32);
  }
  lastTime = now;
  lastRandom = rand;
  return time + rand.map((v) => ENC[v]).join('');
}

export function isUlid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);
}
