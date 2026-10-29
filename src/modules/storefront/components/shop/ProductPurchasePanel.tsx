'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ProductBuyBox,
  ProductBuyBoxActions,
  ProductBuyBoxPrice,
  ProductBuyBoxVariants,
  useProductBuyBox,
  type BuyBoxProduct,
  type BuyBoxPrerequisite,
} from '@/components/ecomcn/product-buy-box'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { PersonalizationField } from '../../lib/productOptions'
import { validatePersonalization } from '../../lib/productOptions'
import { SHOP_NUMBER_LOCALE } from '../../lib/shopFormat'
import type { PurchaseModel, PurchaseStock } from '../../lib/shopProduct'
import { ShopCartError, useShopCart } from './ShopCart'

/**
 * The product page's buy panel (shopping-journey spec REQ-005): the ecomcn buy
 * box for variant axes, price, quantity and add-to-cart, with the product's
 * personalization fields between the options and the button. A required field
 * left empty blocks adding the way a missing option does: the button names the
 * missing step and pressing it takes the buyer there. The server checks it all
 * again and its refusal is shown under the panel.
 */

const MAX_QUANTITY = 99

/** Units the buy box may offer: unknown stock is not tracked, sold out is 0. */
function stockUnits(stock: PurchaseStock | null): number | undefined {
  if (!stock) return undefined
  if (!stock.canFulfil) return 0
  return stock.available === null ? undefined : stock.available
}

function toBuyBoxProduct(title: string, model: PurchaseModel): BuyBoxProduct {
  return {
    id: model.productId,
    name: title,
    price: model.base.price?.amount ?? 0,
    options: model.axes.map((axis) => ({ name: axis.label, values: axis.choices.map((choice) => ({ value: choice.code, label: choice.label })), display: 'grid' })),
    variants: model.configurable
      ? model.variants.map((variant) => ({
          id: variant.id,
          options: Object.fromEntries(model.axes.map((axis) => [axis.label, variant.values[axis.code] ?? ''])),
          stock: stockUnits(variant.stock),
          price: variant.price?.amount,
          currency: variant.price?.currencyCode,
        }))
      : undefined,
  }
}

function FieldsAndActions({ fields, values, setValues, errors }: { fields: PersonalizationField[]; values: Record<string, string>; setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>; errors: Record<string, string> }) {
  const { soldOut } = useProductBuyBox()
  return (
    <>
      {fields.length && !soldOut ? (
        <fieldset className="flex flex-col gap-4">
          {fields.map((field) => {
            const id = `sf-field-${field.code}`
            const error = errors[`personalization.${field.code}`]
            const Control = field.inputType === 'textarea' ? Textarea : Input
            return (
              <div key={field.code} className="flex flex-col gap-1.5">
                <Label htmlFor={id}>
                  {field.label}
                  {field.required ? <span aria-hidden="true"> *</span> : null}
                </Label>
                <Control
                  id={id}
                  name={field.code}
                  required={field.required}
                  maxLength={field.maxLength}
                  inputMode={field.inputType === 'number' ? 'decimal' : undefined}
                  value={values[field.code] ?? ''}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [field.code]: event.target.value }))}
                />
                {error ? (
                  <p id={`${id}-error`} className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
            )
          })}
        </fieldset>
      ) : null}
      <ProductBuyBoxActions />
    </>
  )
}

export function ProductPurchasePanel({ title, model }: { title: string; model: PurchaseModel }) {
  const t = useT()
  const { add } = useShopCart()
  const product = React.useMemo(() => toBuyBoxProduct(title, model), [title, model])
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({})
  const [failure, setFailure] = React.useState<string | null>(null)

  const missingField = model.fields.find((field) => field.required && !(values[field.code] ?? '').trim())
  const prerequisite: BuyBoxPrerequisite | null = missingField
    ? {
        label: t('storefront.shop.product.fill', 'Enter {field}', { field: missingField.label }),
        message: t('storefront.shop.product.fillHint', 'Fill in "{field}" to add this to your cart.', { field: missingField.label }),
        focus: () => document.getElementById(`sf-field-${missingField.code}`)?.focus(),
      }
    : null

  if (!model.base.price || model.quoteOnly) {
    return (
      <Alert>
        <AlertDescription>{t('storefront.shop.product.notForSale', 'This product cannot be ordered online right now.')}</AlertDescription>
      </Alert>
    )
  }

  if (!model.configurable && model.base.stock && !model.base.stock.canFulfil) {
    return (
      <Alert>
        <AlertDescription>{t('storefront.shop.product.soldOut', 'Sold out for now.')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ProductBuyBox
        product={product}
        currency={model.base.price.currencyCode}
        locale={SHOP_NUMBER_LOCALE}
        maxQuantity={MAX_QUANTITY}
        headingLevel="h2"
        prerequisite={prerequisite}
        defaultQuantity={1}
        onAddToBag={async (line) => {
          setFailure(null)
          setServerErrors({})
          const personalization = validatePersonalization(model.fields, values)
          try {
            await add({
              productId: model.productId,
              variantId: model.configurable ? (line.variant?.id ?? null) : model.base.variantId,
              quantity: line.quantity,
              personalization: personalization.ok ? personalization.value : values,
            })
          } catch (err) {
            if (err instanceof ShopCartError) {
              setServerErrors(err.fieldErrors)
              setFailure(err.message)
            }
            throw err
          }
        }}
      >
        <ProductBuyBoxPrice />
        <ProductBuyBoxVariants />
        <FieldsAndActions fields={model.fields} values={values} setValues={setValues} errors={serverErrors} />
      </ProductBuyBox>
      {failure ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
