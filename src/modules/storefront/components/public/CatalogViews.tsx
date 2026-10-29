import * as React from 'react'
import { ProductGallery } from '@/components/ecomcn/product-gallery'
import type { ImageRef } from '../../lib/blocks/schemas'
import { publicMediaResolver } from '../../lib/mediaUrls'
import type { PurchaseModel } from '../../lib/shopProduct'
import { ProductPurchasePanel } from '../shop/ProductPurchasePanel'
import { StorefrontFrame, StorefrontJsonLd, type StorefrontViewProps } from './StorefrontView'

/**
 * Product page (spec P3-Q4, shopping-journey REQ-005; collection pages live in
 * `shop/ShopListingViews`). The ecomcn gallery and the buy panel are client
 * islands; every value was read from the store's own tenant and organization
 * and is rendered as text.
 */

type FrameProps = Pick<StorefrontViewProps, 'siteId' | 'siteSlug' | 'storeName' | 'basePath' | 'logoSrc' | 'tokens' | 'labels' | 'shell' | 'head'>

export type ProductPageProps = FrameProps & {
  product: { title: string; subtitle: string | null; description: string | null; images: ImageRef[] }
  /** What the buyer can choose and buy; `null` in contexts without a cart. */
  purchase: PurchaseModel | null
  back: { href: string; label: string } | null
}

export function ProductPageView(props: ProductPageProps) {
  const media = publicMediaResolver(props.siteSlug)
  const images = props.product.images.map((image) => ({
    // Served by the store's media route, which re-checks that the product is public.
    src: media.src(image.attachmentId, 960),
    srcSet: media.srcSet(image.attachmentId),
    zoomSrc: media.src(image.attachmentId, 1920),
    thumbSrc: media.src(image.attachmentId, 320),
    alt: image.alt,
  }))
  return (
    <>
      <StorefrontJsonLd data={props.head.jsonLd} />
      <StorefrontFrame {...props}>
        <section className="sf-section">
          <div className="sf-container sf-split" data-position="start">
            <div className="sf-product-gallery">
              {images.length ? (
                <ProductGallery images={images} label={props.product.title} sizes="(min-width: 48rem) 50vw, 100vw" />
              ) : (
                <span className="sf-product-image sf-placeholder" aria-hidden="true" />
              )}
            </div>
            <div className="sf-split-text">
              {props.back ? (
                <a className="sf-back" href={props.back.href}>
                  {props.back.label}
                </a>
              ) : null}
              <h1 className="sf-product-heading">{props.product.title}</h1>
              {props.product.subtitle ? <p>{props.product.subtitle}</p> : null}
              {props.purchase ? <ProductPurchasePanel title={props.product.title} model={props.purchase} /> : null}
              {props.product.description ? <p className="sf-pre-line">{props.product.description}</p> : null}
            </div>
          </div>
        </section>
      </StorefrontFrame>
    </>
  )
}
