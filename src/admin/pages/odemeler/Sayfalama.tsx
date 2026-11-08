import { useLayoutEffect, useRef } from 'react';
import { Button } from '../../ui/Button';
import { dahaFazlaMetni, gosterilenMetni } from './model';

// Liste altı: "Gösterilen 10 / 20" (role=status, değişince duyurulur) + "N tahmini ödeme daha göster". Telefon ve geniş
// sunum ortak kullanır. Odak: düğme son sayfayı açıp kalktığında odak kaybolmasın diye durum satırına taşınır
// (odakYonet). Telefon listesi odağı kendisi yeni gelen ilk satıra taşıdığı için odakYonet=false verir.
export interface SayfalamaProps {
  gosterilen: number;
  toplam: number;
  adim: number;
  onDahaFazla(): void;
  /** Düğme kalkınca odağı durum satırına taşı (varsayılan true). */
  odakYonet?: boolean;
}

export function Sayfalama({ gosterilen, toplam, adim, onDahaFazla, odakYonet = true }: SayfalamaProps) {
  const durum = useRef<HTMLParagraphElement>(null);
  const bekleyen = useRef(false);
  const kalan = Math.max(0, toplam - gosterilen);

  useLayoutEffect(() => {
    if (!bekleyen.current) return;
    bekleyen.current = false;
    if (odakYonet && kalan === 0) durum.current?.focus();
  }, [gosterilen, kalan, odakYonet]);

  return (
    <div className="aile-odemeler-sayfalama">
      <p ref={durum} role="status" tabIndex={-1} className="aile-odemeler-sayfalama__durum aile-kucuk aile-ikincil">
        {gosterilenMetni(gosterilen, toplam)}
      </p>
      {kalan > 0 ? (
        <Button variant="secondary" block onClick={() => { bekleyen.current = true; onDahaFazla(); }}>
          {dahaFazlaMetni(kalan, adim)}
        </Button>
      ) : null}
    </div>
  );
}
