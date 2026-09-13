import { STATE_VERSION } from "./constants.mjs";

export function createActorState(agentId = "main") {
  return {
    agentId,
    inputCounter: 0,
    turnIndex: 0,
    recentEntries: [],
    pendingByRule: {},
    lastFiredByRule: {},
    noticesByRule: {},
    hasStandingContext: false,
  };
}

export function createSessionState() {
  return { version: STATE_VERSION, actorsByKey: { main: createActorState() } };
}

export function ensureActor(state, actorKey, agentId) {
  state.actorsByKey ??= {};
  state.actorsByKey[actorKey] ??= createActorState(agentId);
  return state.actorsByKey[actorKey];
}

export function resetActor(state, actorKey, agentId) {
  const actor = createActorState(agentId);
  state.actorsByKey[actorKey] = actor;
  return actor;
}
