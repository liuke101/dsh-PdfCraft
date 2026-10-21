/**
 * The slice of the harness host context this component is written against.
 *
 * The plugin is loaded into a Cordis fiber, but the facilities it uses are few
 * and stable: the Web server's route table, the Session store, the command and
 * tool registries, the effect scope that owns every registration, and the
 * logger. Describing them structurally keeps the plugin usable from a plain
 * recording object in the suite without pulling the whole harness type graph,
 * which lives in packages this bundle does not install, into the build.
 *
 * The MCP bridge's own `Config` and `ToolDefinition` types are imported from
 * the packages this bundle does depend on, so a wrong field or tool shape is
 * still caught here.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { RouteHandler } from './http.js';
/** Releases one registration; the effect scope calls it on unload. */
export type Disposer = () => unknown;
/** The host logger's one level this component writes. */
export interface HostLogger {
    warn?(message: string): void;
}
/** The part of `SessionHeader` the Panel and the engines read. */
export interface SessionHeader {
    readonly id?: string;
    readonly cwd?: string;
}
/** One conversation, as far as this bundle looks at it. */
export interface SessionLike {
    readonly id?: string;
    readonly header?: SessionHeader;
}
/** The Session store the Workspace Document routes resolve a workspace through. */
export interface SessionStore {
    get(id: string): SessionLike | null | undefined;
}
/** One route in the Web server's table. */
export interface WebServerRoute {
    readonly kind: 'exact' | 'prefix';
    readonly path: string;
    readonly handler: RouteHandler;
}
/** The Web server's registration surface. */
export interface WebServer {
    register(route: WebServerRoute): Disposer;
}
/**
 * A mounted child plugin. A fiber is awaitable while it starts, so the bridge
 * mount can wait for it before recording the engine.
 */
export interface FiberLike extends PromiseLike<unknown> {
    dispose(): unknown;
}
/**
 * The event bus on an Agent's own scoped context.
 *
 * Event payloads are untyped in Cordis, so the listener stays loosely typed
 * here; each listener in `agent-tools.ts` narrows its own payload.
 */
export interface AgentScope {
    on?(event: string, listener: (payload: any) => unknown): unknown;
    plugin(plugin: unknown, config?: unknown): FiberLike;
}
/** One live Agent, as the engine lifecycle sees it. */
export interface AgentLike {
    readonly id: string;
    readonly ctx: AgentScope;
    readonly session?: SessionLike;
}
/** One dispatch of a slash command. */
export interface CommandInput {
    readonly agent?: AgentLike;
    readonly rawInput: string;
}
/** One slash command's answer. */
export interface CommandResult {
    readonly kind: 'success' | 'error';
    readonly text: string;
}
/** One registered slash command. */
export interface CommandDefinition {
    readonly name: string;
    readonly description: string;
    readonly input: {
        readonly hint: string;
    };
    handler(input: CommandInput): CommandResult;
}
/** The command registry's registration surface. */
export interface CommandRegistry {
    register(definition: CommandDefinition): Disposer;
}
/** The tool registry's registration surface. */
export interface ToolRegistry {
    register(definition: ToolDefinition): Disposer;
}
/**
 * The host context this component activates in.
 *
 * `get` and `provide` are the Cordis service registry. `effect` owns every
 * registration: the router, the streams, and the engines all disappear when
 * the plugin's fiber is disposed.
 */
export interface HostContext {
    readonly webServer: WebServer;
    readonly sessions?: SessionStore;
    readonly commands?: CommandRegistry;
    readonly tools?: ToolRegistry;
    readonly logger?: HostLogger;
    effect(body: () => Disposer | void, label?: string): Disposer;
    get?(name: string): unknown;
    provide?(name: string, value: unknown): Disposer;
    on?(event: string, listener: (payload: any) => unknown): unknown;
}
