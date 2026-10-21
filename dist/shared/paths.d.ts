/**
 * Public addresses of the Panel's HTTP surface, as one module so the host half,
 * its tests, and any future caller name the same paths.
 *
 * This file is the host's one source of the constants. `npm run build`
 * compiles it to the committed `dist/shared/paths.js`, which the host imports.
 * The browser half is still a self-contained classic script (ADR-0002), so
 * `client.js` repeats the addresses it calls (`APP_PATH`, `STATUS_PATH`,
 * `BINDING_PATH`, `DOCUMENT_PATH`, `PUSHES_PATH`) and the release pin and
 * web-build filename it falls back to; the follow-up browser build removes
 * that mirror. Until then, keep the two copies in step.
 */
/** Loader row id and package name of this bundle. */
export declare const PLUGIN_NAME = "dsh-pdfcraft";
/** Prefix under the profile's own origin that serves the Embedded App. */
export declare const ASSET_PREFIX = "/pdfcraft";
/** The Embedded App's document; relative asset URLs inside it resolve below the prefix. */
export declare const APP_PATH = "/pdfcraft/";
/** JSON readiness report the Panel asks for before it mounts the frame. */
export declare const STATUS_PATH = "/pdfcraft/status";
/** PdfCraft release the web build is pinned to. */
export declare const WEB_RELEASE = "0.9.0";
/** The release asset the person downloads and extracts. */
export declare const WEB_BUILD_FILENAME = "pdfcraft-web-0.9.0.zip";
/** Where that asset is published. */
export declare const WEB_RELEASE_URL = "https://github.com/storytold/pdfcraft/releases/tag/v0.9.0";
/** Which Workspace Document the conversation is bound to (or Standalone Mode). */
export declare const BINDING_PATH = "/pdfcraft/binding";
/** The Workspace Document's bytes (GET) and its Write-back (POST). */
export declare const DOCUMENT_PATH = "/pdfcraft/document";
/** The Push Channel: a Server-Sent Events stream of Panel open requests. */
export declare const PUSHES_PATH = "/pdfcraft/pushes";
/** Response header carrying the revision the Panel must quote on a Write-back. */
export declare const REVISION_HEADER = "x-pdfcraft-revision";
