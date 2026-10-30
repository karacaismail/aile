export const HANDLERS = ['financeEdited', 'financeChanged', 'financeTimer'];
const TIMER_ID = 'FINANCE_TIMER_15_MINUTES_ID';

/** Keep immediate edits; the timer catches API edits that do not fire onEdit. */
export function ensureTriggers(targetId, {scriptApp, properties}) {
  const triggers = scriptApp.getProjectTriggers();
  const timerId = properties.getProperty(TIMER_ID);
  for (const handler of HANDLERS) {
    const type = handler === 'financeTimer' ? scriptApp.EventType.CLOCK : handler === 'financeEdited' ? scriptApp.EventType.ON_EDIT : scriptApp.EventType.ON_CHANGE;
    let kept = false;
    for (const trigger of triggers.filter(t => t.getHandlerFunction() === handler)) {
      // Apps Script does not expose a clock trigger's interval. Its stored identity
      // proves that this controller created it with the current 15-minute cadence.
      const valid = trigger.getEventType() === type && (handler === 'financeTimer'
        ? trigger.getUniqueId() === timerId
        : trigger.getTriggerSourceId() === targetId);
      if (valid && !kept) kept = true;
      else scriptApp.deleteTrigger(trigger);
    }
    if (kept) continue;
    if (handler === 'financeTimer') {
      const timer = scriptApp.newTrigger(handler).timeBased().everyMinutes(15).create();
      properties.setProperty(TIMER_ID, timer.getUniqueId());
    } else if (handler === 'financeEdited') scriptApp.newTrigger(handler).forSpreadsheet(targetId).onEdit().create();
    else scriptApp.newTrigger(handler).forSpreadsheet(targetId).onChange().create();
  }
}
