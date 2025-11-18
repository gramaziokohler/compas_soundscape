"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface ErrorNotification {
  id: string;
  message: string;
  type: 'error' | 'warning' | 'info';
  timestamp: number;
}

interface ErrorContextValue {
  errors: ErrorNotification[];
  addError: (message: string, type?: 'error' | 'warning' | 'info') => void;
  removeError: (id: string) => void;
  clearErrors: () => void;
}

const ErrorContext = createContext<ErrorContextValue | undefined>(undefined);

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<ErrorNotification[]>([]);

  const addError = useCallback((message: string, type: 'error' | 'warning' | 'info' = 'error') => {
    const id = `${Date.now()}-${Math.random()}`;
    const newError: ErrorNotification = {
      id,
      message,
      type,
      timestamp: Date.now()
    };

    setErrors(prev => [...prev, newError]);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      setErrors(prev => prev.filter(e => e.id !== id));
    }, 5000);
  }, []);

  const removeError = useCallback((id: string) => {
    setErrors(prev => prev.filter(e => e.id !== id));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  return (
    <ErrorContext.Provider value={{ errors, addError, removeError, clearErrors }}>
      {children}
    </ErrorContext.Provider>
  );
}

export function useErrorNotification() {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useErrorNotification must be used within ErrorProvider');
  }
  return context;
}
