/**
 * @fileoverview React error boundary: shows an error id + reload and
 * reports the error through telemetry.
 */

import {Component, type ErrorInfo, type ReactNode} from 'react';
import {reportError} from '../lib/telemetry';
import {ErrorView} from './empty_state';

interface Props {
  children: ReactNode;
  /** Changing this key resets the boundary (e.g. the route path). */
  resetKey?: unknown;
  fallback?: (p: {error: Error; errorId: string; reset(): void}) => ReactNode;
}

interface State {
  error: Error | null;
  errorId: string;
  resetKey: unknown;
}

/** Catches render errors below it. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = {error: null, errorId: '', resetKey: undefined};

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {error};
  }

  static getDerivedStateFromProps(
    props: Props,
    state: State,
  ): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return {resetKey: props.resetKey, error: null, errorId: ''};
    }
    return null;
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.setState({errorId: reportError(error)});
  }

  private readonly reset = () => this.setState({error: null, errorId: ''});

  override render(): ReactNode {
    const {error, errorId} = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback)
      return this.props.fallback({error, errorId, reset: this.reset});
    return (
      <ErrorView
        detail={error.message}
        errorId={errorId}
        onRetry={() =>
          typeof location !== 'undefined' ? location.reload() : this.reset()
        }
      />
    );
  }
}
