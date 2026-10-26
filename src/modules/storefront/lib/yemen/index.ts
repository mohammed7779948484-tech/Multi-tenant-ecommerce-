import regions from './regions.json'

/**
 * Yemen's governorates and districts with their OCHA P-codes and Arabic names
 * (COD-AB v01, valid 2019-11-22, CC BY-IGO 3.0; attribution in
 * THIRD_PARTY_NOTICES.md). Bundled public reference data, client-safe: the
 * checkout's lists and the server's validation read the same file.
 *
 * Names are kept exactly as the dataset spells them.
 */

export type YemenDistrict = { code: string; name: string; nameEn: string }
export type YemenGovernorate = { code: string; name: string; nameEn: string; districts: YemenDistrict[] }

export const YEMEN_DATASET = { source: regions.source, version: regions.version, validOn: regions.validOn, licence: regions.licence }

const GOVERNORATES: YemenGovernorate[] = regions.governorates
const BY_CODE = new Map(GOVERNORATES.map((governorate) => [governorate.code, governorate]))
const DISTRICTS = new Map(GOVERNORATES.flatMap((governorate) => governorate.districts.map((district) => [district.code, { governorate, district }] as const)))

const byArabicName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ar')

/** Every governorate, in Arabic alphabetical order, with its districts in the same order. */
export function yemenGovernorates(): YemenGovernorate[] {
  return [...GOVERNORATES].sort(byArabicName).map((governorate) => ({ ...governorate, districts: [...governorate.districts].sort(byArabicName) }))
}

export function findGovernorate(code: string | null | undefined): YemenGovernorate | null {
  return (code && BY_CODE.get(code)) || null
}

/** The district when `districtCode` is a district of `governorateCode`; `null` otherwise (unknown or mismatched codes). */
export function findDistrict(governorateCode: string | null | undefined, districtCode: string | null | undefined): YemenDistrict | null {
  const entry = districtCode ? DISTRICTS.get(districtCode) : undefined
  return entry && entry.governorate.code === governorateCode ? entry.district : null
}

/** GPS points the checkout accepts: Yemen's mainland and islands (spec: lat 12–19.5, lng 41.5–54.5). */
export function isInYemen(latitude: number, longitude: number): boolean {
  return latitude >= 12 && latitude <= 19.5 && longitude >= 41.5 && longitude <= 54.5
}

/**
 * A Yemeni mobile number in E.164 (`+9677XXXXXXXX`), or `null`. Accepts
 * `7XXXXXXXX`, `07XXXXXXXX`, `9677…`, `+967 7…` and `00967 7…`, with spaces or
 * dashes and Arabic-Indic digits; the second digit is 0, 1, 3, 7 or 8.
 */
export function normalizeYemeniMobile(input: string, toLatin: (text: string) => string = (text) => text): string | null {
  const digits = toLatin(input).replace(/[\s\-().]/g, '')
  const match = /^(?:\+967|00967|967|0)?(7[01378]\d{7})$/.exec(digits)
  return match ? `+967${match[1]}` : null
}
