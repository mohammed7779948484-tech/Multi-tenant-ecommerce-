import type { PageSpec } from './pageSpec'

/** First draft of a new page: a Hero titled like the page and a Footer, ready to edit. */
export function buildStarterPageSpec(title: string): PageSpec {
  return {
    root: 'page',
    elements: {
      page: { type: 'Page', props: {}, children: ['hero', 'footer'] },
      hero: { type: 'Hero', props: { heading: title.slice(0, 120), align: 'center' }, children: [] },
      footer: { type: 'Footer', props: { links: [] }, children: [] },
    },
  }
}
