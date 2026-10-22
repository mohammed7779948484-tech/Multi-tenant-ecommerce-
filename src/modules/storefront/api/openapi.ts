import { z } from 'zod'
import { createCrudOpenApiFactory, createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'

/** Shared OpenAPI pieces for storefront routes. */
export const storefrontTag = 'Storefront'

export const storefrontErrorSchema = z.object({
  error: z.string(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
})


export const buildStorefrontCrudOpenApi = createCrudOpenApiFactory({ defaultTag: storefrontTag })

export const pageSpecIssueSchema = z.object({ path: z.string(), code: z.string(), message: z.string() })

export const pageListItemSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  seoDescription: z.string().nullable(),
  status: z.enum(['draft', 'published', 'changed']),
  isHome: z.boolean(),
  publicPath: z.string().nullable(),
  publishedAt: z.string().nullable(),
  publishedRevisionNo: z.number().nullable(),
  draftUpdatedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  draftSpec: z.record(z.string(), z.unknown()).nullable().optional(),
  publishedSpec: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const pageListResponseSchema = createPagedListResponseSchema(pageListItemSchema)

export const publishResultSchema = z.object({
  pageId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revisionNo: z.number(),
  publishedAt: z.string(),
  updatedAt: z.string(),
})
