"use client"

import * as React from "react"

/**
 * Where portalled shadcn components (sheet, and later dialog, popover, select)
 * mount. Without a provider they portal into `<body>`, as shadcn does by
 * default. A store page provides an element inside its themed, right-to-left
 * root, so overlays inherit the merchant's theme variables and direction.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null)

export function PortalContainerProvider({ container, children }: { container: HTMLElement | null; children: React.ReactNode }) {
  return <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
}

/** The provided container, or `undefined` so Radix falls back to `<body>`. */
export function usePortalContainer(): HTMLElement | undefined {
  return React.useContext(PortalContainerContext) ?? undefined
}
