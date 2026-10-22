"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'

/**
 * Leave protection for the builder's unsaved draft, mirroring CrudForm's guard
 * (which is internal to CrudForm): closing or reloading the tab, clicking an
 * in-app link (back link, breadcrumbs, sidebar) and the browser Back button all
 * ask first. `confirmLeave` shows the shared confirmation dialog.
 */
export function useUnsavedChangesGuard(dirty: boolean, confirmLeave: () => Promise<boolean>): void {
  const router = useRouter()
  const confirmRef = React.useRef(confirmLeave)
  confirmRef.current = confirmLeave

  React.useEffect(() => {
    if (!dirty) return
    let pending = false
    let rollingBack = false

    const ask = async (): Promise<boolean> => {
      if (pending) return false
      pending = true
      try {
        return await confirmRef.current()
      } finally {
        pending = false
      }
    }

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
        if (leave) {
          window.removeEventListener('beforeunload', onBeforeUnload)
          router.push(target)
        }
      })
    }

    const onPopState = () => {
      if (rollingBack) {
        rollingBack = false
        return
      }
      // Undo the Back step, then leave only after the user confirms.
      rollingBack = true
      window.history.go(1)
      void ask().then((leave) => {
        if (!leave) return
        cleanup()
        window.history.back()
      })
    }

    const cleanup = () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState)
    return cleanup
  }, [dirty, router])
}
