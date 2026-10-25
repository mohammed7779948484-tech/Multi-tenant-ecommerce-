import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'
import { STOREFRONT_BLOCKS } from '../../lib/blocks/catalog'

/**
 * json-render catalog for the admin builder (spec P2-Q8): the page root plus
 * every storefront block, with each block's own strict Zod schema and
 * description. Admin-only — imported solely under `components/builder/**`, so
 * json-render never reaches a public route (P2-Q12, TEST-012).
 */
export const PAGE_ROOT_PROPS_SCHEMA = z.object({}).strict()

export const builderCatalog = defineCatalog(schema, {
  components: {
    Page: {
      props: PAGE_ROOT_PROPS_SCHEMA,
      slots: ['default'],
      description: 'The page itself: an ordered list of sections.',
    },
    ...STOREFRONT_BLOCKS,
  },
  actions: {},
})

export type BuilderCatalog = typeof builderCatalog
