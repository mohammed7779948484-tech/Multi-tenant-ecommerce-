import type { PageSpec } from './pageSpec'

/**
 * The home page every new store publishes at signup (owner default: new stores
 * publish immediately). It is merchant content in the store's language — Arabic,
 * as buyer pages are Arabic (shopping-journey spec REQ-001) — seeded once and
 * edited later in the builder, not UI copy. Stores created earlier keep theirs.
 */
export function buildDefaultHomeSpec(input: { storeName: string; description?: string | null }): PageSpec {
  const storeName = input.storeName.trim().slice(0, 120) || 'متجرنا'
  const tagline = input.description?.trim().slice(0, 200) || `أهلاً بكم في ${storeName}.`.slice(0, 200)
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
          heading: 'لماذا تتسوق معنا',
          items: [
            { title: 'الدفع عند الاستلام', body: 'ادفع نقداً عند وصول طلبك إلى باب منزلك.' },
            { title: 'تحويل بنكي', body: 'تفضّل الدفع مسبقاً؟ حوّل المبلغ وارفع صورة الإيصال.' },
            { title: 'خدمة شخصية', body: 'لديك سؤال عن طلبك؟ نردّ على كل رسالة.' },
          ],
        },
        children: [],
      },
      about: {
        type: 'RichText',
        props: {
          heading: 'من نحن',
          content: {
            type: 'doc',
            blocks: [
              {
                type: 'paragraph',
                // Opens with an Arabic word: the paragraph takes its direction from its first letter,
                // and a store name in Latin letters would otherwise turn it left to right.
                children: [
                  { type: 'text', text: 'متجر ' },
                  { type: 'text', text: storeName, marks: ['bold'] },
                  { type: 'text', text: ' يستعد للافتتاح. تشكيلتنا الكاملة في الطريق — زورونا قريباً.' },
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
