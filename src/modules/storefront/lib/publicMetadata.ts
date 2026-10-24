import type { Metadata } from 'next'
import type { StorefrontHeadData } from '../components/public/StorefrontView'

/**
 * Next metadata for a store page: one title, description, canonical URL and
 * Open Graph/Twitter set. Values are plain strings that Next escapes as
 * attribute text; nothing merchant-typed becomes markup.
 */
export function buildStorefrontMetadata(head: StorefrontHeadData): Metadata {
  return {
    title: { absolute: head.title },
    description: head.description ?? undefined,
    alternates: { canonical: head.canonicalUrl },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      title: head.title,
      description: head.description ?? undefined,
      url: head.canonicalUrl,
      siteName: head.siteName,
      locale: head.locale,
      images: head.imageUrl ? [{ url: head.imageUrl }] : undefined,
    },
    twitter: { card: 'summary', title: head.title, description: head.description ?? undefined },
  }
}

/** Metadata for the neutral "unavailable" page: never indexed. */
export function buildUnavailableMetadata(title: string): Metadata {
  return { title: { absolute: title }, robots: { index: false, follow: false } }
}
