import { money } from '../dashboard/data';
import type { FinanceInput, simulate } from './finance';
import { FactList } from '../components/Info';

type Result = ReturnType<typeof simulate>;
const cashMoney = (value: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' ₺';

export function FinanceSummary({ result, input, onRules }: { result: Result | null; input: FinanceInput; onRules: () => void }) {
  if (!result) return <aside id="finance-conclusion" tabIndex={-1} data-testid="finance-result" className="scenario-summary error-message" role="alert">Fiyat, yıl ve vadeyi kontrol edin. Borç sınırı %1–50 olmalı.</aside>;
  const blocked = result.status === 'Uygun değil';
  const missing = [input.existingDebt === null && 'borç', input.livingCost === null && 'hane gideri'].filter(Boolean);
  return <aside data-testid="finance-result" className="scenario-summary" aria-labelledby="finance-conclusion">
    <div className="summary-header"><p className="summary-kicker">Finansman özeti</p><span className="summary-mode">Tahmini</span></div>
    <div className="decision-metrics" role="group" aria-label="Ödeme yükü">
      <div className="payment-metric"><span>En yüksek taksit</span><strong>{money(result.peakPayment)}</strong></div>
      <div><span>Toplam maliyet</span><strong>{money(result.totalCost)}</strong></div>
      <div><span>Alım günü nakit açığı <strong className={result.upfrontGap ? 'negative' : ''}>{money(result.upfrontGap)}</strong></span></div>
    </div>
    <div className="summary-assessment">
      <div className={`decision decision-${blocked ? 'block' : 'unknown'}`}>
        <div className="decision-status"><h2 id="finance-conclusion" tabIndex={-1} aria-live="polite">{result.status}</h2></div>
      </div>
      <div className="budget-verdict"><h3>Ödeme gücü</h3><p>{result.budgetStatus}.</p>{missing.length > 0 && <p className="muted">Eksik: {missing.join(', ')}</p>}</div>
    </div>
    <div className="summary-details">
      <section aria-label="Finansmanın dağılımı" role="group"><dl className="finance-breakdown">
        <div><dt>Taşıt kredisi <span>· {result.autoMonths} ay</span></dt><dd>{money(result.autoPrincipal)}</dd></div>
        <div><dt>İhtiyaç kredisi <span>· {result.personalMonths} ay</span></dt><dd>{money(result.personalPrincipal)}</dd></div>
        <div><dt>Faiz, vergi ve tahsis</dt><dd>{money(result.financingCost)}</dd></div>
        {result.fundingGap > 0 && <div className="negative"><dt>Kredi açığı</dt><dd>{money(result.fundingGap)}</dd></div>}
      </dl></section>
      <div className="reserve-summary" data-testid="contingency-result"><FactList label="Alım günü nakdi" items={[
        {label:'Yedekten kullanılan',value:cashMoney(result.contingencyUsed)},
        {label:'Yedekte kalan',value:cashMoney(result.contingencyRemaining)},
      ]}/></div>
    </div>
    <button className="summary-action" onClick={onRules}>Koşulları gör <span aria-hidden="true">↗</span></button>
  </aside>;
}
