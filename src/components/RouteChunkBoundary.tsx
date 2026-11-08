import { Component, Suspense, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

interface RouteChunkBoundaryProps {
  children: ReactNode
}

interface ChunkErrorBoundaryProps extends RouteChunkBoundaryProps {
  /** Clears a load failure when the route changes. */
  resetKey: string
}

interface RouteChunkBoundaryState {
  failed: boolean
}

export function RouteChunkFallback() {
  return (
    <p role="status" className="p-6 text-center text-sm text-content-muted animate-pulse">
      Loading...
    </p>
  )
}

/**
 * Suspense plus a reload prompt for lazily loaded route pages. A page chunk can
 * fail to load when an update replaced the cached app while this tab stayed open.
 */
class ChunkErrorBoundary extends Component<ChunkErrorBoundaryProps, RouteChunkBoundaryState> {
  state: RouteChunkBoundaryState = { failed: false }

  static getDerivedStateFromError(): RouteChunkBoundaryState {
    return { failed: true }
  }

  componentDidUpdate(previous: ChunkErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  componentDidCatch(error: unknown) {
    console.error('[StatKeeper] Page failed to load', error)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="mx-auto max-w-lg space-y-3 px-4 py-6">
          <p role="alert" className="text-danger-content">
            This page could not be loaded. Your games are saved; reload to open the latest version.
          </p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </main>
      )
    }
    return <Suspense fallback={<RouteChunkFallback />}>{this.props.children}</Suspense>
  }
}

export default function RouteChunkBoundary({ children }: RouteChunkBoundaryProps) {
  const { pathname } = useLocation()
  return <ChunkErrorBoundary resetKey={pathname}>{children}</ChunkErrorBoundary>
}
