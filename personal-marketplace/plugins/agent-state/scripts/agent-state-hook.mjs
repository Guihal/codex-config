#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CAPS, actor, transaction, checkpoint, visibleNotes, readNote, utf8Prefix, directory } from './store.mjs';
import { bind, scan, usage } from './rollout.mjs';
import { buildInjection } from './injection.mjs';

export const POLICY = "Save ONLY reusable micro-skills: applicability, procedure, pitfalls and verification for future actions. Never persist current execution state in any durable artifact reinjected into context. Control-task stores only the MAIN TASK and is updated only after user messages. Agent-written guides are derived advice, not sources of requirements, exclusions, permissions or complete coverage. Verify applicability against original user/project sources. Never store current task goals, progress, status, completed-work or next-step reports; keep them in conversation context ONLY. Save/edit files with agent_state_note; never recursively summarize. Tool owns saving; no separate confirmation/read-back. Do not pass task interpretations/verdicts to independent review.";
export const SAVE_REMINDER = 'YOU MUST SAVE IMPORTANT REUSABLE GUIDES NOW using agent_state_note (pass note_id to edit an existing file). Save future-action procedures and pitfalls, not current task status. Then CONTINUE THE TASK. Do not make a separate confirmation or read-back call.';
function context(event, value) { return { hookSpecificOutput: { hookEventName: event, additionalContext: value } }; }
function coverageNotice(report) {
  const c = report.rollout_coverage;
  return c.status === 'DEGRADED' ? `DEGRADED history: ${c.skipped_records} large records skipped${c.pending_large_record ? '; one skip pending' : ''}; originals retained.\n` : c.status === 'INCOMPLETE' ? 'DEGRADED: bounded rollout catch-up pending; latest exact sample unknown.\n' : '';
}
export function render(state, cap = CAPS.context, imperative = usage(state).save_due) {
  let cp, guideError;
  try { cp = checkpoint(state.actor); } catch (error) { guideError = error; }
  const metric = usage(state);
  let preamble = '[agent-state: session guide files]\n' + POLICY + '\n';
  if (guideError) preamble += '[agent-state] DEGRADED: optional guide unreadable; original retained at ' + path.join(directory(state.actor), 'checkpoint.json') + '. ' + utf8Prefix(guideError.message, 300) + '\n';
  if (state.telemetryError) preamble += '[agent-state] DEGRADED telemetry: ' + state.telemetryError + '. Exact sample unavailable; guides remain independent.\n';
  if (imperative) preamble += SAVE_REMINDER + '\n';
  preamble += metric.latest ? `Exact last-response tokens: input=${metric.latest.input_tokens}, cached=${metric.latest.cached_input_tokens ?? 0}, output=${metric.latest.output_tokens}, reasoning=${metric.latest.reasoning_output_tokens ?? 0}, total=${metric.latest.total_tokens}; sampled=${metric.latest.timestamp}.\n` : 'Own completed upstream usage sample unavailable.\n';
  preamble += `UNCALIBRATED effective native cutoff/live count; declared window=${metric.declared_window ?? 'unknown'}; save trigger=${metric.compact_policy?.save_at ?? 'unknown'} (${metric.compact_policy?.basis ?? 'cadence fallback'}).\n`;
  preamble += coverageNotice(metric);
  if (metric.compact_policy?.error) preamble += metric.compact_policy.error + '\n';
  if (state.binding.child && !state.binding.parent) preamble += 'Immediate parent unresolved; no parent files included.\n';
  const files = visibleNotes(state.actor, state.binding.parent).map(n => ({ ...n, read: () => { try { return readNote(n.actor, n.id, n.actor !== state.actor); } catch (error) { return '[agent-state] DEGRADED: guide unreadable; original retained. ' + utf8Prefix(error.message, 300); } } }));
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
    let reader;
    try { reader = scan(state); state.telemetryError = null; }
    catch (error) {
      // Telemetry is optional to guide delivery. Persist invalidation instead
      // of rolling it back on every hook, and never use a stale exact sample.
      state.reader = null; state.epoch = null; state.proxyWarned = false; state.saveTriggerKey = null;
      state.telemetryError = utf8Prefix(error.message, 800);
      reader = {};
    }
    const advisory = state.telemetryError ? hookFailure(event, new Error('telemetry unavailable: ' + state.telemetryError)) : {};
    if (event === 'PreCompact') {
      // No separate recovery index and no compulsory model-authored anchor.
      checkpoint(id);
      for (const n of visibleNotes(id, binding.parent)) readNote(n.actor, n.id, n.actor !== id);
      return advisory;
    }
    if (event === 'PostCompact') { state.epoch = { cut: binding.size, deliveryFloor: null, rootDelivered: false }; state.tools = 0; state.proxyWarned = false; return advisory; }
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
    // Subagent completion never forces another inference, including after compact.
    return advisory;
  });
}
export function hookFailure(event, error) {
  const reason = '[agent-state] DEGRADED: ' + utf8Prefix(error?.message || String(error), 800) + '. Original records retained. Continue the task; guide recovery is unavailable for this event.';
  if (['PreCompact', 'SubagentStop'].includes(event)) return { systemMessage: reason };
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
