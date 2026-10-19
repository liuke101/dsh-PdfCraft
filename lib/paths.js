/**
 * Public addresses of the Panel's HTTP surface, as one module so the host half,
 * its tests, and any future caller name the same paths.
 *
 * The browser half is a self-contained classic script, so it repeats the
 * addresses it calls (`APP_PATH`, `STATUS_PATH`, `BINDING_PATH`, `DOCUMENT_PATH`)
 * and the pinned release and web-build filename it falls back to; keep them in sync.
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

/** Response header carrying the revision the Panel must quote on a Write-back. */
export const REVISION_HEADER = 'x-pdfcraft-revision'
