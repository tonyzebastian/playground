"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef(({ className, ...props }, ref) => (
  <SliderPrimitive.Root ref={ref} className={cn("w-full", className)} {...props}>
    <SliderPrimitive.Control className="relative flex w-full touch-none select-none items-center py-2">
      <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-primary/20">
        <SliderPrimitive.Indicator className="h-full rounded-full bg-primary" />
        <SliderPrimitive.Thumb
          className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50" />
      </SliderPrimitive.Track>
    </SliderPrimitive.Control>
  </SliderPrimitive.Root>
))
Slider.displayName = "Slider"

export { Slider }
