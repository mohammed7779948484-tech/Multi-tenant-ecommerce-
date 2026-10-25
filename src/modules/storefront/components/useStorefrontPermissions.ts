"use client"
import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasFeature } from '@open-mercato/shared/security/features'

const CHECKED_FEATURES = ['storefront.brand.manage', 'storefront.pages.manage', 'storefront.pages.publish'] as const

export type StorefrontPermissions = {
  /** False until the check has answered; actions stay hidden meanwhile. */
  loaded: boolean
  canManageBrand: boolean
  canManagePages: boolean
  canPublishPages: boolean
}

type FeatureCheckResponse = { ok: boolean; granted?: string[] }

const DENIED: StorefrontPermissions = { loaded: false, canManageBrand: false, canManagePages: false, canPublishPages: false }

/**
 * Which storefront actions to show. The server resolves wildcard grants
 * (`storefront.*`) and answers with the concrete features granted; route
 * metadata and commands stay authoritative, this only hides what would fail.
 */
export function useStorefrontPermissions(): StorefrontPermissions {
  const [permissions, setPermissions] = React.useState<StorefrontPermissions>(DENIED)
  React.useEffect(() => {
    let cancelled = false
    void apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: CHECKED_FEATURES }),
    })
      .then((res) => {
        if (cancelled) return
        const granted = res.ok && Array.isArray(res.result?.granted) ? res.result.granted : []
        setPermissions({
          loaded: true,
          canManageBrand: hasFeature(granted, 'storefront.brand.manage'),
          canManagePages: hasFeature(granted, 'storefront.pages.manage'),
          canPublishPages: hasFeature(granted, 'storefront.pages.publish'),
        })
      })
      .catch(() => {
        if (!cancelled) setPermissions({ ...DENIED, loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [])
  return permissions
}
