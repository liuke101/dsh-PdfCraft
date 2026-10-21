import { type RouteHandler } from './http.js';
/** The JSON readiness report the Panel asks for before it mounts the frame. */
export interface WebBuildStatus {
    readonly ready: boolean;
    readonly reason: 'not-configured' | 'missing-build' | 'not-a-directory' | 'missing-index' | 'ready';
    readonly directory: string;
    readonly file: string;
    readonly release: string;
    readonly releaseUrl: string;
    readonly appPath: string;
}
/** The readiness report for one configured directory. */
export declare function inspectWebBuild(webBuildDir: string): Promise<WebBuildStatus>;
/**
 * Build the route handler that answers the Panel's readiness question.
 * @param webBuildDir - the configured directory holding the web build.
 */
export declare function createStatusHandler(webBuildDir: string): RouteHandler;
/**
 * Build the route handler that serves the Embedded App and its assets.
 * @param webBuildDir - the configured directory holding the web build.
 */
export declare function createAssetHandler(webBuildDir: string): RouteHandler;
