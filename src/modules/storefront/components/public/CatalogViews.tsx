import * as React from 'react'
import type { ImageRef } from '../../lib/blocks/schemas'
import { publicMediaResolver } from '../../lib/mediaUrls'
import type { ProductCard } from '../../lib/sectionDataTypes'
import { ProductCardItem } from './blocks'
import { StorefrontFrame, StorefrontJsonLd, type StorefrontViewProps } from './StorefrontView'

/**
 * Product and collection pages (spec P3-Q4). Server components inside the
 * store frame; no client JavaScript. Every value here was read from the store's
 * own tenant and organization and is rendered as text.
 */

type FrameProps = Pick<StorefrontViewProps, 'siteId' | 'siteSlug' | 'storeName' | 'basePath' | 'logoSrc' | 'tokens' | 'labels' | 'shell' | 'head'>

export type ProductPageProps = FrameProps & {
  product: { title: string; subtitle: string | null; description: string | null; price: string | null; images: ImageRef[] }
  back: { href: string; label: string } | null
}

export function ProductPageView(props: ProductPageProps) {
  const media = publicMediaResolver(props.siteSlug)
  const [cover, ...rest] = props.product.images
  return (
    <>
      <StorefrontJsonLd data={props.head.jsonLd} />
      <StorefrontFrame {...props}>
        <section className="sf-section">
          <div className="sf-container sf-split" data-position="start">
            <div className="sf-media">
              {cover ? (
                // Served by the store's media route, which re-checks that the product is public.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media.src(cover.attachmentId, 960)} srcSet={media.srcSet(cover.attachmentId)} sizes="(min-width: 48rem) 50vw, 100vw" alt={cover.alt} decoding="async" />
              ) : (
                <span className="sf-product-image sf-placeholder" aria-hidden="true" />
              )}
              {rest.length ? (
                <ul className="sf-gallery sf-thumbs" role="list">
                  {rest.map((image) => (
                    <li key={image.attachmentId}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={media.src(image.attachmentId, 320)} alt={image.alt} loading="lazy" decoding="async" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="sf-split-text">
              {props.back ? (
                <a className="sf-back" href={props.back.href}>
                  {props.back.label}
                </a>
              ) : null}
              <h1 className="sf-product-heading">{props.product.title}</h1>
              {props.product.subtitle ? <p>{props.product.subtitle}</p> : null}
              {props.product.price ? <p className="sf-price sf-price-lg">{props.product.price}</p> : null}
              {props.product.description ? <p className="sf-pre-line">{props.product.description}</p> : null}
            </div>
          </div>
        </section>
      </StorefrontFrame>
    </>
  )
}

export type CollectionPageProps = FrameProps & {
  category: { name: string; description: string | null }
  products: ProductCard[]
  pagination: { page: number; pageCount: number; previousHref: string | null; nextHref: string | null; label: string; status: string; previous: string; next: string }
  emptyLabel: string
}

export function CollectionPageView(props: CollectionPageProps) {
  const media = publicMediaResolver(props.siteSlug)
  const { pagination } = props
  return (
    <>
      <StorefrontJsonLd data={props.head.jsonLd} />
      <StorefrontFrame {...props}>
        <section className="sf-section">
          <div className="sf-container">
            <h1 className="sf-section-title">{props.category.name}</h1>
            {props.category.description ? <p className="sf-pre-line sf-lead">{props.category.description}</p> : null}
            {props.products.length ? (
              <ul className="sf-products" role="list">
                {props.products.map((product) => (
                  <ProductCardItem key={product.id} product={product} media={media} showPrice />
                ))}
              </ul>
            ) : (
              <p className="sf-empty">{props.emptyLabel}</p>
            )}
            {pagination.pageCount > 1 ? (
              <nav className="sf-pagination" aria-label={pagination.label}>
                {pagination.previousHref ? (
                  <a href={pagination.previousHref} rel="prev">
                    {pagination.previous}
                  </a>
                ) : (
                  <span />
                )}
                <span>{pagination.status}</span>
                {pagination.nextHref ? (
                  <a href={pagination.nextHref} rel="next">
                    {pagination.next}
                  </a>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </div>
        </section>
      </StorefrontFrame>
    </>
  )
}
