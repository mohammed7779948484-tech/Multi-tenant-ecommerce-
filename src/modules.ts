// Central place to enable modules and their source.
// - id: module id (plural snake_case; special cases: 'auth')
// - from: '@open-mercato/core' | '@app' | custom alias/path in future
// - overrides: optional unified per-app override surface — replace or
//   disable any contract a module presents: AI, routes, events, workers,
//   widgets, notifications, interceptors, setup, ACL, DI, encryption, etc.
//   See `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md` and
//   `apps/docs/docs/framework/modules/overrides.mdx`.
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { ModuleOverrides } from '@open-mercato/shared/modules/overrides'
import { officialModuleEntries } from './official-modules.generated'

export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
  overrides?: ModuleOverrides
}

/**
 * Copyable examples for every wired `entry.overrides` domain.
 *
 * This object is intentionally not assigned to any enabled module. Use it as
 * a reference when a downstream app needs to disable or replace contracts
 * from a package-backed module without editing that module's source.
 */
export const moduleOverrideExamples: ModuleOverrides = {
  ai: {
    agents: { 'catalog.catalog_assistant': null },
    tools: { inbox_ops_accept_action: null },
    extensions: [], // additive AiAgentExtension[]; do not use null-map semantics
  },
  routes: {
    api: { 'DELETE /api/example/items': null },
    pages: { '/backend/example/reports': null },
  },
  events: {
    subscribers: { 'example.todo.audit': null },
  },
  workers: { 'example:sync': null },
  widgets: {
    injection: { 'example.sidebar': null },
    components: { 'page:/backend/example': null },
    dashboard: { 'example.kpi': null },
  },
  notifications: {
    types: { 'example.notice': null },
    handlers: { 'example.notice.toast': null },
  },
  interceptors: { 'example.items.interceptor': null },
  commandInterceptors: { 'example.command.interceptor': null },
  enrichers: { 'example.items.enricher': null },
  guards: { 'example.backend.guard': null },
  cli: { 'example seed': null },
  setup: {
    seedExamples: false,
  },
  acl: {
    features: { 'example.manage': null },
  },
  di: { exampleService: null },
  encryption: {
    maps: { 'example:item': null },
  },
  nav: {
    // Prepends sidebar nav group ids ahead of the built-in ordering; unnamed groups keep their
    // current position. Applied beneath role and per-user sidebar preferences.
    groupOrder: ['example.nav.group'],
  },
}

export const enabledModules: ModuleEntry[] = [
  // ---------------------------------------------------------------------------
  // Suqna module set. Multi-tenant commerce: every tenant (merchant) gets its own
  // organization tree, staff, catalogue, orders, buyers and storefront domain.
  // Decision record and dependency notes: README.md ("Modules").
  // ---------------------------------------------------------------------------

  // Platform foundation: tenants/organizations, staff auth + RBAC, config, data model
  { id: 'auth', from: '@open-mercato/core' },
  { id: 'directory', from: '@open-mercato/core' },
  { id: 'configs', from: '@open-mercato/core' },
  { id: 'entities', from: '@open-mercato/core' }, // requires query_index
  { id: 'query_index', from: '@open-mercato/core' },
  { id: 'api_keys', from: '@open-mercato/core' }, // requires auth
  { id: 'api_docs', from: '@open-mercato/core' },
  { id: 'audit_logs', from: '@open-mercato/core' },
  { id: 'attachments', from: '@open-mercato/core' }, // product images, bank-transfer receipt uploads
  { id: 'dashboards', from: '@open-mercato/core' },
  { id: 'perspectives', from: '@open-mercato/core' }, // saved data-table views
  { id: 'events', from: '@open-mercato/events' },
  { id: 'progress', from: '@open-mercato/core' }, // required by customers + communication_channels
  { id: 'dictionaries', from: '@open-mercato/core' }, // required by sales
  { id: 'currencies', from: '@open-mercato/core' },
  { id: 'feature_toggles', from: '@open-mercato/core' }, // required by wms

  // Commerce core: catalogue, customers (CRM), orders/quotes/invoices/shipments/payments, inventory.
  // Payments use the sales module's built-in offline providers (cash-on-delivery, wire-transfer);
  // no payment gateway modules are enabled.
  { id: 'catalog', from: '@open-mercato/core' },
  { id: 'customers', from: '@open-mercato/core' }, // requires progress
  { id: 'sales', from: '@open-mercato/core' }, // requires catalog, customers, dictionaries
  { id: 'wms', from: '@open-mercato/core' }, // requires catalog, sales, feature_toggles

  // Buyer accounts, customer portal and per-tenant custom domains (domain mappings live here)
  { id: 'customer_accounts', from: '@open-mercato/core' },
  { id: 'portal', from: '@open-mercato/core' }, // requires customer_accounts

  // Self-service tenant signup (/onboarding) and the legal pages it links to (/terms, /privacy)
  { id: 'onboarding', from: '@open-mercato/onboarding' },
  { id: 'content', from: '@open-mercato/content' },

  // Translations, search, notifications
  { id: 'translations', from: '@open-mercato/core' },
  { id: 'search', from: '@open-mercato/search' },
  { id: 'notifications', from: '@open-mercato/core' },

  // Automation
  { id: 'workflows', from: '@open-mercato/core' },
  { id: 'business_rules', from: '@open-mercato/core' },
  { id: 'scheduler', from: '@open-mercato/scheduler' }, // jobs registered by workflows + customer_accounts (domain checks)

  // Transactional email (signup verification, notifications, buyer emails) goes through the
  // Communications Hub system email transport. communication_channels requires progress and
  // imports the messages entities; channel_resend requires communication_channels + integrations.
  { id: 'messages', from: '@open-mercato/core' },
  { id: 'integrations', from: '@open-mercato/core' },
  { id: 'communication_channels', from: '@open-mercato/core' },
  { id: 'channel_resend', from: '@open-mercato/channel-resend' },

  // Test-only rate-limit probe shipped with the scaffold (framework integration suites call it)
  { id: 'ratelimit_probe', from: '@app' },

  // Deliberately NOT enabled (package installed, module off): payment_gateways, checkout,
  // gateway_stripe (no online gateways); warranty_claims, eudr, planner, resources, staff,
  // phone_calls, tillio, devices, push_notifications, channel_apns/expo/fcm/ses/imap/gmail,
  // inbox_ops, ai_assistant (needs an LLM key), documents, data_sync, sync_excel, sync_akeneo,
  // shipping_carriers, webhooks, telemetry. Enterprise modules are never enabled in this app.
]

// Official modules activated via official-modules.json / official-modules.local.json
// (managed by `yarn official-modules`; backed by the external/official-modules submodule).
for (const entry of officialModuleEntries) {
  if (!enabledModules.some((existing) => existing.id === entry.id)) enabledModules.push(entry)
}

if (enabledModules.some((entry) => entry.id === 'example')) {
  enabledModules.push({ id: 'example_customers_sync', from: '@app' })
}

if (parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)) {
  enabledModules.push({ id: 'storage_s3', from: '@open-mercato/storage-s3' })
}

// Suqna app modules (src/modules/<id>). Appended after the baseline so their
// setup hooks run after the installed modules they build on.
enabledModules.push({ id: 'storefront', from: '@app' })
// Platform payment policy: deactivates gateway payment methods seeded by sales
// (requires sales, so its seedDefaults runs after the sales defaults).
enabledModules.push({ id: 'payment_policy', from: '@app' })
