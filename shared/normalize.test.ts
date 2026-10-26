import { describe, it, expect } from 'vitest';
import { parseTl, parsePhase, guessOda, guessKategori, csvRowToItem, trLower, parseCsv, collectLinks } from './normalize.ts';

describe('parseTl', () => {
  it('Türkçe para biçimlerini sayıya çevirir', () => {
    expect(parseTl('₺5.000,00')).toBe(5000);
    expect(parseTl('5000')).toBe(5000);
    expect(parseTl('5.000')).toBe(5000);
    expect(parseTl('1.250,50')).toBe(1250.5);
    expect(parseTl('₺0,00')).toBe(0);
    expect(parseTl(' ₺ 7.500 ')).toBe(7500);
  });
  it('"?" ve boş → null', () => {
    expect(parseTl('?')).toBeNull();
    expect(parseTl('')).toBeNull();
    expect(parseTl(undefined)).toBeNull();
    expect(parseTl('yok')).toBeNull();
  });
});

describe('parsePhase', () => {
  it('TRUE → faz 1; FALSE + When 2/3 → faz 2/3; FALSE + boş → faz 2 ve karar bekliyor', () => {
    expect(parsePhase('TRUE', '')).toEqual({ faz: '1', kararBekliyor: false });
    expect(parsePhase('FALSE', '2')).toEqual({ faz: '2', kararBekliyor: false });
    expect(parsePhase('FALSE', '3')).toEqual({ faz: '3', kararBekliyor: false });
    expect(parsePhase('FALSE', '')).toEqual({ faz: '2', kararBekliyor: true });
    expect(parsePhase('', '3')).toEqual({ faz: '3', kararBekliyor: false });
  });
});

describe('trLower', () => {
  it('İ → i, I → ı; ICU bağımsız', () => {
    expect(trLower('KİTAPLIK')).toBe('kitaplık');
    expect(trLower('IŞIK')).toBe('ışık');
    expect(trLower('ÇĞÖŞÜ')).toBe('çğöşü');
  });
});

describe('guessOda / guessKategori', () => {
  it('anahtar kelimeden oda ve kategori tahmini', () => {
    expect(guessOda('Çocuk ofis sandalyesi')).toBe('cocuk');
    expect(guessOda('Tezgâh altı aydınlatma')).toBe('mutfak');
    expect(guessOda('Banyo tuvalet fırçası seti')).toBe('banyo');
    expect(guessOda('Baza / karyola')).toBe('ebeveyn');
    expect(guessOda('Koli bandı')).toBeUndefined();
    expect(guessKategori('Koltuk takımı, Berjer')).toBe('mobilya');
    expect(guessKategori('Ampul / LED')).toBe('aydinlatma_led');
    expect(guessKategori('Kablo kanalı')).toBe('elektrik');
    expect(guessKategori('Boya / alçı / küçük onarım')).toBe('boya');
    expect(guessKategori('Depozito / Peşinat / Kira')).toBe('masraf');
    expect(guessKategori('Evden eve nakliye toplam bedeli')).toBe('hizmet');
    expect(guessKategori('Yangın Tüpü x 2')).toBe('guvenlik');
    expect(guessKategori('Perde / tül')).toBe('tekstil');
    expect(guessKategori('Derin dondurucu (opsiyonel)')).toBe('beyaz_esya');
    expect(guessKategori('Bilinmeyen şey')).toBe('diger');
  });
});

describe('collectLinks', () => {
  it('http ile başlayan hücreleri toplar, tekilleştirir; diğer metinleri not olarak verir', () => {
    const r = collectLinks(['https://a.example/x', 'not metni', 'https://a.example/x', 'https://b.example']);
    expect(r.links).toEqual(['https://a.example/x', 'https://b.example']);
    expect(r.notes).toEqual(['not metni']);
  });
});

describe('csvRowToItem', () => {
  const header = ['sıra', '', 'Eşya', 'When?', '', '', '', '', '', ''];
  it('tam satırı kaleme çevirir', () => {
    const row = ['118', 'TRUE', 'Oturma grubu', '', '₺1.500,00', 'https://ornek.example/urun', '', '', '', ''];
    const it1 = csvRowToItem(row, header, 0);
    expect(it1).toMatchObject({
      tip: 'satinalma', kod: '118', ad: 'Oturma grubu', faz: '1', durum: 'karar',
      tahmini_tl_min: 1500, tahmini_tl_max: 1500, kategori: 'mobilya', oda: 'salon',
      linkler: ['https://ornek.example/urun'], karar_bekliyor: false, fiyat_guven: 'tahmini',
    });
    expect(it1?.id).toMatch(/^[0-9A-Z]{26}$/);
  });
  it('fiyat "?" → fiyatsız, durum fikir; FALSE + When 3 → faz 3', () => {
    const it2 = csvRowToItem(['', 'FALSE', 'Yan sehpa', '3', '?', '', '', '', '', ''], header, 5);
    expect(it2).toMatchObject({ ad: 'Yan sehpa', faz: '3', durum: 'fikir' });
    expect(it2?.tahmini_tl_min).toBeUndefined();
  });
  it('₺0 fiyatlı kalem mevcut eşya sayılır', () => {
    const it3 = csvRowToItem(['106', 'TRUE', 'Çalışma masası (cam)', '', '₺0,00', '', '', '', '', ''], header, 1);
    expect(it3?.mevcut).toBe(true);
  });
  it('boş satır → null', () => {
    expect(csvRowToItem(['', 'FALSE', '', '', '', '', '', '', '', ''], header, 9)).toBeNull();
  });
});

describe('parseCsv', () => {
  it('tırnaklı virgül ve satır sonunu doğru ayrıştırır', () => {
    const rows = parseCsv('a,b,c\n1,"x, y",3\n"çok\nsatır",,\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['1', 'x, y', '3'], ['çok\nsatır', '', '']]);
  });
});
