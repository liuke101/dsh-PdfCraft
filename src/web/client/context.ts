/**
 * The slice of the DSH client context this browser half is written against.
 *
 * The shell loads one module per package and hands it a Cordis context with
 * the slot registry, the locale service, the right sidebar's controller and
 * tab-type registry, and the optional better-sidebar service. Describing them
 * structurally keeps the component testable with a recording object; the
 * module table's React stays the only runtime dependency.
 */
import type { ComponentType, ReactNode } from 'react'

import type { Dictionary } from './copy.ts'
import type { PanelSeatProps, Translate } from './protocol.ts'

/** One component the Panel publishes into a sidebar seat. */
export type PanelComponent = ComponentType<PanelSeatProps>

/** The locale service's one subscription and one translator. */
export interface LocaleService {
  register(namespace: string, dictionaries: { readonly en: Dictionary; readonly zh: Dictionary }): unknown
  bind(namespace: string): Translate
  subscribe(listener: () => void): () => void
  getSnapshot(): unknown
}

/** One slot registration's options. */
export interface SlotOptions {
  readonly name: string
  readonly key: string
  readonly locale: string
}

/** The slot registry the native right-sidebar seat uses. */
export interface SlotRegistry {
  inject(name: string, callback: () => () => void): () => void
  register(options: SlotOptions, component: PanelComponent): () => void
}

/** One entry of the native right sidebar's `+` guide. */
export interface NativeGuideEntry {
  readonly id: string
  readonly order: number
  readonly title: () => string
  readonly description: () => string
  readonly icon: ComponentType<{ size?: number }>
}

/** One native right-sidebar page type. */
export interface NativeTabDefinition {
  readonly id: string
  readonly kind: string
  readonly priority: 'extension'
  readonly title: () => string
  readonly guide: NativeGuideEntry[]
}

/** The native right sidebar's tab-type registry. */
export interface SidebarRightTabs {
  register(definition: NativeTabDefinition): () => void
}

/** The mounted-conversation snapshot the Push Channel follows. */
export interface MountedSessionSource {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

/** The right sidebar's controller, as far as opening the Panel needs it. */
export interface SidebarRightController {
  readonly mounted?: MountedSessionSource
  openTab(kind: string): void
}

/** One page published through the better-sidebar service. */
export interface BetterSidebarTab {
  readonly id: string
  readonly title: () => string
  readonly description: () => string
  readonly icon: (size?: number) => ReactNode
  readonly order: number
  readonly single: true
  readonly component: PanelComponent
}

/** The better-sidebar service, when the profile has it installed. */
export interface BetterSidebarService {
  registerTab(descriptor: BetterSidebarTab): () => void
}

/** The browser context this component activates in. */
export interface ClientContext {
  readonly locale: LocaleService
  readonly slots: SlotRegistry
  readonly sidebarRightTabs: SidebarRightTabs
  readonly sidebarRight?: SidebarRightController
  get(name: string): unknown
  effect(body: () => (() => void) | undefined, label?: string): () => void
  inject(deps: readonly string[], callback: (scoped: ClientContext) => void): unknown
}
