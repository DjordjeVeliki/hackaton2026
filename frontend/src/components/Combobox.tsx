import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { inputClass } from './ui'

/**
 * Accessible, touch-friendly combobox (ARIA 1.2 pattern): type to filter the suggestions,
 * pick one with tap/Enter, or add your own text when nothing matches.
 */
export function Combobox({
  label,
  options,
  onSelect,
  disabled,
  placeholder,
  maxLength = 60,
}: {
  label: string
  options: string[]
  onSelect: (value: string) => void
  disabled?: boolean
  placeholder?: string
  maxLength?: number
}) {
  const id = useId()
  const listId = `${id}-list`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toLowerCase()
  const matches = options.filter((o) => o.toLowerCase().includes(q))
  const exact = options.some((o) => o.toLowerCase() === q)
  const items = [...matches.map((o) => ({ value: o, custom: false })), ...(q && !exact ? [{ value: query.trim(), custom: true }] : [])]
  const showList = open && items.length > 0

  const choose = (value: string) => {
    if (!value.trim()) return
    onSelect(value.trim())
    setQuery('')
    setActive(0)
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[active]
      if (showList && item) choose(item.value)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        className={inputClass}
        value={query}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!showList}
        className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
      >
        {showList && items.map((item, i) => (
          <li
            key={`${item.custom ? 'custom' : 'opt'}:${item.value}`}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            // mousedown (not click) so the choice lands before the input's blur closes the list
            onMouseDown={(e) => {
              e.preventDefault()
              choose(item.value)
            }}
            onMouseEnter={() => setActive(i)}
            className={`flex min-h-11 cursor-pointer items-center px-3 text-base ${i === active ? 'bg-brand-50 text-brand-900' : 'text-slate-800'}`}
          >
            {item.custom ? (
              <span>
                Add “<strong>{item.value}</strong>”
              </span>
            ) : (
              item.value
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
