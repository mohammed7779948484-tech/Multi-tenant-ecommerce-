import type { PageSpec } from './blocks/pageSpec'
import { HOME_PAGE_SLUG_VALUE } from './slug'

/**
 * Store templates (spec P3-Q6, P3-Q7). A template is a set of pages composed
 * from the section catalog and filled with the store's own data: its name,
 * description and up to four active top-level categories. Copy is translated
 * into the admin's language when the template is applied. Pure: the apply
 * command loads the data, validates every generated spec and writes drafts.
 */

export type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

export type TemplateCategory = { id: string; slug: string | null; name: string }

export type TemplateStoreData = {
  storeName: string
  description: string | null
  /** Active top-level categories, at most four, in catalog order. */
  categories: TemplateCategory[]
}

export type TemplatePage = { slug: string; title: string; seoDescription: string | null; spec: PageSpec }

type Element = { type: string; props: Record<string, unknown> }

export const MAX_TEMPLATE_CATEGORIES = 4

export const STORE_TEMPLATE_IDS = ['classic', 'showcase'] as const
export type StoreTemplateId = (typeof STORE_TEMPLATE_IDS)[number]

export function isStoreTemplateId(value: string): value is StoreTemplateId {
  return (STORE_TEMPLATE_IDS as readonly string[]).includes(value)
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

function spec(elements: Array<[string, Element]>): PageSpec {
  return {
    root: 'page',
    elements: {
      page: { type: 'Page', props: {}, children: elements.map(([id]) => id) },
      ...Object.fromEntries(elements.map(([id, element]) => [id, { ...element, children: [] }])),
    },
  } as PageSpec
}

const categoryPath = (category: TemplateCategory) => `/collections/${encodeURIComponent(category.slug || category.id)}`

function footer(data: TemplateStoreData, t: Translate, links: Array<'about' | 'faq' | 'contact'>): [string, Element] {
  const labels = {
    about: t('storefront.templates.copy.navAbout', 'About us'),
    faq: t('storefront.templates.copy.navFaq', 'Questions'),
    contact: t('storefront.templates.copy.navContact', 'Contact'),
  }
  return [
    'footer',
    {
      type: 'Footer',
      props: {
        text: clip(t('storefront.templates.copy.footerText', '© {store}. Pay cash on delivery or by bank transfer.', { store: data.storeName }), 200),
        links: links.map((slug) => ({ label: labels[slug], href: `/${slug}` })),
      },
    },
  ]
}

function contactCta(t: Translate, tone: 'surface' | 'primary'): Element {
  return {
    type: 'CallToAction',
    props: {
      heading: t('storefront.templates.copy.contactCtaHeading', 'Questions about an order?'),
      body: t('storefront.templates.copy.contactCtaBody', 'Write or call us. We answer every message ourselves.'),
      cta: { label: t('storefront.templates.copy.contactUs', 'Contact us'), href: '/contact' },
      tone,
    },
  }
}

/** Product sections when the store has categories; a contact call to action otherwise (P3-Q7). */
function commerceSections(data: TemplateStoreData, t: Translate, order: 'products-first' | 'collections-first', limit: number): Array<[string, Element]> {
  const [first] = data.categories
  if (!first) {
    return [
      [
        'coming-soon',
        {
          type: 'CallToAction',
          props: {
            heading: t('storefront.templates.copy.comingSoonHeading', 'Our products are on their way'),
            body: t('storefront.templates.copy.comingSoonBody', 'Ask us what is in stock today.'),
            cta: { label: t('storefront.templates.copy.contactUs', 'Contact us'), href: '/contact' },
            tone: 'primary',
          },
        },
      ],
    ]
  }
  const products: [string, Element] = [
    'products',
    {
      type: 'ProductGrid',
      props: {
        heading: clip(t('storefront.templates.copy.productsHeading', 'From {category}', { category: first.name }), 120),
        source: { kind: 'category', categoryId: first.id },
        limit,
        showPrice: true,
      },
    },
  ]
  const collections: [string, Element] = [
    'collections',
    { type: 'CollectionList', props: { heading: t('storefront.templates.copy.collectionsHeading', 'Shop by category'), categoryIds: data.categories.map((category) => category.id) } },
  ]
  return order === 'products-first' ? [products, collections] : [collections, products]
}

function hero(data: TemplateStoreData, t: Translate, align: 'center' | 'start'): [string, Element] {
  const [first] = data.categories
  return [
    'hero',
    {
      type: 'Hero',
      props: {
        heading: clip(data.storeName, 120),
        subheading: clip(data.description?.trim() || t('storefront.templates.copy.tagline', 'Good products, delivered to your door.'), 200),
        cta: first
          ? { label: t('storefront.templates.copy.shopNow', 'Shop now'), href: categoryPath(first) }
          : { label: t('storefront.templates.copy.contactUs', 'Contact us'), href: '/contact' },
        align,
      },
    },
  ]
}

function paymentFeatures(t: Translate): [string, Element] {
  return [
    'features',
    {
      type: 'Features',
      props: {
        heading: t('storefront.templates.copy.featuresHeading', 'Why shop with us'),
        items: [
          { title: t('storefront.templates.copy.codTitle', 'Cash on delivery'), body: t('storefront.templates.copy.codBody', 'Pay when your order arrives at your door.') },
          {
            title: t('storefront.templates.copy.transferTitle', 'Bank transfer'),
            body: t('storefront.templates.copy.transferBody', 'Pay by bank transfer and send us a photo of the receipt.'),
          },
          { title: t('storefront.templates.copy.serviceTitle', 'Personal service'), body: t('storefront.templates.copy.serviceBody', 'A real person answers every question.') },
        ],
      },
    },
  ]
}

function homePage(data: TemplateStoreData, elements: Array<[string, Element]>): TemplatePage {
  return {
    slug: HOME_PAGE_SLUG_VALUE,
    title: clip(data.storeName, 70),
    seoDescription: data.description ? clip(data.description.trim(), 160) : null,
    spec: spec(elements),
  }
}

function contactPage(data: TemplateStoreData, t: Translate, links: Array<'about' | 'faq' | 'contact'>): TemplatePage {
  return {
    slug: 'contact',
    title: t('storefront.templates.copy.contactTitle', 'Contact'),
    seoDescription: clip(t('storefront.templates.copy.contactSeo', 'How to reach {store}.', { store: data.storeName }), 160),
    spec: spec([
      ['hero', { type: 'Hero', props: { heading: t('storefront.templates.copy.contactHeading', 'Get in touch'), align: 'center' } }],
      [
        'contact',
        {
          type: 'ContactInfo',
          props: {
            heading: t('storefront.templates.copy.contactInfoHeading', 'How to reach us'),
            hours: t('storefront.templates.copy.contactHours', 'Monday to Friday, 9:00–17:00'),
          },
        },
      ],
      footer(data, t, links),
    ]),
  }
}

type TemplateDefinition = {
  id: StoreTemplateId
  name: [string, string]
  description: [string, string]
  build: (data: TemplateStoreData, t: Translate) => TemplatePage[]
}

const TEMPLATES: Record<StoreTemplateId, TemplateDefinition> = {
  classic: {
    id: 'classic',
    name: ['storefront.templates.classic.name', 'Classic shop'],
    description: [
      'storefront.templates.classic.description',
      'A home page with your products and collections, plus About, Questions and Contact pages.',
    ],
    build: (data, t) => {
      const links: Array<'about' | 'faq' | 'contact'> = ['about', 'faq', 'contact']
      return [
        homePage(data, [hero(data, t, 'center'), ...commerceSections(data, t, 'products-first', 8), paymentFeatures(t), footer(data, t, links)]),
        {
          slug: 'about',
          title: t('storefront.templates.copy.aboutTitle', 'About us'),
          seoDescription: clip(t('storefront.templates.copy.aboutSeo', 'The story behind {store}.', { store: data.storeName }), 160),
          spec: spec([
            ['hero', { type: 'Hero', props: { heading: clip(t('storefront.templates.copy.aboutHeading', 'About {store}', { store: data.storeName }), 120), align: 'center' } }],
            [
              'story',
              {
                type: 'RichText',
                props: {
                  content: {
                    type: 'doc',
                    blocks: [
                      {
                        type: 'paragraph',
                        children: [
                          {
                            type: 'text',
                            text: t(
                              'storefront.templates.copy.aboutBody',
                              'Tell your customers who you are, where your products come from and what you care about.',
                            ),
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            ],
            ['cta', contactCta(t, 'surface')],
            footer(data, t, links),
          ]),
        },
        {
          slug: 'faq',
          title: t('storefront.templates.copy.faqTitle', 'Questions'),
          seoDescription: clip(t('storefront.templates.copy.faqSeo', 'Payment and delivery at {store}.', { store: data.storeName }), 160),
          spec: spec([
            [
              'faq',
              {
                type: 'Faq',
                props: {
                  heading: t('storefront.templates.copy.faqHeading', 'Questions and answers'),
                  items: [
                    { question: t('storefront.templates.copy.faqPayQ', 'How do I pay?'), answer: t('storefront.templates.copy.faqPayA', 'Pay cash on delivery, or by bank transfer with a photo of the receipt.') },
                    {
                      question: t('storefront.templates.copy.faqDeliveryQ', 'When will my order arrive?'),
                      answer: t('storefront.templates.copy.faqDeliveryA', 'We confirm the delivery time when we accept your order.'),
                    },
                    {
                      question: t('storefront.templates.copy.faqReturnQ', 'Can I return a product?'),
                      answer: t('storefront.templates.copy.faqReturnA', 'Contact us and we will find a solution together.'),
                    },
                  ],
                },
              },
            ],
            ['cta', contactCta(t, 'surface')],
            footer(data, t, links),
          ]),
        },
        contactPage(data, t, links),
      ]
    },
  },
  showcase: {
    id: 'showcase',
    name: ['storefront.templates.showcase.name', 'Simple showcase'],
    description: ['storefront.templates.showcase.description', 'One home page that leads with your collections, plus a Contact page.'],
    build: (data, t) => {
      const links: Array<'about' | 'faq' | 'contact'> = ['contact']
      return [
        homePage(data, [hero(data, t, 'start'), ...commerceSections(data, t, 'collections-first', 12), ['cta', contactCta(t, 'primary')], footer(data, t, links)]),
        contactPage(data, t, links),
      ]
    },
  },
}

export type TemplateSummary = { id: StoreTemplateId; name: string; description: string; pages: Array<{ slug: string; title: string }> }

/** Templates as the dialog lists them: name, description and the pages each would draft. */
export function listStoreTemplates(t: Translate, data: TemplateStoreData): TemplateSummary[] {
  return STORE_TEMPLATE_IDS.map((id) => {
    const template = TEMPLATES[id]
    return {
      id,
      name: t(template.name[0], template.name[1]),
      description: t(template.description[0], template.description[1]),
      pages: template.build(data, t).map((page) => ({ slug: page.slug, title: page.title })),
    }
  })
}

export function buildStoreTemplate(id: StoreTemplateId, data: TemplateStoreData, t: Translate): TemplatePage[] {
  return TEMPLATES[id].build({ ...data, categories: data.categories.slice(0, MAX_TEMPLATE_CATEGORIES) }, t)
}
