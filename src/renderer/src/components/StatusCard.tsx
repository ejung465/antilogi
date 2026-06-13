import type { ReactNode } from 'react'

export type PillTone = 'ok' | 'warn' | 'bad' | 'idle'

export function Pill({ tone, label }: { tone: PillTone; label: string }) {
  return (
    <span className={`pill pill-${tone}`}>
      <span className="pill-dot" />
      {label}
    </span>
  )
}

export function StatusCard({
  title,
  pill,
  action,
  children,
  className
}: {
  title: string
  pill?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      <header className="card-head">
        <h2>{title}</h2>
        <div className="card-head-right">
          {pill}
          {action}
        </div>
      </header>
      <div className="card-body">{children}</div>
    </section>
  )
}
