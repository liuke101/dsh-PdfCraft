/**
 * The Push Channel's HTTP adapter: one Server-Sent Events stream per conversation.
 *
 * `GET /pdfcraft/pushes?session=<id>` attaches a stream for that conversation
 * and flushes any open request that was waiting for it. The policy lives in
 * `panel-opens.ts`; this module only validates the request, writes the SSE
 * framing, and makes sure an unloaded plugin closes the streams it owned.
 *
 * The stream carries `data: {"type":"open","id":...,"sessionId":...,"document":...}`
 * frames. Consume-on-send lives in the channel, so a browser reconnect opens a
 * fresh stream and receives only requests created after the last delivery; a
 * Panel that was already opened is not opened again.
 */
import { type RouteHandler } from './http.js';
import type { PanelOpens } from './panel-opens.js';
/** The Push Channel's route and its teardown. */
export interface PushSurface {
    readonly handler: RouteHandler;
    /** Ends every attached stream; the plugin is going away. */
    close(): void;
}
/**
 * Build the Push Channel route.
 * @param opens - the Push Channel from `createPanelOpens`.
 */
export declare function createPushHandler(opens: PanelOpens): PushSurface;
