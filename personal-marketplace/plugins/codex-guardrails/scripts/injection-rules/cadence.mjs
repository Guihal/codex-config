function gcd(left, right) {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function lcm(left, right) {
  return (left * right) / gcd(left, right);
}

function selectCadence(chosen, minimum, maximum) {
  for (let cadence = minimum; cadence <= maximum; cadence += 1) {
    if (!chosen.includes(cadence) && chosen.every((value) => gcd(cadence, value) === 1)) return cadence;
  }
  let best = -1;
  let bestCost = Infinity;
  for (let cadence = minimum; cadence <= maximum; cadence += 1) {
    if (chosen.includes(cadence)) continue;
    const cost = chosen.reduce((sum, value) => sum + 1 / lcm(cadence, value), 0);
    if (cost < bestCost) [best, bestCost] = [cadence, cost];
  }
  return best === -1 ? (chosen[0] ?? minimum) : best;
}

export function distributeCadences(rules, config, onWarning = () => {}) {
  const overrides = {};
  const slots = config.maxStep - config.minStep + 1;
  let hasWarned = false;
  for (const isInputClock of [true, false]) {
    const prioritized = rules
      .filter((rule) => rule.onUserEnd === isInputClock && rule.priority !== undefined && rule.every === undefined && !rule.everyInput)
      .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name, "en"));
    if (prioritized.length > slots && !hasWarned) {
      hasWarned = true;
      onWarning(`[injection-rules] cadence distribution exceeds ${slots} slots; reusing cadences`);
    }
    const chosen = [];
    for (const rule of prioritized) {
      const cadence = selectCadence(chosen, config.minStep, config.maxStep);
      overrides[rule.name] = cadence;
      chosen.push(cadence);
    }
  }
  return overrides;
}
