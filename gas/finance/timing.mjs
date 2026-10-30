/** Logs only phase and elapsed time, never source cells or financial values. */
export function measurePhase(phase, action, clock = Date.now, log = entry => console.log(JSON.stringify(entry))) {
  const started = clock();
  try {
    const result = action();
    log({phase, milliseconds: clock() - started, status: 'ok'});
    return result;
  } catch (error) {
    log({phase, milliseconds: clock() - started, status: 'error'});
    throw error;
  }
}
