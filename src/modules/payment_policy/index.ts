import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

/**
 * Platform payment policy (docs/DECISIONS.md P4): Suqna integrates no external
 * payment gateway. Every new tenant keeps only manual methods (cash on delivery,
 * bank transfer); gateway methods seeded by `sales` are deactivated.
 */
export const metadata: ModuleInfo = {
  name: 'payment_policy',
  title: 'Payment policy',
  version: '0.1.0',
  description: 'Deactivates gateway payment methods (e.g. the seeded Stripe card method) for every tenant.',
  author: 'Suqna',
  license: 'Proprietary',
  // Seeding runs in dependency order: the sales defaults must exist before this policy applies.
  requires: ['sales'],
}
