"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isLoading?: boolean;
  className?: string;
  autoFocus?: boolean;
  debounceMs?: number;
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search...",
  isLoading = false,
  className = "",
  autoFocus = false,
  debounceMs = 200,
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setLocalValue(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (debounceMs <= 0) {
        onChange(next);
      } else {
        debounceRef.current = setTimeout(() => onChange(next), debounceMs);
      }
    },
    [onChange, debounceMs],
  );

  const handleClear = useCallback(() => {
    setLocalValue("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        handleClear();
      }
    },
    [handleClear],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <Search
        size={14}
        strokeWidth={2}
        className="absolute left-2 top-1/2 -translate-y-1/2 text-secondary-hover pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full pl-7 pr-8 py-1.5 text-xs rounded-lg bg-secondary-lighter text-foreground
          border border-secondary-light
          focus:border-primary focus:ring-1 focus:ring-primary outline-none
          placeholder:text-secondary-hover"
      />
      {localValue && !isLoading && (
        <button
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary-hover hover:text-foreground transition-colors cursor-pointer"
          aria-label="Clear search"
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
      {isLoading && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <div
            className="w-3 h-3 border-2 rounded-full animate-spin"
            style={{
              borderColor: "var(--color-primary-light)",
              borderTopColor: "var(--color-primary)",
            }}
          />
        </div>
      )}
    </div>
  );
}
