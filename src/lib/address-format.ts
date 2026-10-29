export type AddressFieldName =
  | "givenName"
  | "familyName"
  | "organization"
  | "line1"
  | "line2"
  | "city"
  | "region"
  | "postalCode"
  | "phone"

export interface Address {
  /** ISO 3166-1 alpha-2: "US", "IN". */
  country: string
  givenName: string
  familyName: string
  organization?: string
  line1: string
  line2?: string
  city: string
  /**
   * With a region list, the ISO 3166-2 subdivision code without the country
   * prefix — "CA" for California, "MH" for Maharashtra, "13" for Tokyo.
   * Otherwise whatever the shopper typed.
   */
  region?: string
  postalCode?: string
  phone?: string
}

/** An error message for each field that needs fixing; empty when nothing does. */
export type AddressErrors = Partial<Record<AddressFieldName | "country", string>>

export interface AddressRegion {
  code: string
  name: string
}

export interface AddressFormat {
  /** Top to bottom; fields in a row sit side by side once the form is wide enough. */
  rows: AddressFieldName[][]
  /** Fields the shopper must fill. Every other field in `rows` is optional. */
  required: AddressFieldName[]
  labels: Record<AddressFieldName, string>
  /** When set, the region is chosen from this list rather than typed. */
  regions?: AddressRegion[]
  /**
   * When set, the city is chosen from the chosen region's list rather than
   * typed (Yemen: the district of a governorate). A new region drops a city it
   * doesn't have.
   */
  cities?: (region: string) => AddressRegion[]
  postalCode?: {
    pattern: RegExp
    /** Shown in the error: "Enter a valid ZIP code, like 94103". */
    example: string
    /** Digits only, so phones show the number pad. */
    numeric?: boolean
  }
}

/** A country's format as you write it: labels you leave out keep their defaults. */
export type AddressFormatInput = Omit<AddressFormat, "labels"> & {
  labels?: Partial<Record<AddressFieldName, string>>
}

/** Whether a field is shown, and whether it must be filled — over any country's format. */
export type AddressFieldMode = "hidden" | "optional" | "required"
export type AddressFieldModes = Partial<Record<"organization" | "line2" | "phone", AddressFieldMode>>

export const DEFAULT_ADDRESS_LABELS: Record<AddressFieldName, string> = {
  givenName: "First name",
  familyName: "Last name",
  organization: "Company",
  line1: "Address",
  line2: "Apartment, suite, etc.",
  city: "City",
  region: "Region",
  postalCode: "Postal code",
  phone: "Phone",
}

/* ─── regions ──────────────────────────────────────────────────────────── */

const list = (entries: string): AddressRegion[] =>
  entries
    .trim()
    .split("\n")
    .map((line) => {
      const [code, name] = line.trim().split("|")
      return { code, name }
    })

const US_STATES = list(`
  AL|Alabama
  AK|Alaska
  AS|American Samoa
  AZ|Arizona
  AR|Arkansas
  CA|California
  CO|Colorado
  CT|Connecticut
  DE|Delaware
  DC|District of Columbia
  FL|Florida
  GA|Georgia
  GU|Guam
  HI|Hawaii
  ID|Idaho
  IL|Illinois
  IN|Indiana
  IA|Iowa
  KS|Kansas
  KY|Kentucky
  LA|Louisiana
  ME|Maine
  MD|Maryland
  MA|Massachusetts
  MI|Michigan
  MN|Minnesota
  MS|Mississippi
  MO|Missouri
  MT|Montana
  NE|Nebraska
  NV|Nevada
  NH|New Hampshire
  NJ|New Jersey
  NM|New Mexico
  NY|New York
  NC|North Carolina
  ND|North Dakota
  MP|Northern Mariana Islands
  OH|Ohio
  OK|Oklahoma
  OR|Oregon
  PA|Pennsylvania
  PR|Puerto Rico
  RI|Rhode Island
  SC|South Carolina
  SD|South Dakota
  TN|Tennessee
  TX|Texas
  UT|Utah
  VT|Vermont
  VI|U.S. Virgin Islands
  VA|Virginia
  WA|Washington
  WV|West Virginia
  WI|Wisconsin
  WY|Wyoming
`)

const CA_PROVINCES = list(`
  AB|Alberta
  BC|British Columbia
  MB|Manitoba
  NB|New Brunswick
  NL|Newfoundland and Labrador
  NT|Northwest Territories
  NS|Nova Scotia
  NU|Nunavut
  ON|Ontario
  PE|Prince Edward Island
  QC|Quebec
  SK|Saskatchewan
  YT|Yukon
`)

const AU_STATES = list(`
  ACT|Australian Capital Territory
  NSW|New South Wales
  NT|Northern Territory
  QLD|Queensland
  SA|South Australia
  TAS|Tasmania
  VIC|Victoria
  WA|Western Australia
`)

const IN_STATES = list(`
  AN|Andaman and Nicobar Islands
  AP|Andhra Pradesh
  AR|Arunachal Pradesh
  AS|Assam
  BR|Bihar
  CH|Chandigarh
  CG|Chhattisgarh
  DH|Dadra and Nagar Haveli and Daman and Diu
  DL|Delhi
  GA|Goa
  GJ|Gujarat
  HR|Haryana
  HP|Himachal Pradesh
  JK|Jammu and Kashmir
  JH|Jharkhand
  KA|Karnataka
  KL|Kerala
  LA|Ladakh
  LD|Lakshadweep
  MP|Madhya Pradesh
  MH|Maharashtra
  MN|Manipur
  ML|Meghalaya
  MZ|Mizoram
  NL|Nagaland
  OD|Odisha
  PY|Puducherry
  PB|Punjab
  RJ|Rajasthan
  SK|Sikkim
  TN|Tamil Nadu
  TS|Telangana
  TR|Tripura
  UP|Uttar Pradesh
  UK|Uttarakhand
  WB|West Bengal
`)

// North to south, the order Japanese forms list them in.
const JP_PREFECTURES = `Hokkaido Aomori Iwate Miyagi Akita Yamagata Fukushima Ibaraki Tochigi
  Gunma Saitama Chiba Tokyo Kanagawa Niigata Toyama Ishikawa Fukui Yamanashi Nagano Gifu
  Shizuoka Aichi Mie Shiga Kyoto Osaka Hyogo Nara Wakayama Tottori Shimane Okayama
  Hiroshima Yamaguchi Tokushima Kagawa Ehime Kochi Fukuoka Saga Nagasaki Kumamoto Oita
  Miyazaki Kagoshima Okinawa`
  .split(/\s+/)
  .map((name, i) => ({ code: String(i + 1).padStart(2, "0"), name }))

/* ─── formats ──────────────────────────────────────────────────────────── */

const NAMES: AddressFieldName[] = ["givenName", "familyName"]
const STREET: AddressFieldName[][] = [["line1"], ["line2"]]

/** Any country without its own entry: every field, nothing assumed. */
export const GENERIC_ADDRESS_FORMAT: AddressFormatInput = {
  rows: [NAMES, ...STREET, ["city"], ["region", "postalCode"], ["phone"]],
  required: ["givenName", "familyName", "line1", "city"],
  labels: { region: "State / province / region" },
}

export const ADDRESS_FORMATS: Record<string, AddressFormatInput> = {
  US: {
    rows: [NAMES, ...STREET, ["city", "region", "postalCode"], ["phone"]],
    required: ["givenName", "familyName", "line1", "city", "region", "postalCode"],
    labels: { region: "State", postalCode: "ZIP code" },
    regions: US_STATES,
    postalCode: { pattern: /^\d{5}(?:[-\s]?\d{4})?$/, example: "94103", numeric: true },
  },
  CA: {
    rows: [NAMES, ...STREET, ["city", "region", "postalCode"], ["phone"]],
    required: ["givenName", "familyName", "line1", "city", "region", "postalCode"],
    labels: { region: "Province" },
    regions: CA_PROVINCES,
    postalCode: { pattern: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][\s-]?\d[ABCEGHJ-NPRSTV-Z]\d$/i, example: "K1A 0B1" },
  },
  GB: {
    rows: [NAMES, ...STREET, ["city", "postalCode"], ["phone"]],
    required: ["givenName", "familyName", "line1", "city", "postalCode"],
    labels: { city: "Town or city", postalCode: "Postcode" },
    postalCode: { pattern: /^(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i, example: "SW1A 1AA" },
  },
  AU: {
    rows: [NAMES, ...STREET, ["city", "region", "postalCode"], ["phone"]],
    required: ["givenName", "familyName", "line1", "city", "region", "postalCode"],
    labels: { city: "Suburb", region: "State", postalCode: "Postcode" },
    regions: AU_STATES,
    postalCode: { pattern: /^\d{4}$/, example: "2000", numeric: true },
  },
  IN: {
    rows: [NAMES, ...STREET, ["city", "region", "postalCode"], ["phone"]],
    // Couriers in India call before delivering.
    required: ["givenName", "familyName", "line1", "city", "region", "postalCode", "phone"],
    labels: { line2: "Apartment, area, landmark", region: "State", postalCode: "PIN code" },
    regions: IN_STATES,
    postalCode: { pattern: /^[1-9]\d{2}\s?\d{3}$/, example: "110001", numeric: true },
  },
  DE: {
    rows: [NAMES, ...STREET, ["postalCode", "city"], ["phone"]],
    required: ["givenName", "familyName", "line1", "city", "postalCode"],
    labels: { line1: "Street and house number", postalCode: "Postcode" },
    postalCode: { pattern: /^\d{5}$/, example: "10115", numeric: true },
  },
  FR: {
    rows: [NAMES, ...STREET, ["postalCode", "city"], ["phone"]],
    required: ["givenName", "familyName", "line1", "city", "postalCode"],
    labels: { postalCode: "Postcode" },
    postalCode: { pattern: /^\d{2}\s?\d{3}$/, example: "75001", numeric: true },
  },
  JP: {
    // Family name first, then the address from the largest unit down.
    rows: [["familyName", "givenName"], ["postalCode", "region"], ["city"], ...STREET, ["phone"]],
    required: ["familyName", "givenName", "postalCode", "region", "city", "line1"],
    labels: { region: "Prefecture", city: "City, ward, town", line1: "Street address", line2: "Building, room" },
    regions: JP_PREFECTURES,
    postalCode: { pattern: /^\d{3}-?\d{4}$/, example: "100-0001", numeric: true },
  },
}

/** Every ISO 3166-1 alpha-2 code. Pass `countries` to the form to offer only those you ship to. */
export const COUNTRY_CODES: readonly string[] = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
  BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM
  CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD
  GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS
  IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME
  MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ
  OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK
  SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US
  UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/)

/* ─── resolving a format ───────────────────────────────────────────────── */

export interface AddressFormatOptions {
  /** Your countries, or changes to ours — merged over the built-in entry. */
  formats?: Record<string, Partial<AddressFormatInput>>
  /** Show, hide or require the company, second address line and phone everywhere. */
  fields?: AddressFieldModes
}

/** Where a field goes back in when a mode turns it on. */
function insertRow(rows: AddressFieldName[][], field: AddressFieldName): AddressFieldName[][] {
  if (field === "phone") return [...rows, ["phone"]]
  const anchor = field === "line2" ? "line1" : rows[0]?.find((f) => f === "givenName" || f === "familyName")
  const at = rows.findIndex((row) => anchor !== undefined && row.includes(anchor))
  return at === -1 ? [[field], ...rows] : [...rows.slice(0, at + 1), [field], ...rows.slice(at + 1)]
}

/** The format for a country — built-in, generic, or yours — with field modes applied. */
export function getAddressFormat(country: string, options: AddressFormatOptions = {}): AddressFormat {
  const code = country.toUpperCase()
  const base = ADDRESS_FORMATS[code] ?? GENERIC_ADDRESS_FORMAT
  const own = options.formats?.[code]
  const input: AddressFormatInput = { ...base, ...own, labels: { ...base.labels, ...own?.labels } }

  let rows = input.rows.map((row) => [...row])
  let required = [...input.required]
  for (const [field, mode] of Object.entries(options.fields ?? {}) as [AddressFieldName, AddressFieldMode][]) {
    const shown = rows.some((row) => row.includes(field))
    if (mode === "hidden") {
      rows = rows.map((row) => row.filter((f) => f !== field)).filter((row) => row.length > 0)
      required = required.filter((f) => f !== field)
      continue
    }
    if (!shown) rows = insertRow(rows, field)
    required = mode === "required" ? [...new Set([...required, field])] : required.filter((f) => f !== field)
  }

  return {
    rows,
    required,
    labels: { ...DEFAULT_ADDRESS_LABELS, ...input.labels },
    regions: input.regions,
    cities: input.cities,
    postalCode: input.postalCode,
  }
}

/** An empty address in a country. */
export function emptyAddress(country = "US"): Address {
  return { country, givenName: "", familyName: "", line1: "", city: "" }
}

/* ─── validation ───────────────────────────────────────────────────────── */

/** "State" -> "state", but "ZIP code" and "PIN code" keep their capitals. */
const lower = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label)
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a")
const named = (label: string) => `${article(lower(label))} ${lower(label)}`

function missing(field: AddressFieldName, format: AddressFormat) {
  const label = format.labels[field]
  if (field === "givenName" || field === "familyName") return `Enter your ${lower(label)}`
  if (field === "phone") return "Enter a phone number"
  if (field === "region" && format.regions) return `Choose ${named(label)}`
  return `Enter ${named(label)}`
}

/**
 * The same rules the form shows, as a pure function: required fields, the
 * postcode's shape, a region from the list, a plausible phone number. Returns
 * an error message per field, or `{}` when the address will do. Run it again
 * on your server — the browser's copy can be skipped.
 */
export function validateAddress(address: Address, format: AddressFormat = getAddressFormat(address.country)): AddressErrors {
  const errors: AddressErrors = {}
  if (!address.country?.trim()) errors.country = "Choose a country"

  const shown = new Set(format.rows.flat())
  for (const field of shown) {
    const value = (address[field] ?? "").trim()
    if (!value) {
      if (format.required.includes(field)) errors[field] = missing(field, format)
      continue
    }
    if (field === "postalCode" && format.postalCode && !format.postalCode.pattern.test(value)) {
      errors.postalCode = `Enter a valid ${lower(format.labels.postalCode)}, like ${format.postalCode.example}`
    }
    if (field === "region" && format.regions && !format.regions.some((r) => r.code === value)) {
      errors.region = `Choose ${named(format.labels.region)} from the list`
    }
    if (field === "phone" && !(/^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 6)) {
      errors.phone = "Enter a valid phone number"
    }
  }
  return errors
}

/* ─── display ──────────────────────────────────────────────────────────── */

/**
 * The address as lines for a label or a "Ship to" summary, in the country's
 * order: "San Francisco, California 94103", "10115 Berlin". Region codes
 * become names; the country itself is left to you.
 */
export function formatAddressLines(address: Address, format: AddressFormat = getAddressFormat(address.country)): string[] {
  const text = (field: AddressFieldName) => {
    const value = (address[field] ?? "").trim()
    if (field !== "region" || !format.regions) return value
    return format.regions.find((r) => r.code === value)?.name ?? value
  }
  return format.rows
    .filter((row) => !row.includes("phone"))
    .map((row) => {
      const parts = row.map((field) => ({ field, value: text(field) })).filter((p) => p.value)
      return parts
        .map((p, i) => {
          if (i === 0) return p.value
          const prev = parts[i - 1]
          const tight = p.field === "postalCode" || prev.field === "postalCode" || prev.field === "givenName" || prev.field === "familyName"
          return (tight ? " " : ", ") + p.value
        })
        .join("")
    })
    .filter(Boolean)
}
