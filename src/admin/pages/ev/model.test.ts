// Ev ve odalar görünüm modeli (saf TS): sentetik nesil (fixtures/generation-synthetic) dosyadan okunur, satırlar veri
// katmanının kendi buildIndexes + toRecordRow yoluyla kurulur. Beklenen değerler fixture'dan bağımsız aritmetikle
// (kuruş tam sayı) hesaplanır; sabit tutar yazılmaz. Plan ve gerçek ayrı toplamlardır.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildIndexes, toRecordRow } from '../../data/indexes';
import type { MediaReference, PurchaseNeedRecord, Relation, Room, Term, Vocabulary } from '../../data/types';
import { BIRDEN_COK, EKSIK_YOK, ODA_ATANMAMIS, ODA_BILINMIYOR, ODASIZ_ID, evModeli, toplamMetni, type EvGirdisi } from './model';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../../../../fixtures/generation-synthetic');
const DIR = join(ROOT, readdirSync(ROOT).find((name) => statSync(join(ROOT, name)).isDirectory())!);
const records = <R,>(rel: string): R[] => (JSON.parse(readFileSync(join(DIR, rel), 'utf8')) as { records: R[] }).records;

const ROOMS = records<Room>('data/rooms/household/00000.json');
const NEEDS = records<PurchaseNeedRecord>('data/purchase_needs/household/00000.json');
const WORKS = records<PurchaseNeedRecord>('data/work_orders/household/00000.json');
const LAYOUT = records<PurchaseNeedRecord>('data/layout_items/household/00000.json');
const LIGHTING = records<PurchaseNeedRecord>('data/lighting_specs/household/00000.json');
const RELATIONS = records<Relation>('data/relations/household/00000.json');
const TERMS = records<Term>('data/terms/global/00000.json');
const VOCABULARIES = records<Vocabulary>('data/vocabularies/global/00000.json');
const MEDIA = records<MediaReference>('data/media_references/household/00000.json');

function girdi(over: Partial<EvGirdisi> = {}): EvGirdisi {
  const base = { rooms: ROOMS, relations: RELATIONS, terms: TERMS, needs: NEEDS, workOrders: WORKS, layout: LAYOUT, lighting: LIGHTING, ...over };
  const indexes = buildIndexes({
    rooms: base.rooms, relations: base.relations, terms: base.terms, vocabularies: VOCABULARIES, media_references: MEDIA,
    purchase_needs: base.needs, work_orders: base.workOrders, layout_items: base.layout, lighting_specs: base.lighting,
  });
  return { ...base, satir: (record) => toRecordRow(record, indexes) };
}

const canli = <R extends { deleted_at?: string | null }>(list: readonly R[]) => list.filter((item) => !item.deleted_at);
const LIVE_NEEDS = canli(NEEDS);
const tl = (kurus: bigint) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  .format(`${kurus / 100n}.${String(kurus % 100n).padStart(2, '0')}` as `${number}`);
function kurus(values: readonly ({ amount: string } | null | undefined)[]): bigint {
  let toplam = 0n;
  for (const value of values) {
    if (!value) continue;
    const [lira, ondalik = ''] = value.amount.split('.');
    toplam += BigInt(lira!) * 100n + BigInt(`${ondalik}00`.slice(0, 2));
  }
  return toplam;
}

const ODA_3 = ROOMS.find((room) => room.code === 'oda_3')!;

describe('evModeli › oda satırları', () => {
  it('her canlı oda ada göre sıralı bir satırdır; odasız alımlar sonda "Oda bilinmiyor" satırında toplanır', () => {
    const model = evModeli(girdi());
    const adlar = canli(ROOMS).map((room) => room.label!).sort((a, b) => a.localeCompare(b, 'tr-TR'));
    expect(model.odalar.map((oda) => oda.label)).toEqual([...adlar, ODA_BILINMIYOR]);
    const odasiz = model.odalar.at(-1)!;
    expect(odasiz.id).toBe(ODASIZ_ID);
    expect(odasiz.odasiz).toBe(true);
    expect(odasiz.alimlar.map((row) => row.label).sort()).toEqual(LIVE_NEEDS.filter((need) => !need.room_id).map((need) => need.label).sort());
    expect(odasiz.eksik).toMatch(new RegExp(`^${ODA_ATANMAMIS}`));
  });

  it('alım sayısı odanın canlı alımlarıdır: aynı odaya bağlı işler, eşyalar, armatürler ve silinmiş alımlar sayılmaz', () => {
    const model = evModeli(girdi());
    const oda3 = model.odalar.find((oda) => oda.id === ODA_3.id)!;
    const beklenen = LIVE_NEEDS.filter((need) => need.room_id === ODA_3.id);
    const tumBaglar = RELATIONS.filter((rel) => rel.kind === 'located_in' && rel.target_id === ODA_3.id).length;
    expect(beklenen.length).toBeLessThan(tumBaglar);
    expect(oda3.alimlar.map((row) => row.id).sort()).toEqual(beklenen.map((need) => need.id).sort());
    expect(oda3.isler.map((row) => row.id)).toEqual(canli(WORKS).filter((work) => work.room_id === ODA_3.id).map((work) => work.id));
    expect(oda3.esyalar.map((row) => row.id)).toEqual(canli(LAYOUT).filter((item) => item.room_id === ODA_3.id).map((item) => item.id));
    expect(oda3.aydinlatma.map((row) => row.id)).toEqual(canli(LIGHTING).filter((item) => item.room_id === ODA_3.id).map((item) => item.id));

    const silinmisOda = ROOMS.find((room) => NEEDS.some((need) => need.deleted_at && need.room_id === room.id))!;
    const satir = model.odalar.find((oda) => oda.id === silinmisOda.id)!;
    expect(satir.alimlar.every((row) => !NEEDS.find((need) => need.id === row.id)!.deleted_at)).toBe(true);
  });

  it('planlanan ve gerçekleşen ayrı toplanır (kuruş kesin); eksik bilgi adıyla sayılır', () => {
    const model = evModeli(girdi());
    const oda3 = model.odalar.find((oda) => oda.id === ODA_3.id)!;
    const ihtiyac = LIVE_NEEDS.filter((need) => need.room_id === ODA_3.id);
    expect(toplamMetni(oda3.planned, 'Fiyat yok')).toBe(tl(kurus(ihtiyac.map((need) => need.amounts.planned))));
    expect(toplamMetni(oda3.actual, 'Henüz yok')).toBe(tl(kurus(ihtiyac.map((need) => need.amounts.actual))));
    expect(oda3.planned.counted).toBe(ihtiyac.filter((need) => need.amounts.planned).length);
    expect(oda3.actual.counted).toBe(ihtiyac.filter((need) => need.amounts.actual).length);

    const fiyatsiz = ihtiyac.filter((need) => !need.amounts.planned).length;
    const fotografsiz = ihtiyac.filter((need) => !MEDIA.some((media) => media.entity_id === need.id && media.verification === 'verified')).length;
    const parcalar = [fiyatsiz ? `${fiyatsiz} fiyat` : null, fotografsiz ? `${fotografsiz} fotoğraf` : null].filter(Boolean);
    expect(oda3.eksik).toBe(parcalar.length ? parcalar.join(' · ') : EKSIK_YOK);
  });

  it('gerçekleşen tutarı olmayan oda "Henüz yok", fiyatı olmayan "Fiyat yok" yazar; ₺0,00 eksiğin yerine geçmez', () => {
    const model = evModeli(girdi({ needs: NEEDS.map((need) => ({ ...need, amounts: { ...need.amounts, actual: null, planned: need.room_id === ODA_3.id ? null : need.amounts.planned } })) }));
    const oda3 = model.odalar.find((oda) => oda.id === ODA_3.id)!;
    expect(toplamMetni(oda3.actual, 'Henüz yok')).toBe('Henüz yok');
    expect(toplamMetni(oda3.planned, 'Fiyat yok')).toBe('Fiyat yok');
  });

  it('birden çok para birimi tek sayıda toplanmaz: "Birden çok para birimi"', () => {
    const ilk = LIVE_NEEDS.find((need) => need.room_id === ODA_3.id && need.amounts.planned)!;
    const needs = NEEDS.map((need) => (need.id === ilk.id ? { ...need, amounts: { ...need.amounts, planned: { amount: '100.00', currency: 'EUR' } } } : need));
    const oda3 = evModeli(girdi({ needs })).odalar.find((oda) => oda.id === ODA_3.id)!;
    expect(oda3.planned.money).toBeNull();
    expect(toplamMetni(oda3.planned, 'Fiyat yok')).toBe('Birden çok para birimi');
  });

  it('aşama: tek etiket olduğu gibi, farklı etiketler "Birden çok", etiket yoksa "Bilinmiyor"', () => {
    const model = evModeli(girdi());
    for (const oda of model.odalar) {
      const etiketler = new Set(oda.alimlar.map((row) => NEEDS.find((need) => need.id === row.id)!.phase_term_id)
        .map((id) => TERMS.find((term) => term.id === id)?.label).filter(Boolean));
      const beklenen = etiketler.size === 0 ? 'Bilinmiyor' : etiketler.size === 1 ? [...etiketler][0] : BIRDEN_COK;
      expect(oda.asama, oda.label).toBe(beklenen);
    }
  });

  it('açık iş: iptal edilmemiş ve kurulmamış/teslim edilmemiş/tamamlanmamış işler', () => {
    const model = evModeli(girdi());
    for (const oda of model.odalar.filter((item) => !item.odasiz)) {
      const beklenen = canli(WORKS).filter((work) => work.room_id === oda.id)
        .filter((work) => work.state_snapshot?.decision !== 'cancelled' && !['installed', 'delivered', 'completed'].includes(work.state_snapshot?.fulfillment ?? '')).length;
      expect(oda.acikIs, oda.label).toBe(beklenen);
    }
  });

  it('kaynak: oda satırının e-tablo sayfası ve satırı adıyla yazılır', () => {
    const oda3 = evModeli(girdi()).odalar.find((oda) => oda.id === ODA_3.id)!;
    expect(oda3.kaynak).toBe(`${ODA_3.provenance!.sheet_title} · satır ${ODA_3.provenance!.row}`);
    expect(evModeli(girdi()).odalar.at(-1)!.kaynak).toBeNull();
  });
});

describe('evModeli › özet', () => {
  it('ev toplamı yalnız canlı alımlardan; satır toplamlarıyla tutarlı, silinmiş kayıt sayılmaz', () => {
    const model = evModeli(girdi());
    expect(model.odaSayisi).toBe(canli(ROOMS).length);
    expect(model.alimSayisi).toBe(LIVE_NEEDS.length);
    expect(model.odasizAlim).toBe(LIVE_NEEDS.filter((need) => !need.room_id).length);
    expect(toplamMetni(model.planned, 'Fiyat yok')).toBe(tl(kurus(LIVE_NEEDS.map((need) => need.amounts.planned))));
    expect(toplamMetni(model.actual, 'Henüz yok')).toBe(tl(kurus(LIVE_NEEDS.map((need) => need.amounts.actual))));
    const satirToplami = model.odalar.reduce((acc, oda) => acc + kurus([oda.planned.money]), 0n);
    expect(tl(satirToplami)).toBe(toplamMetni(model.planned, 'Fiyat yok'));
  });

  it('silinmiş oda listelenmez; ona bağlı alımlar odasız sayılır', () => {
    const silinen = ROOMS[0]!;
    const model = evModeli(girdi({ rooms: ROOMS.map((room) => (room.id === silinen.id ? { ...room, deleted_at: '2026-10-01T00:00:00Z' } : room)) }));
    expect(model.odalar.some((oda) => oda.id === silinen.id)).toBe(false);
    expect(model.odaSayisi).toBe(canli(ROOMS).length - 1);
    const odasiz = model.odalar.find((oda) => oda.odasiz)!;
    expect(odasiz.alimlar.length).toBe(LIVE_NEEDS.filter((need) => !need.room_id || need.room_id === silinen.id).length);
  });
});
