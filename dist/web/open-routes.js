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
import { queryOf, sendJson } from './http.js';
/** The SSE media type; the browser half listens with EventSource. */
const EVENT_STREAM = 'text/event-stream';
/**
 * Build the Push Channel route.
 * @param opens - the Push Channel from `createPanelOpens`.
 */
export function createPushHandler(opens) {
    /** Responses currently holding a stream open; ended when the plugin unloads. */
    const streams = new Set();
    const handler = (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, {
                'content-type': 'text/plain; charset=utf-8',
                'cache-control': 'no-store',
                allow: 'GET, HEAD',
            });
            response.end('method not allowed');
            return;
        }
        const sessionId = queryOf(request).get('session') ?? '';
        if (sessionId === '') {
            sendJson(response, request, 400, {
                code: 'push-channel/bad-request',
                message: 'A Push Channel stream needs the conversation id (session).',
            });
            return;
        }
        if (request.method === 'HEAD') {
            response.writeHead(200, {
                'content-type': EVENT_STREAM,
                'cache-control': 'no-cache, no-transform',
                'x-content-type-options': 'nosniff',
            });
            response.end();
            return;
        }
        response.writeHead(200, {
            'content-type': EVENT_STREAM,
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-content-type-options': 'nosniff',
            // Ask intermediaries not to buffer a stream they would otherwise hold.
            'x-accel-buffering': 'no',
        });
        response.write(': connected\n\n');
        let detached = false;
        let unsubscribe;
        const detach = () => {
            if (detached)
                return;
            detached = true;
            streams.delete(response);
            unsubscribe?.();
        };
        unsubscribe = opens.attach(sessionId, (open) => {
            if (detached)
                return;
            response.write(`data: ${JSON.stringify({ type: 'open', ...open })}\n\n`);
        });
        streams.add(response);
        response.on?.('close', detach);
        response.on?.('error', detach);
    };
    const close = () => {
        for (const response of [...streams]) {
            streams.delete(response);
            try {
                if (response.writableEnded !== true)
                    response.end();
            }
            catch {
                // The socket is already gone; there is nothing left to release.
            }
        }
    };
    return { handler, close };
}
