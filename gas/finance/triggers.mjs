export const HANDLERS = ['financeEdited', 'financeChanged'];

/** Event-driven only. Reinstalling must never recreate the retired clock trigger. */
export function ensureTriggers(targetId, {scriptApp, properties}) {
  const triggers = scriptApp.getProjectTriggers();
  for (const trigger of triggers.filter(t => t.getHandlerFunction() === 'financeTimer')) scriptApp.deleteTrigger(trigger);
  properties.deleteProperty('FINANCE_TIMER_15_MINUTES_ID');
  for (const handler of HANDLERS) {
    const type = handler === 'financeEdited' ? scriptApp.EventType.ON_EDIT : scriptApp.EventType.ON_CHANGE;
    let kept = false;
    for (const trigger of triggers.filter(t => t.getHandlerFunction() === handler)) {
      const valid = trigger.getEventType() === type && trigger.getTriggerSourceId() === targetId;
      if (valid && !kept) kept = true;
      else scriptApp.deleteTrigger(trigger);
    }
    if (kept) continue;
    if (handler === 'financeEdited') scriptApp.newTrigger(handler).forSpreadsheet(targetId).onEdit().create();
    else scriptApp.newTrigger(handler).forSpreadsheet(targetId).onChange().create();
  }
}
