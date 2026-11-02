import type { IletisimBaglantisi } from './model';
import { BILINMIYOR } from './sunum';

// İletişim bağlantıları: yerel <a> (tel: ve WhatsApp). Hedef en az 44 px, kaba (dokunmatik) girişte 48 px
// (TaraflarPage.css, [data-input-coarse]). Görünür etiket ("Ara", "WhatsApp") erişilebilir adın başındadır (WCAG 2.5.3);
// ad kimi aradığını, WhatsApp yeni sekmede açıldığını söyler. Odak çizgisini admin.css a:focus-visible::after çizer
// (çevreleyen halka yok). Bağlantı kurulamıyorsa ya da kaynakta telefon yoksa "Bilinmiyor" — uydurma bağlantı yok.

export interface IletisimProps {
  ad: string | null;
  telefon: string | null;
  iletisim: IletisimBaglantisi | null;
}

export function Iletisim({ ad, telefon, iletisim }: IletisimProps) {
  if (!iletisim || !telefon) return <span className="aile-ikincil">{BILINMIYOR}</span>;
  const kim = ad ?? telefon;
  return (
    <span className="aile-taraflar-iletisim">
      <a className="aile-taraflar-iletisim__baglanti" href={iletisim.tel} aria-label={ad ? `Ara: ${ad}, ${telefon}` : `Ara: ${telefon}`}>
        Ara
      </a>
      {iletisim.whatsapp ? (
        <a
          className="aile-taraflar-iletisim__baglanti"
          href={iletisim.whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`WhatsApp ile yaz: ${kim} (yeni sekmede açılır)`}
        >
          WhatsApp
        </a>
      ) : null}
    </span>
  );
}
