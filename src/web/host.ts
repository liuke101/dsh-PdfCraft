/**
 * The slice of the harness host context the Web Component is written against.
 *
 * The component is loaded into a Cordis fiber, but the facilities it uses are
 * few and stable: the Web server's route table, the Session store, the command
 * and tool registries, the effect scope that owns every registration, and the
 * logger. Describing them structurally keeps the component usable from a plain
 * recording object in the suite without pulling the whole harness type graph,
 * which lives in packages this bundle does not install, into the build.
 *
 * The types the two component entries share — the effect scope, the logger, a
 * conversation, and an Agent — come from `src/shared/host.ts`; this module adds
 * only the Panel's own facilities. The engines are the CLI Component's job and
 * this context deliberately omits agent lifecycle events.
 *
 * The tool registry's `ToolDefinition` type is imported from the package this
 * bundle depends on, so a wrong tool shape is still caught here.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import type { AgentLike, ComponentContext, Disposer, SessionLike } from '../shared/host.ts'
import type { RouteHandler } from './http.ts'

export type { AgentLike, Disposer, SessionLike } from '../shared/host.ts'

/** The Session store the Workspace Document routes resolve a workspace through. */
export interface SessionStore {
  get(id: string): SessionLike | null | undefined
}

/** One route in the Web server's table. */
export interface WebServerRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: RouteHandler
}

/** The Web server's registration surface. */
export interface WebServer {
  register(route: WebServerRoute): Disposer
}

/** One dispatch of a slash command. */
export interface CommandInput {
  readonly agent?: AgentLike
  readonly rawInput: string
}

/** One slash command's answer. */
export interface CommandResult {
  readonly kind: 'success' | 'error'
  readonly text: string
}

/** One registered slash command. */
export interface CommandDefinition {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  handler(input: CommandInput): CommandResult
}

/** The command registry's registration surface. */
export interface CommandRegistry {
  register(definition: CommandDefinition): Disposer
}

/** The tool registry's registration surface. */
export interface ToolRegistry {
  register(definition: ToolDefinition): Disposer
}

/**
 * The host context this component activates in.
 *
 * The Web server is required: a Host without it has nothing to serve. The
 * Session store resolves each conversation's workspace root. The command and
 * tool registries are optional because another plugin may not be composed.
 */
export interface HostContext extends ComponentContext {
  readonly webServer: WebServer
  readonly sessions?: SessionStore
  readonly commands?: CommandRegistry
  readonly tools?: ToolRegistry
}
