"use client"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export default function AppHeader({ title, tone = "default", actions, titleOnly = false }) {
    // "light" is for pages with a full-bleed picture behind the header.
    const light = tone === "light"
    const link = light
        ? "text-white/80 hover:text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.45)]"
        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
    const current = light
        ? "text-white font-medium drop-shadow-[0_1px_6px_rgba(0,0,0,0.45)]"
        : "text-slate-900 dark:text-slate-100 font-medium"
    return (
        <header className="w-full z-50" data-app-header>
            <div className={`flex w-full items-center justify-between gap-4 ${titleOnly ? "px-4 py-2" : "px-6 py-4"}`}>
                <Breadcrumb>
                    <BreadcrumbList>
                        {!titleOnly && (
                            <>
                            <BreadcrumbItem>
                                <BreadcrumbLink href="https://www.tonyzeb.com/" className={link}>
                                    Tony
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator className={light ? "text-white/70" : undefined} />
                            <BreadcrumbItem>
                                <BreadcrumbLink href="/" className={link}>
                                    Playground
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            </>
                        )}
                        {title && (
                            <>
                                {!titleOnly && <BreadcrumbSeparator className={light ? "text-white/70" : undefined} />}
                                <BreadcrumbItem>
                                    <span className={current}>
                                        {title}
                                    </span>
                                </BreadcrumbItem>
                            </>
                        )}
                    </BreadcrumbList>
                </Breadcrumb>
                {actions && <div className={`flex shrink-0 items-center gap-1 ${titleOnly ? "" : "-my-1"}`}>{actions}</div>}
            </div>
        </header>
    );
}