import React from 'react'

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger'
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit' | 'reset'
}

export default function Button({
  variant = 'primary',
  children,
  onClick,
  disabled,
  className = '',
  type = 'button',
}: ButtonProps) {
  const baseStyle = 'px-4 py-3 rounded-lg font-semibold transition-colors text-base min-h-[44px]'
  
  const variants = {
    primary: 'bg-accel-primary text-white hover:bg-accel-hover active:bg-accel-active disabled:bg-gray-400',
    secondary: 'bg-accel-light text-accel-text hover:bg-accel-secondary disabled:bg-gray-300',
    danger: 'bg-red-500 text-white hover:bg-red-600 disabled:bg-gray-400',
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyle} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  )
}
