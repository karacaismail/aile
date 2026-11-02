import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { aileCssVars } from '../design/tokens.ts';
import * as startup from './startup';

// admin.html satır içi başlangıç betiği (vite.config.ts transformIndexHtml admin dalı). Betik metni burada gerçek
// tarayıcıdaki gibi çalıştırılır: `location` yalnız bir parametreyle gölgelenir (jsdom'da location.reload değiştirilemez).
// Sözleşme: giriş modülü (ya da statik bağımlılığı) yüklenemezse React kökü boşken düz HTML "Uygulama yüklenemedi ·
// Yenile" görünür; React kökü doluyken ya da başka kaynak hatalarında hiçbir şey olmaz.

type Registered = { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions };
let registered: Registered[] = [];
let reload: Mock<() => void>;

function runScript() {
  new Function('location', startup.adminStartupScript)({ reload });
}

function moduleScriptError(type = 'module') {
  const script = document.createElement('script');
  script.type = type;
  document.head.append(script);
  script.dispatchEvent(new Event('error'));
  return script;
}

const root = () => document.getElementById('admin-root')!;
const failure = () => root().querySelector('main');

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="admin-root"></div>';
  delete document.documentElement.dataset.keyboard;
  reload = vi.fn<() => void>();
  registered = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    registered.push({ type, listener, options });
    add(type, listener, options);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const { type, listener, options } of registered) window.removeEventListener(type, listener, options);
});

describe('adminStartupScript', () => {
  it('klavye kipini giriş modülünden önce kurar (mevcut davranış)', () => {
    runScript();
    expect(document.documentElement.dataset.keyboard).toBe('false');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.documentElement.dataset.keyboard).toBe('true');
  });

  it('giriş modülü yüklenemezse boş köke düz HTML hata ekranı çizer: başlık, açıklama, Yenile düğmesi', () => {
    runScript();
    moduleScriptError();
    const main = failure();
    expect(main, 'hata ekranı').not.toBeNull();
    const alert = main!.querySelector('[role="alert"]');
    expect(alert?.querySelector('h1')?.textContent).toBe('Uygulama yüklenemedi');
    expect(alert?.textContent).toContain('Bağlantınızı kontrol edip sayfayı yenileyin.');
    expect(main!.getAttribute('aria-labelledby')).toBe(main!.querySelector('h1')!.id);
    const buttons = main!.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].type).toBe('button');
    expect(buttons[0].textContent).toBe('Yenile');
    expect(document.head.querySelectorAll('style[data-admin-startup-failure]')).toHaveLength(1);
  });

  it('Yenile sayfayı yeniden yükler', () => {
    runScript();
    moduleScriptError();
    failure()!.querySelector('button')!.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('belge henüz ayrıştırılırken gelen hata DOMContentLoaded sonrasında çizilir', () => {
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    runScript();
    moduleScriptError();
    expect(failure()).toBeNull();
    readyState.mockReturnValue('interactive');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(failure()?.querySelector('h1')?.textContent).toBe('Uygulama yüklenemedi');
  });

  it('React kökü doluysa (uygulama açıldıktan sonra) hiçbir şey değiştirmez', () => {
    runScript();
    root().innerHTML = '<div class="aile-admin"><main id="admin-content"><h1>Alımlar</h1></main></div>';
    moduleScriptError();
    expect(root().querySelector('#admin-content')).not.toBeNull();
    expect(root().textContent).not.toContain('Uygulama yüklenemedi');
    expect(document.head.querySelector('style[data-admin-startup-failure]')).toBeNull();
  });

  it('modül olmayan betik, görsel ve stil hatalarını yok sayar', () => {
    runScript();
    moduleScriptError('text/javascript');
    const img = document.createElement('img');
    document.body.append(img);
    img.dispatchEvent(new Event('error'));
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    document.head.append(link);
    link.dispatchEvent(new Event('error'));
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    expect(failure()).toBeNull();
  });

  it('birden çok modül hatasında ekranı bir kez çizer', () => {
    runScript();
    moduleScriptError();
    moduleScriptError();
    expect(root().querySelectorAll('main')).toHaveLength(1);
    expect(document.head.querySelectorAll('style[data-admin-startup-failure]')).toHaveLength(1);
  });
});

describe('hata ekranı stilleri (tokens.ts kaynaklı --aile-* değişkenleri)', () => {
  const css = () => {
    runScript();
    moduleScriptError();
    return document.head.querySelector('style[data-admin-startup-failure]')!.textContent ?? '';
  };

  it('kullanılan her --aile-* değişkeni kökte tanımlı ve değeri tokens.ts ile aynı; başka yerde sabit renk yok', () => {
    const text = css();
    const declared = Object.fromEntries([...text.matchAll(/(--aile-[a-z0-9-]+):([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
    const used = [...new Set([...text.matchAll(/var\((--aile-[a-z0-9-]+)\)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(5);
    for (const name of used) {
      expect(declared[name], `${name} tanımlı`).toBeDefined();
      expect(declared[name], `${name} tokens.ts değeri`).toBe(aileCssVars[name]);
    }
    const withoutDeclarations = text.replace(/--aile-[a-z0-9-]+:[^;}]+/g, '');
    expect(withoutDeclarations).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('okunur metin ≥14 px, Outfit önce; Yenile 44 px, kaba girişte 48 px', () => {
    const text = css();
    for (const [, size] of text.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) expect(Number(size)).toBeGreaterThanOrEqual(14);
    expect(text).toMatch(/--aile-font-sans:Outfit/);
    expect(text).toMatch(/@font-face\{font-family:Outfit;src:url\('\/aile\/fonts\/outfit-regular\.ttf'\)/);
    expect(text).toMatch(/button\{[^}]*min-height:var\(--aile-hedef-asgari\)/);
    expect(aileCssVars['--aile-hedef-asgari']).toBe('44px');
    expect(text).toMatch(/@media \(any-pointer:coarse\)\{[^{]*button\{min-height:calc\(var\(--aile-hedef-asgari\) \+ var\(--aile-bosluk-1\)\)\}\}/);
    expect(aileCssVars['--aile-bosluk-1']).toBe('4px');
  });

  it('odak: çevreleyen halka yok; tek alt çizgi yalnız klavye kipinde; forced-colors istisnası', () => {
    const text = css();
    expect(text).toMatch(/button:focus,[^{]*button:focus-visible\{outline:none;box-shadow:none\}/);
    expect(text).toMatch(/html\[data-keyboard='true'\] \.aile-startup-failure button:focus-visible::after\{[^}]*height:var\(--aile-odak-kalinlik\);[^}]*background:var\(--aile-odak\)/);
    const outlines = [...text.matchAll(/outline:([^;}]+)/g)].map((m) => m[1]);
    expect(outlines.sort()).toEqual(['2px solid CanvasText', 'none']);
    expect(text).toMatch(/@media \(forced-colors:active\)\{html\[data-keyboard='true'\] \.aile-startup-failure button:focus-visible\{outline:2px solid CanvasText\}\}/);
    expect(text).not.toMatch(/box-shadow:(?!none)/);
    expect(text).not.toMatch(/border-(?:left|right|top|bottom):/);
    expect(text).not.toMatch(/transition|animation/);
  });
});
