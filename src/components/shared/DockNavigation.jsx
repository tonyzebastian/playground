'use client'

import { useState, useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { Dock, DockIcon, DockItem, DockLabel } from '@/components/ui/dock'
import { LinearBlur } from 'progressive-blur'

export default function DockNavigation() {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  // Memoize navItems to prevent unnecessary re-renders
  const navItems = useMemo(() => [
    {
      title: 'Home',
      href: 'https://www.tonyzeb.com/',
      icon: <img src="/nav/home.png" alt="Home" className='h-full w-full object-contain' />
    },
    {
      title: 'About',
      href: 'https://www.tonyzeb.com/about',
      icon: <img src="/nav/about.png" alt="About" className='h-full w-full object-contain' />
    },
    {
      title: 'Playground',
      href: '/',
      icon: <img src="/nav/craft.png" alt="Playground" className='h-full w-full object-contain' />
    }
  ], [])

  useEffect(() => {
    setMounted(true)
    // Hide dock if we're inside an iframe
    const isInIframe = window.self !== window.top
    setIsVisible(!isInIframe)
  }, [pathname])

  if (
    !mounted ||
    pathname?.startsWith('/kalimba') ||
    pathname?.startsWith('/vault/') ||
    pathname?.startsWith('/feelings') ||
    pathname?.startsWith('/client/physio')
  ) {
    return null
  }

  return (
    <div className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full z-50 transition-all duration-300 ${
      isVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
    }`}>

    <LinearBlur
      side="bottom"
      steps={8}
      strength={64}
      falloffPercentage={100}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
      }}
    />

    <div className='pb-4 '>
      <Dock className='items-end pb-3 z-50 '>
        {navItems.map((item) => (
          <DockItem
            key={item.href}
            className={`aspect-square rounded-full`}
          >
            <DockLabel>{item.title}</DockLabel>
            <DockIcon>
              <a href={item.href}>
                {item.icon}
              </a>
            </DockIcon>
          </DockItem>
        ))}
      </Dock>
    </div>
  </div>
  )
}
