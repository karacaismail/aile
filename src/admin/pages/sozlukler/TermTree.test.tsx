import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import type { Term } from '../../data';
import { aggregateUsage, buildTermTree } from './model';
import { CATEGORY_NOUN, TermTree, panelIdOf } from './TermTree';

// Terim ağacı (telefon / temel sunum): iç içe açılır liste (APG Disclosure), başlık tam genişlik <button>
// (aria-expanded + aria-controls), ilk kök açık; klavye APG tree tuşları (Aşağı/Yukarı, Home/End, Sağ/Sol); Enter/Space
// düğmenin kendisi. Dış liste radiuslu ve taşmayı kırpar (kose-kart + overflow hidden); iç liste (alt terimler) de
// radiusludur (kose-kontrol). Kapalı son düğümün başlık çizgisi (admin.css [data-focus-line], başlığın 4 px altında 3 px)
// listenin alt kenarına 1 px kala oturur ve uçları köşe eğrisinde kırpılırdı (kavisli vurgu kenarı; e2e
// accentEdgeViolations "radiuslu ve kırpan ata kenarında şerit (ul.aile-sz-agac-liste, alt)"). Kural bileşenin kendi
// stilindedir (TermTree.css): yalnız çizgi görünürken (klavye modu + :focus-visible) o listenin değdiği iki alt köşesi
// radiussuz; açık son düğümde çizgi gövdenin üstünde kalır, köşeler değişmez; üst köşeler ve işaretçi modu korunur.
// Ölçüm: TermTree.css kuralları (postcss) render edilen öğeye Element.matches ile uygulanır; at-kuralı içindekiler
// sayılmaz. Odak klavyeyle alınır (jsdom :focus-visible'ı tarayıcı sezgisiyle hesaplar). Seçiciler role/ad.

vi.mock('../../ui', async () => ({
  Icon: (await import('../../ui/icons')).Icon,
  Tag: (await import('../../ui/Tag')).Tag,
}));

const term = (id: string, label: string, parent: string | null = null, legacy = false): Term => ({
  id, label, code: `kod_${id}`, parent_id: parent, legacy, vocabulary_id: 'v', tenant_id: 't',
});
// Kökler: Ana (Bağlı, Cam), Dış (Dal), Zeytin. İlk kök (Ana) açık başlar; son kök (Zeytin) altsız.
const TERMS: Term[] = [
  term('ana', 'Ana'), term('bagli', 'Bağlı', 'ana'), term('cam', 'Cam', 'ana'),
  term('dis', 'Dış'), term('dal', 'Dal', 'dis'),
  term('zeytin', 'Zeytin', null, true),
];

function renderTree(terms: readonly Term[] = TERMS) {
  const nodes = buildTermTree(terms);
  const usage = aggregateUsage(nodes, new Map([['bagli', { total: 2, kinds: [{ kind: 'purchase_need', count: 2 }] }]]));
  const onAction = vi.fn();
  const view = render(
    <TermTree label="Kategoriler" nodes={nodes} usage={usage} noun={CATEGORY_NOUN}
      renderAction={t => <button type="button" onClick={() => onAction(t.id)}>Pasifleştir</button>} />,
  );
  return { ...view, onAction };
}
// Ad "<terim> <kullanım> · <alt sayısı>" ile başlar; \b Türkçe harfte (ş, ı) sınır saymaz, bu yüzden boşluk/son.
const head = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) });
const outerList = () => screen.getByRole('list', { name: 'Kategoriler ağacı' });
const innerList = (label: string) => screen.getByRole('list', { name: `${label} altındakiler` });
const keyboardMode = (on: boolean) => { document.documentElement.dataset.keyboard = on ? 'true' : 'false'; };

afterEach(() => {
  delete document.documentElement.dataset.keyboard;
});

describe('TermTree › APG disclosure ve klavye', () => {
  it('her düğüm başlığı aria-expanded + aria-controls taşıyan düğmedir; ilk kök açık, diğerleri kapalı ve paneli hidden + inert', () => {
    renderTree();
    expect(head('Ana')).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Dış', 'Zeytin']) {
      const button = head(label);
      expect(button).toHaveAttribute('aria-expanded', 'false');
      const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
      expect(panel).toHaveAttribute('hidden');
      expect(panel).toHaveAttribute('inert');
      expect(panel).toBeEmptyDOMElement();
    }
    expect(head('Ana').getAttribute('aria-controls')).toBe(panelIdOf(TERMS[0]!));
    // Açık panel: e-tablo kodu, üst terim, kullanım ve alt terimler; eksik bilgi adıyla ("Yok").
    const panel = document.getElementById(panelIdOf(TERMS[0]!))!;
    expect(within(panel).getByText('kod_ana')).toBeInTheDocument();
    expect(within(innerList('Ana')).getAllByRole('listitem')).toHaveLength(2);
    expect(head('Bağlı')).toHaveAccessibleName(/2 kayıt kullanıyor/);
    expect(within(head('Zeytin')).getByText('Eski')).toBeInTheDocument();
  });

  it('Aşağı/Yukarı görünür başlıklar arasında, Home/End ilk/son; kapalı düğümün altına inilmez', async () => {
    const user = userEvent.setup();
    renderTree();
    await user.tab();
    expect(head('Ana')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(head('Bağlı')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(head('Dış')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(head('Zeytin')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(head('Dış')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(head('Ana')).toHaveFocus();
    await user.keyboard('{End}');
    expect(head('Zeytin')).toHaveFocus();
  });

  it('Sağ kapalıyı açar, açıksa ilk alta iner; Sol açığı kapatır, kapalıysa üste çıkar', async () => {
    const user = userEvent.setup();
    renderTree();
    act(() => head('Dış').focus());
    await user.keyboard('{ArrowRight}');
    expect(head('Dış')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Dış')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(head('Dal')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(head('Dış')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(head('Dış')).toHaveAttribute('aria-expanded', 'false');
    expect(head('Dış')).toHaveFocus();
  });

  it('Enter ve Space düğmenin kendisidir (aç/kapat, odak yerinde); Escape ve harf tuşları hiçbir şey yapmaz', async () => {
    const user = userEvent.setup();
    renderTree();
    act(() => head('Zeytin').focus());
    await user.keyboard('{Enter}');
    expect(head('Zeytin')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(head('Zeytin')).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Escape}z');
    expect(head('Zeytin')).toHaveAttribute('aria-expanded', 'false');
    expect(head('Zeytin')).toHaveFocus();
  });

  it('Tab panelin eylemine girer, Shift+Tab başlığa döner; kapalı panel sekme sırasında değildir', async () => {
    const user = userEvent.setup();
    const { onAction } = renderTree();
    await user.tab();
    expect(head('Ana')).toHaveFocus();
    await user.tab();
    const action = within(document.getElementById(panelIdOf(TERMS[0]!))!).getAllByRole('button', { name: 'Pasifleştir' })[0]!;
    expect(action).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledWith('ana');
    await user.tab({ shift: true });
    expect(head('Ana')).toHaveFocus();
    expect(screen.getAllByRole('button', { name: 'Pasifleştir' })).toHaveLength(1);
  });

  it('dokunup bırakma açar; iptal edilen dokunuş (pointercancel: kaydırma başladı) açmaz', async () => {
    const user = userEvent.setup();
    renderTree();
    const button = head('Dış');
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.pointerCancel(button, { pointerType: 'touch' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.pointer({ keys: '[TouchA]', target: button });
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});

// --- Stil: bileşenin kendi CSS'i ---------------------------------------------------------------------------------------
interface CssRule { selectors: string[]; atRules: string[]; decls: Map<string, string> }
const CSS_TEXT = readFileSync(resolve(__dirname, 'TermTree.css'), 'utf8');
const CORNERS_OF: Record<string, readonly string[]> = {
  'border-radius': ['top-left', 'top-right', 'bottom-right', 'bottom-left'],
  'border-top-left-radius': ['top-left'],
  'border-top-right-radius': ['top-right'],
  'border-bottom-right-radius': ['bottom-right'],
  'border-bottom-left-radius': ['bottom-left'],
};
function cssRules(text: string): CssRule[] {
  const rules: CssRule[] = [];
  postcss.parse(text).walkRules(rule => {
    const atRules: string[] = [];
    for (let parent = rule.parent; parent && parent.type === 'atrule'; parent = parent.parent) {
      atRules.push(`@${(parent as postcss.AtRule).name} ${(parent as postcss.AtRule).params}`);
    }
    const decls = new Map<string, string>();
    rule.each(node => { if (node.type === 'decl') decls.set(node.prop, node.value.trim()); });
    rules.push({ selectors: rule.selectors, atRules, decls });
  });
  return rules;
}
// Model: klavye modunda klavyeyle alınan odak görünürdür. jsdom'un :focus-visible sezgisi değerlendirme geçmişine bağlıdır
// (önceki testten kalan durum sonucu değiştirir); bu yüzden eşleşmede :focus-visible → :focus. Kuralın klavye modu ve
// :focus-visible ile koşullandığı ayrıca (cornerRuleSelectors) doğrulanır; gerçek tarayıcı davranışı e2e/admin-ui-f-edges.
function matchingRules(el: Element, rules: readonly CssRule[]): CssRule[] {
  return rules.filter(rule => rule.atRules.length === 0 && rule.selectors.some(selector => {
    if (/::?(before|after)\b/.test(selector)) return false;
    try { return el.matches(selector.replace(/:focus-visible\b/g, ':focus')); } catch { return false; }
  }));
}
/** Kabın (sınıf) köşesini 0'a çeken kuralların seçicileri: yalnız klavye modu + :focus-visible ile koşullu olmalı. */
function cornerRuleSelectors(rules: readonly CssRule[], boxClass: string): string[] {
  return rules
    .filter(rule => [...rule.decls].some(([prop, value]) => CORNERS_OF[prop] && /^0(px)?$/.test(value)))
    .flatMap(rule => rule.selectors)
    .filter(selector => selector.includes(boxClass));
}
function expectKeyboardGated(selectors: readonly string[]) {
  expect(selectors.length).toBeGreaterThan(0);
  for (const selector of selectors) {
    expect(selector).toMatch(/^html\[data-keyboard='true'\] /);
    expect(selector).toMatch(/:focus-visible\b/);
    expect(selector).not.toMatch(/:focus(?!-visible)/);
  }
}
function zeroedCorners(el: Element, rules: readonly CssRule[]): string[] {
  const corners = new Set<string>();
  for (const rule of matchingRules(el, rules)) {
    for (const [prop, value] of rule.decls) if (CORNERS_OF[prop] && /^0(px)?$/.test(value)) CORNERS_OF[prop]!.forEach(c => corners.add(c));
  }
  return [...corners].sort();
}

describe('TermTree › son düğümün odak çizgisi listenin radiuslu köşesinde kırpılmaz (TermTree.css)', () => {
  const css = cssRules(CSS_TEXT);

  it('dış ve iç liste radiusludur ve taşmayı kırpar: kapalı son düğüm çizgisinin kırpıldığı durum gerçektir', () => {
    renderTree();
    for (const [list, radius] of [[outerList(), 'var(--aile-kose-kart)'], [innerList('Ana'), 'var(--aile-kose-kontrol)']] as const) {
      const decls = matchingRules(list, css).flatMap(rule => [...rule.decls]);
      expect(decls).toContainEqual(['overflow', 'hidden']);
      expect(decls.filter(([prop]) => prop === 'border-radius').at(-1)).toEqual(['border-radius', radius]);
    }
  });

  it('klavye modunda kapalı son kök odaktayken yalnız dış listenin iki alt köşesi radiussuz; diğer düğümlerde köşeler korunur', async () => {
    const user = userEvent.setup();
    renderTree();
    keyboardMode(true);
    await user.tab();
    expect(head('Ana')).toHaveFocus();
    expect(zeroedCorners(outerList(), css)).toEqual([]);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(head('Dış')).toHaveFocus();
    expect(zeroedCorners(outerList(), css)).toEqual([]);
    await user.keyboard('{End}');
    expect(head('Zeytin')).toHaveFocus();
    expect(zeroedCorners(outerList(), css)).toEqual(['bottom-left', 'bottom-right']);
    expect(zeroedCorners(innerList('Ana'), css)).toEqual([]);
  });

  it('açık son kökte çizgi gövdenin üstündedir: köşeler korunur; kapanınca yeniden radiussuz', async () => {
    const user = userEvent.setup();
    renderTree();
    keyboardMode(true);
    act(() => head('Zeytin').focus());
    await user.keyboard('{ArrowRight}');
    expect(head('Zeytin')).toHaveAttribute('aria-expanded', 'true');
    expect(zeroedCorners(outerList(), css)).toEqual([]);
    await user.keyboard('{ArrowLeft}');
    expect(zeroedCorners(outerList(), css)).toEqual(['bottom-left', 'bottom-right']);
  });

  it('iç listenin kapalı son düğümü odaktayken yalnız o iç listenin alt köşeleri radiussuz; dış liste değişmez', async () => {
    const user = userEvent.setup();
    renderTree();
    keyboardMode(true);
    act(() => head('Bağlı').focus());
    expect(zeroedCorners(innerList('Ana'), css)).toEqual([]);
    await user.keyboard('{ArrowDown}');
    expect(head('Cam')).toHaveFocus();
    expect(zeroedCorners(innerList('Ana'), css)).toEqual(['bottom-left', 'bottom-right']);
    expect(zeroedCorners(outerList(), css)).toEqual([]);
  });

  it('işaretçi modunda (data-keyboard=false) odak son kökte kalsa da köşeler korunur; radiussuz durumda geçiş yok', async () => {
    const user = userEvent.setup();
    renderTree();
    keyboardMode(true);
    await user.tab();
    await user.keyboard('{End}');
    expect(head('Zeytin')).toHaveFocus();
    expect(zeroedCorners(outerList(), css)).toEqual(['bottom-left', 'bottom-right']);
    expect(matchingRules(outerList(), css).filter(rule => [...rule.decls.keys()].some(prop => prop.startsWith('transition')))).toEqual([]);
    expectKeyboardGated(cornerRuleSelectors(css, '.aile-sz-agac-liste'));
    keyboardMode(false);
    expect(head('Zeytin')).toHaveFocus();
    expect(zeroedCorners(outerList(), css)).toEqual([]);
  });
});

describe('TermTree › kaynak kuralları', () => {
  it('telefon yolunda antd yok: TermTree.tsx antd, @ant-design/*, ui/antd ya da geniş modül içe aktarmaz', () => {
    const tsx = readFileSync(resolve(__dirname, 'TermTree.tsx'), 'utf8');
    expect(tsx).not.toMatch(/from\s+['"](antd|antd\/[^'"]*|@ant-design\/[^'"]*|[./]*\/?ui\/antd|\.\/antd)['"]/);
    expect(tsx).not.toMatch(/from\s+['"][^'"]*\.wide['"]/);
    expect(tsx).toContain("import './TermTree.css'");
    expect(CSS_TEXT).not.toMatch(/\.ant-/);
  });

  it('yalnız --aile tokenları: ham renk, halka, gölge, font-size yok; ikincil metin .aile-kucuk (14 px) sınıfıyla', () => {
    renderTree();
    const rules = CSS_TEXT.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rules).not.toMatch(/rgba?\(|hsla?\(/);
    expect(rules).not.toMatch(/outline|box-shadow/);
    expect(rules).not.toMatch(/font-size/);
    expect(rules).not.toMatch(/break-all|anywhere/);
    expect(document.querySelectorAll('.aile-sz-dugum-meta').length).toBeGreaterThan(0);
    for (const meta of document.querySelectorAll('.aile-sz-dugum-meta, dt')) expect(meta).toHaveClass('aile-kucuk');
  });

  it('dokunma hedefi: başlık düğmesi --aile-dokunma-hedefi (44 px, kaba girişte 48 px) yüksekliğinde ve tam genişlikte', () => {
    const decls = cssRules(CSS_TEXT).filter(rule => rule.selectors.includes('.aile-sz-dugum-bas')).flatMap(rule => [...rule.decls]);
    expect(decls).toContainEqual(['min-height', 'var(--aile-dokunma-hedefi)']);
    expect(decls).toContainEqual(['width', '100%']);
  });

  it('tek süre ve eğri; reduced-motion geçişli her öğede süreyi 0 yapar (durum anında değişir)', () => {
    const all = cssRules(CSS_TEXT);
    const moving = all.filter(rule => rule.atRules.length === 0 && rule.decls.has('transition'));
    expect(moving.length).toBeGreaterThan(0);
    for (const rule of moving) {
      for (const part of rule.decls.get('transition')!.split(',')) expect(part.trim()).toMatch(/^[a-z-]+ var\(--aile-sure\) var\(--aile-egri\)$/);
    }
    const reduced = all.filter(rule => rule.atRules.some(at => /prefers-reduced-motion:\s*reduce/.test(at)) && rule.decls.get('transition-duration') === '0s');
    const covered = reduced.flatMap(rule => rule.selectors);
    for (const rule of moving) for (const selector of rule.selectors) expect(covered, selector).toContain(selector);
  });
});
