import React from 'react'

interface InputProps {
  type?: string
  placeholder?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  className?: string
  label?: string
}

export default function Input({
  type = 'text',
  placeholder,
  value,
  onChange,
  className = '',
  label,
}: InputProps) {
  return (
    <div className="w-full">
      {label && (
        <label className="block mb-2 text-sm font-semibold text-accel-text">
          {label}
        </label>
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={`w-full px-4 py-3 rounded-lg border-2 border-accel-text dark:bg-slate-800 dark:border-slate-600 text-base focus:outline-none focus:border-accel-primary focus:ring-2 focus:ring-accel-light ${className}`}
      />
    </div>
  )
}
