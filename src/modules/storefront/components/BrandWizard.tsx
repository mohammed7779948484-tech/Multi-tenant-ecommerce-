"use client"
import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { CrudForm, type CrudField, type CrudFormGroup, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { ColorPicker } from '@open-mercato/ui/primitives/color-picker'
import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  COLOR_TOKEN_KEYS,
  DENSITY_VALUES,
  FONT_STACK_IDS,
  MIN_CONTRAST,
  RADIUS_VALUES,
  RECOMMENDED_CONTRAST,
  THEME_PRESETS,
  contrastRatio,
  type ColorTokenKey,
} from '../lib/theme'
import {
  BRAND_API_PATH,
  OVERVIEW_HREF,
  SITE_ENTITY_ID,
  colorFieldId,
  toBrandFormValues,
  toBrandRequestBody,
  toFormFieldErrors,
  type BrandFormValues,
  type BrandPayload,
} from './brandForm'

type Translate = ReturnType<typeof useT>

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/
const LOGO_MAX_BYTES = 2 * 1024 * 1024

type UploadPayload = { ok: true; item: { id: string } }

/** One colour token: the shared picker (swatch, hue slider and HEX input in one keyboard-reachable popover). */
function ColorTokenInput({ value, disabled, setValue, label }: CrudCustomFieldRenderProps & { label: string }) {
  const text = typeof value === 'string' ? value : ''
  return (
    <ColorPicker
      value={HEX_PATTERN.test(text) ? text.toLowerCase() : '#000000'}
      onChange={(next) => setValue(next.toLowerCase())}
      disabled={disabled}
      aria-label={label}
      enableEyedropper={false}
    />
  )
}

/** Logo upload: files go to the attachments module, the form keeps only the attachment id. */
function LogoInput({ value, disabled, setValue, setFormValue, values }: CrudCustomFieldRenderProps) {
  const t = useT()
  const [uploading, setUploading] = React.useState(false)
  const objectUrlRef = React.useRef<string | null>(null)
  React.useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])
  const siteId = typeof values?.siteId === 'string' ? values.siteId : ''
  const previewUrl = value && typeof values?.logoPreviewUrl === 'string' ? values.logoPreviewUrl : null

  const onChange = React.useCallback(
    async (file: File | null) => {
      if (!file) {
        setValue(null)
        setFormValue?.('logoPreviewUrl', null)
        return
      }
      setUploading(true)
      try {
        const form = new FormData()
        form.set('entityId', SITE_ENTITY_ID)
        form.set('recordId', siteId)
        form.set('file', file)
        form.set('tags', JSON.stringify(['storefront-logo']))
        const upload = await readApiResultOrThrow<UploadPayload>(
          '/api/attachments',
          { method: 'POST', body: form },
          { errorMessage: t('storefront.brand.logo.uploadFailed', 'The logo could not be uploaded. The previous logo is kept.') },
        )
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = URL.createObjectURL(file)
        setValue(upload.item.id)
        setFormValue?.('logoPreviewUrl', objectUrlRef.current)
      } catch (err) {
        flash(err instanceof Error && err.message ? err.message : t('storefront.brand.logo.uploadFailed', 'The logo could not be uploaded. The previous logo is kept.'), 'error')
      } finally {
        setUploading(false)
      }
    },
    [setFormValue, setValue, siteId, t],
  )

  return (
    <div className="flex flex-col gap-2">
      <ImageUpload
        kind="company"
        alignment="horizontal"
        src={previewUrl}
        alt={t('storefront.brand.logo.alt', 'Store logo')}
        heading={t('storefront.brand.logo.heading', 'Store logo')}
        description={t('storefront.brand.logo.hint', 'PNG or JPEG, at least 64×64 px, up to 2 MB. Without a logo the store name is shown.')}
        maxSizeBytes={LOGO_MAX_BYTES}
        minWidth={64}
        minHeight={64}
        disabled={disabled || uploading}
        onChange={(file) => void onChange(file)}
      />
      {uploading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner size="sm" />
          {t('storefront.brand.logo.uploading', 'Uploading…')}
        </div>
      ) : null}
    </div>
  )
}

function ChoiceInput<T extends string>({
  value,
  setValue,
  disabled,
  options,
  label,
}: CrudCustomFieldRenderProps & { options: ReadonlyArray<{ value: T; label: string }>; label: string }) {
  return (
    <SegmentedControl
      value={typeof value === 'string' ? value : undefined}
      onValueChange={(next) => setValue(next)}
      disabled={disabled}
      aria-label={label}
    >
      {options.map((option) => (
        <SegmentedControlItem key={option.value} value={option.value}>
          {option.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}

function readHex(values: Record<string, unknown>, key: ColorTokenKey): string | null {
  const raw = values[colorFieldId(key)]
  return typeof raw === 'string' && HEX_PATTERN.test(raw) ? raw : null
}

/** Contrast of the two pairs the validator enforces, for live hints. */
function contrastChecks(values: Record<string, unknown>) {
  const pairs: Array<[ColorTokenKey, ColorTokenKey]> = [
    ['text', 'background'],
    ['onPrimary', 'primary'],
  ]
  return pairs.map(([fg, bg]) => {
    const foreground = readHex(values, fg)
    const background = readHex(values, bg)
    const ratio = foreground && background ? contrastRatio(foreground, background) : null
    return { fg, bg, ratio }
  })
}

function ColorAssistant({ values, setValue, t }: { values: Record<string, unknown>; setValue: (id: string, v: unknown) => void; t: Translate }) {
  const checks = contrastChecks(values)
  const warnings = checks.filter((check) => check.ratio !== null && check.ratio < RECOMMENDED_CONTRAST)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('storefront.brand.presets.label', 'Start from a palette')}</span>
        {Object.entries(THEME_PRESETS).map(([presetId, colors]) => (
          <Button
            key={presetId}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              for (const key of COLOR_TOKEN_KEYS) setValue(colorFieldId(key), colors[key])
            }}
          >
            {t(`storefront.brand.presets.${presetId}`, presetId)}
          </Button>
        ))}
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {warnings.map(({ fg, bg, ratio }) => (
          <Alert key={fg} status={ratio !== null && ratio < MIN_CONTRAST ? 'error' : 'warning'} size="sm">
            <AlertDescription>
              {t(
                ratio !== null && ratio < MIN_CONTRAST ? 'storefront.brand.contrast.blocking' : 'storefront.brand.contrast.warning',
                '{foreground} on {background}: contrast {ratio}:1.',
                {
                  foreground: t(`storefront.brand.colors.${fg}`, fg),
                  background: t(`storefront.brand.colors.${bg}`, bg),
                  ratio: (ratio ?? 0).toFixed(1),
                },
              )}
            </AlertDescription>
          </Alert>
        ))}
      </div>
    </div>
  )
}

function buildSteps(values: Record<string, unknown>, errors: Record<string, string>, t: Translate): StepIndicatorStep[] {
  const hasError = (match: (key: string) => boolean) => Object.keys(errors).some(match)
  const identityOk = typeof values.name === 'string' && values.name.trim().length > 0
  const colorsOk = COLOR_TOKEN_KEYS.every((key) => readHex(values, key)) &&
    contrastChecks(values).every((check) => check.ratio !== null && check.ratio >= MIN_CONTRAST)
  return [
    {
      id: 'identity',
      label: t('storefront.brand.steps.identity', 'Identity'),
      status: hasError((key) => ['name', 'description', 'logoAttachmentId'].includes(key)) || !identityOk ? 'error' : 'complete',
    },
    {
      id: 'colors',
      label: t('storefront.brand.steps.colors', 'Colours'),
      status: hasError((key) => key.startsWith('colors.')) || !colorsOk ? 'error' : 'complete',
    },
    {
      id: 'typography',
      label: t('storefront.brand.steps.typography', 'Typography and shape'),
      status: hasError((key) => key.startsWith('fonts.') || key === 'radius' || key === 'density') ? 'error' : 'complete',
    },
    { id: 'review', label: t('storefront.brand.steps.review', 'Review and save'), status: 'current' },
  ]
}

function ReviewSummary({ values, initial, t }: { values: Record<string, unknown>; initial: BrandFormValues; t: Translate }) {
  const changed = Object.keys(initial).filter(
    (key) => !['id', 'logoPreviewUrl', 'updatedAt', 'siteId', 'slug', 'publicUrl'].includes(key) && values[key] !== initial[key as keyof BrandFormValues],
  )
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground" role="status" aria-live="polite">
        {changed.length
          ? t('storefront.brand.review.changed', '{count} setting(s) changed. Saving publishes them to your store immediately.', { count: changed.length })
          : t('storefront.brand.review.unchanged', 'No changes yet.')}
      </p>
      <div>
        <Button asChild variant="outline" size="sm">
          <a href={initial.publicUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden="true" />
            {t('storefront.actions.viewStore', 'View store')}
          </a>
        </Button>
      </div>
    </div>
  )
}

export function BrandWizard() {
  const t = useT()
  const [initial, setInitial] = React.useState<BrandFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      setNotFound(false)
      try {
        const payload = await readApiResultOrThrow<BrandPayload>(`/api/${BRAND_API_PATH}`, undefined, {
          errorMessage: t('storefront.errors.load', 'The storefront could not be loaded.'),
        })
        if (!cancelled) setInitial(toBrandFormValues(payload))
      } catch (error: unknown) {
        if (cancelled) return
        if ((error as { status?: number }).status === 404) setNotFound(true)
        else setLoadError(error instanceof Error && error.message ? error.message : t('storefront.errors.load', 'The storefront could not be loaded.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [t])

  const fields = React.useMemo<CrudField[]>(() => {
    const colorFields: CrudField[] = COLOR_TOKEN_KEYS.map((key) => {
      const label = t(`storefront.brand.colors.${key}`, key)
      return {
        id: colorFieldId(key),
        label,
        type: 'custom',
        required: true,
        layout: 'half',
        component: (props) => <ColorTokenInput {...props} label={label} />,
      }
    })
    const fontOptions = FONT_STACK_IDS.map((id) => ({ value: id, label: t(`storefront.fonts.${id}`, id) }))
    const radiusLabel = t('storefront.brand.fields.radius', 'Corner radius')
    const densityLabel = t('storefront.brand.fields.density', 'Spacing')
    return [
      { id: 'name', label: t('storefront.brand.fields.name', 'Store name'), type: 'text', required: true },
      {
        id: 'description',
        label: t('storefront.brand.fields.description', 'Short description'),
        type: 'textarea',
        description: t('storefront.brand.fields.descriptionHint', 'Up to 160 characters. Used by search engines and link previews.'),
      },
      { id: 'logoAttachmentId', label: t('storefront.brand.fields.logo', 'Logo'), type: 'custom', component: (props) => <LogoInput {...props} /> },
      ...colorFields,
      { id: 'fonts.heading', label: t('storefront.brand.fields.headingFont', 'Heading font'), type: 'select', options: fontOptions, required: true, layout: 'half' },
      { id: 'fonts.body', label: t('storefront.brand.fields.bodyFont', 'Body font'), type: 'select', options: fontOptions, required: true, layout: 'half' },
      {
        id: 'radius',
        label: radiusLabel,
        type: 'custom',
        component: (props) => (
          <ChoiceInput {...props} label={radiusLabel} options={RADIUS_VALUES.map((value) => ({ value, label: t(`storefront.radius.${value}`, value) }))} />
        ),
      },
      {
        id: 'density',
        label: densityLabel,
        type: 'custom',
        component: (props) => (
          <ChoiceInput {...props} label={densityLabel} options={DENSITY_VALUES.map((value) => ({ value, label: t(`storefront.density.${value}`, value) }))} />
        ),
      },
    ]
  }, [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    if (!initial) return []
    return [
      {
        id: 'steps',
        bare: true,
        component: ({ values, errors }) => <StepIndicator steps={buildSteps(values, errors, t)} showNumbers />,
      },
      {
        id: 'identity',
        title: t('storefront.brand.steps.identityTitle', '1 · Identity'),
        fields: ['name', 'description', 'logoAttachmentId'],
      },
      {
        id: 'colors',
        title: t('storefront.brand.steps.colorsTitle', '2 · Colours'),
        description: t('storefront.brand.steps.colorsHint', 'Text needs at least 3:1 contrast with the background, and so does text on the primary colour; 4.5:1 is recommended.'),
        fields: COLOR_TOKEN_KEYS.map((key) => colorFieldId(key)),
        component: ({ values, setValue }) => <ColorAssistant values={values} setValue={setValue} t={t} />,
      },
      {
        id: 'typography',
        title: t('storefront.brand.steps.typographyTitle', '3 · Typography and shape'),
        fields: ['fonts.heading', 'fonts.body', 'radius', 'density'],
      },
      {
        id: 'review',
        title: t('storefront.brand.steps.reviewTitle', '4 · Review and save'),
        component: ({ values }) => <ReviewSummary values={values} initial={initial} t={t} />,
      },
    ]
  }, [initial, t])

  const successRedirect = React.useMemo(() => withFlash(OVERVIEW_HREF, t('storefront.brand.flash.saved', 'Brand saved. Your store shows it now.'), 'success'), [t])

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('storefront.overview.missing', 'This organization has no storefront yet. An operator can create it with: yarn mercato storefront ensure-sites')}
        backHref={OVERVIEW_HREF}
        backLabel={t('storefront.actions.backToOverview', 'Back to storefront')}
      />
    )
  }
  if (loadError) return <ErrorMessage label={loadError} />

  return (
    <CrudForm<BrandFormValues>
      title={t('storefront.brand.title', 'Storefront brand')}
      titleHeadingLevel={1}
      backHref={OVERVIEW_HREF}
      entityId={SITE_ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? undefined}
      isLoading={loading || !initial}
      loadingMessage={t('storefront.brand.loading', 'Loading brand…')}
      submitLabel={t('storefront.brand.submit', 'Save brand')}
      cancelHref={OVERVIEW_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        try {
          await updateCrud(BRAND_API_PATH, toBrandRequestBody(values))
        } catch (err) {
          const withFields = err as { fieldErrors?: Record<string, string> }
          if (withFields && typeof withFields === 'object' && withFields.fieldErrors) {
            withFields.fieldErrors = toFormFieldErrors(withFields.fieldErrors)
          }
          throw err
        }
      }}
    />
  )
}

export default BrandWizard
