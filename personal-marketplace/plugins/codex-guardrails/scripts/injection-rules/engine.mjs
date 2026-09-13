import { RECENT_ENTRY_CHAR_CAP } from "./constants.mjs";
import { hasSemanticTrigger, matchesRule, semanticHit } from "./rule-parser.mjs";

function matchingRules(rules, actor) {
  return rules.filter((rule) => matchesRule(rule, actor.agentId));
}

function textsForRule(actor, rule) {
  const source = rule.source.replace("_only", "");
  const entries = rule.source === "any"
    ? actor.recentEntries
    : actor.recentEntries.filter((entry) => entry.source === source);
  return entries.slice(-rule.windowSize).map((entry) => entry.text);
}

function markPending(actor, rule, isSemantic, debugEvents) {
  actor.pendingByRule[rule.name] = true;
  if (!isSemantic) return;
  actor.lastFiredByRule[rule.name] = actor.turnIndex;
  if (rule.hintMode !== "inject_only") actor.noticesByRule[rule.name] = true;
  debugEvents.push({
    ts: new Date().toISOString(),
    turnIndex: actor.turnIndex,
    ruleName: rule.name,
    hitSource: rule.source === "any" ? "any" : rule.source.replace("_only", ""),
    bufferLen: textsForRule(actor, rule).length,
    cooldownLeft: 0,
    mode: rule.hintMode === "inject_only" ? "inject" : rule.hintMode === "notify_only" ? "notify" : "both",
  });
}

export function recordRecent(actor, text, source, maxWindow) {
  const normalized = String(text ?? "").slice(0, RECENT_ENTRY_CHAR_CAP);
  if (!normalized) return;
  actor.recentEntries.push({ text: normalized, source });
  const indices = actor.recentEntries.flatMap((entry, index) => entry.source === source ? [index] : []);
  if (indices.length > maxWindow) actor.recentEntries.splice(indices[0], 1);
}

export function buildStandingContext(rules, actor) {
  return matchingRules(rules, actor).filter((rule) => rule.sendOnStart).map((rule) => rule.body).join("\n\n");
}

export function tickInput({ actor, rules, cadences }) {
  actor.inputCounter += 1;
  for (const rule of matchingRules(rules, actor)) {
    if (!rule.onUserEnd) continue;
    const cadence = cadences[rule.name] ?? rule.every;
    if (rule.everyInput || (cadence && actor.inputCounter % cadence === 0)) actor.pendingByRule[rule.name] = true;
  }
}

export function tickTurn({ actor, rules, cadences }) {
  actor.turnIndex += 1;
  const debugEvents = [];
  for (const rule of matchingRules(rules, actor)) {
    const cadence = cadences[rule.name] ?? rule.every;
    if (!rule.onUserEnd && cadence && actor.turnIndex % cadence === 0) markPending(actor, rule, false, debugEvents);
    const texts = textsForRule(actor, rule);
    if (!hasSemanticTrigger(rule) || texts.length === 0 || !semanticHit(rule, texts)) continue;
    const lastFired = actor.lastFiredByRule[rule.name];
    if (lastFired !== undefined && actor.turnIndex - lastFired < rule.cooldownTurns) continue;
    markPending(actor, rule, true, debugEvents);
  }
  return debugEvents;
}

export function consumePending(rules, actor) {
  const reminders = [];
  const systemMessages = [];
  for (const rule of matchingRules(rules, actor)) {
    if (!actor.pendingByRule[rule.name]) continue;
    delete actor.pendingByRule[rule.name];
    if (rule.suffix) reminders.push(rule.suffix.replace(/^\n+/, ""));
    if (actor.noticesByRule[rule.name]) {
      systemMessages.push(`${rule.name}: ${rule.suffix ?? ""}`.trim());
      delete actor.noticesByRule[rule.name];
    }
  }
  return { reminders: reminders.join("\n\n"), systemMessages };
}
