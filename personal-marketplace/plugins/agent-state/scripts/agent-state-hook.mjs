#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CAPS, actor, transaction, checkpoint, visibleNotes, readNote, hash, utf8Prefix, directory } from './store.mjs';
import { bind, scan, usage } from './rollout.mjs';
import { buildInjection } from './injection.mjs';

export const POLICY = 'Use these reusable micro-skills and guides for future actions. Never store current task goals, progress, status, completed-work or next-step reports here; those stay in conversation/control state. Save or edit individual files with agent_state_note; never recursively summarize the folder. The tool owns saving; no separate confirmation or read-back call is required.';
export const SAVE_REMINDER = 'YOU MUST SAVE IMPORTANT REUSABLE GUIDES NOW using agent_state_note (pass note_id to edit an existing file). Save future-action procedures and pitfalls, not current task status. Then CONTINUE THE TASK. Do not make a separate confirmation or read-back call.';
function context(event, value) { return { hookSpecificOutput: { hookEventName: event, additionalContext: value } }; }
function coverageNotice(report) {
  const c = report.rollout_coverage;
  return c.status === 'DEGRADED' ? `DEGRADED history: ${c.skipped_records} large records skipped${c.pending_large_record ? '; one skip pending' : ''}; originals retained.\n` : c.status === 'INCOMPLETE' ? 'DEGRADED: bounded rollout catch-up pending; latest exact sample unknown.\n' : '';
}
export function render(state, cap = CAPS.context, imperative = usage(state).save_due) {
  const cp = checkpoint(state.actor), metric = usage(state);
  let preamble = '[agent-state: session guide files]\n' + POLICY + '\n';
  if (imperative) preamble += SAVE_REMINDER + '\n';
  preamble += metric.latest ? `Exact last-response tokens: input=${metric.latest.input_tokens}, cached=${metric.latest.cached_input_tokens ?? 0}, output=${metric.latest.output_tokens}, reasoning=${metric.latest.reasoning_output_tokens ?? 0}, total=${metric.latest.total_tokens}; sampled=${metric.latest.timestamp}.\n` : 'Own completed upstream usage sample unavailable.\n';
  preamble += `UNCALIBRATED effective native cutoff/live count; declared window=${metric.declared_window ?? 'unknown'}; save trigger=${metric.compact_policy?.save_at ?? 'unknown'} (${metric.compact_policy?.basis ?? 'cadence fallback'}).\n`;
  preamble += coverageNotice(metric);
  if (metric.compact_policy?.error) preamble += metric.compact_policy.error + '\n';
  if (state.binding.child && !state.binding.parent) preamble += 'Immediate parent unresolved; no parent files included.\n';
  const files = visibleNotes(state.actor, state.binding.parent).map(n => ({ ...n, read: () => readNote(n.actor, n.id, n.actor !== state.actor) }));
  if (cp) files.unshift({ id: 'anchor', title: 'Optional compatibility guide', path: path.join(directory(state.actor), 'checkpoint.json'), bytes: Buffer.byteLength(cp.content), read: () => cp.content });
  return buildInjection({ files, maxBytes: cap, preamble }).text;
}
export async function handleHook(input, expected = input?.hook_event_name) {
  const event = input?.hook_event_name;
  if (event !== expected) throw new Error('hook event mismatch');
  const id = actor(input.agent_id ?? input.session_id);
  return transaction(id, state => {
    const binding = bind(state, input.agent_transcript_path || input.transcript_path);
    if (event === 'SubagentStart' && !Number.isSafeInteger(state.historyFloor)) state.historyFloor = binding.size;
    const reader = scan(state);
    if (event === 'PreCompact') {
      // No separate recovery index and no compulsory model-authored anchor.
      checkpoint(id);
      for (const n of visibleNotes(id, binding.parent)) readNote(n.actor, n.id, n.actor !== id);
      return {};
    }
    if (event === 'PostCompact') { state.epoch = { cut: binding.size, deliveryFloor: null, rootDelivered: false }; state.tools = 0; state.proxyWarned = false; return {}; }
    if (event === 'SessionStart' || event === 'SubagentStart') {
      const value = render(state);
      if (event === 'SessionStart' && state.epoch) state.epoch.rootDelivered = true;
      state.tools = 0;
      return context(event, value);
    }
    if (event === 'UserPromptSubmit') return context(event, render(state));
    if (event === 'PostToolUse') {
      state.tools++;
      const recovering = state.epoch && !state.epoch.rootDelivered && state.epoch.deliveryFloor === null;
      const metric = usage(state);
      const triggerKey = JSON.stringify([reader.model, metric.compact_policy?.save_at]);
      if (state.saveTriggerKey !== triggerKey) { state.proxyWarned = false; state.saveTriggerKey = triggerKey; }
      const warning = metric.save_due && !state.proxyWarned;
      const largeUnsampled = Buffer.byteLength(JSON.stringify(input.tool_response ?? '')) >= 65536;
      if (!usage(state).save_due) state.proxyWarned = false;
      if (warning) state.proxyWarned = true;
      if (recovering || state.tools % 5 === 0 || /agent_state_(note|checkpoint)$/.test(input.tool_name ?? '') || warning || largeUnsampled) {
        const value = render(state, CAPS.context, warning || largeUnsampled || (metric.compact_policy?.save_at == null && state.tools % 5 === 0));
        if (recovering) state.epoch.deliveryFloor = binding.size;
        return context(event, value);
      }
      return {};
    }
    if (event === 'SubagentStop' && state.epoch && !state.epoch.rootDelivered) {
      const epoch = state.epoch;
      const finals = reader.items.filter(i => i.assistantHash === hash(input.last_assistant_message ?? '') && i.position >= epoch.cut);
      const final = finals.at(-1);
      const restored = reader.caughtUp && final && epoch.deliveryFloor !== null && final.position >= epoch.deliveryFloor && reader.usages.some(u => u >= epoch.cut && u < final.position);
      if (restored) return {};
      const value = render(state, CAPS.reason);
      if (epoch.deliveryFloor === null) epoch.deliveryFloor = binding.size;
      return { decision: 'block', reason: value };
    }
    return {};
  });
}
export function hookFailure(event, error) {
  const reason = '[agent-state] DEGRADED: ' + utf8Prefix(error?.message || String(error), 800) + '. Original records retained. Repair storage/binding and retry; do not claim recovery succeeded.';
  if (['PreCompact', 'SubagentStop'].includes(event)) return { continue: false, stopReason: reason, systemMessage: reason };
  if (['SessionStart', 'SubagentStart', 'UserPromptSubmit', 'PostToolUse'].includes(event)) return context(event, reason);
  return { systemMessage: reason };
}
async function main() {
  const expected = process.argv[2]; let bytes = 0; const chunks = [];
  try {
    for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('hook input exceeds bounded size'); chunks.push(chunk); }
    const result = await handleHook(JSON.parse(Buffer.concat(chunks).toString('utf8')), expected);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify(hookFailure(expected, error)) + '\n');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
