import * as React from 'react'
import type {
  FeaturesProps,
  FooterProps,
  HeroProps,
  RichTextInline,
  RichTextProps,
} from '../../lib/blocks/schemas'

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
  return (
    <section className="sf-section sf-hero">
      <div className="sf-container sf-hero-inner" data-align={props.align}>
        <Heading>{props.heading}</Heading>
        {props.subheading ? <p>{props.subheading}</p> : null}
        {props.cta ? (
          <a className="sf-button" href={resolveStoreHref(props.cta.href, context.basePath)} rel={linkRel(props.cta.href)}>
            {props.cta.label}
          </a>
        ) : null}
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
