"use client"

import * as React from "react"
import { CircleAlert } from "lucide-react"
import { AnimatePresence, MotionConfig, animate, motion, useReducedMotion } from "motion/react"

import { Checkbox } from "@/components/ui/checkbox"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  COUNTRY_CODES,
  getAddressFormat,
  type Address,
  type AddressErrors,
  type AddressFieldModes,
  type AddressFieldName,
  type AddressFormat,
  type AddressFormatInput,
} from "@/lib/address-format"
import { useT } from "@open-mercato/shared/lib/i18n/context"
import { cn } from "@/lib/utils"

/*
 * A shipping or billing address whose fields follow the country: a US
 * address asks for a state and a ZIP code, a UK one for a town and a
 * postcode, a Japanese one starts with the family name.
 *
 *   const [address, setAddress] = React.useState(emptyAddress("US"))
 *   <AddressForm value={address} onValueChange={setAddress} errors={errors} />
 *
 *   <AddressForm value={address} onValueChange={setAddress}>          or composed
 *     <AddressFormErrorSummary />
 *     <AddressFormCountry />
 *     <AddressFormFields />
 *   </AddressForm>
 *
 * Country and region are your shadcn Combobox — type "ger" for Germany —
 * and every field carries its `autocomplete` token, so browser autofill
 * fills the lot, country and state included. Validation is yours to run:
 * `validateAddress` from `@/lib/address-format` is a pure function, so the
 * server checks with the same rules; pass what it returns as `errors`.
 * Fields that come and go with the country grow and fold to their measured
 * height, and the lists grow out of their field (Motion; a fade under
 * reduced motion).
 */

export type { Address, AddressErrors, AddressFieldModes, AddressFieldName, AddressFormat } from "@/lib/address-format"

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const
const FADE = { duration: 0.15 } as const

const subscribeNothing = () => () => {}

/** Your locale, or the visitor's once hydrated — so server and client HTML agree. */
function useFormatLocale(locale?: string) {
  const hydrated = React.useSyncExternalStore(subscribeNothing, () => true, () => false)
  return locale ?? (hydrated ? undefined : "en-US")
}

/** Each field's autofill token, after the section ("shipping" / "billing"). */
const AUTOCOMPLETE: Record<AddressFieldName, string> = {
  givenName: "given-name",
  familyName: "family-name",
  organization: "organization",
  line1: "address-line1",
  line2: "address-line2",
  city: "address-level2",
  region: "address-level1",
  postalCode: "postal-code",
  phone: "tel",
}

/** Side by side once the form is wide enough — the form's width, not the screen's. */
const COLUMNS: Record<number, string> = {
  1: "",
  2: "@sm/address-form:grid-cols-2",
  3: "@sm/address-form:grid-cols-2 @md/address-form:grid-cols-3",
}

/** Grows to its measured height and folds back; a plain fade under reduced motion. */
function fold(reduce: boolean | null) {
  return reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: FADE }
    : {
        initial: { height: 0, opacity: 0, overflow: "hidden" },
        // Visible once open, so focus rings aren't clipped.
        animate: { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } },
        exit: { height: 0, opacity: 0, overflow: "hidden" },
        transition: MORPH,
      }
}

/** "State" -> "state", but "ZIP code" keeps its capitals. */
const lower = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label)

type Option = { value: string; label: string }

/** Lower case, accents off: "cote" finds "Côte d’Ivoire". */
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

/**
 * Best match first: the code itself ("de"), then names that start with what
 * was typed ("ger" -> Germany), then a word inside the name ("kingdom"),
 * then anywhere — so "ger" doesn't open on Algeria.
 */
function rank(options: Option[], query: string) {
  const q = plain(query.trim())
  if (!q) return options
  const scored: { option: Option; score: number; index: number }[] = []
  options.forEach((option, index) => {
    const label = plain(option.label)
    const at = label.indexOf(q)
    let score = -1
    if (option.value.toLowerCase() === q) score = 0
    else if (at === 0) score = 1
    else if (at > 0 && /[\s(\-’']/.test(label[at - 1])) score = 2
    else if (at > 0) score = 3
    if (score !== -1) scored.push({ option, score, index })
  })
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.option)
}

/* ─── context ──────────────────────────────────────────────────────────── */

type Part = AddressFieldName | "country"

export interface AddressFormContextValue {
  value: Address
  /** The format for the chosen country, with your `formats` and `fields` applied. */
  format: AddressFormat
  /** Sets one field. A new country drops a region it doesn't have. */
  setField: (field: Part, next: string) => void
  /** Sets several fields at once — what an address lookup calls with its result. */
  setAddress: (patch: Partial<Address>) => void
  /** The errors on show: yours, less any field the shopper has edited since. */
  errors: AddressErrors
  section: "shipping" | "billing"
  /** The id of a field's input, for a label or a link of your own. */
  fieldId: (field: Part) => string
  /** Moves focus to a field and scrolls it into view. */
  focusField: (field: Part) => void
  countries: Option[]
  name?: string
  lookup?: React.ReactNode
  saveAsDefault: boolean
  /** Undefined when the form was given no `onSaveAsDefaultChange`. */
  setSaveAsDefault?: (checked: boolean) => void
  disabled: boolean
  loading: boolean
}

const AddressFormContext = React.createContext<AddressFormContextValue | null>(null)

export function useAddressForm() {
  const context = React.useContext(AddressFormContext)
  if (!context) {
    throw new Error("useAddressForm must be used within <AddressForm>.")
  }
  return context
}

/* ─── root ─────────────────────────────────────────────────────────────── */

export interface AddressFormProps
  extends Omit<React.FieldsetHTMLAttributes<HTMLFieldSetElement>, "onChange" | "defaultValue" | "name" | "children"> {
  value: Address
  onValueChange: (address: Address) => void
  /** Prefixes every autocomplete token, so a billing form never autofills as shipping. */
  section?: "shipping" | "billing"
  /** Messages by field — from `validateAddress`, your schema or your server. */
  errors?: AddressErrors | null
  /** ISO codes to offer, in your order. Every country, by name, when left out. */
  countries?: string[]
  /** Your countries, or changes to ours — see `AddressFormatInput`. */
  formats?: Record<string, Partial<AddressFormatInput>>
  /** Show, hide or require the company, second line and phone in every country. */
  fields?: AddressFieldModes
  /** For country names. `undefined` follows the visitor's locale, once hydrated. */
  locale?: string
  /** "Shipping address" or "Billing address", by default. */
  legend?: React.ReactNode
  /** Keeps the legend for screen readers when your page already has a heading. */
  hideLegend?: boolean
  /** An address search — Google Places, Loqate, your own — placed above the fields. */
  lookup?: React.ReactNode
  saveAsDefault?: boolean
  /** Shows "Save as my default address"; leave it out to hide the checkbox. */
  onSaveAsDefaultChange?: (checked: boolean) => void
  /** Names every input `${name}.city` and so on, for a plain form post. */
  name?: string
  loading?: boolean
  children?: React.ReactNode
}

export function AddressForm({
  value,
  onValueChange,
  section = "shipping",
  errors,
  countries,
  formats,
  fields,
  locale: localeProp,
  legend,
  hideLegend = false,
  lookup,
  saveAsDefault = false,
  onSaveAsDefaultChange,
  name,
  loading = false,
  disabled = false,
  className,
  children,
  ...props
}: AddressFormProps) {
  const locale = useFormatLocale(localeProp)
  const reduce = useReducedMotion()
  const uid = React.useId()
  const t = useT()

  const formatOptions = React.useMemo(() => ({ formats, fields }), [formats, fields])
  const format = React.useMemo(() => getAddressFormat(value.country ?? "", formatOptions), [value.country, formatOptions])

  // Autofill fires a change per field in one tick, before React re-renders;
  // building each from the last one sent keeps all of them.
  const latest = React.useRef(value)
  React.useLayoutEffect(() => {
    latest.current = value
  }, [value])
  const emit = React.useCallback(
    (next: Address) => {
      latest.current = next
      onValueChange(next)
    },
    [onValueChange]
  )

  // A field's error stays until the shopper edits it, or new errors arrive.
  const errorsKey = JSON.stringify(errors ?? {})
  const [edited, setEdited] = React.useState({ errorsKey, fields: new Set<Part>() })
  if (edited.errorsKey !== errorsKey) setEdited({ errorsKey, fields: new Set() })
  const visibleErrors = React.useMemo(() => {
    const shown: AddressErrors = {}
    for (const [field, message] of Object.entries(errors ?? {}) as [Part, string | undefined][]) {
      if (message && !edited.fields.has(field)) shown[field] = message
    }
    return shown
  }, [errors, edited])
  const markEdited = React.useCallback(
    (parts: Part[]) =>
      setEdited((prev) => (parts.every((p) => prev.fields.has(p)) ? prev : { ...prev, fields: new Set([...prev.fields, ...parts]) })),
    []
  )

  const setAddress = React.useCallback(
    (patch: Partial<Address>) => {
      const current = latest.current
      const next = { ...current, ...patch }
      if (patch.country !== undefined && patch.country !== current.country && patch.region === undefined) {
        // A region only carries over between countries that both type it in.
        const from = getAddressFormat(current.country ?? "", formatOptions).regions
        const to = getAddressFormat(patch.country, formatOptions).regions
        const keeps = to ? to.some((r) => r.code === current.region) : !from
        if (!keeps) next.region = ""
      }
      // A city chosen from a list goes when its region changes to one without it.
      const cityList = getAddressFormat(next.country ?? "", formatOptions).cities
      if (cityList && patch.region !== undefined && patch.region !== current.region && patch.city === undefined) {
        if (!cityList(next.region ?? "").some((c) => c.code === next.city)) next.city = ""
      }
      markEdited(Object.keys(patch) as Part[])
      emit(next)
    },
    [emit, formatOptions, markEdited]
  )
  const setField = React.useCallback((field: Part, next: string) => setAddress({ [field]: next }), [setAddress])

  const fieldId = React.useCallback((field: Part) => `${uid}-${field}`, [uid])
  const focusField = React.useCallback(
    (field: Part) => {
      const input = document.getElementById(fieldId(field))
      if (!input) return
      input.focus({ preventScroll: true })
      input.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" })
    },
    [fieldId, reduce]
  )

  const countryOptions = useCountryOptions(countries, value.country, locale)

  const context = React.useMemo<AddressFormContextValue>(
    () => ({
      value,
      format,
      setField,
      setAddress,
      errors: visibleErrors,
      section,
      fieldId,
      focusField,
      countries: countryOptions,
      name,
      lookup,
      saveAsDefault,
      setSaveAsDefault: onSaveAsDefaultChange,
      disabled,
      loading,
    }),
    [value, format, setField, setAddress, visibleErrors, section, fieldId, focusField, countryOptions, name, lookup, saveAsDefault, onSaveAsDefaultChange, disabled, loading]
  )

  return (
    <AddressFormContext.Provider value={context}>
      <MotionConfig reducedMotion="user">
        <FieldSet
          data-slot="address-form"
          data-section={section}
          disabled={disabled}
          aria-busy={loading || undefined}
          className={cn("@container/address-form min-w-0 gap-5", className)}
          {...props}
        >
          <FieldLegend className={cn(hideLegend && "sr-only")}>
            {legend ?? (section === "billing" ? t("ecomcn.address.billing", "Billing address") : t("ecomcn.address.shipping", "Shipping address"))}
          </FieldLegend>
          {loading ? (
            <AddressFormSkeleton />
          ) : (
            (children ?? (
              <>
                <AddressFormErrorSummary />
                <AddressFormCountry />
                <AddressFormLookup />
                <AddressFormFields />
                <AddressFormSaveDefault />
              </>
            ))
          )}
        </FieldSet>
      </MotionConfig>
    </AddressFormContext.Provider>
  )
}

/** Country names in the visitor's language: every country by name, or yours in your order. */
function useCountryOptions(codes: string[] | undefined, current: string | undefined, locale: string | undefined) {
  const key = codes?.join(",")
  return React.useMemo(() => {
    let names: Intl.DisplayNames | null = null
    try {
      names = new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region" })
    } catch {
      // Very old engines: show the codes.
    }
    const list = key ? key.split(",") : [...COUNTRY_CODES]
    if (current && !list.includes(current.toUpperCase())) list.push(current.toUpperCase())
    const options = list.map((code) => ({ value: code.toUpperCase(), label: names?.of(code.toUpperCase()) ?? code }))
    if (!key) options.sort((a, b) => a.label.localeCompare(b.label, locale))
    return options
  }, [key, current, locale])
}

/* ─── a combobox that grows out of its field ───────────────────────────── */

const OPEN_CLIP = "inset(-10% -10% -10% -10%)"

interface AddressComboboxProps {
  id: string
  options: Option[]
  value: string
  onValueChange: (value: string) => void
  autoComplete: string
  name?: string
  invalid: boolean
  describedBy?: string
  required: boolean
  disabled: boolean
  empty: string
}

/**
 * Your shadcn Combobox, searchable, with its list growing out of the field
 * it belongs to and folding back into it. Base UI is told to wait for the
 * fold before it unmounts the list.
 */
function AddressCombobox({
  id,
  options,
  value,
  onValueChange,
  autoComplete,
  name,
  invalid,
  describedBy,
  required,
  disabled,
  empty,
}: AddressComboboxProps) {
  const reduce = useReducedMotion()
  const popupId = React.useId()
  const actionsRef = React.useRef<{ unmount: () => void; close: () => void } | null>(null)
  const phase = React.useRef<"closed" | "opening" | "open" | "closing">("closed")
  const running = React.useRef<{ stop: () => void } | null>(null)
  const frame = React.useRef(0)

  const selected = React.useMemo(() => options.find((o) => o.value === value) ?? null, [options, value])
  const [query, setQuery] = React.useState("")
  const filtered = React.useMemo(() => rank(options, query), [options, query])
  const findPopup = () => document.querySelector<HTMLElement>(`[data-address-popup="${popupId}"]`)

  /** `fromHere` reverses a fold already under way rather than restarting it. */
  const play = (popup: HTMLElement, open: boolean, fromHere = false) => {
    running.current?.stop()
    if (reduce) {
      const controls = animate(popup, { opacity: open ? 1 : 0 }, FADE)
      running.current = controls
      return controls
    }
    // From the field's edge: down from below it, up from above it.
    const shut = popup.getAttribute("data-side") === "top" ? "inset(100% -10% -10% -10%)" : "inset(-10% -10% 100% -10%)"
    const controls = animate(
      popup,
      { clipPath: open && !fromHere ? [shut, OPEN_CLIP] : open ? OPEN_CLIP : shut },
      MORPH
    )
    running.current = controls
    return controls
  }

  // The list mounts a frame or two after the open request, in a portal.
  const playOpen = (tries = 12) => {
    cancelAnimationFrame(frame.current)
    const popup = findPopup()
    if (!popup) {
      if (tries > 0) frame.current = requestAnimationFrame(() => playOpen(tries - 1))
      return
    }
    const reversing = phase.current === "closing"
    phase.current = "opening"
    play(popup, true, reversing).then(() => {
      if (phase.current === "opening") phase.current = "open"
    })
  }

  React.useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return (
    <Combobox
      items={options}
      filteredItems={filtered}
      onInputValueChange={(input: string) => setQuery(input)}
      value={selected}
      onValueChange={(next: Option | null) => onValueChange(next?.value ?? "")}
      isItemEqualToValue={(a: Option, b: Option) => a.value === b.value}
      autoHighlight
      // The browser fills a hidden input with this token; Base UI matches
      // "US" or "United States" to an option and selects it.
      autoComplete={autoComplete}
      name={name}
      disabled={disabled}
      actionsRef={actionsRef}
      onOpenChange={(open, details) => {
        if (open) {
          playOpen()
          return
        }
        cancelAnimationFrame(frame.current)
        const popup = findPopup()
        if (!popup) return
        details.preventUnmountOnClose()
        phase.current = "closing"
        play(popup, false).then(() => {
          if (phase.current !== "closing") return
          phase.current = "closed"
          actionsRef.current?.unmount()
        })
      }}
    >
      <ComboboxInput
        id={id}
        className="w-full"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
      />
      <ComboboxContent
        data-address-popup={popupId}
        className={cn(
          // Motion runs the open and close; the primitive's keyframes would fight it.
          "animate-none!",
          reduce
            ? "opacity-0"
            : "[clip-path:inset(-10%_-10%_100%_-10%)] data-[side=top]:[clip-path:inset(100%_-10%_-10%_-10%)]"
        )}
      >
        <ComboboxEmpty>{empty}</ComboboxEmpty>
        <ComboboxList className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(option: Option) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/* ─── parts ────────────────────────────────────────────────────────────── */

function FieldLabelText({ label, required }: { label: string; required: boolean }) {
  const t = useT()
  return (
    <>
      {label}
      {!required && <span className="font-normal text-muted-foreground">{t("ecomcn.address.optional", "(optional)")}</span>}
    </>
  )
}

export interface AddressFormCountryProps extends React.HTMLAttributes<HTMLDivElement> {
  /** "Country / region", by default. */
  label?: string
}

/** The country, first: it decides every field below it. */
export function AddressFormCountry({ label: labelProp, className, ...props }: AddressFormCountryProps) {
  const t = useT()
  const label = labelProp ?? t("ecomcn.address.country", "Country / region")
  const { value, countries, setField, errors, fieldId, section, name, disabled } = useAddressForm()
  const id = fieldId("country")
  const error = errors.country
  return (
    <Field
      data-slot="address-form-country"
      data-invalid={error ? true : undefined}
      data-disabled={disabled || undefined}
      className={className}
      {...props}
    >
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <AddressCombobox
        id={id}
        options={countries}
        value={value.country ?? ""}
        onValueChange={(next) => setField("country", next)}
        autoComplete={`${section} country`}
        name={name ? `${name}.country` : undefined}
        invalid={!!error}
        describedBy={error ? `${id}-error` : undefined}
        required
        disabled={disabled}
        empty={t("ecomcn.address.noCountry", "No country matches")}
      />
      <FieldError id={`${id}-error`} role={undefined}>
        {error}
      </FieldError>
    </Field>
  )
}

export interface AddressFormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  field: AddressFieldName
}

/** One field, labelled and wired: its autofill token, its error, its keyboard. */
export function AddressFormField({ field, className, ...props }: AddressFormFieldProps) {
  const t = useT()
  const { value, format, setField, errors, fieldId, section, name, disabled } = useAddressForm()
  const cityOptions = field === "city" && format.cities ? format.cities(value.region ?? "") : null
  const id = fieldId(field)
  const error = errors[field]
  const required = format.required.includes(field)
  const label = format.labels[field]
  const describedBy = error ? `${id}-error` : undefined
  const autoComplete = `${section} ${AUTOCOMPLETE[field]}`
  const inputName = name ? `${name}.${field}` : undefined

  const control =
    field === "region" && format.regions ? (
      <AddressCombobox
        id={id}
        options={format.regions.map((r) => ({ value: r.code, label: r.name }))}
        value={value.region ?? ""}
        onValueChange={(next) => setField("region", next)}
        autoComplete={autoComplete}
        name={inputName}
        invalid={!!error}
        describedBy={describedBy}
        required={required}
        disabled={disabled}
        empty={t("ecomcn.address.noMatch", "No {label} matches", { label: lower(label) })}
      />
    ) : cityOptions ? (
      <AddressCombobox
        id={id}
        options={cityOptions.map((c) => ({ value: c.code, label: c.name }))}
        value={value.city ?? ""}
        onValueChange={(next) => setField("city", next)}
        autoComplete={autoComplete}
        name={inputName}
        invalid={!!error}
        describedBy={describedBy}
        required={required}
        disabled={disabled || !cityOptions.length}
        empty={t("ecomcn.address.noMatch", "No {label} matches", { label: lower(label) })}
      />
    ) : (
      <Input
        id={id}
        name={inputName}
        value={value[field] ?? ""}
        onChange={(event) => setField(field, event.target.value)}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        disabled={disabled}
        {...(field === "phone" && { type: "tel", inputMode: "tel" as const })}
        {...(field === "postalCode" && {
          inputMode: format.postalCode?.numeric ? ("numeric" as const) : undefined,
          autoCapitalize: format.postalCode?.numeric ? undefined : "characters",
          spellCheck: false,
        })}
        {...((field === "givenName" || field === "familyName" || field === "city") && { autoCapitalize: "words" })}
      />
    )

  return (
    <Field
      data-slot="address-form-field"
      data-field={field}
      data-invalid={error ? true : undefined}
      data-disabled={disabled || undefined}
      className={cn("min-w-0", className)}
      {...props}
    >
      <FieldLabel htmlFor={id}>
        <FieldLabelText label={label} required={required} />
      </FieldLabel>
      {control}
      <FieldError id={`${id}-error`} role={undefined}>
        {error}
      </FieldError>
    </Field>
  )
}

/**
 * The country's fields, row by row. A row the new country doesn't have
 * folds away where it stood and a new one grows in where it belongs; the
 * rows that stay move only as far as those heights carry them. No layout
 * slide on top: two motions on one row is how fields end up overlapping.
 */
export function AddressFormFields({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { format } = useAddressForm()
  const reduce = useReducedMotion()
  const motionProps = fold(reduce)
  return (
    <div data-slot="address-form-fields" className={cn("flex flex-col", className)} {...props}>
      <AnimatePresence initial={false}>
        {format.rows.map((row) => (
          <motion.div key={row.join("+")} {...motionProps}>
            <div className={cn("grid gap-4 pb-5", COLUMNS[row.length] ?? COLUMNS[3])}>
              {row.map((field) => (
                <AddressFormField key={field} field={field} />
              ))}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/** Your address search, above the fields. Calls `useAddressForm().setAddress` with its result. */
export function AddressFormLookup({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { lookup } = useAddressForm()
  const content = children ?? lookup
  if (!content) return null
  return (
    <div data-slot="address-form-lookup" className={className} {...props}>
      {content}
    </div>
  )
}

export interface AddressFormSaveDefaultProps extends React.HTMLAttributes<HTMLLabelElement> {
  /** "Save as my default shipping address", by default. */
  label?: React.ReactNode
}

/** Shown only when the form was given `onSaveAsDefaultChange`. */
export function AddressFormSaveDefault({ label, className, ...props }: AddressFormSaveDefaultProps) {
  const t = useT()
  const { saveAsDefault, setSaveAsDefault, section, disabled } = useAddressForm()
  if (!setSaveAsDefault) return null
  return (
    <label
      data-slot="address-form-save-default"
      className={cn("flex w-fit cursor-pointer items-center gap-3 text-sm", disabled && "cursor-not-allowed opacity-50", className)}
      {...props}
    >
      <Checkbox checked={saveAsDefault} disabled={disabled} onCheckedChange={(checked: boolean) => setSaveAsDefault(checked === true)} />
      {label ?? t("ecomcn.address.saveDefault", "Save as my default address")}
    </label>
  )
}

/**
 * Every error at once, at the top, each a link to its field — for the
 * shopper who pressed continue at the bottom. It takes focus when it
 * appears, and folds away as the fields are fixed.
 */
export function AddressFormErrorSummary({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { errors, format, focusField, fieldId } = useAddressForm()
  const reduce = useReducedMotion()
  const order: Part[] = ["country", ...format.rows.flat()]
  const entries = order.flatMap((field) => (errors[field] ? [{ field, message: errors[field] as string }] : []))
  return (
    <AnimatePresence initial={false}>
      {entries.length > 0 && (
        <motion.div key="summary" {...fold(reduce)}>
          <ErrorSummaryBody
            entries={entries}
            focusField={focusField}
            fieldId={fieldId}
            className={className}
            {...props}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Takes its entries as props, so it keeps them while the summary folds away. */
function ErrorSummaryBody({
  entries,
  focusField,
  fieldId,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  entries: { field: Part; message: string }[]
  focusField: (field: Part) => void
  fieldId: (field: Part) => string
}) {
  const t = useT()
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    ref.current?.scrollIntoView({ block: "nearest" })
  }, [])
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      data-slot="address-form-error-summary"
      className={cn("mb-1 border-s-2 border-destructive py-1 ps-4 text-sm outline-none", className)}
      {...props}
    >
      <p className="flex items-center gap-2 font-medium text-destructive">
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        {entries.length === 1 ? t("ecomcn.address.checkOne", "Check this field") : t("ecomcn.address.checkMany", "Check these {count} fields", { count: entries.length })}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {entries.map(({ field, message }) => (
          <li key={field}>
            <a
              href={`#${fieldId(field)}`}
              onClick={(event) => {
                event.preventDefault()
                focusField(field)
              }}
              className="underline underline-offset-4 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The form's shape, while you load a saved address. */
function AddressFormSkeleton() {
  const { format } = useAddressForm()
  const rows: string[][] = [["country"], ...format.rows]
  return (
    <div data-slot="address-form-skeleton" className="flex flex-col gap-5">
      <span className="sr-only" role="status">
        Loading the address form
      </span>
      {rows.map((row) => (
        <div key={row.join("+")} aria-hidden className={cn("grid gap-4", COLUMNS[row.length] ?? COLUMNS[3])}>
          {row.map((field) => (
            <div key={field} className="flex flex-col gap-3">
              <Skeleton className="h-3.5 w-24 rounded-none" />
              <Skeleton className="h-9 w-full rounded-none" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
