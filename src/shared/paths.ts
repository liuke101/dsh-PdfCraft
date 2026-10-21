/**
 * Public addresses of the Panel's HTTP surface and the upstream release pin,
 * as one module so the host half and the browser half name the same values.
 *
 * `npm run build` compiles this file into both outputs: the compiled host
 * imports `dist/shared/paths.js`, and the browser bundle inlines
 * `dist/web/client.js`, so neither half keeps a hand-copied address.
 */

/** Loader row id and package name of this bundle. */
export const PLUGIN_NAME = 'dsh-pdfcraft'

/** Prefix under the profile's own origin that serves the Embedded App. */
export const ASSET_PREFIX = '/pdfcraft'

/** The Embedded App's document; relative asset URLs inside it resolve below the prefix. */
export const APP_PATH = '/pdfcraft/'

/** JSON readiness report the Panel asks for before it mounts the frame. */
export const STATUS_PATH = '/pdfcraft/status'

/** PdfCraft release the web build is pinned to. */
export const WEB_RELEASE = '0.9.0'

/** The release asset the person downloads and extracts. */
export const WEB_BUILD_FILENAME = `pdfcraft-web-${WEB_RELEASE}.zip`

/** Where that asset is published. */
export const WEB_RELEASE_URL = `https://github.com/storytold/pdfcraft/releases/tag/v${WEB_RELEASE}`

/** Which Workspace Document the conversation is bound to (or Standalone Mode). */
export const BINDING_PATH = '/pdfcraft/binding'

/** The Workspace Document's bytes (GET) and its Write-back (POST). */
export const DOCUMENT_PATH = '/pdfcraft/document'

/** The Push Channel: a Server-Sent Events stream of Panel open requests. */
export const PUSHES_PATH = '/pdfcraft/pushes'

/** Response header carrying the revision the Panel must quote on a Write-back. */
export const REVISION_HEADER = 'x-pdfcraft-revision'

/** Request header carrying the person's explicit overwrite-anyway choice. */
export const FORCE_HEADER = 'x-pdfcraft-force'
