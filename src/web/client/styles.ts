/**
 * The Panel's inline styles: the frame, its plugin-owned overlays, and the
 * cards shown where the Panel must speak. They use DSH's theme variables so
 * the plugin's own copy matches the surrounding shell; the Embedded App keeps
 * its own appearance inside the frame.
 */
import type { CSSProperties } from 'react'

/** The Embedded App's frame: it owns the whole box. */
export const PANEL_STYLE: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  margin: 0,
  padding: 0,
  border: 0,
  display: 'block',
  background: '#f1f1f3',
}

/** One full-pane state card, centered. */
export const STATE_STYLE: CSSProperties = {
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'inherit',
  fontSize: '13px',
  lineHeight: '1.6',
}

/** The state card's column width. */
export const CARD_STYLE: CSSProperties = { maxWidth: '420px' }

/** A state card's heading. */
export const HEADING_STYLE: CSSProperties = {
  margin: '0 0 8px',
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
}

/** A state card's body copy. */
export const COPY_STYLE: CSSProperties = {
  margin: '0 0 8px',
  color: 'var(--dsw-alias-label-secondary)',
}

/** A path or filename inside copy. */
export const CODE_STYLE: CSSProperties = {
  padding: '1px 5px',
  borderRadius: '4px',
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '12px',
  wordBreak: 'break-all',
}

/** A release link. */
export const LINK_STYLE: CSSProperties = { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'none' }

/** One action button. */
export const BUTTON_STYLE: CSSProperties = {
  marginTop: '4px',
  padding: '5px 12px',
  borderRadius: '6px',
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  cursor: 'pointer',
}

/** The frame and its plugin-owned overlays share one positioning box. */
export const FRAME_WRAP_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 0,
  margin: 0,
  padding: 0,
  overflow: 'hidden',
}

/** The dimmed backdrop a dialog sits on. */
export const OVERLAY_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  background: 'rgba(10, 12, 16, 0.38)',
}

/** The Revision Guard dialog itself. */
export const DIALOG_STYLE: CSSProperties = {
  maxWidth: '420px',
  boxSizing: 'border-box',
  padding: '18px 20px',
  borderRadius: '10px',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.28)',
}

/** A dialog's action row. */
export const BUTTON_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  marginTop: '12px',
}

/** A failed-save message that keeps the frame on screen. */
export const BANNER_STYLE: CSSProperties = {
  position: 'absolute',
  left: '12px',
  right: '12px',
  bottom: '12px',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '10px 12px',
  borderRadius: '8px',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.2)',
  fontSize: '12px',
}

/** The Standalone Mode pill over the frame. */
export const NOTICE_STYLE: CSSProperties = {
  position: 'absolute',
  top: '12px',
  left: '12px',
  padding: '4px 10px',
  borderRadius: '999px',
  background: 'rgba(25, 25, 28, 0.72)',
  color: '#f5f5f7',
  fontSize: '11px',
  lineHeight: '1.5',
  pointerEvents: 'none',
}
