import { money } from '../dashboard/data';
import type { FinanceInput, simulate } from './finance';

type Result = ReturnType<typeof simulate>;
const cashMoney = (value: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' ₺';

export function FinanceSummary({ result, input, onRules }: { result: Result | null; input: FinanceInput; onRules: () => void }) {
  if (!result) return <aside data-testid="finance-result" className="scenario-summary error-message" role="alert">Alım bedeli, model/alım yılı ve vadeleri kontrol edin. Bütçe eşiği %1–50 olmalı.</aside>;
  const blocked = result.status === 'Uygun değil';
  return <aside data-testid="finance-result" className="scenario-summary" aria-labelledby="finance-conclusion">
    <div className="summary-header"><p className="summary-kicker">Finansman özeti</p><span className="summary-mode">Tahmini hesap</span></div>
    <div className="decision-metrics">
      <div className="payment-metric"><span>En yüksek aylık taksit</span><strong>{money(result.peakPayment)}</strong></div>
      <div><span>Toplam alım maliyeti</span><strong>{money(result.totalCost)}</strong></div>
      <div><span>Alım günü ek nakit açığı <strong className={result.upfrontGap ? 'negative' : ''}>{money(result.upfrontGap)}</strong></span></div>
    </div>
    <div className={`decision decision-${blocked ? 'block' : 'unknown'}`}>
      <div className="decision-status"><h2 id="finance-conclusion" tabIndex={-1} aria-live="polite">{result.status}</h2><span>Yasal / ürün koşulları</span></div>
      <p>{blocked ? 'Seçilen kredi ürünlerinin tutar veya araç koşulları karşılanmıyor.' : result.status === 'Değerlendirilemiyor' ? 'Bu araç / teklif için doğrulanmış ürün koşulları eksik.' : result.status === 'Kredi gerekmiyor' ? 'Nakit, alım bedelini ve girilen masrafları karşılıyor.' : 'Tutar ve vade sınırları içinde; gelir, araç ve satıcı teyidi gerekir.'}</p>
      <p className="approval-note">{result.lenderStatus} · Kişisel onay değildir.</p>
    </div>
    <dl className="finance-breakdown">
      <div><dt>Taşıt kredisi <span>· {result.autoMonths} ay</span></dt><dd>{money(result.autoPrincipal)}</dd></div>
      <div><dt>İhtiyaç kredisi <span>· {result.personalMonths} ay</span></dt><dd>{money(result.personalPrincipal)}</dd></div>
      <div><dt>Faiz, vergiler ve tahsis</dt><dd>{money(result.financingCost)}</dd></div>
      {result.fundingGap > 0 && <div className="negative"><dt>Karşılanmayan kredi tutarı</dt><dd>{money(result.fundingGap)}</dd></div>}
    </dl>
    <div className="reserve-summary" data-testid="contingency-result"><span>Yedekten kullanılan <strong>{cashMoney(result.contingencyUsed)}</strong></span><span>Yedekte kalan <strong>{cashMoney(result.contingencyRemaining)}</strong></span></div>
    <div className="budget-verdict"><h3>Ödeme gücü</h3><p>{result.budgetStatus}.</p>{input.existingDebt === null && <p className="muted">Mevcut borç bilgisi eksik.</p>}{input.livingCost === null && <p className="muted">Hane gideri bilgisi eksik.</p>}</div>
    <button className="summary-action" onClick={onRules}>Koşulları ve bütçe hesabını incele <span aria-hidden="true">↗</span></button>
    <p className="summary-footnote">Örnek faizlerle hesaplanır. Girilmeyen sigorta ve alım masrafları hariçtir.</p>
  </aside>;
}
