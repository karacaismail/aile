import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceContext } from '../device';
import type { Device, RecordRow } from '../shell/contracts';
import { ListRow } from './ListRow';

// Kaynak: aile-tasarim/tasarim-sistemi/components/ListRow/README.md + index.d.ts ListRowProps + bundle.js ListRow.
// Bizim props adları contracts RecordRow'a uyar (row, selected, narrow, onClick). Seçiciler role/label ile;
// antd iç sınıfı yok. Sentetik örnek: ORNEK_ALIMLAR'ın ilk kaydının biçimi, gerçek veri değil.

const karyola: RecordRow = {
  id: '6f1c0d2e-0000-5000-8000-000000000142',
  code: 'ALM-0142',
  label: 'Bebek karyolası',
  status: { label: 'Sipariş verildi', tone: 'bilgi' },
  room: 'Bebek odası',
  planned: { amount: '8500.00', currency: 'TRY' },
  actual: { amount: '7940.00', currency: 'TRY' },
  photo: { url: 'https://example.test/foto/karyola.png', verified: true },
  kind: 'purchase_need',
};

function renderList(ui: ReactNode, device: Device = 'desktop') {
  return render(
    <DeviceContext.Provider value={device}>
      <ul>{ui}</ul>
    </DeviceContext.Provider>,
  );
}

describe('ListRow — yapı ve ad', () => {
  it('bir liste öğesi içinde tek düğmedir; adı başlığı, kod · oda satırını ve durum sözcüğünü taşır', () => {
    renderList(<ListRow row={karyola} />);
    const item = screen.getByRole('listitem');
    const button = within(item).getByRole('button');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(within(item).getAllByRole('button')).toHaveLength(1);
    expect(button).toHaveAccessibleName(/Bebek karyolası/);
    expect(button).toHaveAccessibleName(/ALM-0142 · Bebek odası/);
    expect(button).toHaveAccessibleName(/Sipariş verildi/);
  });

  it('başlık govde-kalin sınıfıyla, kod · oda ikincil metin olarak çıkar', () => {
    renderList(<ListRow row={karyola} />);
    expect(screen.getByText('Bebek karyolası')).toHaveClass('aile-listrow-ad');
    expect(screen.getByText('ALM-0142 · Bebek odası')).toHaveClass('aile-listrow-meta');
  });

  it('oda yoksa yalnız kodu yazar', () => {
    renderList(<ListRow row={{ ...karyola, room: undefined }} />);
    expect(screen.getByText('ALM-0142')).toHaveClass('aile-listrow-meta');
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('durum Tag olarak tonuyla çıkar; boş durum sözcüğü "Bilinmiyor" olur', () => {
    const { unmount } = renderList(<ListRow row={karyola} />);
    expect(screen.getByText('Sipariş verildi').closest('[data-tone]')).toHaveAttribute('data-tone', 'bilgi');
    unmount();
    renderList(<ListRow row={{ ...karyola, status: { label: '  ', tone: 'uyari' } }} />);
    expect(screen.getByText('Bilinmiyor').closest('[data-tone]')).toHaveAttribute('data-tone', 'uyari');
  });

  it('ListRow.Header üst satırı aria-hidden bir liste öğesi olarak sütun adlarıyla verir', () => {
    expect(typeof ListRow).toBe('function');
    expect(typeof ListRow.Header).toBe('function');
    renderList(<ListRow.Header />);
    const head = screen.getByRole('listitem', { hidden: true });
    expect(head).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('listitem')).toBeNull();
    for (const text of ['Foto', 'Alım', 'Planlanan', 'Gerçekleşen']) expect(within(head).getByText(text)).toBeInTheDocument();
  });
});

describe('ListRow — fotoğraf kuralı', () => {
  it('doğrulanmış fotoğraf 56 px görsel olarak çıkar; "Fotoğraf yok" yazılmaz', () => {
    const { container } = renderList(<ListRow row={karyola} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://example.test/foto/karyola.png');
    expect(img).toHaveAttribute('width', '56');
    expect(img).toHaveAttribute('height', '56');
    // Süsleyici: başlık zaten yanında; düğme adı iki kez "Bebek karyolası" demez.
    expect(img).toHaveAttribute('alt', '');
    expect(screen.queryByText('Fotoğraf yok')).toBeNull();
  });

  it('doğrulanmamış görselin adresi DOM\'a hiç girmez; boş yuva + bir kez "Fotoğraf yok"', () => {
    const { container } = renderList(<ListRow row={{ ...karyola, photo: { url: 'https://example.test/foto/baska-urun.png', verified: false } }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('baska-urun');
    expect(container.querySelector('svg[data-icon="imageOff"]')).not.toBeNull();
    expect(screen.getByText('Fotoğraf yok')).toBeInTheDocument();
  });

  it.each([null, undefined])('photo=%s için boş yuva ve "Fotoğraf yok"', photo => {
    const { container } = renderList(<ListRow row={{ ...karyola, photo }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[data-icon="imageOff"]')).not.toBeNull();
    expect(screen.getByText('Fotoğraf yok')).toBeInTheDocument();
  });
});

describe('ListRow — tutarlar', () => {
  it('Planlanan ve Gerçekleşen ayrı sütunlarda tr-TR biçiminde (₺8.500,00) ve etiketli çıkar', () => {
    renderList(<ListRow row={karyola} />);
    const planned = screen.getByText('₺8.500,00');
    const actual = screen.getByText('₺7.940,00');
    expect(planned).toHaveClass('aile-tutar');
    expect(actual).toHaveClass('aile-tutar');
    expect(planned.closest('[data-tutar]')).toHaveAttribute('data-tutar', 'planlanan');
    expect(actual.closest('[data-tutar]')).toHaveAttribute('data-tutar', 'gerceklesen');
    expect(screen.getByText('Planlanan')).toBeInTheDocument();
    expect(screen.getByText('Gerçekleşen')).toBeInTheDocument();
  });

  it('planlanan yoksa "Fiyat yok", gerçekleşen yoksa "Henüz yok"; iki değer tek sayıda birleşmez', () => {
    const { unmount } = renderList(<ListRow row={{ ...karyola, planned: null, actual: { amount: '1349.90', currency: 'TRY' } }} />);
    expect(screen.getByText('Fiyat yok').closest('[data-tutar]')).toHaveAttribute('data-tutar', 'planlanan');
    expect(screen.getByText('₺1.349,90').closest('[data-tutar]')).toHaveAttribute('data-tutar', 'gerceklesen');
    unmount();
    renderList(<ListRow row={{ ...karyola, planned: { amount: '18000', currency: 'TRY' }, actual: null }} />);
    expect(screen.getByText('₺18.000,00').closest('[data-tutar]')).toHaveAttribute('data-tutar', 'planlanan');
    expect(screen.getByText('Henüz yok').closest('[data-tutar]')).toHaveAttribute('data-tutar', 'gerceklesen');
    expect(screen.getAllByText(/₺/)).toHaveLength(1);
  });

  it('ikisi de yoksa iki ayrı eksik sözcük yazar', () => {
    renderList(<ListRow row={{ ...karyola, planned: null, actual: null }} />);
    expect(screen.getByText('Fiyat yok')).toBeInTheDocument();
    expect(screen.getByText('Henüz yok')).toBeInTheDocument();
    expect(screen.queryByText(/₺/)).toBeNull();
  });

  it('başka para birimini kendi simgesiyle, okunamayan tutarı "Bilinmiyor" diye yazar', () => {
    renderList(<ListRow row={{ ...karyola, planned: { amount: '1234.5', currency: 'EUR' }, actual: { amount: 'abc', currency: 'TRY' } }} />);
    expect(screen.getByText('€1.234,50')).toBeInTheDocument();
    expect(screen.getByText('Bilinmiyor').closest('[data-tutar]')).toHaveAttribute('data-tutar', 'gerceklesen');
  });
});

describe('ListRow — dar biçim', () => {
  it('masaüstünde geniş biçimdir: tutarlar sütunda, ok simgesi süsleyici', () => {
    const { container } = renderList(<ListRow row={karyola} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-bicim', 'genis');
    const chevron = container.querySelector('svg[data-icon="chevronRight"]');
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.aile-listrow-tutarlar')).toBeNull();
  });

  it('narrow ile tutarlar etiketli iki sütun hâlinde satırın altına iner', () => {
    const { container } = renderList(<ListRow row={karyola} narrow />);
    expect(screen.getByRole('button')).toHaveAttribute('data-bicim', 'dar');
    const amounts = container.querySelector('.aile-listrow-tutarlar');
    expect(amounts).not.toBeNull();
    const block = within(amounts as HTMLElement);
    expect(block.getByText('Planlanan')).toHaveClass('aile-listrow-etiket');
    expect(block.getByText('Gerçekleşen')).toHaveClass('aile-listrow-etiket');
    expect(block.getByText('₺8.500,00')).toBeInTheDocument();
    expect(block.getByText('₺7.940,00')).toBeInTheDocument();
    expect(container.querySelector('svg[data-icon="chevronRight"]')).toBeNull();
  });

  it('narrow verilmezse telefonda dar, tablette ve masaüstünde geniş biçim; verilen prop cihazı ezer', () => {
    const { unmount: u1 } = renderList(<ListRow row={karyola} />, 'phone');
    expect(screen.getByRole('button')).toHaveAttribute('data-bicim', 'dar');
    u1();
    const { unmount: u2 } = renderList(<ListRow row={karyola} />, 'tablet');
    expect(screen.getByRole('button')).toHaveAttribute('data-bicim', 'genis');
    u2();
    renderList(<ListRow row={karyola} narrow={false} />, 'phone');
    expect(screen.getByRole('button')).toHaveAttribute('data-bicim', 'genis');
  });
});

describe('ListRow — seçim, tıklama, klavye', () => {
  it('selected iken aria-current="true"; değilken öznitelik yoktur', () => {
    const { unmount } = renderList(<ListRow row={karyola} selected />);
    expect(screen.getByRole('button', { current: true })).toBeInTheDocument();
    unmount();
    renderList(<ListRow row={karyola} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current');
  });

  it('tıklama onClick çağırır', async () => {
    const onClick = vi.fn();
    renderList(<ListRow row={karyola} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Tab odaklar; Enter ve Space onClick çağırır', async () => {
    const onClick = vi.fn();
    renderList(<ListRow row={karyola} onClick={onClick} />);
    await userEvent.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('odak taşıyıcısı liste öğesi değil düğmedir (odak çizgisi satırın alt kenarında)', async () => {
    renderList(<ListRow row={karyola} onClick={() => {}} />);
    await userEvent.tab();
    expect(document.activeElement).toHaveClass('aile-listrow-dugme');
    expect(screen.getByRole('listitem')).not.toHaveAttribute('tabindex');
  });
});

describe('ListRow — kaynak kuralları', () => {
  const read = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

  it('ham antd/phosphor importu yok; simge ./icons, etiket ./Tag üzerinden', () => {
    const tsx = read('ListRow.tsx');
    expect(tsx).not.toMatch(/from ['"]antd['"]/);
    expect(tsx).not.toContain('@ant-design/');
    expect(tsx).not.toContain('@phosphor-icons');
    expect(tsx).toMatch(/from ['"]\.\/icons['"]/);
    expect(tsx).toMatch(/from ['"]\.\/Tag['"]/);
  });

  it('bileşende sabit renk ve satır içi stil yok; ölçüler --aile tokenlarından', () => {
    const tsx = read('ListRow.tsx');
    const css = read('ListRow.css');
    expect(tsx).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(tsx).not.toContain('style={{');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const token of ['fotograf-liste', 'kose-kontrol', 'hedef-asgari', 'secili', 'bilgi-yuzey', 'cizgi', 'sure', 'egri', 'odak', 'odak-kalinlik']) {
      expect(css, token).toContain(`var(--aile-${token})`);
    }
  });

  it('metin 14 CSS px altına inmez; odak için halka/outline/box-shadow yok; sözcük ortasından kesme yok', () => {
    const css = read('ListRow.css');
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    expect(css).not.toMatch(/outline\s*:(?!\s*none)/);
    expect(css).not.toMatch(/box-shadow\s*:(?!\s*none)/);
    expect(css).not.toContain('break-all');
    expect(css).not.toContain('anywhere');
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});
