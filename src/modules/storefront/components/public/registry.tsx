import * as React from 'react'
import type { ValidatedSection } from '../../lib/blocks/pageSpec'
import type { StorefrontBlockType } from '../../lib/blocks/catalog'
import { FeaturesBlock, FooterBlock, HeroBlock, RichTextBlock, type BlockRenderContext } from './blocks'

/**
 * Server block registry: catalog type → SSR component. The `satisfies` clause
 * makes a catalog block without a component (or vice versa) a type error.
 */
const BLOCK_COMPONENTS = {
  Hero: HeroBlock,
  RichText: RichTextBlock,
  Features: FeaturesBlock,
  Footer: FooterBlock,
} satisfies Record<StorefrontBlockType, React.ComponentType<{ props: never; context: BlockRenderContext }>>

export function renderSection(section: ValidatedSection, context: BlockRenderContext): React.ReactNode {
  switch (section.type) {
    case 'Hero':
      return <BLOCK_COMPONENTS.Hero key={section.id} props={section.props} context={context} />
    case 'RichText':
      return <BLOCK_COMPONENTS.RichText key={section.id} props={section.props} context={context} />
    case 'Features':
      return <BLOCK_COMPONENTS.Features key={section.id} props={section.props} context={context} />
    case 'Footer':
      return <BLOCK_COMPONENTS.Footer key={section.id} props={section.props} context={context} />
    default: {
      const exhaustive: never = section
      throw new Error(`[internal] storefront block without a component: ${String((exhaustive as { type?: unknown }).type)}`)
    }
  }
}
