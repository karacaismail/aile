import './timeline-shell.css';

/** Only layout placeholders are shared with the route shell; no finance data or route logic. */
export function TimelineLoading() {
  return <section className="timeline-loading" aria-label="Ödeme takvimi yükleniyor" aria-busy="true">
    <p className="timeline-loading-status" role="status">Ödeme takvimi ve bakiyeler kontrol ediliyor…</p>
    <div className="timeline-loading-activity" aria-hidden="true" />
    <div className="timeline-workspace" aria-hidden="true">
      <div className="timeline-overview timeline-loading-overview">
        <span className="timeline-loading-shape" />
        <span className="timeline-loading-shape timeline-loading-control" />
        {[0, 1].map(key => <div className="timeline-loading-metric" key={key}><span className="timeline-loading-shape" /><span className="timeline-loading-shape timeline-loading-value" /></div>)}
        <span className="timeline-loading-shape" />
      </div>
      <div className="timeline-loading-flow">
        <span className="timeline-loading-shape timeline-loading-flow-heading" />
        {[0, 1, 2].map(key => <div className="timeline-loading-step" key={key}>
          <span className="timeline-loading-shape" />
          <span className="timeline-loading-shape timeline-loading-step-title" />
          <div className="timeline-loading-balances"><span className="timeline-loading-shape timeline-loading-value" /><span className="timeline-loading-shape timeline-loading-value" /></div>
          <span className="timeline-loading-shape timeline-loading-step-note" />
        </div>)}
      </div>
    </div>
  </section>;
}

export function TimelineRouteLoading() {
  return <div className="timeline-page">
    <header className="timeline-heading">
      <div className="timeline-title"><h1>Timeline</h1><p className="muted">Nakit ve borç takvimi.</p></div>
      <div className="timeline-heading-tools"><button className="quiet-button" disabled>Yenile</button></div>
    </header>
    <p className="timeline-plan-label"><span>Plan</span> Gerçekleşmiş ödeme değildir.</p>
    <TimelineLoading />
  </div>;
}
