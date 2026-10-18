let activeEffect = null;
let effectTimer = null;

export function createDeliveryBadge(event) {
  const badge = document.createElement('span');
  let kind = 'run';
  let text = String(event.runs ?? 0);
  if (event.wicket) { kind = 'wicket'; text = 'W'; }
  else if (!event.legalBall) {
    kind = 'extra';
    text = String(event.label).startsWith('NO-BALL') ? 'Nb' : 'Wd';
  } else if (event.runs === 4) kind = 'four';
  else if (event.runs === 6) kind = 'six';
  else if (event.runs === 0) { kind = 'dot'; text = '•'; }
  badge.className = 'tw-delivery-badge tw-delivery-' + kind;
  badge.textContent = text;
  // The adjacent delivery label supplies the accessible description.
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

export function clearBoundaryEffect() {
  if (effectTimer !== null) clearTimeout(effectTimer);
  activeEffect?.remove();
  activeEffect = null;
  effectTimer = null;
}

export function flashBoundary(runs) {
  if (runs !== 4 && runs !== 6) return;
  clearBoundaryEffect();
  const effect = document.createElement('div');
  effect.className = 'tw-boundary tw-boundary-' + runs;
  effect.setAttribute('role', 'status');
  effect.setAttribute('aria-live', 'polite');
  const label = document.createElement('b');
  label.textContent = runs === 4 ? 'Four!' : 'Six!';
  effect.appendChild(label);
  document.body.appendChild(effect);
  activeEffect = effect;
  effectTimer = setTimeout(clearBoundaryEffect, 1100);
}

// Establish a baseline on first load. Only new deliveries trigger celebrations;
// repeated snapshots, Undo, innings switches and old match views stay quiet.
export function createBoundaryObserver(celebrate = flashBoundary) {
  let previousCounts = null;
  return match => {
    const innings = match.innings || [];
    const counts = innings.map(inn => Array.isArray(inn.events) ? inn.events.length : 0);
    const previous = previousCounts;
    previousCounts = counts;
    if (!previous) return;
    const total = counts.reduce((sum, count) => sum + count, 0);
    const previousTotal = previous.reduce((sum, count) => sum + count, 0);
    if (total <= previousTotal) return;
    for (let index = counts.length - 1; index >= 0; index--) {
      if (counts[index] <= (previous[index] || 0)) continue;
      const event = innings[index].events[0];
      if (event?.legalBall && !event.wicket && (event.runs === 4 || event.runs === 6)) {
        celebrate(event.runs);
      }
      return;
    }
  };
}
