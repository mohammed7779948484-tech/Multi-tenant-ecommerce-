"use client"
import * as React from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { staffMediaResolver } from '../../lib/mediaUrls'
import type { EditorImageListField, ImageValue, Label } from './blockEditors'

type Translate = ReturnType<typeof useT>

/** Page images are attachments recorded on the page itself; only those may be referenced by its sections (spec P3-Q2). */
export const PAGE_ENTITY_ID = 'storefront:storefront_page'
const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const preview = staffMediaResolver()

type UploadPayload = { item: { id: string } }

function asImage(value: unknown): ImageValue {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    attachmentId: typeof source.attachmentId === 'string' ? source.attachmentId : '',
    alt: typeof source.alt === 'string' ? source.alt : '',
  }
}

function useImageUpload(pageId: string) {
  const t = useT()
  const [uploading, setUploading] = React.useState(false)
  const upload = React.useCallback(
    async (file: File): Promise<string | null> => {
      setUploading(true)
      try {
        const form = new FormData()
        form.set('entityId', PAGE_ENTITY_ID)
        form.set('recordId', pageId)
        form.set('file', file)
        form.set('tags', JSON.stringify(['storefront-page-image']))
        const result = await readApiResultOrThrow<UploadPayload>(
          '/api/attachments',
          { method: 'POST', body: form },
          { errorMessage: t('storefront.builder.image.uploadFailed', 'The image could not be uploaded. Try another file.') },
        )
        return result.item.id
      } catch (err) {
        flash(err instanceof Error && err.message ? err.message : t('storefront.builder.image.uploadFailed', 'The image could not be uploaded. Try another file.'), 'error')
        return null
      } finally {
        setUploading(false)
      }
    },
    [pageId, t],
  )
  return { upload, uploading }
}

function Uploading({ t }: { t: Translate }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner size="sm" />
      {t('storefront.builder.image.uploading', 'Uploading…')}
    </div>
  )
}

function AltInput({ id, value, onChange, disabled, invalid, t }: { id: string; value: string; onChange: (next: string) => void; disabled?: boolean; invalid?: boolean; t: Translate }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {t('storefront.builder.image.alt', 'Describe the image (alt text)')}
      </label>
      <Input id={id} value={value} maxLength={200} disabled={disabled} aria-invalid={invalid ? true : undefined} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

/** One image: upload (replaces the current one) plus required alt text. */
export function ImageInput({ id, value, setValue, disabled, error, pageId, name }: CrudCustomFieldRenderProps & { pageId: string; name: string }) {
  const t = useT()
  const image = asImage(value)
  const { upload, uploading } = useImageUpload(pageId)
  return (
    <div className="flex flex-col gap-2">
      <ImageUpload
        kind="company"
        alignment="horizontal"
        src={image.attachmentId ? preview.src(image.attachmentId, 320) : null}
        alt={image.alt || name}
        heading={name}
        description={t('storefront.builder.image.hint', 'PNG or JPEG, at least 200×200 px, up to 8 MB.')}
        maxSizeBytes={IMAGE_MAX_BYTES}
        minWidth={200}
        minHeight={200}
        disabled={disabled || uploading}
        onChange={(file) => {
          if (!file) {
            setValue({ attachmentId: '', alt: image.alt })
            return
          }
          void upload(file).then((attachmentId) => {
            if (attachmentId) setValue({ attachmentId, alt: image.alt })
          })
        }}
      />
      {uploading ? <Uploading t={t} /> : null}
      <AltInput id={`${id}-alt`} value={image.alt} invalid={Boolean(error)} disabled={disabled} onChange={(alt) => setValue({ ...image, alt })} t={t} />
    </div>
  )
}

/** Gallery images: add by upload, edit alt text, reorder and remove. */
export function ImageListInput({
  id,
  value,
  setValue,
  disabled,
  error,
  field,
  pageId,
  label,
}: CrudCustomFieldRenderProps & { field: EditorImageListField; pageId: string; label: (entry: Label, params?: Record<string, string | number>) => string }) {
  const t = useT()
  const items = Array.isArray(value) ? value.map(asImage) : []
  const { upload, uploading } = useImageUpload(pageId)
  const update = (next: ImageValue[]) => setValue(next)
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    update(next)
  }
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{t('storefront.builder.list.empty', 'Nothing added yet.')}</p> : null}
      <ol className="flex flex-col gap-3">
        {items.map((item, index) => {
          const itemName = label(field.itemLabel, { n: index + 1 })
          return (
            <li key={`${item.attachmentId}-${index}`} className="flex gap-3 rounded-md border p-3">
              {/* Staff preview of an uploaded file through the authenticated attachments route. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.src(item.attachmentId, 320)} alt="" className="size-16 shrink-0 rounded-md object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{itemName}</span>
                  <div className="flex items-center gap-1">
                    <IconButton variant="ghost" size="sm" aria-label={t('storefront.builder.list.moveUp', 'Move {item} up', { item: itemName })} disabled={disabled || index === 0} onClick={() => move(index, -1)}>
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </IconButton>
                    <IconButton variant="ghost" size="sm" aria-label={t('storefront.builder.list.moveDown', 'Move {item} down', { item: itemName })} disabled={disabled || index === items.length - 1} onClick={() => move(index, 1)}>
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </IconButton>
                    <IconButton variant="ghost" size="sm" aria-label={t('storefront.builder.list.remove', 'Remove {item}', { item: itemName })} disabled={disabled} onClick={() => update(items.filter((_, position) => position !== index))}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
                <AltInput
                  id={`${id}-${index}-alt`}
                  value={item.alt}
                  invalid={Boolean(error)}
                  disabled={disabled}
                  onChange={(alt) => update(items.map((current, position) => (position === index ? { ...current, alt } : current)))}
                  t={t}
                />
              </div>
            </li>
          )
        })}
      </ol>
      {items.length < field.max ? (
        <ImageUpload
          kind="company"
          alignment="horizontal"
          heading={label(field.addLabel)}
          description={t('storefront.builder.image.listHint', 'PNG or JPEG, at least 200×200 px, up to 8 MB. {count} of {max} added.', { count: items.length, max: field.max })}
          maxSizeBytes={IMAGE_MAX_BYTES}
          minWidth={200}
          minHeight={200}
          disabled={disabled || uploading}
          onChange={(file) => {
            if (!file) return
            void upload(file).then((attachmentId) => {
              if (attachmentId) update([...items, { attachmentId, alt: '' }])
            })
          }}
        />
      ) : null}
      {uploading ? <Uploading t={t} /> : null}
    </div>
  )
}
