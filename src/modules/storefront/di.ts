import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerShippingProvider } from '@open-mercato/core/modules/sales/lib/providers/index'
import { yemenZonesProvider } from './lib/yemenZones'

/**
 * Registers the Yemen delivery-zone shipping provider with the sales provider
 * registry (shopping-journey spec S-8). The registry is process-wide and
 * keyed, so registering again (one call per request container) replaces the
 * same entry.
 */
export function register(_container: AppContainer) {
  registerShippingProvider(yemenZonesProvider)
}
