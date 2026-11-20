"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Rendered instead of the children after an error; `reset` re-mounts them. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** Called once per caught error (logging / reporting). */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * ErrorBoundary Component
 *
 * Catches render errors in its subtree so one failing area (e.g. the 3D scene)
 * shows a recovery panel instead of blanking the whole app. React requires a
 * class component for this.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary fallback={(error, reset) => <Recover onRetry={reset} />}>
 *   <SpeckleScene … />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
