import * as React from 'react'
import type {
  CallToActionProps,
  ContactInfoProps,
  FaqProps,
  FeaturesProps,
  FooterProps,
  GalleryProps,
  HeroProps,
  ImageProps,
  ImageRef,
  ImageTextProps,
  ProductGridProps,
  CollectionListProps,
  RichTextInline,
  RichTextProps,
  TestimonialsProps,
} from '../../lib/blocks/schemas'
import type { MediaResolver } from '../../lib/mediaUrls'
import type { CategoryCard, ProductCard, SectionData } from '../../lib/sectionDataTypes'

/**
 * SSR-safe block components for public storefront pages. They receive props
 * that already passed the block's strict schema; every merchant string is
 * rendered as a React text node. No `dangerouslySetInnerHTML`, no merchant
 * class names or styles, no client hooks.
 */

export type BlockRenderContext = {
  /** Store base path, e.g. `/acme` on the platform host; `''` on a custom domain. */
  basePath: string
  /** True for the first section on the page: only it renders the page `<h1>`. */
  isFirst: boolean
  media: MediaResolver
  /** Fixed words sections print (translated by the caller); merchant text never comes from here. */
  labels: SectionLabels
  /** Store data a commerce section shows (products, categories), resolved on the server or for the preview. */
  data?: SectionData
}

export type SectionLabels = {
  contactAddress: string
  contactPhone: string
  contactEmail: string
  contactHours: string
  productsEmpty: string
  categoriesEmpty: string
}

/** Translation keys and English fallbacks of `SectionLabels`, resolved by the public page and the builder. */
export const SECTION_LABEL_KEYS: Record<keyof SectionLabels, readonly [string, string]> = {
  contactAddress: ['storefront.public.contact.address', 'Address'],
  contactPhone: ['storefront.public.contact.phone', 'Phone'],
  contactEmail: ['storefront.public.contact.email', 'Email'],
  contactHours: ['storefront.public.contact.hours', 'Opening hours'],
  productsEmpty: ['storefront.public.productsEmpty', 'New products are on their way.'],
  categoriesEmpty: ['storefront.public.categoriesEmpty', 'Collections are on their way.'],
}

export function resolveSectionLabels(translate: (key: string, fallback: string) => string): SectionLabels {
  return Object.fromEntries(
    Object.entries(SECTION_LABEL_KEYS).map(([name, [key, fallback]]) => [name, translate(key, fallback)]),
  ) as SectionLabels
}

function StoreImage({
  image,
  media,
  sizes,
  eager,
  className,
}: {
  image: ImageRef
  media: MediaResolver
  sizes: string
  eager?: boolean
  className?: string
}) {
  return (
    // Served by the store's media route (scope and visibility re-checked there); next/image would fetch it out of band.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={media.src(image.attachmentId, 960)}
      srcSet={media.srcSet(image.attachmentId)}
      sizes={sizes}
      alt={image.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  )
}

/** Resolves a validated href: store-relative paths are joined to the store base path. */
export function resolveStoreHref(href: string, basePath: string): string {
  if (!href.startsWith('/')) return href
  if (!basePath) return href
  return href === '/' ? basePath : `${basePath}${href}`
}

function linkRel(href: string): string | undefined {
  return href.startsWith('/') ? undefined : 'noopener noreferrer'
}

export function HeroBlock({ props, context }: { props: HeroProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  const text = (
    <div className="sf-hero-inner" data-align={props.image ? 'start' : props.align}>
      <Heading>{props.heading}</Heading>
      {props.subheading ? <p>{props.subheading}</p> : null}
      {props.cta ? (
        <a className="sf-button" href={resolveStoreHref(props.cta.href, context.basePath)} rel={linkRel(props.cta.href)}>
          {props.cta.label}
        </a>
      ) : null}
    </div>
  )
  return (
    <section className="sf-section sf-hero">
      {props.image ? (
        <div className="sf-container sf-split">
          {text}
          <div className="sf-media">
            <StoreImage image={props.image} media={context.media} sizes="(min-width: 48rem) 50vw, 100vw" eager={context.isFirst} />
          </div>
        </div>
      ) : (
        <div className="sf-container">{text}</div>
      )}
    </section>
  )
}

export function ImageBlock({ props, context }: { props: ImageProps; context: BlockRenderContext }) {
  const image = (
    <StoreImage
      image={props.image}
      media={context.media}
      sizes={props.width === 'full' ? '100vw' : '(min-width: 72rem) 72rem, 100vw'}
      eager={context.isFirst}
    />
  )
  const figure = (
    <figure className="sf-figure">
      {props.href ? (
        <a href={resolveStoreHref(props.href, context.basePath)} rel={linkRel(props.href)}>
          {image}
        </a>
      ) : (
        image
      )}
      {props.caption ? <figcaption>{props.caption}</figcaption> : null}
    </figure>
  )
  return (
    <section className="sf-section sf-image" data-width={props.width}>
      {props.width === 'full' ? figure : <div className="sf-container">{figure}</div>}
    </section>
  )
}

export function ImageTextBlock({ props, context }: { props: ImageTextProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  return (
    <section className="sf-section">
      <div className="sf-container sf-split" data-position={props.imagePosition}>
        <div className="sf-media">
          <StoreImage image={props.image} media={context.media} sizes="(min-width: 48rem) 50vw, 100vw" eager={context.isFirst} />
        </div>
        <div className="sf-split-text">
          <Heading className="sf-section-title">{props.heading}</Heading>
          {props.body ? <p className="sf-pre-line">{props.body}</p> : null}
          {props.cta ? (
            <a className="sf-button" href={resolveStoreHref(props.cta.href, context.basePath)} rel={linkRel(props.cta.href)}>
              {props.cta.label}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function GalleryBlock({ props, context }: { props: GalleryProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  return (
    <section className="sf-section">
      <div className="sf-container">
        {props.heading ? <Heading className="sf-section-title">{props.heading}</Heading> : null}
        <ul className="sf-gallery" role="list">
          {props.images.map((image, index) => (
            <li key={`${image.attachmentId}-${index}`}>
              <StoreImage image={image} media={context.media} sizes="(min-width: 48rem) 33vw, 50vw" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function TestimonialsBlock({ props, context }: { props: TestimonialsProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  return (
    <section className="sf-section">
      <div className="sf-container">
        {props.heading ? <Heading className="sf-section-title">{props.heading}</Heading> : null}
        <ul className="sf-cards" role="list">
          {props.items.map((item, index) => (
            <li key={index} className="sf-card">
              <figure className="sf-quote">
                <blockquote className="sf-pre-line">{item.quote}</blockquote>
                <figcaption>
                  <strong>{item.author}</strong>
                  {item.role ? <span>{item.role}</span> : null}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Questions open and close with the browser's own `<details>`: no script, keyboard and screen-reader support built in. */
export function FaqBlock({ props, context }: { props: FaqProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  return (
    <section className="sf-section">
      <div className="sf-container sf-narrow">
        {props.heading ? <Heading className="sf-section-title">{props.heading}</Heading> : null}
        <div className="sf-faq">
          {props.items.map((item, index) => (
            <details key={index}>
              <summary>{item.question}</summary>
              <p className="sf-pre-line">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

/** `tel:`/`mailto:` targets are built here from validated values; merchants never supply those hrefs. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+0-9]/g, '')}`
}

export function ContactInfoBlock({ props, context }: { props: ContactInfoProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  const text = context.labels
  return (
    <section className="sf-section">
      <div className="sf-container sf-narrow">
        {props.heading ? <Heading className="sf-section-title">{props.heading}</Heading> : null}
        <address className="sf-contact">
          <dl>
            {props.address ? (
              <div>
                <dt>{text.contactAddress}</dt>
                <dd className="sf-pre-line">{props.address}</dd>
              </div>
            ) : null}
            {props.phone ? (
              <div>
                <dt>{text.contactPhone}</dt>
                <dd>
                  <a href={telHref(props.phone)}>{props.phone}</a>
                </dd>
              </div>
            ) : null}
            {props.email ? (
              <div>
                <dt>{text.contactEmail}</dt>
                <dd>
                  <a href={`mailto:${props.email}`}>{props.email}</a>
                </dd>
              </div>
            ) : null}
            {props.hours ? (
              <div>
                <dt>{text.contactHours}</dt>
                <dd className="sf-pre-line">{props.hours}</dd>
              </div>
            ) : null}
          </dl>
        </address>
      </div>
    </section>
  )
}

export function CallToActionBlock({ props, context }: { props: CallToActionProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  return (
    <section className="sf-section sf-cta" data-tone={props.tone}>
      <div className="sf-container sf-cta-inner">
        <div>
          <Heading className="sf-section-title">{props.heading}</Heading>
          {props.body ? <p>{props.body}</p> : null}
        </div>
        <a className="sf-button" href={resolveStoreHref(props.cta.href, context.basePath)} rel={linkRel(props.cta.href)}>
          {props.cta.label}
        </a>
      </div>
    </section>
  )
}

function InlineNodes({ nodes, basePath }: { nodes: RichTextInline[]; basePath: string }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'link') {
          return (
            <a key={index} href={resolveStoreHref(node.href, basePath)} rel={linkRel(node.href)}>
              {node.children.map((child, childIndex) => (
                <MarkedText key={childIndex} text={child.text} marks={child.marks} />
              ))}
            </a>
          )
        }
        return <MarkedText key={index} text={node.text} marks={node.marks} />
      })}
    </>
  )
}

function MarkedText({ text, marks }: { text: string; marks?: Array<'bold' | 'italic'> }) {
  let content: React.ReactNode = text
  if (marks?.includes('italic')) content = <em>{content}</em>
  if (marks?.includes('bold')) content = <strong>{content}</strong>
  return <>{content}</>
}

export function RichTextBlock({ props, context }: { props: RichTextProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  return (
    <section className="sf-section">
      <div className="sf-container">
        {props.heading ? <Heading className="sf-section-title">{props.heading}</Heading> : null}
        <div className="sf-prose">
          {props.content.blocks.map((block, index) => {
            if (block.type === 'paragraph') {
              return (
                <p key={index}>
                  <InlineNodes nodes={block.children} basePath={context.basePath} />
                </p>
              )
            }
            const List = block.ordered ? 'ol' : 'ul'
            return (
              <List key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <InlineNodes nodes={item} basePath={context.basePath} />
                  </li>
                ))}
              </List>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function FeaturesBlock({ props, context }: { props: FeaturesProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  return (
    <section className="sf-section">
      <div className="sf-container">
        {props.heading ? <Heading className="sf-section-title">{props.heading}</Heading> : null}
        <ul className="sf-features" role="list">
          {props.items.map((item, index) => (
            <li key={index} className="sf-feature">
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function FooterBlock({ props, context }: { props: FooterProps; context: BlockRenderContext }) {
  return (
    <footer className="sf-section sf-footer">
      <div className="sf-container sf-footer-inner">
        {props.text ? <p>{props.text}</p> : <span />}
        {props.links.length ? (
          <nav>
            <ul>
              {props.links.map((link, index) => (
                <li key={index}>
                  <a href={resolveStoreHref(link.href, context.basePath)} rel={linkRel(link.href)}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </footer>
  )
}

export function ProductCardItem({ product, media, showPrice }: { product: ProductCard; media: MediaResolver; showPrice: boolean }) {
  return (
    <li className="sf-product">
      <a href={product.href} className="sf-product-link">
        {product.image ? (
          <StoreImage image={product.image} media={media} sizes="(min-width: 48rem) 25vw, 50vw" className="sf-product-image" />
        ) : (
          <span className="sf-product-image sf-placeholder" aria-hidden="true" />
        )}
        <span className="sf-product-title">{product.title}</span>
      </a>
      {product.subtitle ? <span className="sf-product-subtitle">{product.subtitle}</span> : null}
      {showPrice && product.price ? <span className="sf-price">{product.price}</span> : null}
    </li>
  )
}

export function ProductGridBlock({ props, context }: { props: ProductGridProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  const products = context.data?.products ?? []
  return (
    <section className="sf-section">
      <div className="sf-container">
        {props.heading ? <Heading className="sf-section-title">{props.heading}</Heading> : null}
        {products.length ? (
          <ul className="sf-products" role="list">
            {products.map((product) => (
              <ProductCardItem key={product.id} product={product} media={context.media} showPrice={props.showPrice} />
            ))}
          </ul>
        ) : (
          <p className="sf-empty">{context.labels.productsEmpty}</p>
        )}
      </div>
    </section>
  )
}

function CategoryCardItem({ category, media }: { category: CategoryCard; media: MediaResolver }) {
  return (
    <li className="sf-card sf-collection">
      <a href={category.href} className="sf-product-link">
        {category.image ? (
          <StoreImage image={category.image} media={media} sizes="(min-width: 48rem) 33vw, 100vw" className="sf-product-image" />
        ) : (
          <span className="sf-product-image sf-placeholder" aria-hidden="true" />
        )}
        <span className="sf-product-title">{category.name}</span>
      </a>
      {category.description ? <p className="sf-product-subtitle">{category.description}</p> : null}
    </li>
  )
}

export function CollectionListBlock({ props, context }: { props: CollectionListProps; context: BlockRenderContext }) {
  const Heading = context.isFirst ? 'h1' : 'h2'
  const categories = context.data?.categories ?? []
  return (
    <section className="sf-section">
      <div className="sf-container">
        {props.heading ? <Heading className="sf-section-title">{props.heading}</Heading> : null}
        {categories.length ? (
          <ul className="sf-cards" role="list">
            {categories.map((category) => (
              <CategoryCardItem key={category.id} category={category} media={context.media} />
            ))}
          </ul>
        ) : (
          <p className="sf-empty">{context.labels.categoriesEmpty}</p>
        )}
      </div>
    </section>
  )
}
