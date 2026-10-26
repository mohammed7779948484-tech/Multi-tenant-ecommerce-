"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { useT } from "@open-mercato/shared/lib/i18n/context"
import { cn } from "@/lib/utils"

/*
 * Where the shopper is in checkout: a rail of equal ruled cells, edge to
 * edge — not floating pills.
 *
 *   <CheckoutStepper steps={STEPS} value={step} onValueChange={setStep} />
 *
 * Done steps carry a check and are buttons that go back to them; the
 * current one is marked `aria-current="step"`; steps still to come are not
 * clickable — you can't skip ahead of what checkout needs. State is never
 * colour alone: a check, a number, and the heavy rule under the current
 * step, which slides to the next as the shopper moves on (Motion; a fade
 * under reduced motion). On a phone the labels give way to numbers, with
 * the current step named in full below the rail.
 */

export interface CheckoutStep {
  id: string
  label: string
}

/** The same settle curve as the other ecomcn morphs: no bounce, an editorial ease. */
const MORPH = { duration: 0.45, ease: [0.2, 0, 0, 1] } as const

export interface CheckoutStepperProps extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  steps: CheckoutStep[]
  /** The current step's id. */
  value: string
  /** Called with a done step's id when the shopper goes back to it. */
  onValueChange?: (id: string) => void
  /** "Checkout progress", by default. */
  label?: string
}

export function CheckoutStepper({
  steps,
  value,
  onValueChange,
  label: labelProp,
  className,
  ...props
}: CheckoutStepperProps) {
  const t = useT()
  const label = labelProp ?? t("ecomcn.stepper.label", "Checkout progress")
  const reduce = useReducedMotion()
  const scope = React.useId()
  const current = Math.max(0, steps.findIndex((s) => s.id === value))
  const step = steps[current]

  if (!steps.length) return null

  return (
    <MotionConfig reducedMotion="user">
      <nav aria-label={label} data-slot="checkout-stepper" className={cn("w-full", className)} {...props}>
        <ol
          className="grid border-y"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {steps.map((s, i) => {
            const state = i < current ? "done" : i === current ? "current" : "pending"
            const cell = cn(
              "relative flex h-12 w-full items-center gap-2.5 px-3 text-start text-sm outline-none sm:px-4",
              i > 0 && "border-s"
            )
            const marker = (
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center text-[11px] tabular-nums",
                  state === "done" && "bg-foreground text-background",
                  state === "current" && "border border-foreground",
                  state === "pending" && "border border-border text-muted-foreground"
                )}
              >
                {state === "done" ? <Check className="size-3" /> : i + 1}
              </span>
            )
            const text = (
              <span
                className={cn(
                  "hidden truncate sm:inline",
                  state === "pending" ? "text-muted-foreground" : "text-foreground",
                  state === "current" && "font-medium"
                )}
              >
                {s.label}
              </span>
            )
            return (
              <li key={s.id} data-state={state} className="relative min-w-0">
                {state === "done" && onValueChange ? (
                  <button
                    type="button"
                    onClick={() => onValueChange(s.id)}
                    className={cn(cell, "transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}
                  >
                    {marker}
                    {text}
                    <span className="sr-only">{t("ecomcn.stepper.doneBack", "{step}, done. Go back to this step", { step: s.label })}</span>
                  </button>
                ) : (
                  <span aria-current={state === "current" ? "step" : undefined} className={cell}>
                    {marker}
                    {text}
                    <span className="sr-only">
                      {state === "current" ? t("ecomcn.stepper.current", "{step}, current step", { step: s.label }) : state === "done" ? t("ecomcn.stepper.done", "{step}, done", { step: s.label }) : t("ecomcn.stepper.pending", "{step}, not started", { step: s.label })}
                    </span>
                  </span>
                )}
                {state === "current" ? (
                  <motion.span
                    aria-hidden
                    layoutId={reduce ? undefined : `${scope}-current`}
                    initial={reduce ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    transition={reduce ? { duration: 0.15 } : MORPH}
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground"
                  />
                ) : null}
              </li>
            )
          })}
        </ol>
        {/* A phone shows numbers in the rail; the step is named here. */}
        <p className="mt-2 text-sm sm:hidden">
          <span className="text-muted-foreground tabular-nums">
            {t("ecomcn.stepper.position", "Step {current} of {total}:", { current: current + 1, total: steps.length })}
          </span>{" "}
          {step?.label}
        </p>
      </nav>
    </MotionConfig>
  )
}
