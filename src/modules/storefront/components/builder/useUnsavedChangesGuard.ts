"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'

/** Marks the duplicate history entry the guard adds while the draft is dirty. */
const SENTINEL_KEY = '__storefrontUnsavedGuard'

type HistoryState = Record<string, unknown> | null

function isSentinel(state: unknown): boolean {
  return Boolean(state && typeof state === 'object' && (state as Record<string, unknown>)[SENTINEL_KEY])
}

/**
 * Leave protection for the builder's unsaved draft, mirroring CrudForm's guard
 * (which is internal to CrudForm): closing or reloading the tab, clicking an
 * in-app link (back link, breadcrumbs, sidebar) and the browser Back button all
 * ask first. `confirmLeave` shows the shared confirmation dialog.
 *
 * Back cannot be cancelled once it happens, and the App Router handles the same
 * `popstate` event. So while the draft is dirty the guard keeps a duplicate of
 * the builder's history entry on top (same URL, the router's own state): Back
 * only steps from the duplicate to the builder entry, which the router treats
 * as the page it already shows, and the builder stays mounted while the dialog
 * is open. Leaving then steps back past the builder entry; staying puts the
 * duplicate back.
 */
export function useUnsavedChangesGuard(dirty: boolean, confirmLeave: () => Promise<boolean>): void {
  const router = useRouter()
  const confirmRef = React.useRef(confirmLeave)
  confirmRef.current = confirmLeave

  React.useEffect(() => {
    if (!dirty) return
    let pending = false
    let leaving = false
    const guardedHref = window.location.href

    const ask = async (): Promise<boolean> => {
      if (pending) return false
      pending = true
      try {
        return await confirmRef.current()
      } finally {
        pending = false
      }
    }

    const pushSentinel = () => {
      // Copying the current state keeps the App Router's own history fields, so it
      // passes the entry through unchanged and restores the same page on Back.
      const state = { ...((window.history.state as HistoryState) ?? {}), [SENTINEL_KEY]: true }
      window.history.pushState(state, '', guardedHref)
    }
    if (!isSentinel(window.history.state)) pushSentinel()

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      const target = `${url.pathname}${url.search}${url.hash}`
      if (target === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
      event.preventDefault()
      event.stopPropagation()
      void ask().then((leave) => {
        if (!leave) return
        leaving = true
        cleanup()
        router.push(target)
      })
    }

    const onPopState = (event: PopStateEvent) => {
      if (leaving) return
      // Forward onto the duplicate again: nothing to ask.
      if (isSentinel(event.state)) return
      // Back moved from the duplicate to the builder's own entry (same URL, page still mounted).
      void ask().then((leave) => {
        if (!leave) {
          pushSentinel()
          return
        }
        leaving = true
        cleanup()
        window.history.back()
      })
    }

    const removeListeners = () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
    }

    const cleanup = () => {
      removeListeners()
      // The draft was saved (or discarded) while staying on the page: drop the
      // duplicate so the next Back is a real one. Never while leaving, and never
      // once the router has moved to another entry.
      if (!leaving && isSentinel(window.history.state) && window.location.href === guardedHref) {
        window.history.back()
      }
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState)
    return cleanup
  }, [dirty, router])
}
