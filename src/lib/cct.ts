// Renk sıcaklığı (Kelvin) → yaklaşık sRGB (Tanner Helland yaklaşımı). Yalnız görsel ipucu içindir.
export function cctToRgb(kelvin: number): [number, number, number] {
  const k = Math.min(10000, Math.max(1000, kelvin)) / 100;
  let r: number; let g: number; let b: number;
  if (k <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(k) - 161.1195681661;
    b = k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(k - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(k - 60, -0.0755148492);
    b = 255;
  }
  const clamp = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return [clamp(r), clamp(g), clamp(b)];
}

export function cctToCss(kelvin: number): string {
  const [r, g, b] = cctToRgb(kelvin);
  return `rgb(${r}, ${g}, ${b})`;
}

/** min..max arası doğrusal gradyan (CSS). */
export function cctGradient(min = 2200, max = 6500, stops = 6): string {
  const lo = Math.min(min, max); const hi = Math.max(min, max);
  const parts: string[] = [];
  for (let i = 0; i < stops; i++) {
    const k = lo + ((hi - lo) * i) / (stops - 1);
    parts.push(`${cctToCss(k)} ${Math.round((i / (stops - 1)) * 100)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

export function cctLabel(kelvin: number): string {
  if (kelvin < 2400) return 'amber / mum';
  if (kelvin < 2900) return 'sıcak';
  if (kelvin < 3300) return 'sıcak beyaz';
  if (kelvin < 4300) return 'nötr beyaz';
  if (kelvin < 5300) return 'gün ışığı';
  return 'soğuk beyaz';
}
