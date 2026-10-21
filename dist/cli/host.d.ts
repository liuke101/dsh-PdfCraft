/**
 * The slice of the harness host context the CLI Component is written against.
 *
 * The component is loaded into a Cordis fiber, and it needs four things: the
 * effect scope that owns every engine and listener, the host event bus that
 * reports Agents coming and going, the live-agent registry that lets a fresh
 * activation adopt conversations that were already open, and the logger. It
 * does not need the Web server, the Session store, or the command and tool
 * registries — those belong to the Web Component's Panel — so this context
 * omits them and the suite can activate the engines with a plain recording
 * object.
 *
 * The types the two component entries share — the effect scope, the logger, a
 * conversation, and an Agent — come from `src/shared/host.ts`.
 */
import type { AgentLike, ComponentContext } from '../shared/host.js';
export type { AgentLike, Disposer } from '../shared/host.js';
/** The live-agent registry the harness publishes as `agents`. */
export interface AgentRegistry {
    /** Every live Agent, in registration order. */
    list(): AgentLike[];
}
/**
 * The host context this component activates in.
 *
 * Agent lifecycle events are dispatched on the host context and, for a
 * subagent, on that Agent's own scoped context; the engines listen to both.
 */
export interface HostContext extends ComponentContext {
    readonly agents?: AgentRegistry;
    on?(event: string, listener: (payload: any) => unknown): unknown;
}
