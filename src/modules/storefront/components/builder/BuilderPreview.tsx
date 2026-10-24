"use client"
import * as React from 'react'
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react'
import type { Spec } from '@json-render/core'
import { STOREFRONT_BLOCKS, type StorefrontBlockType } from '../../lib/blocks/catalog'
import type { ValidatedSection } from '../../lib/blocks/pageSpec'
import type { ThemeTokens } from '../../lib/theme'
import { renderSection } from '../public/registry'
import { StorefrontFrame } from '../public/StorefrontView'
import type { SectionLabels } from '../public/blocks'
import { NO_MEDIA, staffMediaResolver, type MediaResolver } from '../../lib/mediaUrls'
import { builderCatalog } from './catalog'
import { stableStringify } from './builderSpec'

/**
 * Live preview of the in-memory draft (spec P2-Q8): json-render renders the
 * spec, and every block resolves to the same SSR component the public page
 * uses, inside the same theme frame. Props are re-validated per section, so a
 * half-edited section shows a placeholder instead of breaking the preview.
 */

type PreviewSettings = { basePath: string; unavailableLabel: string; media: MediaResolver; sectionLabels: SectionLabels | null }

const PreviewSettingsContext = React.createContext<PreviewSettings>({ basePath: '', unavailableLabel: '', media: NO_MEDIA, sectionLabels: null })
const FirstSectionContext = React.createContext(false)

function Unavailable() {
  const { unavailableLabel } = React.useContext(PreviewSettingsContext)
  return (
    <section className="sf-section">
      <div className="sf-container">
        <p>{unavailableLabel}</p>
      </div>
    </section>
  )
}

class SectionBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <Unavailable /> : this.props.children
  }
}

function PreviewSection({ type, props }: { type: StorefrontBlockType; props: unknown }) {
  const { basePath, media, sectionLabels } = React.useContext(PreviewSettingsContext)
  const isFirst = React.useContext(FirstSectionContext)
  const parsed = (STOREFRONT_BLOCKS[type].props as typeof STOREFRONT_BLOCKS.Hero.props).safeParse(props)
  if (!parsed.success || !sectionLabels) return <Unavailable />
  const section = { id: 'preview', type, props: parsed.data } as ValidatedSection
  // Keyed by the props, so a section that failed renders again once it is edited.
  return (
    <SectionBoundary key={stableStringify(parsed.data)}>
      {renderSection(section, { basePath, isFirst, media, labels: sectionLabels })}
    </SectionBoundary>
  )
}

export const { registry: previewRegistry } = defineRegistry(builderCatalog, {
  components: {
    // The frame supplies `<main>`; the page only marks its first section (the one that renders the `<h1>`).
    Page: ({ children }) => (
      <>
        {React.Children.map(children, (child, index) => (
          <FirstSectionContext.Provider value={index === 0}>{child}</FirstSectionContext.Provider>
        ))}
      </>
    ),
    Hero: ({ props }) => <PreviewSection type="Hero" props={props} />,
    RichText: ({ props }) => <PreviewSection type="RichText" props={props} />,
    Features: ({ props }) => <PreviewSection type="Features" props={props} />,
    Image: ({ props }) => <PreviewSection type="Image" props={props} />,
    ImageText: ({ props }) => <PreviewSection type="ImageText" props={props} />,
    Gallery: ({ props }) => <PreviewSection type="Gallery" props={props} />,
    Testimonials: ({ props }) => <PreviewSection type="Testimonials" props={props} />,
    Faq: ({ props }) => <PreviewSection type="Faq" props={props} />,
    ContactInfo: ({ props }) => <PreviewSection type="ContactInfo" props={props} />,
    CallToAction: ({ props }) => <PreviewSection type="CallToAction" props={props} />,
    Footer: ({ props }) => <PreviewSection type="Footer" props={props} />,
  },
})

export type BuilderPreviewProps = {
  spec: Spec
  siteId: string
  storeName: string
  basePath: string
  logoSrc: string | null
  tokens: ThemeTokens
  labels: { home: string; signIn: string; unavailable: string; sections: SectionLabels }
}

export function BuilderPreview({ spec, siteId, storeName, basePath, logoSrc, tokens, labels }: BuilderPreviewProps) {
  const settings = React.useMemo(
    () => ({ basePath, unavailableLabel: labels.unavailable, media: staffMediaResolver(), sectionLabels: labels.sections }),
    [basePath, labels.unavailable, labels.sections],
  )
  return (
    <PreviewSettingsContext.Provider value={settings}>
      <StorefrontFrame
        siteId={siteId}
        storeName={storeName}
        basePath={basePath}
        logoSrc={logoSrc}
        tokens={tokens}
        signInHref={null}
        preview
        labels={{ home: labels.home, signIn: labels.signIn }}
      >
        <JSONUIProvider registry={previewRegistry}>
          <Renderer spec={spec} registry={previewRegistry} />
        </JSONUIProvider>
      </StorefrontFrame>
    </PreviewSettingsContext.Provider>
  )
}
