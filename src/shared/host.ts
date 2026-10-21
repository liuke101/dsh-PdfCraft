/**
 * The slice of the harness host context both components are written against.
 *
 * The bundle is loaded into a Cordis fiber, but the facilities it uses are few
 * and stable: the effect scope that owns every registration, the logger, and
 * the service registry. Describing them structurally keeps the components
 * usable from a plain recording object in the suite without pulling the whole
 * harness type graph, which lives in packages this bundle does not install,
 * into the build.
 *
 * Types shared by the two entries live here so neither component imports the
 * other: the Web Component serves the Panel, the CLI Component runs the
 * engines, and the only thing they have in common is the host they activate in.
 */

/** Releases one registration; the effect scope calls it on unload. */
export type Disposer = () => unknown

/** The host logger's one level these components write. */
export interface HostLogger {
  warn?(message: string): void
}

/** The part of `SessionHeader` the Panel and the engines read. */
export interface SessionHeader {
  readonly id?: string
  readonly cwd?: string
}

/** One conversation, as far as this bundle looks at it. */
export interface SessionLike {
  readonly id?: string
  readonly header?: SessionHeader
}

/**
 * A mounted child plugin. A fiber is awaitable while it starts, so the bridge
 * mount can wait for it before recording the engine.
 */
export interface FiberLike extends PromiseLike<unknown> {
  dispose(): unknown
}

/**
 * The event bus on an Agent's own scoped context.
 *
 * Event payloads are untyped in Cordis, so the listener stays loosely typed
 * here; each listener in `agent-tools.ts` narrows its own payload.
 */
export interface AgentScope {
  on?(event: string, listener: (payload: any) => unknown): unknown
  plugin(plugin: unknown, config?: unknown): FiberLike
}

/** One live Agent, as the engine lifecycle and the open entries see it. */
export interface AgentLike {
  readonly id: string
  readonly ctx: AgentScope
  readonly session?: SessionLike
  /** The Agent's current lifecycle state; an activation-time adoption reads it. */
  readonly status?: string
}

/**
 * The facilities every component uses.
 *
 * `get` and `provide` are the Cordis service registry. `effect` owns every
 * registration: the routes, the streams, and the engines all disappear when
 * the component's fiber is disposed.
 */
export interface ComponentContext {
  readonly logger?: HostLogger
  effect(body: () => Disposer | void, label?: string): Disposer
  get?(name: string): unknown
  provide?(name: string, value: unknown): Disposer
}
