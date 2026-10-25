"use client"
import * as React from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@open-mercato/ui/primitives/drawer'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  BLOCK_EDITORS,
  LINK_FIELDS,
  blockPropsToFormValues,
  formValuesToBlockProps,
  type EditorField,
  type EditorListField,
  type EditorTextField,
  type Label,
  type ListItemValue,
} from './blockEditors'
import type { BuilderSection } from './builderSpec'
import { CategoriesInput, ProductSourceInput } from './CatalogPickers'
import { ImageInput, ImageListInput } from './ImageInputs'

type Translate = ReturnType<typeof useT>

const label = (t: Translate, [key, fallback]: Label, params?: Record<string, string | number>) => t(key, fallback, params)

function asItem(value: unknown): ListItemValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ListItemValue) : {}
}

function TextInputs({
  idPrefix,
  fields,
  value,
  onChange,
  disabled,
  invalid,
  t,
}: {
  idPrefix: string
  invalid?: boolean
  fields: readonly EditorTextField[]
  value: ListItemValue
  onChange: (next: ListItemValue) => void
  disabled?: boolean
  t: Translate
}) {
  return (
    <div className="flex flex-col gap-2">
      {fields.map((field) => {
        const inputId = `${idPrefix}-${field.id}`
        const common = {
          id: inputId,
          value: value[field.id] ?? '',
          maxLength: field.maxLength,
          disabled,
          'aria-invalid': invalid ? true : undefined,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [field.id]: event.target.value }),
        }
        return (
          <div key={field.id} className="flex flex-col gap-1">
            <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
              {label(t, field.label)}
            </label>
            {field.kind === 'textarea' ? <Textarea rows={2} {...common} /> : <Input {...common} />}
          </div>
        )
      })}
    </div>
  )
}

function LinkInput({ id, value, setValue, disabled, error, t }: CrudCustomFieldRenderProps & { t: Translate }) {
  return (
    <div className="flex flex-col gap-1">
      <TextInputs idPrefix={id} fields={LINK_FIELDS} value={asItem(value)} onChange={setValue} disabled={disabled} invalid={Boolean(error)} t={t} />
      <p className="text-xs text-muted-foreground">
        {t('storefront.builder.fields.linkHint', 'Use a store path such as /about, or a full https:// address. Leave both empty for no link.')}
      </p>
    </div>
  )
}

function ListInput({ id, value, setValue, disabled, error, field, t }: CrudCustomFieldRenderProps & { field: EditorListField; t: Translate }) {
  const items = Array.isArray(value) ? (value as ListItemValue[]) : []
  // Stable row keys, so focus and input state follow an item when it moves.
  const keysRef = React.useRef<string[]>([])
  const nextKey = React.useRef(0)
  const newKey = () => `item-${(nextKey.current += 1)}`
  while (keysRef.current.length < items.length) keysRef.current.push(newKey())
  if (keysRef.current.length > items.length) keysRef.current = keysRef.current.slice(0, items.length)
  const buttonRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const addRef = React.useRef<HTMLButtonElement>(null)
  const focusLater = (target: () => HTMLElement | null | undefined) => requestAnimationFrame(() => target()?.focus())

  const update = (next: ListItemValue[]) => setValue(next)
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    const keys = [...keysRef.current]
    const [movedKey] = keys.splice(index, 1)
    keys.splice(target, 0, movedKey)
    keysRef.current = keys
    update(next)
    // Keep focus on the moved item's own button (or its other arrow at the edge).
    const direction = delta < 0 ? 'up' : 'down'
    const atEdge = target === 0 || target === next.length - 1
    focusLater(() => buttonRefs.current.get(`${movedKey}:${atEdge ? (direction === 'up' ? 'down' : 'up') : direction}`))
  }
  const removeAt = (index: number) => {
    const keys = [...keysRef.current]
    keys.splice(index, 1)
    keysRef.current = keys
    update(items.filter((_, position) => position !== index))
    const neighbour = keys[Math.min(index, keys.length - 1)]
    focusLater(() => (neighbour ? buttonRefs.current.get(`${neighbour}:remove`) : addRef.current))
  }
  const blank = () => Object.fromEntries(field.item.map((item) => [item.id, ''])) as ListItemValue
  const bindButton = (key: string, action: string) => (node: HTMLButtonElement | null) => {
    if (node) buttonRefs.current.set(`${key}:${action}`, node)
    else buttonRefs.current.delete(`${key}:${action}`)
  }
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('storefront.builder.list.empty', 'Nothing added yet.')}</p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {items.map((item, index) => {
          const itemName = label(t, field.itemLabel, { n: index + 1 })
          const key = keysRef.current[index]
          return (
            <li key={key} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{itemName}</span>
                <div className="flex items-center gap-1">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    ref={bindButton(key, 'up')}
                    aria-label={t('storefront.builder.list.moveUp', 'Move {item} up', { item: itemName })}
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    ref={bindButton(key, 'down')}
                    aria-label={t('storefront.builder.list.moveDown', 'Move {item} down', { item: itemName })}
                    disabled={disabled || index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    ref={bindButton(key, 'remove')}
                    aria-label={t('storefront.builder.list.remove', 'Remove {item}', { item: itemName })}
                    disabled={disabled}
                    onClick={() => removeAt(index)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
              <TextInputs
                idPrefix={`${id}-${index}`}
                invalid={Boolean(error)}
                fields={field.item}
                value={item}
                onChange={(next) => update(items.map((current, position) => (position === index ? next : current)))}
                disabled={disabled}
                t={t}
              />
            </li>
          )
        })}
      </ol>
      <div className="flex items-center gap-2">
        <Button
          ref={addRef}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || items.length >= field.max}
          onClick={() => {
            keysRef.current = [...keysRef.current, newKey()]
            update([...items, blank()])
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          {label(t, field.addLabel)}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t('storefront.builder.list.count', '{count} of {max}', { count: items.length, max: field.max })}
        </span>
      </div>
    </div>
  )
}

function RichTextInput({ id, value, setValue, disabled, error, name, t }: CrudCustomFieldRenderProps & { name: string; t: Translate }) {
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        id={id}
        rows={10}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        aria-label={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={hintId}
        className="font-mono text-sm"
        onChange={(event) => setValue(event.target.value)}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {t(
          'storefront.builder.fields.richTextHint',
          'Blank line = new paragraph. "- " starts a bullet, "1. " a numbered item. **bold**, *italic*, [link text](/path or https://…). Use \\* for a literal star.',
        )}
      </p>
    </div>
  )
}

function toCrudField(field: EditorField, t: Translate, pageId: string): CrudField {
  switch (field.kind) {
    case 'text':
    case 'textarea':
      return { id: field.id, type: field.kind, label: label(t, field.label), required: field.required, maxLength: field.maxLength }
    case 'select':
      return {
        id: field.id,
        type: 'select',
        label: label(t, field.label),
        options: field.options.map((option) => ({ value: option.value, label: label(t, option.label) })),
      }
    case 'link':
      return { id: field.id, type: 'custom', label: label(t, field.label), component: (props) => <LinkInput {...props} t={t} /> }
    case 'list':
      return { id: field.id, type: 'custom', label: label(t, field.label), component: (props) => <ListInput {...props} field={field} t={t} /> }
    case 'richtext':
      return { id: field.id, type: 'custom', label: label(t, field.label), required: true, component: (props) => <RichTextInput {...props} name={label(t, field.label)} t={t} /> }
    case 'image':
      return {
        id: field.id,
        type: 'custom',
        label: label(t, field.label),
        required: field.required,
        component: (props) => <ImageInput {...props} pageId={pageId} name={label(t, field.label)} />,
      }
    case 'images':
      return {
        id: field.id,
        type: 'custom',
        label: label(t, field.label),
        required: true,
        component: (props) => <ImageListInput {...props} field={field} pageId={pageId} label={(entry, params) => label(t, entry, params)} />,
      }
    case 'productSource':
      return { id: field.id, type: 'custom', label: label(t, field.label), required: true, component: (props) => <ProductSourceInput {...props} /> }
    case 'categories':
      return { id: field.id, type: 'custom', label: label(t, field.label), required: true, component: (props) => <CategoriesInput {...props} /> }
    case 'number':
      return { id: field.id, type: 'number', label: label(t, field.label) }
    case 'checkbox':
      return { id: field.id, type: 'checkbox', label: label(t, field.label) }
  }
}

export type SectionInspectorProps = {
  /** The page being edited: uploaded images are recorded on it (spec P3-Q2). */
  pageId: string
  section: BuilderSection | null
  position: number
  open: boolean
  readOnly: boolean
  onOpenChange: (open: boolean) => void
  onApply: (sectionId: string, props: Record<string, unknown>) => void
}

/**
 * Inspector drawer for one section: a compact, embedded CrudForm keyed by the
 * section id (a fresh mount per section, so edits never leak between them).
 * Apply writes into the in-memory draft only; Save draft persists it.
 */
export function SectionInspector({ pageId, section, position, open, readOnly, onOpenChange, onApply }: SectionInspectorProps) {
  const t = useT()
  const editor = section ? BLOCK_EDITORS[section.type] : null
  const fields = React.useMemo(() => (editor ? editor.fields.map((field) => toCrudField(field, t, pageId)) : []), [editor, t, pageId])
  const groups = React.useMemo<CrudFormGroup[]>(() => [{ id: 'section', fields: fields.map((field) => field.id) }], [fields])
  const initialValues = React.useMemo(() => (section ? blockPropsToFormValues(section.type, section.props) : {}), [section])

  return (
    <Drawer open={open && Boolean(section)} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-lg" closeAriaLabel={t('storefront.builder.inspector.close', 'Close')}>
        {section && editor ? (
          <>
            <DrawerHeader>
              <DrawerTitle>
                {t('storefront.builder.inspector.title', 'Section {n} · {block}', { n: position + 1, block: label(t, editor.label) })}
              </DrawerTitle>
              <DrawerDescription>
                {readOnly
                  ? t('storefront.builder.inspector.readOnly', 'You can view this section but not change it.')
                  : t('storefront.builder.inspector.description', 'Apply updates the preview. Save draft keeps your changes; Publish makes them public.')}
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <CrudForm<Record<string, unknown>>
                key={section.id}
                embedded
                density="compact"
                fields={readOnly ? fields.map((field) => ({ ...field, disabled: true })) : fields}
                groups={groups}
                initialValues={initialValues}
                submitLabel={t('storefront.builder.inspector.apply', 'Apply')}
                hideFooterActions={readOnly}
                onSubmit={async (values) => {
                  const result = formValuesToBlockProps(section.type, values)
                  if (!result.ok) {
                    // Name the item and sub-field for list and link errors ("Selling point 2 · Sentence: …").
                    const describe = (field: string, key: string) => {
                      const message = t(key, t('storefront.validation.invalidValue', 'Enter a valid value.'))
                      const where = result.locations?.[field]
                      const editorField = editor.fields.find((candidate) => candidate.id === field)
                      if (!where || !editorField) return message
                      const parts: string[] = []
                      if ((editorField.kind === 'list' || editorField.kind === 'images') && where.index !== undefined) parts.push(label(t, editorField.itemLabel, { n: where.index + 1 }))
                      const subFields = editorField.kind === 'list' ? editorField.item : editorField.kind === 'link' ? LINK_FIELDS : []
                      const sub = subFields.find((candidate) => candidate.id === where.subField)
                      if (sub) parts.push(label(t, sub.label))
                      return parts.length ? `${parts.join(' · ')}: ${message}` : message
                    }
                    const fieldErrors = Object.fromEntries(Object.entries(result.fieldErrors).map(([field, key]) => [field, describe(field, key)]))
                    throw createCrudFormError(t('storefront.builder.inspector.invalid', 'Fix the highlighted fields.'), fieldErrors)
                  }
                  onApply(section.id, result.props)
                }}
              />
            </DrawerBody>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}
