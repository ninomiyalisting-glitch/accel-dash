import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
}

export default function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-white dark:bg-slate-900 rounded-lg shadow p-6 ${className}`}>
      {children}
    </div>
  )
}
