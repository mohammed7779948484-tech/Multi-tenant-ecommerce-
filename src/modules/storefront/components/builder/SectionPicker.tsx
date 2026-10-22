"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { STOREFRONT_BLOCKS, STOREFRONT_BLOCK_TYPES, type StorefrontBlockType } from '../../lib/blocks/catalog'
import { BLOCK_EDITORS } from './blockEditors'

export type SectionPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (type: StorefrontBlockType) => void
}

/**
 * Section types offered by the picker: the json-render catalog's components
 * minus the page root (TEST-015 pins that list to `STOREFRONT_BLOCK_TYPES`).
 * Read from the block catalog so this file does not import json-render, which
 * loads only with the preview (see `PageBuilder`).
 */
const PICKABLE: StorefrontBlockType[] = [...STOREFRONT_BLOCK_TYPES]

/**
 * "Add section" dialog: the json-render catalog's blocks with their
 * descriptions. Arrow keys move between choices, Enter or Cmd/Ctrl+Enter adds
 * the chosen one, Escape closes.
 */
export function SectionPicker({ open, onOpenChange, onPick }: SectionPickerProps) {
  const t = useT()
  const [choice, setChoice] = React.useState<StorefrontBlockType>(PICKABLE[0])
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  React.useEffect(() => {
    if (open) setChoice(PICKABLE[0])
  }, [open])

  const pick = () => {
    onPick(choice)
    onOpenChange(false)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      pick()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = PICKABLE.indexOf(choice)
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + PICKABLE.length) % PICKABLE.length
    setChoice(PICKABLE[next])
    optionRefs.current[next]?.focus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={onKeyDown} closeAriaLabel={t('storefront.builder.picker.close', 'Close')}>
        <DialogHeader>
          <DialogTitle>{t('storefront.builder.picker.title', 'Add a section')}</DialogTitle>
          <DialogDescription>{t('storefront.builder.picker.description', 'Choose what the new section shows. You can edit it right after.')}</DialogDescription>
        </DialogHeader>
        <div role="listbox" aria-label={t('storefront.builder.picker.title', 'Add a section')} className="flex flex-col gap-2">
          {PICKABLE.map((type, index) => {
            const selected = type === choice
            const [labelKey, labelFallback] = BLOCK_EDITORS[type].label
            return (
              <Button
                key={type}
                ref={(node) => {
                  optionRefs.current[index] = node
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                variant={selected ? 'outline' : 'ghost'}
                className="h-auto flex-col items-start gap-1 whitespace-normal py-3 text-left aria-selected:border-primary"
                onClick={() => setChoice(type)}
                onDoubleClick={pick}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                    event.preventDefault()
                    setChoice(type)
                    onPick(type)
                    onOpenChange(false)
                  }
                }}
              >
                <span className="font-medium">{t(labelKey, labelFallback)}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {t(`storefront.builder.blockDescriptions.${type}`, STOREFRONT_BLOCKS[type].description)}
                </span>
              </Button>
            )
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('storefront.builder.picker.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={pick}>
            {t('storefront.builder.picker.add', 'Add section')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
