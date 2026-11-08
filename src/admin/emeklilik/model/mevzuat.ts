// Kamu mevzuatı parametreleri (kişisel değil). Değerler yıl ve kaynakla taşınır; yeni yılda yeni sabit eklenir,
// hesap sınıfları bu değerleri parametre olarak alır (ezberlenmez).
import type { MevzuatParametreleri } from '../contract';

export const MEVZUAT_2026: MevzuatParametreleri = Object.freeze({
  yil: 2026,
  asgariUcretBrutTl: '33030.00',
  gunlukKazancAltSiniriTl: '1101.00',
  borclanmaOrani: 0.45,
  enDusukAylikTl: '23552.00',
  borcKesintiOrani: 0.1,
  borcKesintiTavani: 0.25,
  kaynaklar: Object.freeze([
    'SGK — 2026 prime esas kazanç sınırları: günlük alt sınır 1.101,00 TL (aylık brüt asgari ücret 33.030,00 TL)',
    'SGK — Borçlanmalar: borçlanma ve ihya günlük bedeli = günlük alt sınır × %45',
    'SGK 2026/19 Genelgesi — gelir ve aylıklardan prim borcu kesintisi: uygulama oranı %10',
    '7566 sayılı Kanun md. 21 ve 25 — aylıktan borç kesintisinin kanuni tavanı %25',
    'En düşük aylık 23.552,00 TL: kaynak araçlardaki 2026 değeri; resmi tutar SGK’dan doğrulanmalı',
  ]) as string[],
}) as MevzuatParametreleri;
