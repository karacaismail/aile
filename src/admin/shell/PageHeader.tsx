import type { ReactNode } from 'react';
import { useDevice } from '../device';
import { Button } from '../ui/Button';
import { DataStatus } from '../ui/DataStatus';
import { OverflowActions } from '../ui/OverflowActions';
import type { PageHeaderProps } from './contracts';
import { adminGroupTitle, currentAdminLink } from './navigation';
import './PageHeader.css';

// Tasarım: README.md "Sayfa iskeleti (sıra sabit)" 1–2 + components/PageHeader/README.md + index.d.ts PageHeaderProps;
// davranış bundle.js PageHeader. Sıra: bölüm adı (kucuk-orta, ikincil) → h1 (menüdeki ad) → amaç cümlesi → eylemler →
// tazelik satırı (DataStatus) → özet (en çok 3 ölçü, kutusuz tek satır; dördüncü kesilir) → children.
// Eylemler: `actions` verilirse olduğu gibi; yoksa primary + more. Telefonda yalnız primary + "Diğer" (OverflowActions,
// alttan açılır); tablet ve masaüstünde more ikincil Button'lar, sonra primary. Hover'a bağlı eylem yok.
// antd PageContainer kullanılmaz (breadcrumb/sticky yan etkileri); kendi <header>. document.title'ı kabuk yazar.
// Dar yerleşim useDevice'tan (phone/tablet); görsel kurallar PageHeader.css, yalnız --aile tokenları.
// Bölgeler (doğrudan çocuklar, telefonda alt alta): başlık bloğu → [data-part="actions"] → [data-part="context"]. Bağlam =
// tazelik + özet + sayfanın notları; tek tam genişlik satırdır, masaüstünde notlar eylem sütununa düşmez. Boş bölge çizilmez.
// ui modülleri tek tek içe aktarılır (barrel değil): telefon teslimi yalnız burada çizilen bileşenleri çeker.

/** README: "en çok üç anlamlı ölçü"; dördüncü ve sonrası çizilmez. */
export const SUMMARY_LIMIT = 3;

/** Çizilecek bir düğüm var mı (null, undefined, boolean ve boş dizi çizilmez). */
function hasNodes(node: ReactNode): boolean {
  if (node === null || node === undefined || node === '' || typeof node === 'boolean') return false;
  if (Array.isArray(node)) return node.some(hasNodes);
  return true;
}

export function PageHeader({
  location, section, title, purpose, lead, primary, more, actions, status, summary, children,
}: PageHeaderProps) {
  const device = useDevice();
  const narrow = device !== 'desktop';
  const link = currentAdminLink(location);
  const sectionText = section ?? adminGroupTitle(link.path);
  const titleText = title ?? link.label;
  const purposeNode: ReactNode = purpose ?? lead;

  let actionNodes: ReactNode = actions;
  const hasMore = Boolean(more && more.length > 0);
  if (actionNodes === undefined && (primary || hasMore)) {
    actionNodes = device === 'phone' ? (
      <>
        {primary}
        {hasMore ? <OverflowActions items={more!} /> : null}
      </>
    ) : (
      <>
        {(more ?? []).map(action => (
          <Button key={action.label} variant="secondary" icon={action.icon} onClick={() => action.onClick()}>
            {action.label}
          </Button>
        ))}
        {primary}
      </>
    );
  }

  const measures = summary ? summary.slice(0, SUMMARY_LIMIT) : [];
  const hasContext = Boolean(status) || measures.length > 0 || hasNodes(children);

  return (
    <header className={`aile-ph${narrow ? ' aile-ph--dar' : ''}`} data-narrow={narrow}>
      <div className="aile-ph__baslik">
        <p className="aile-ph__bolum aile-kucuk aile-ikincil">{sectionText}</p>
        <h1 className="aile-ph__h1">{titleText}</h1>
        {purposeNode ? <p className="aile-ph__amac aile-ikincil">{purposeNode}</p> : null}
      </div>
      {actionNodes ? <div className="aile-ph__eylemler" data-part="actions">{actionNodes}</div> : null}
      {hasContext ? (
        <div className="aile-ph__baglam" data-part="context">
          {status ? <div className="aile-ph__durum"><DataStatus {...status} /></div> : null}
          {measures.length > 0 ? (
            <ul className="aile-ph__ozet" aria-label="Özet">
              {measures.map(measure => (
                <li key={measure.label} className="aile-ph__olcu">
                  <span className="aile-ph__olcu-etiket aile-kucuk aile-ikincil">{measure.label}</span>
                  <span className="aile-ph__olcu-deger">
                    <span className="aile-ph__olcu-sayi">{measure.value}</span>
                    {measure.note ? <span className="aile-ph__olcu-not aile-kucuk aile-ikincil">{measure.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {children}
        </div>
      ) : null}
    </header>
  );
}
