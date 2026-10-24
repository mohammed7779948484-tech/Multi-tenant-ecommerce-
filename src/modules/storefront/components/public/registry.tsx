import * as React from 'react'
import type { ValidatedSection } from '../../lib/blocks/pageSpec'
import type { StorefrontBlockType } from '../../lib/blocks/catalog'
import {
  CallToActionBlock,
  ContactInfoBlock,
  FaqBlock,
  FeaturesBlock,
  FooterBlock,
  GalleryBlock,
  HeroBlock,
  ImageBlock,
  ImageTextBlock,
  RichTextBlock,
  TestimonialsBlock,
  type BlockRenderContext,
} from './blocks'

/**
 * Server block registry: catalog type → SSR component. The `satisfies` clause
 * makes a catalog block without a component (or vice versa) a type error.
 */
const BLOCK_COMPONENTS = {
  Hero: HeroBlock,
  RichText: RichTextBlock,
  Features: FeaturesBlock,
  Image: ImageBlock,
  ImageText: ImageTextBlock,
  Gallery: GalleryBlock,
  Testimonials: TestimonialsBlock,
  Faq: FaqBlock,
  ContactInfo: ContactInfoBlock,
  CallToAction: CallToActionBlock,
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
    case 'Image':
      return <BLOCK_COMPONENTS.Image key={section.id} props={section.props} context={context} />
    case 'ImageText':
      return <BLOCK_COMPONENTS.ImageText key={section.id} props={section.props} context={context} />
    case 'Gallery':
      return <BLOCK_COMPONENTS.Gallery key={section.id} props={section.props} context={context} />
    case 'Testimonials':
      return <BLOCK_COMPONENTS.Testimonials key={section.id} props={section.props} context={context} />
    case 'Faq':
      return <BLOCK_COMPONENTS.Faq key={section.id} props={section.props} context={context} />
    case 'ContactInfo':
      return <BLOCK_COMPONENTS.ContactInfo key={section.id} props={section.props} context={context} />
    case 'CallToAction':
      return <BLOCK_COMPONENTS.CallToAction key={section.id} props={section.props} context={context} />
    case 'Footer':
      return <BLOCK_COMPONENTS.Footer key={section.id} props={section.props} context={context} />
    default: {
      const exhaustive: never = section
      throw new Error(`[internal] storefront block without a component: ${String((exhaustive as { type?: unknown }).type)}`)
    }
  }
}
