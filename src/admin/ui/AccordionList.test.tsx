import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AccordionItem } from '../shell/contracts';
import { AccordionList } from './AccordionList';

// Tasarım › components/AccordionList/README.md: bir yüzey içinde açılır satırlar; telefonda tablonun yerine geçer.
// Kapalı başlıkta title/meta/status/lead; sağda 32 px çerçeveli ok (aria-hidden, düğme satırın kendisidir, aria-expanded
// + aria-controls doğru); ilk satır açık (firstOpen); birden çok satır açık kalabilir; üst satırda sayım +
// "ayrıntı için satıra dokunun" + "Tümünü aç / kapat"; gruplar; body yoksa düz satır, onOpen varsa ayrıntıya gider.
// Renkli kenar şeridi yok; açık hâl yalnız ok yönüyle gösterilmez (bilgi-yuzey + dolgulu düğme, CSS'te doğrulanır).
const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');
const head = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });
const panelOf = (button: HTMLElement) => {
  const id = button.getAttribute('aria-controls');
  expect(id).toBeTruthy();
  const panel = document.getElementById(id!);
  expect(panel).not.toBeNull();
  return panel!;
};

const alimlar: AccordionItem[] = [
  { key: 'a1', title: 'Salon koltuğu', meta: 'ALM-001 · Salon', status: 'Sipariş verildi', lead: '₺18.500,00', body: [['Planlanan', '₺18.500,00'], ['Gerçekleşen', 'Henüz yok'], ['Oda', 'Salon']] },
  { key: 'a2', title: 'Mutfak masası', meta: 'ALM-002 · Mutfak', status: 'Fiyat araştırılıyor', lead: 'Fiyat yok', body: [['Planlanan', 'Fiyat yok'], ['Gerçekleşen', 'Henüz yok']] },
  { key: 'a3', title: 'Bebek karyolası', meta: 'ALM-003 · Bebek odası', lead: '₺6.200,00', body: [['Planlanan', '₺6.200,00'], ['Gerçekleşen', '₺6.200,00']] },
];

describe('AccordionList', () => {
  it('ilk satır açık gelir (firstOpen varsayılan); diğerleri kapalı, hidden + inert', () => {
    render(<AccordionList items={alimlar} />);
    const first = head('Salon koltuğu');
    expect(first).toHaveAttribute('type', 'button');
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const firstPanel = panelOf(first);
    expect(firstPanel).not.toHaveAttribute('hidden');
    expect(firstPanel).not.toHaveAttribute('inert');
    expect(within(firstPanel).getByText('Planlanan')).toBeVisible();
    expect(within(firstPanel).getByText('Henüz yok')).toBeVisible();

    const second = head('Mutfak masası');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    const secondPanel = panelOf(second);
    expect(secondPanel).toHaveAttribute('hidden');
    expect(secondPanel).toHaveAttribute('inert');
    expect(head('Bebek karyolası')).toHaveAttribute('aria-expanded', 'false');

    // Kapalı başlıkta title, meta, status ve lead görünür.
    expect(within(second).getByText('Mutfak masası')).toBeVisible();
    expect(within(second).getByText('ALM-002 · Mutfak')).toBeVisible();
    expect(within(second).getByText('Fiyat araştırılıyor')).toBeVisible();
    expect(within(second).getByText('Fiyat yok')).toBeVisible();
  });

  it('firstOpen={false} ile hiçbir satır açık değildir; defaultOpenKeys verilen satırları açar', () => {
    const { unmount } = render(<AccordionList items={alimlar} firstOpen={false} />);
    for (const title of ['Salon koltuğu', 'Mutfak masası', 'Bebek karyolası']) expect(head(title)).toHaveAttribute('aria-expanded', 'false');
    unmount();

    render(<AccordionList items={alimlar} defaultOpenKeys={['a2', 'a3']} />);
    expect(head('Salon koltuğu')).toHaveAttribute('aria-expanded', 'false');
    expect(head('Mutfak masası')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Bebek karyolası')).toHaveAttribute('aria-expanded', 'true');
  });

  it('yeni kayıt kümesinde açık satırların hiçbiri yoksa (filtre, dönem) ilk gövdeli satır yeniden açılır; kalanlar korunur', async () => {
    const user = userEvent.setup();
    const yeni: AccordionItem[] = [
      { key: 'b1', title: 'Çalışma masası', body: [['Planlanan', '₺9.000,00']] },
      { key: 'b2', title: 'Kitaplık', body: [['Planlanan', '₺4.500,00']] },
    ];
    const { rerender } = render(<AccordionList items={alimlar} />);
    await user.click(head('Mutfak masası'));
    expect(head('Salon koltuğu')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Mutfak masası')).toHaveAttribute('aria-expanded', 'true');

    // Açık satırlardan biri yeni kümede varsa durum korunur (ör. "daha fazla göster" satır ekler).
    rerender(<AccordionList items={[...alimlar.slice(1), ...yeni]} />);
    expect(head('Mutfak masası')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Çalışma masası')).toHaveAttribute('aria-expanded', 'false');

    // Hiçbiri yoksa ilk gövdeli satır açık gelir (tablolar akordeon, ilk açık).
    rerender(<AccordionList items={yeni} />);
    expect(head('Çalışma masası')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Kitaplık')).toHaveAttribute('aria-expanded', 'false');

    // Kullanıcı hepsini kapattıysa yeni küme bunu bozmaz; firstOpen={false} hiç açmaz.
    await user.click(head('Çalışma masası'));
    rerender(<AccordionList items={alimlar} />);
    for (const title of ['Salon koltuğu', 'Mutfak masası', 'Bebek karyolası']) expect(head(title)).toHaveAttribute('aria-expanded', 'false');
  });

  it('kayıtlar sonradan gelirse (boş liste → veri) ilk gövdeli satır açık gelir', () => {
    const { rerender } = render(<AccordionList items={[]} caption="0 alım" />);
    rerender(<AccordionList items={alimlar} caption="3 alım" />);
    expect(head('Salon koltuğu')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Mutfak masası')).toHaveAttribute('aria-expanded', 'false');
  });

  it('firstOpen={false}: açık satırlar yeni kümede yoksa hiçbir satır açılmaz', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AccordionList items={alimlar} firstOpen={false} />);
    await user.click(head('Mutfak masası'));
    rerender(<AccordionList items={[{ key: 'b1', title: 'Çalışma masası', body: [['Planlanan', '₺9.000,00']] }]} firstOpen={false} />);
    expect(head('Çalışma masası')).toHaveAttribute('aria-expanded', 'false');
  });

  it('tıklama açar ve kapatır; birden çok satır aynı anda açık kalabilir; gövde etiket–değer listesidir (dl)', async () => {
    const user = userEvent.setup();
    render(<AccordionList items={alimlar} />);
    const first = head('Salon koltuğu');
    const second = head('Mutfak masası');

    await user.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(panelOf(second)).not.toHaveAttribute('hidden');
    // İlk satır açık kalır: akordeon tekil değildir.
    expect(first).toHaveAttribute('aria-expanded', 'true');

    const dl = panelOf(second).querySelector('dl');
    expect(dl).not.toBeNull();
    const terms = Array.from(dl!.querySelectorAll('dt')).map(dt => dt.textContent);
    const values = Array.from(dl!.querySelectorAll('dd')).map(dd => dd.textContent);
    expect(terms).toEqual(['Planlanan', 'Gerçekleşen']);
    expect(values).toEqual(['Fiyat yok', 'Henüz yok']);

    await user.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(panelOf(second)).toHaveAttribute('hidden');
    expect(panelOf(second)).toHaveAttribute('inert');

    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  it('açık durum satırda data-open ile işaretlenir; ok kutusu süsleyicidir (aria-hidden) ve 32 px çerçeveli düğme görünümündedir', async () => {
    const user = userEvent.setup();
    render(<AccordionList items={alimlar} />);
    const first = head('Salon koltuğu');
    const item = first.closest('li')!;
    expect(item).toHaveAttribute('data-open', 'true');

    const toggleBox = first.querySelector('.aile-acc-tog');
    expect(toggleBox).not.toBeNull();
    expect(toggleBox).toHaveAttribute('aria-hidden', 'true');
    const chevron = toggleBox!.querySelector('svg[data-icon="chevronDown"]');
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveAttribute('aria-hidden', 'true');

    await user.click(first);
    expect(item).toHaveAttribute('data-open', 'false');
  });

  it('üst satır: caption + "ayrıntı için satıra dokunun"; "Tümünü aç" hepsini açar ve "Tümünü kapat" olur', async () => {
    const user = userEvent.setup();
    render(<AccordionList items={alimlar} caption="3 alım" />);
    expect(screen.getByText('3 alım · ayrıntı için satıra dokunun')).toBeVisible();

    const all = screen.getByRole('button', { name: 'Tümünü aç' });
    await user.click(all);
    for (const title of ['Salon koltuğu', 'Mutfak masası', 'Bebek karyolası']) expect(head(title)).toHaveAttribute('aria-expanded', 'true');
    const close = screen.getByRole('button', { name: 'Tümünü kapat' });
    expect(screen.queryByRole('button', { name: 'Tümünü aç' })).toBeNull();

    await user.click(close);
    for (const title of ['Salon koltuğu', 'Mutfak masası', 'Bebek karyolası']) expect(head(title)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Tümünü aç' })).toBeVisible();
  });

  it('üst satır caption yokken 3 ve daha az kayıtta görünmez; 4 ve üstünde "N kayıt" yazar', () => {
    const { unmount } = render(<AccordionList items={alimlar} />);
    expect(screen.queryByText(/ayrıntı için satıra dokunun/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Tümünü/ })).toBeNull();
    unmount();

    const dort = [...alimlar, { key: 'a4', title: 'Köpek yatağı', body: [['Planlanan', '₺900,00']] as [string, string][] }];
    render(<AccordionList items={dort} />);
    expect(screen.getByText('4 kayıt · ayrıntı için satıra dokunun')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tümünü aç' })).toBeVisible();
  });

  it('gruplar: her grup adlı bölge, başlığı h3 + sayım; sıra ilk görülme sırasıdır', () => {
    const grouped: AccordionItem[] = [
      { ...alimlar[0], group: 'Salon' },
      { ...alimlar[1], group: 'Mutfak' },
      { key: 'a5', title: 'Mutfak sandalyesi', group: 'Mutfak', body: [['Planlanan', '₺2.400,00']] },
      { ...alimlar[2], group: 'Bebek odası' },
    ];
    render(<AccordionList items={grouped} caption="4 alım" />);
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map(h => h.textContent)).toEqual(['Salon1', 'Mutfak2', 'Bebek odası1']);

    const mutfak = screen.getByRole('region', { name: 'Mutfak' });
    const rows = within(mutfak).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(mutfak).getByRole('button', { name: /^Mutfak masası/ })).toBeVisible();
    expect(within(mutfak).getByRole('button', { name: /^Mutfak sandalyesi/ })).toBeVisible();
    // İlk açık satır listenin ilk gövdeli satırıdır, grup sırasından bağımsız.
    expect(head('Salon koltuğu')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Mutfak masası')).toHaveAttribute('aria-expanded', 'false');
  });

  it('headingLevel: grup başlıkları verilen düzeyde (h1 altında h2 yoksa 2; başlık sırası atlamaz); varsayılan h3 kalır', () => {
    const grouped: AccordionItem[] = [
      { ...alimlar[0], group: 'Tarihi geçenler' },
      { ...alimlar[1], group: 'Mart 2027' },
    ];
    const { unmount } = render(<AccordionList items={grouped} caption="2 tahmini ödeme" headingLevel={2} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Tarihi geçenler1', 'Mart 20271']);
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    // Bölge adı ve sayım düzeyden bağımsızdır.
    expect(screen.getByRole('region', { name: 'Tarihi geçenler' })).toBeVisible();
    unmount();

    render(<AccordionList items={grouped} caption="2 tahmini ödeme" />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('grupsuz listede grup başlığı yoktur; bölge adı caption olur', () => {
    render(<AccordionList items={alimlar} caption="3 alım" />);
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    expect(screen.getByRole('region', { name: '3 alım' })).toBeVisible();
    expect(screen.getByRole('list')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('body yoksa satır düz liste öğesidir: onOpen varsa düğme ayrıntıya gider (aria-expanded yok), yoksa düğme değildir', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const items: AccordionItem[] = [
      { key: 'f1', title: 'Fatura ödendi', meta: '28.10.2026', lead: '₺1.250,00', onOpen },
      { key: 'f2', title: 'Kira', meta: '01.11.2026', lead: '₺20.000,00' },
    ];
    render(<AccordionList items={items} />);
    const flat = screen.getByRole('button', { name: /^Fatura ödendi/ });
    expect(flat).not.toHaveAttribute('aria-expanded');
    expect(flat).not.toHaveAttribute('aria-controls');
    expect(flat.querySelector('svg[data-icon="chevronRight"]')).not.toBeNull();
    expect(flat.querySelector('.aile-acc-tog')).toBeNull();
    await user.click(flat);
    expect(onOpen).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole('button', { name: /^Kira/ })).toBeNull();
    expect(screen.getByText('Kira')).toBeVisible();
    // Gövdeli satır yokken ne "dokunun" ipucu ne de Tümünü aç vardır.
    expect(screen.queryByText(/ayrıntı için satıra dokunun/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Tümünü/ })).toBeNull();
  });

  it('body + onOpen: açık gövdede "Ayrıntıyı aç" düğmesi (openLabel ile değişir) ayrıntıya gider', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const items: AccordionItem[] = [{ ...alimlar[0], onOpen }];
    const { unmount } = render(<AccordionList items={items} />);
    const open = within(panelOf(head('Salon koltuğu'))).getByRole('button', { name: 'Ayrıntıyı aç' });
    await user.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
    unmount();

    render(<AccordionList items={items} openLabel="Alımı aç" />);
    expect(within(panelOf(head('Salon koltuğu'))).getByRole('button', { name: 'Alımı aç' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ayrıntıyı aç' })).toBeNull();
  });

  it('gövdedeki eylem düğmesi satırın adıyla açıklanır: görünür ad aynı kalır, aria-describedby satır başlığını gösterir', () => {
    const items: AccordionItem[] = alimlar.map(item => ({ ...item, onOpen: () => {} }));
    render(<AccordionList items={items} caption="3 alım" defaultOpenKeys={['a1', 'a2', 'a3']} />);
    const dugmeler = screen.getAllByRole('button', { name: 'Ayrıntıyı aç' });
    expect(dugmeler).toHaveLength(3);
    expect(dugmeler.map(dugme => dugme.textContent)).toEqual(['Ayrıntıyı aç', 'Ayrıntıyı aç', 'Ayrıntıyı aç']);
    for (const [i, title] of ['Salon koltuğu', 'Mutfak masası', 'Bebek karyolası'].entries()) {
      expect(dugmeler[i]).toHaveAccessibleName('Ayrıntıyı aç');
      expect(dugmeler[i]).toHaveAccessibleDescription(title);
      // Açıklama başlıktaki ad öğesidir (meta, durum ve tutar değil): tek kaynak, ikinci bir gizli metin yok.
      const id = dugmeler[i]!.getAttribute('aria-describedby')!;
      expect(document.getElementById(id)).toBe(head(title).querySelector('.aile-acc-ul'));
    }
  });

  it('seçili satır data-selected taşır (seçim yüzeyi CSS\'te secili + 600)', () => {
    render(<AccordionList items={[{ ...alimlar[0], selected: true }, alimlar[1]]} />);
    expect(head('Salon koltuğu').closest('li')).toHaveAttribute('data-selected', 'true');
    expect(head('Mutfak masası').closest('li')).toHaveAttribute('data-selected', 'false');
  });

  it('seçili başlıkta sayfanın ikincil metni (.aile-ikincil) ana metin rengine döner: secili üzerinde 4,5:1 (Table.css ile eşlik)', () => {
    // metin-ikincil secili yüzeyde 4,0:1'de kalır (WCAG 1.4.3 için 4,5:1). Sayfalar başlığa .aile-ikincil yazı koyar
    // (Bütçe "Fark" etiketi, "Kaynakta yazılı"); kural bileşende tek yerde durur, sayfa düzeyinde yinelenmez.
    const rules = (css: string) => Array.from(css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g))
      .map(([, selector, body]) => ({ selectors: selector!.split(',').map(part => part.trim().replace(/\s+/g, ' ')), body: body! }));
    const metinRengi = (css: string, hedef: string) => rules(css).some(rule => rule.selectors.includes(hedef) && /color: var\(--aile-metin\);/.test(rule.body));
    expect(metinRengi(read('AccordionList.css'), ".aile-acc-item[data-selected='true'] > .aile-acc-head .aile-ikincil")).toBe(true);
    expect(metinRengi(read('Table.css'), ".aile-table tbody > tr[aria-selected='true'] > td.aile-table-hucre .aile-ikincil")).toBe(true);
  });

  it('klavye: Enter ve Space satırı açar/kapatır; ok tuşları, Home ve End satır başlıkları arasında odağı taşır', async () => {
    const user = userEvent.setup();
    render(<AccordionList items={alimlar} firstOpen={false} />);
    const [first, second, third] = ['Salon koltuğu', 'Mutfak masası', 'Bebek karyolası'].map(head);

    first.focus();
    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('[Space]');
    expect(first).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(third).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(third).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    await user.keyboard('{End}');
    expect(third).toHaveFocus();
    // Ok tuşları durumu değiştirmez.
    for (const button of [first, second, third]) expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('bir satır dışarıdan kapanırken odak gövdesindeyse satır başlığına döner', () => {
    const items: AccordionItem[] = [{ ...alimlar[0], onOpen: () => {} }, alimlar[1]];
    render(<AccordionList items={items} caption="2 alım" defaultOpenKeys={['a1', 'a2']} />);
    const first = head('Salon koltuğu');
    const inner = within(panelOf(first)).getByRole('button', { name: 'Ayrıntıyı aç' });
    inner.focus();
    expect(inner).toHaveFocus();
    // fireEvent odağı taşımaz; gerçek tıklamada odak zaten "Tümünü kapat" düğmesinde kalır.
    fireEvent.click(screen.getByRole('button', { name: 'Tümünü kapat' }));
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(first).toHaveFocus();
  });

  it('Tab ve Shift+Tab satır başlıkları arasında DOM sırasıyla gezer; kapalı gövdenin içi sekme sırasında değildir; Escape durumu değiştirmez', async () => {
    const user = userEvent.setup();
    const items: AccordionItem[] = [{ ...alimlar[0], onOpen: () => {} }, { ...alimlar[1], onOpen: () => {} }];
    render(<AccordionList items={items} />);
    const first = head('Salon koltuğu');
    const second = head('Mutfak masası');
    await user.tab();
    expect(first).toHaveFocus();
    // İlk satır açık: gövdesindeki "Ayrıntıyı aç" sırada; ikinci satır kapalı (inert): onun düğmesi atlanır.
    await user.tab();
    expect(within(panelOf(first)).getByRole('button', { name: 'Ayrıntıyı aç' })).toHaveFocus();
    await user.tab();
    expect(second).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(panelOf(first)).getByRole('button', { name: 'Ayrıntıyı aç' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(first).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'false');
  });

  it('iptal edilen dokunuş (pointercancel: liste kaydırılıyor) satırı açmaz; dokunup bırakma açar', () => {
    render(<AccordionList items={alimlar} />);
    const second = head('Mutfak masası');
    fireEvent.pointerDown(second, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerCancel(second, { pointerType: 'touch', isPrimary: true });
    expect(second).toHaveAttribute('aria-expanded', 'false');
    fireEvent.pointerDown(second, { pointerType: 'touch', isPrimary: true });
    fireEvent.pointerUp(second, { pointerType: 'touch', isPrimary: true });
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
  });

  // CSS kuralları (yorumsuz) ve bulundukları @media koşulu; iç içe tek düzey @media yeterli.
  const cssKurallari = (css: string) => {
    const kurallar: { secici: string; govde: string; medya: string | null }[] = [];
    const temiz = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const yuru = (metin: string, medya: string | null) => {
      let i = 0;
      while (i < metin.length) {
        const ac = metin.indexOf('{', i);
        if (ac < 0) break;
        const bas = metin.slice(i, ac).trim();
        let derinlik = 1;
        let j = ac + 1;
        for (; j < metin.length && derinlik > 0; j++) {
          if (metin[j] === '{') derinlik++;
          else if (metin[j] === '}') derinlik--;
        }
        const ic = metin.slice(ac + 1, j - 1);
        if (bas.startsWith('@media') || bas.startsWith('@container') || bas.startsWith('@starting-style')) yuru(ic, bas.startsWith('@media') ? bas : medya);
        else kurallar.push({ secici: bas.replace(/\s+/g, ' '), govde: ic, medya });
        i = j;
      }
    };
    yuru(temiz, null);
    return kurallar;
  };

  it('odak göstergesi hareketsizdir: çizgi sözde öğesi hiçbir koşulda geçiş taşımaz (solarak belirmez; UX hareket sözleşmesi)', () => {
    const kurallar = cssKurallari(read('AccordionList.css')).filter(kural => kural.secici.includes('.aile-acc-ul::after'));
    expect(kurallar.length).toBeGreaterThan(0);
    for (const kural of kurallar) expect(kural.govde, kural.secici).not.toMatch(/transition/);
    // Gösterge yalnız klavye modu + :focus-visible ile görünür; açılış ve kapanış anında (opaklık 0 ↔ 1).
    const gorunur = kurallar.find(kural => /html\[data-keyboard='true'\][^,]*:focus-visible/.test(kural.secici));
    expect(gorunur?.govde).toMatch(/opacity:\s*1/);
  });

  it('hover tonu yalnız hover destekleyen birincil işaretçide: dokunmatikte takılı kalmaz (açık satır tonuyla karışmaz)', () => {
    const hover = cssKurallari(read('AccordionList.css')).filter(kural => kural.secici.includes(':hover'));
    expect(hover.length).toBeGreaterThan(0);
    for (const kural of hover) expect(kural.medya, kural.secici).toBe('@media (hover: hover)');
  });

  it('uzun adlar kelime arasından sarılır: başlıkta ve etiketlerde break-all / anywhere yok; başlık sütunu daralabilir', () => {
    const css = read('AccordionList.css');
    expect(css).not.toMatch(/break-all|anywhere/);
    expect(css).toMatch(/\.aile-acc-title \{[^}]*word-break: keep-all/);
    expect(css).toMatch(/\.aile-acc-dl dt \{[^}]*word-break: keep-all/);
    expect(css).toMatch(/\.aile-acc-main \{[^}]*min-width: 0/);
  });

  it('dar listede (kap sorgusu, rem) ana tutar başlık bloğunun altına iner: başlık ve durum satırın genişliğini alır', () => {
    const css = read('AccordionList.css');
    expect(css).toMatch(/\.aile-acc \{[^}]*container: aile-acc \/ inline-size/);
    const narrow = /@container aile-acc \(max-width: [\d.]+rem\) \{([\s\S]*?)\n\}/.exec(css);
    expect(narrow).not.toBeNull();
    expect(narrow![1]).toMatch(/\.aile-acc-head \{[^}]*grid-template-columns: minmax\(0, 1fr\) var\(--aile-bosluk-8\)/);
    expect(narrow![1]).toMatch(/\.aile-acc-end \{[^}]*grid-column: 1;[^}]*grid-row: 2;/);
  });

  it('dokunma hedefi: satır başlığı --aile-dokunma-hedefi (44 px, kaba girişte 48 px) ile 64 px tasarım yüksekliğinin büyüğü', () => {
    const css = read('AccordionList.css');
    expect(css).toMatch(/\.aile-acc-head \{[^}]*min-height: max\(var\(--aile-dokunma-hedefi\), calc\(2 \* var\(--aile-bosluk-8\)\)\)/);
    expect(css).not.toMatch(/--aile-hedef-asgari/);
  });

  it('antd Collapse kullanmaz; CSS tokenlardan beslenir; halka/outline yok; renkli kenar şeridi yok; açık hâl tonla gösterilir', () => {
    const tsx = read('AccordionList.tsx');
    expect(tsx).not.toMatch(/import[^;]*\bCollapse\b|<Collapse\b/);
    expect(tsx).not.toMatch(/from\s+['"](antd|@ant-design\/|@phosphor-icons\/)/);
    expect(tsx).toContain("import './AccordionList.css'");

    const css = read('AccordionList.css');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/outline|box-shadow/);
    // Renkli kenar şeridi yok: sol/sağ kenar hiç yok; kenar ya sıfırlanır (düğme) ya 1 px cizgi/kenar-kontrol çizgisidir.
    expect(css).not.toMatch(/border-left|border-right/);
    for (const edge of css.match(/border(?:-top|-bottom)?:[^;]+;/g) ?? []) expect(edge).toMatch(/^border(?:-top|-bottom)?: (?:0|1px solid var\(--aile-(cizgi|kenar-kontrol)\));$/);
    expect(css).toMatch(/var\(--aile-sure\)/);
    expect(css).toMatch(/var\(--aile-egri\)/);
    expect(css).toMatch(/var\(--aile-dokunma-hedefi\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    // Açık satır: başlık bilgi-yuzey, ok kutusu eylem dolgu; seçili satır secili yüzey.
    expect(css).toMatch(/\[data-open='true'\] > \.aile-acc-head \{[^}]*var\(--aile-bilgi-yuzey\)/);
    expect(css).toMatch(/\[data-open='true'\] > \.aile-acc-head \.aile-acc-tog \{[^}]*var\(--aile-eylem\)/);
    expect(css).toMatch(/\[data-selected='true'\][^{]*\{[^}]*var\(--aile-secili\)/);
    // Odak: tek çizgi, odak tokenları, yalnız klavye modunda ve :focus-visible ile.
    expect(css).toMatch(/html\[data-keyboard='true'\][^{]*:focus-visible[^{]*\.aile-acc-ul::after/);
    expect(css).toMatch(/var\(--aile-odak-kalinlik\)/);
    expect(css).toMatch(/var\(--aile-odak-aralik\)/);
    // Sabit px yok; tek istisna 1 px ayırıcı/çerçeve çizgisi.
    const fixedPx = (css.match(/\b\d+px\b/g) ?? []).filter(value => value !== '1px');
    expect(fixedPx).toEqual([]);
  });
});
