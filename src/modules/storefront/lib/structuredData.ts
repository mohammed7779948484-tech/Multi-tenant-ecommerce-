/**
 * JSON-LD for a store page. Serialised with `<`, `>`, `&`, U+2028 and U+2029
 * escaped so merchant text can never close the surrounding `<script>` element
 * or break the JSON in older parsers. The output is only ever produced by
 * this function from typed fields; the public page injects nothing else.
 */
export type StorefrontStructuredDataInput = {
  storeName: string
  description: string | null
  url: string
  logoUrl: string | null
}

export function buildStorefrontJsonLd(input: StorefrontStructuredDataInput): Record<string, unknown>[] {
  const organization: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: input.storeName,
    url: input.url,
  }
  if (input.description) organization.description = input.description
  if (input.logoUrl) organization.logo = input.logoUrl
  const website: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: input.storeName,
    url: input.url,
  }
  return [organization, website]
}

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LINE_SEPARATOR)
    .join('\\u2028')
    .split(PARAGRAPH_SEPARATOR)
    .join('\\u2029')
}
