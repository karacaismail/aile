// Sorun kuyruğu saf mantığı: hücre adresi, etki metni, gruplama/sıralama ve sayfa dilimi. Veri sentetik nesilden
// (fixtures/generation-synthetic) ve ondan türetilen kayıtlardan gelir; gerçek nesil okunmaz.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../data';
import {
  SAYFA_BOYUTU, a1Metni, aralikMetni, etkiMetni, hucreAdresi, kaynakAnahtari, sayfaDilimi, sorunDurumu, sorunGruplari, sorunTuru,
} from './sorunlar';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../../../../fixtures/generation-synthetic');
const GEN = join(ROOT, readdirSync(ROOT).find(name => statSync(join(ROOT, name)).isDirectory())!);
const records = (rel: string) => (JSON.parse(readFileSync(join(GEN, rel), 'utf8')) as { records: Issue[] }).records;
const ISSUES: Issue[] = [...records('data/issues/budget/00000.json'), ...records('data/issues/household/00000.json')];
const FORMUL = ISSUES.find(issue => issue.code === 'formula_error')!;

/** Sentetik formül hatası şablonundan n kayıt: satır 2'den başlar, her satırda A–H sütunları. */
function formulHatalari(n: number, severity = 'review'): Issue[] {
  return Array.from({ length: n }, (_, index) => ({
    ...FORMUL,
    id: `00000000-0000-5000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    severity,
    provenance: { ...FORMUL.provenance!, a1: `${String.fromCharCode(65 + (index % 8))}${2 + Math.floor(index / 8)}`, row: 2 + Math.floor(index / 8), column: 1 + (index % 8) },
  }));
}

describe('hücre adresi', () => {
  it('A1 gösterimini okunur adrese çevirir', () => {
    expect(a1Metni('G9')).toBe('G9');
    expect(a1Metni('11:11')).toBe('11. satır');
    expect(a1Metni('3:5')).toBe('3–5. satırlar');
    expect(a1Metni('c:c')).toBe('C sütunu');
    expect(a1Metni('B:D')).toBe('B–D sütunları');
    expect(a1Metni('A1:B2')).toBe('A1:B2');
    expect(a1Metni('', 7)).toBe('7. satır');
    expect(a1Metni(undefined, 0)).toBeNull();
    expect(a1Metni(null)).toBeNull();
  });

  it('sayfa adı + hücre; provenance yoksa "Kaynak bilinmiyor" (gizlenmez)', () => {
    expect(hucreAdresi(FORMUL)).toBe('Gerçekleşen · G9');
    const satir = ISSUES.find(issue => issue.code === 'invalid_link')!;
    expect(hucreAdresi(satir)).toBe('app_kalemler · 11. satır');
    expect(hucreAdresi({ ...FORMUL, provenance: null })).toBe('Kaynak bilinmiyor');
    expect(hucreAdresi({ ...FORMUL, provenance: { ...FORMUL.provenance!, sheet_title: ' ', a1: '' } })).toBe('9. satır');
    expect(kaynakAnahtari(FORMUL)).toBe('budget');
    expect(kaynakAnahtari({ ...FORMUL, provenance: undefined })).toBe('Bilinmiyor');
  });
});

describe('tür, durum ve etki', () => {
  it('kodu Türkçe türe çevirir; bilinmeyen kod olduğu gibi kalır', () => {
    expect(sorunTuru('formula_error')).toBe('Formül hatası');
    expect(sorunTuru('yeni_kod')).toBe('yeni_kod');
  });

  it('önem sözcükle yazılır; boş önem "Bilinmiyor"', () => {
    expect(sorunDurumu('review')).toEqual({ label: 'Gözden geçirilecek', tone: 'uyari' });
    expect(sorunDurumu('error')).toEqual({ label: 'Hata', tone: 'hata' });
    expect(sorunDurumu('garip')).toEqual({ label: 'garip', tone: 'notr' });
    expect(sorunDurumu(' ')).toEqual({ label: 'Bilinmiyor', tone: 'notr' });
  });

  it('etki metni alanları Türkçe adla yazar; formül hata türü hücrede görünen koda döner', () => {
    expect(etkiMetni(FORMUL.detail)).toBe('İleti: Sentetik formül hatası · Tip: #REF!');
    expect(etkiMetni({ message: 'x', type: 'DIV_ZERO' })).toBe('İleti: x · Tip: #DIV/0!');
    expect(etkiMetni({ type: 'depends_on' })).toBe('Tip: depends_on');
    expect(etkiMetni({ value: '', vocabulary: null })).toBe('Ayrıntı yok');
    expect(etkiMetni(undefined)).toBe('Ayrıntı yok');
    expect(etkiMetni({ value: { a: 1 } })).toBe('Değer: {"a":1}');
  });
});

describe('gruplama', () => {
  it('sentetik kuyruk: her kod bir grup; kalabalık önce, eşitlikte Türkçe ada göre', () => {
    const gruplar = sorunGruplari(ISSUES);
    expect(gruplar.map(grup => grup.ad)).toEqual([
      'Formül hatası', 'Bilinmeyen aşama', 'Bilinmeyen terim', 'Çözülmeyen ilişki', 'Çözülmeyen oda', 'Geçersiz bağlantı',
      'Geçersiz tarih', 'Kayıt kimliği eksik', 'Yalnız kaynak sayfa',
    ]);
    expect(gruplar.reduce((sum, grup) => sum + grup.sorunlar.length, 0)).toBe(ISSUES.length);
    // Grup içi kaynak hücre sırası: Gerçekleşen (G9) sayfa adına göre Plan'dan (E12) önce.
    expect(gruplar[0]!.sorunlar.map(hucreAdresi)).toEqual(['Gerçekleşen · G9', 'Plan · E12']);
  });

  it('önemi "hata" olan grup, kalabalık "gözden geçirilecek" grubun önüne geçer', () => {
    const hata = { ...ISSUES.find(issue => issue.code === 'invalid_date')!, severity: 'error' };
    const gruplar = sorunGruplari([...formulHatalari(30), hata]);
    expect(gruplar.map(grup => grup.kod)).toEqual(['invalid_date', 'formula_error']);
  });

  it('469 formül hatası satır, sonra sütun sırasıyla dizilir; girdi sırası önemli değil', () => {
    const karisik = formulHatalari(469).reverse();
    const [grup] = sorunGruplari(karisik);
    expect(grup!.sorunlar).toHaveLength(469);
    expect(grup!.sorunlar.slice(0, 3).map(hucreAdresi)).toEqual(['Gerçekleşen · A2', 'Gerçekleşen · B2', 'Gerçekleşen · C2']);
    expect(hucreAdresi(grup!.sorunlar[20]!)).toBe('Gerçekleşen · E4');
    expect(hucreAdresi(grup!.sorunlar[468]!)).toBe('Gerçekleşen · E60');
  });

  it('kodu olmayan kayıt "Bilinmiyor" grubunda görünür (atılmaz)', () => {
    const gruplar = sorunGruplari([{ ...FORMUL, code: '' }]);
    expect(gruplar).toEqual([expect.objectContaining({ kod: 'Bilinmiyor', ad: 'Bilinmiyor' })]);
  });
});

describe('sayfa dilimi', () => {
  it(`varsayılan ${SAYFA_BOYUTU}'lik dilimler; sınır dışı sayfa sıkıştırılır`, () => {
    expect(sayfaDilimi(469, 0)).toEqual({ sayfa: 0, sayfaSayisi: 24, ilk: 1, son: 20, toplam: 469 });
    expect(sayfaDilimi(469, 1)).toMatchObject({ ilk: 21, son: 40 });
    expect(sayfaDilimi(469, 23)).toMatchObject({ sayfa: 23, ilk: 461, son: 469 });
    expect(sayfaDilimi(469, 99)).toMatchObject({ sayfa: 23 });
    expect(sayfaDilimi(469, -4)).toMatchObject({ sayfa: 0 });
    expect(sayfaDilimi(20, 0)).toMatchObject({ sayfaSayisi: 1, son: 20 });
    expect(sayfaDilimi(0, 3)).toEqual({ sayfa: 0, sayfaSayisi: 1, ilk: 0, son: 0, toplam: 0 });
  });

  it('aralık metni tr-TR basamak ayırıcıyla', () => {
    expect(aralikMetni(sayfaDilimi(469, 1))).toBe('21–40 / 469');
    expect(aralikMetni(sayfaDilimi(12_345, 0))).toBe('1–20 / 12.345');
  });
});
