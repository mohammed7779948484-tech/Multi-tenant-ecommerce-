import type { PageSpec } from './pageSpec'

/**
 * The home page every new store publishes at signup (owner default: new stores
 * publish immediately). It is merchant content in the store's default locale,
 * seeded once and edited later in the builder — not UI copy.
 */
export function buildDefaultHomeSpec(input: { storeName: string; description?: string | null }): PageSpec {
  const storeName = input.storeName.trim().slice(0, 120) || 'Our store'
  const tagline = input.description?.trim().slice(0, 200) || `Welcome to ${storeName}.`.slice(0, 200)
  return {
    root: 'page',
    elements: {
      page: { type: 'Page', props: {}, children: ['hero', 'features', 'about', 'footer'] },
      hero: {
        type: 'Hero',
        props: { heading: storeName, subheading: tagline, align: 'center' },
        children: [],
      },
      features: {
        type: 'Features',
        props: {
          heading: 'Why shop with us',
          items: [
            { title: 'Cash on delivery', body: 'Pay in cash when your order arrives at your door.' },
            { title: 'Bank transfer', body: 'Prefer to pay ahead? Transfer and upload your receipt.' },
            { title: 'Personal service', body: 'Questions about an order? We answer every message.' },
          ],
        },
        children: [],
      },
      about: {
        type: 'RichText',
        props: {
          heading: 'About us',
          content: {
            type: 'doc',
            blocks: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', text: storeName, marks: ['bold'] },
                  { type: 'text', text: ' is getting ready. Our full catalogue is on its way — check back soon.' },
                ],
              },
            ],
          },
        },
        children: [],
      },
      footer: {
        type: 'Footer',
        props: { text: `© ${new Date().getUTCFullYear()} ${storeName}`.slice(0, 200), links: [] },
        children: [],
      },
    },
  }
}
