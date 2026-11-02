import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gviz, syntheticSheets } from '../dashboard/fixtures';
import { syntheticCurrentSheets } from '../dashboard/currentFixtures';
import { syntheticBridgeResponse } from '../dashboard/bridgeFixtures';
import { sheetMonthKey } from '../dashboard/current';
import type { Budget, Category, Grid } from '../dashboard/data';
import { currentPeriod, isFuturePeriod, spendLabel, type RecordedValue } from './data/actuals';
import type { Money } from './data/types';

vi.hoisted(() => vi.stubEnv('VITE_BUDGET_SHEET_ID', 'synthetic-budget-sheet-2098'));
import { fetchBudget, money } from '../dashboard/data';
import Dashboard from '../dashboard/Dashboard';
import { liveBudget, type BudgetLineView, type BudgetViewModel } from './data/live';

// Eşitlik testi: eski Mantine pano (src/dashboard) ile yeni panelin canlı okuma katmanı (src/admin/data/live.ts) aynı
// sentetik GViz fikstürlerinden aynı ay toplamlarını, plan değerlerini ve yaklaşan ödemeleri üretiyor mu?
//  - Eski pano: fetchBudget → Budget. budgetStore/useBudget aynı nesneyi tutar, Dashboard onu olduğu gibi çizer.
//  - Yeni panel: liveBudget → BudgetViewModel.
// Kaynak yalnız fetch saplamasıdır (src/dashboard fikstürleri, VITE_BUDGET_SHEET_ID=synthetic-budget-sheet-2098). Google'a
// ağ çağrısı yok, özel nesil verisi yok, Sheets'e yazma yok.
//
// Bilinçli farklar (eşitlik bunları hesaba katar, her biri aşağıda kendi testinde adlandırılır):
//  1. Gerçekleşen anlamı: eski pano Gerçekleşen sekmesindeki değeri her ay için "Güncel" adıyla gösterir. live aynı sayıyı
//     `actual` alanında taşır; yeni panelde bu değer ödeme kanıtı değildir: gelecek ay "Henüz yok", bu ay ve geçmiş ay
//     "Kaynakta yazılı"; yüzde ve "harcandı" yok (data/actuals.ts spendLabel).
//  2. Para zarfı: eski number → live { amount: 2 ondalık metin, currency: 'TRY' }. Kuruş altı kayan nokta artığı metinde
//     2 haneye sabitlenir; eski pano da en çok 2 hane gösterdiği için görünen tutar aynıdır.
//  3. Eksik tutar: eski null ("Tutar yok") → live null; hiçbir yolda sıfıra çevrilmez.
//  4. Ay anahtarı: eski ay etiketi ("Aralık 2098") → live dönem ("2098-12"); boş ay → null.
//  5. Kapsam dışı: araç sayfasının selfFundedCashFlow değeri ve köprü/şema meta verisi ay toplamı değildir; live ay
//     görünümü yalnız beş toplamı (gelir, ödemeler, birikim, aylık net nakit, nakit bakiyesi) taşır.

const ALANLAR = ['income', 'expense', 'saving', 'free', 'balance'] as const;
const ONDALIK = /^-?[0-9]+\.[0-9]{2}$/;
/** İstanbul'da 1 Aralık 2098 00:30; UTC'de hâlâ 30 Kasım. "Bu ay" ay sınırında da aynı olmalı. */
const ARALIK_BASI = new Date('2098-11-30T21:30:00.000Z');
/** İstanbul'da 30 Kasım 2098 23:59:59. */
const KASIM_SONU = new Date('2098-11-30T20:59:59.000Z');

type GuncelKaynak = ReturnType<typeof syntheticCurrentSheets>;
type EskiKaynak = ReturnType<typeof syntheticSheets>;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Güncel (nakit akışı) şema: Plan, Pano, Gerçekleşen, Kasa, Arızi Giderler ve köprü sekmesi. */
function guncelSemaSun(kaynak: GuncelKaynak = syntheticCurrentSheets()) {
  const sekmeler: Record<string, Grid> = { Pano: kaynak.summary, Plan: kaynak.plan, 'Gerçekleşen': kaynak.actual, Kasa: kaynak.cash };
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    const kopru = syntheticBridgeResponse(url.toString());
    if (kopru) return new Response(kopru);
    const sekme = url.searchParams.get('sheet') ?? '';
    if (sekme === 'Arızi Giderler') return new Response(gviz(kaynak.irregular.slice(1), kaynak.irregular[0].map(String)));
    const tablo = sekmeler[sekme];
    if (!tablo) throw new Error(`Beklenmeyen kaynak: ${sekme}`);
    return new Response(gviz(tablo));
  }));
}

/** Eski şema: Plan/Gerçekleşen B7:P74 başlıklı, Pano özeti, Düzensiz giderler; güncel şema aralıkları kullanılmaz. */
function eskiSemaSun(kaynak: EskiKaynak = syntheticSheets()) {
  const basliklar = ['Kalem', ...kaynak.summary.map(satir => String(satir[0]))];
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    const kopru = syntheticBridgeResponse(url.toString());
    if (kopru) return new Response(kopru);
    const sekme = url.searchParams.get('sheet') ?? '';
    if (sekme === 'Pano') return new Response(gviz(kaynak.summary));
    if (sekme === 'Plan') return new Response(gviz(kaynak.plan.map(satir => satir.slice(0, 4)), basliklar));
    if (sekme === 'Gerçekleşen') return new Response(gviz(kaynak.actual.map(satir => satir.slice(0, 4)), basliklar));
    if (sekme === 'Düzensiz giderler') return new Response(gviz(kaynak.irregular));
    if (sekme === 'Kasa' || sekme === 'Arızi Giderler') return new Response(gviz([[null]]));
    throw new Error(`Beklenmeyen kaynak: ${sekme}`);
  }));
}

/** Aynı saplanmış kaynağı iki yoldan okur. */
async function ikiYoldanOku(bugun: Date = ARALIK_BASI): Promise<{ eski: Budget; yeni: BudgetViewModel }> {
  const eski = await fetchBudget(new AbortController().signal);
  const sonuc = await liveBudget({ now: () => bugun });
  if (!sonuc.ok) throw new Error(`live okunamadı: ${sonuc.message}`);
  return { eski, yeni: sonuc.budget };
}

const SEMALAR = [
  { ad: 'güncel (nakit akışı) şema', sun: () => guncelSemaSun() },
  { ad: 'eski şema', sun: () => eskiSemaSun() },
] as const;

/** Eski tutar (number | null) ile live Money aynı mı; farkı okunur bir satır olarak döndürür. */
function tutarFarki(yer: string, eski: number | null, yeni: Money | undefined): string[] {
  if (yeni === undefined) return [`${yer}: live'da alan yok (eski ${eski})`];
  if (eski === null) return yeni === null ? [] : [`${yer}: eski "Tutar yok", live ${yeni.amount} ${yeni.currency}`];
  if (yeni === null) return [`${yer}: eski ${eski}, live null`];
  const sayi = Number(yeni.amount);
  const ayni = yeni.currency === 'TRY' && ONDALIK.test(yeni.amount) && Math.abs(sayi - eski) <= 0.005 && money(sayi) === money(eski);
  return ayni ? [] : [`${yer}: eski ${eski} (${money(eski)}), live ${yeni.amount} ${yeni.currency}`];
}

/** Eski ay etiketi panonun kendi ayrıştırıcısıyla (sheetMonthKey) okunur; boş etiket ↔ null. */
const eskiDonem = (etiket: string): string | null => (etiket ? sheetMonthKey(etiket) : null);
function ayFarki(yer: string, eskiEtiket: string, yeniDonem: string | null): string[] {
  const beklenen = eskiDonem(eskiEtiket);
  return beklenen === yeniDonem ? [] : [`${yer}: eski "${eskiEtiket}" (${beklenen}), live ${yeniDonem}`];
}

function satirFarklari(tur: string, eski: Budget, eskiSatirlar: Category[], yeniSatirlar: BudgetLineView[]): string[] {
  expect(yeniSatirlar.map(s => [s.id, s.label, s.group, s.kind])).toEqual(eskiSatirlar.map(s => [s.id, s.label, s.group, s.kind]));
  return eskiSatirlar.flatMap((satir, j) => eski.months.flatMap((ay, i) => [
    ...tutarFarki(`${tur} ${satir.id} ${ay.key} plan`, satir.plan[i], yeniSatirlar[j].planned[ay.key]),
    ...tutarFarki(`${tur} ${satir.id} ${ay.key} güncel→actual`, satir.current[i], yeniSatirlar[j].actual[ay.key]),
  ]));
}

// --- Yaklaşan ödemeler -----------------------------------------------------------------------------------------
interface YaklasanKalem { id: string; ad: string; donem: string; tutar: number | null }
interface Yaklasan {
  /** Bu aydan itibaren aylık "Ödemeler" toplamı; plan ve güncel/gerçek ayrı. */
  aylik: { donem: string; plan: number | null; guncel: number | null }[];
  /** Planlanan tarihi bu aydan itibaren olan düzensiz ödemeler, plan tutarıyla. */
  planlanan: YaklasanKalem[];
  /** Ödeme tarihi bu aydan itibaren olan düzensiz ödemeler, güncel/gerçek tutarla. */
  odenecek: YaklasanKalem[];
}
const sayi = (deger: Money | undefined): number | null => (deger ? Number(deger.amount) : null);

function eskiYaklasan(eski: Budget, bu: string): Yaklasan {
  const kalemler = (ay: 'planMonth' | 'month', tutar: 'plan' | 'current') => eski.irregular
    .map(r => ({ id: r.id, ad: r.label, donem: eskiDonem(r[ay]), tutar: r[tutar] }))
    .filter((k): k is YaklasanKalem => k.donem !== null && k.donem >= bu);
  return {
    aylik: eski.months.filter(m => m.key >= bu).map(m => ({ donem: m.key, plan: m.expense.plan, guncel: m.expense.current })),
    planlanan: kalemler('planMonth', 'plan'),
    odenecek: kalemler('month', 'current'),
  };
}

function yeniYaklasan(yeni: BudgetViewModel, bu: string): Yaklasan {
  const kalemler = (taraf: 'planned' | 'actual') => yeni.irregular
    .map(r => ({ id: r.id, ad: r.label, donem: r[taraf].period, tutar: sayi(r[taraf].amount) }))
    .filter((k): k is YaklasanKalem => k.donem !== null && k.donem >= bu);
  return {
    aylik: yeni.months.filter(m => m.period >= bu).map(m => ({ donem: m.period, plan: sayi(m.planned.expense), guncel: sayi(m.actual.expense) })),
    planlanan: kalemler('planned'),
    odenecek: kalemler('actual'),
  };
}

describe.each(SEMALAR)('eski pano ↔ live eşitliği: $ad', ({ sun }) => {
  it('ay toplamları: her ayın beş toplamı plan ve güncel/gerçek ayrı, aynı değerle gelir', async () => {
    sun();
    const { eski, yeni } = await ikiYoldanOku();
    expect(yeni.periods).toEqual(eski.months.map(m => m.key));
    expect(yeni.months.map(m => [m.period, m.label, m.source])).toEqual(eski.months.map(m => [m.key, m.label, m.source]));
    const farklar = eski.months.flatMap((ay, i) => ALANLAR.flatMap(alan => [
      ...tutarFarki(`${ay.label} ${alan} plan`, ay[alan].plan, yeni.months[i].planned[alan]),
      ...tutarFarki(`${ay.label} ${alan} güncel→actual`, ay[alan].current, yeni.months[i].actual[alan]),
    ]));
    expect(farklar).toEqual([]);
    // Plan ve gerçek tek sayıda birleşmez: iki ayrı nesne, toplam alanı yok.
    for (const ay of yeni.months) {
      expect(ay.planned).not.toBe(ay.actual);
      expect(Object.keys(ay)).not.toContain('total');
    }
  });

  it('plan değerleri: her kalemin ve grubun her ay planı ve güncel/gerçek değeri aynı', async () => {
    sun();
    const { eski, yeni } = await ikiYoldanOku();
    expect(eski.categories.length).toBeGreaterThan(5);
    expect([
      ...satirFarklari('kalem', eski, eski.categories, yeni.categories),
      ...satirFarklari('grup', eski, eski.groups, yeni.groups),
    ]).toEqual([]);
  });

  it('düzensiz ödemeler: kimlik, ad, tür, durum, yer, not, elle değişti; plan ve ödeme ayı ile tutarları aynı', async () => {
    sun();
    const { eski, yeni } = await ikiYoldanOku();
    expect(eski.irregular.length).toBeGreaterThanOrEqual(3);
    expect(yeni.irregular.map(r => [r.id, r.label, r.type, r.status, r.room, r.note, r.manual]))
      .toEqual(eski.irregular.map(r => [r.id, r.label, r.type, r.status, r.room, r.note, r.manual]));
    const farklar = eski.irregular.flatMap((r, i) => [
      ...ayFarki(`${r.id} plan ayı`, r.planMonth, yeni.irregular[i].planned.period),
      ...ayFarki(`${r.id} ödeme ayı`, r.month, yeni.irregular[i].actual.period),
      ...tutarFarki(`${r.id} plan`, r.plan, yeni.irregular[i].planned.amount),
      ...tutarFarki(`${r.id} güncel→actual`, r.current, yeni.irregular[i].actual.amount),
    ]);
    expect(farklar).toEqual([]);
  });

  it.each([
    ['ay sınırından hemen önce (İstanbul 30 Kasım 23:59)', KASIM_SONU, '2098-11'],
    ['ay sınırından hemen sonra (İstanbul 1 Aralık 00:30, UTC hâlâ Kasım)', ARALIK_BASI, '2098-12'],
  ])('yaklaşan ödemeler %s: aylık ödemeler ve düzensiz ödemeler aynı', async (_ad, bugun, donem) => {
    sun();
    const { eski, yeni } = await ikiYoldanOku(bugun);
    const bu = currentPeriod(bugun);
    expect(bu).toBe(donem);
    const beklenen = eskiYaklasan(eski, bu);
    expect(beklenen.aylik.length).toBeGreaterThan(0);
    expect(beklenen.planlanan.length).toBeGreaterThan(0);
    expect(yeniYaklasan(yeni, bu)).toEqual(beklenen);
  });
});

describe('yaklaşan ödemeler: bütçe penceresi dışı', () => {
  it('bütçe aylarının dışındaki planlanan ve ödeme ayı da dönem olarak okunur (eski pano "Mart 2099" gösterir)', async () => {
    const kaynak = syntheticCurrentSheets();
    // Bütçe penceresi Kasım 2098 – Ocak 2099; bu ödeme Mart 2099'da. Eski pano ay toplamı kuralını yalnız pencere
    // ayları için uygular, satırı "Plan ayı / Ödeme ayı: Mart 2099" olarak listeler.
    kaynak.irregular.push(['Pencere dışı ödeme', 'Tek seferlik', 'Planlı', '2099-03-01', 'Date(2099,2,15)', 750, 750, 0, 'Salon', 750, '', '', 'record-4', 0, 'TEST-4']);
    guncelSemaSun(kaynak);
    const { eski, yeni } = await ikiYoldanOku();
    const eskiSatir = eski.irregular.find(r => r.id === 'TEST-4')!;
    expect([eskiSatir.planMonth, eskiSatir.month]).toEqual(['Mart 2099', 'Mart 2099']);
    const bu = currentPeriod(ARALIK_BASI);
    const beklenen = eskiYaklasan(eski, bu);
    expect(beklenen.odenecek.map(k => [k.id, k.donem, k.tutar])).toContainEqual(['TEST-4', '2099-03', 750]);
    expect(yeniYaklasan(yeni, bu)).toEqual(beklenen);
  });
});

describe('bilinçli farklar (adlandırılmış)', () => {
  it('1 · Gerçekleşen anlamı: eski pano "Güncel" der ve her ay gösterir; live aynı sayıyı actual alanında taşır; yeni panelde ödeme kanıtı değildir', async () => {
    guncelSemaSun();
    const { eski, yeni } = await ikiYoldanOku(ARALIK_BASI);
    const bu = currentPeriod(ARALIK_BASI);
    expect(yeni.months.some(ay => isFuturePeriod(ay.period, ARALIK_BASI))).toBe(true);
    for (const [i, ay] of yeni.months.entries()) {
      // Ham değer aynı; live gelecek ayın Gerçekleşen değerini de taşır. Gizlemek tüketicinin işidir (actuals).
      expect(sayi(ay.actual.expense)).toBe(eski.months[i].expense.current);
      // Sentetik Gerçekleşen sekmesi planı taşır: eski pano Güncel = Plan gösterir; live iki tarafı ayrı tutar.
      expect(ay.actual).toEqual(ay.planned);
      // live'da ödeme kanıtı alanı yoktur; bu yüzden değer yeni panelde kanıtsız kaynak gözlemidir.
      const kayit: RecordedValue = isFuturePeriod(ay.period, ARALIK_BASI) ? { kind: 'not_yet' } : { kind: 'recorded', money: ay.actual.expense, evidence: false };
      const etiket = spendLabel(ay.planned.expense, kayit);
      expect(etiket.percent).toBeNull();
      expect(etiket.text).toBe(ay.period > bu ? 'Henüz yok' : 'Kaynakta yazılı');
    }
    expect(JSON.stringify(yeni)).not.toMatch(/evidence|harcand/i);
  });

  it('2–4 · para zarfı, eksik tutar ve ay anahtarı: kuruş altı artık 2 haneye sabitlenir, görünen tutar aynı; eksik tutar sıfır olmaz', async () => {
    const kaynak = syntheticCurrentSheets();
    // Sheets toplamlarındaki kayan nokta artığı. Kalem satırlarında bütünlük kuralı yoktur; ay toplamları değişmez.
    const fatura = kaynak.plan.find(satir => satir[0] === 'Fatura A')!;
    fatura[1] = 4000.004;
    fatura[2] = 0.1 + 0.2;
    guncelSemaSun(kaynak);
    const { eski, yeni } = await ikiYoldanOku();
    const eskiFatura = eski.categories.find(c => c.label === 'Fatura A')!;
    const yeniFatura = yeni.categories.find(c => c.label === 'Fatura A')!;
    expect(eskiFatura.plan.slice(0, 2)).toEqual([4000.004, 0.30000000000000004]);
    expect(yeniFatura.planned['2098-11']).toEqual({ amount: '4000.00', currency: 'TRY' });
    expect(yeniFatura.planned['2098-12']).toEqual({ amount: '0.30', currency: 'TRY' });
    expect(money(eskiFatura.plan[0])).toBe(money(Number(yeniFatura.planned['2098-11']!.amount)));
    expect(money(eskiFatura.plan[1])).toBe(money(Number(yeniFatura.planned['2098-12']!.amount)));
    // Eksik tutar: eski null ("Tutar yok") ↔ live null; sıfır değil.
    const eksik = eski.irregular.find(r => r.id === 'TEST-2')!;
    expect([eksik.plan, eksik.current, money(eksik.plan)]).toEqual([null, null, 'Tutar yok']);
    const yeniEksik = yeni.irregular.find(r => r.id === 'TEST-2')!;
    expect([yeniEksik.planned.amount, yeniEksik.actual.amount]).toEqual([null, null]);
    // Sıfır ise sıfır kalır (iptal edilen ürün): null ile karışmaz.
    expect(yeni.irregular.find(r => r.id === 'TEST-3')!.planned.amount).toEqual({ amount: '0.00', currency: 'TRY' });
    // Ay anahtarı: eski etiket ↔ live dönem.
    expect(eski.irregular[0].planMonth).toBe('Aralık 2098');
    expect(yeni.irregular[0].planned.period).toBe('2098-12');
  });

  it('5 · kapsam dışı: selfFundedCashFlow (araç sayfası) ve köprü/şema meta verisi ay toplamı değildir; live ay görünümü yalnız beş toplamı taşır', async () => {
    guncelSemaSun();
    const { eski, yeni } = await ikiYoldanOku();
    expect(eski.months[0].selfFundedCashFlow).toEqual({ plan: 3500, current: 3300 });
    expect(eski.bridge?.status).toBe('Koşullu hesap');
    expect(eski.schema).toBe('cashflow');
    for (const ay of yeni.months) {
      expect(Object.keys(ay.planned).sort()).toEqual([...ALANLAR].sort());
      expect(Object.keys(ay.actual).sort()).toEqual([...ALANLAR].sort());
    }
    // Köprü aylık net nakdi değiştirmez: selfFundedCashFlow ayrı kalır, free iki tarafta da kaynak değeridir.
    expect(sayi(yeni.months[0].actual.free)).toBe(eski.months[0].free.current);
    expect(sayi(yeni.months[0].actual.free)).not.toBe(eski.months[0].selfFundedCashFlow?.current);
  });
});

describe('eski panonun çizdiği değerler', () => {
  it('Dashboard varsayılan ayı İstanbul "bu ay"ıdır; özet, Aylık tablo ve Düzensiz giderler live değerlerini gösterir', async () => {
    vi.useFakeTimers({ now: ARALIK_BASI, toFake: ['Date'] });
    const gozlemci = window.IntersectionObserver;
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; } as unknown as typeof IntersectionObserver;
    try {
      guncelSemaSun();
      const sonuc = await liveBudget({ now: () => new Date() });
      if (!sonuc.ok) throw new Error(sonuc.message);
      const yeni = sonuc.budget;
      const bu = currentPeriod(new Date());
      const buAy = yeni.months.find(ay => ay.period === bu)!;
      const goster = (deger: Money) => money(sayi(deger));

      render(createElement(MantineProvider, null, createElement(Dashboard)));
      const ozet = await screen.findByRole('region', { name: 'Seçili ay özeti' });
      const netNakit = within(ozet).getByRole('heading', { name: 'Aylık net nakit' }).closest('article')!;
      // Seçili ay etiketi tam eşleşir (Ocak seçilseydi karşılaştırma metni de "Aralık 2098" içerirdi).
      expect(netNakit.querySelector('.metric-period')?.textContent).toBe(buAy.label);
      expect(netNakit.querySelector('.metric-value')?.textContent).toBe(goster(buAy.actual.free));
      expect(netNakit).toHaveTextContent(`Plan ${goster(buAy.planned.free)}`);

      fireEvent.click(screen.getByRole('button', { name: 'Aylık tablo' }));
      const aylik = screen.getByRole('table', { name: 'Aylık plan ve güncel karşılaştırması' });
      // Bilinçli fark 1: eski sütun adı "güncel"; live alanı actual.
      expect(within(aylik).getByRole('columnheader', { name: /Ödeme · güncel/ })).toBeInTheDocument();
      const aylar = within(aylik).getAllByRole('row').slice(1).map(satir => within(satir).getAllByRole('cell').map(hucre => hucre.textContent));
      expect(aylar).toEqual(yeni.months.map(ay => [ay.label, ay.source, ...ALANLAR.flatMap(alan => [goster(ay.planned[alan]), goster(ay.actual[alan])])]));

      fireEvent.click(screen.getByRole('button', { name: 'Düzensiz giderler' }));
      const duzensiz = screen.getByRole('table', { name: 'Düzensiz giderlerin plan ve güncel tutarları' });
      const satirlar = within(duzensiz).getAllByRole('row').slice(1).map(satir => {
        const [gider, , planAyi, odemeAyi, plan, guncel, durum] = within(satir).getAllByRole('cell');
        return {
          ad: gider.querySelector('strong')?.textContent,
          planDonemi: eskiDonem(planAyi.textContent === 'Belirlenmedi' ? '' : planAyi.textContent ?? ''),
          odemeDonemi: eskiDonem(odemeAyi.textContent === 'Belirlenmedi' ? '' : odemeAyi.textContent ?? ''),
          plan: plan.textContent,
          guncel: guncel.textContent,
          durum: durum.textContent,
        };
      });
      expect(satirlar).toEqual(yeni.irregular.map(r => ({
        ad: r.label,
        planDonemi: r.planned.period,
        odemeDonemi: r.actual.period,
        plan: goster(r.planned.amount),
        guncel: `${goster(r.actual.amount)}${r.manual ? 'Elle güncellendi' : 'Planı izliyor'}`,
        durum: r.status || 'Belirlenmedi',
      })));
    } finally {
      window.IntersectionObserver = gozlemci;
    }
  });
});
