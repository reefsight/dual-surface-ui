import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefCallback,
} from "react";

import type { AgentSurface } from "../surface.js";
import type { AgentElementDefinition } from "../types.js";

const AgentSurfaceContext = createContext<AgentSurface | null>(null);

export interface AgentSurfaceProviderProps {
  surface: AgentSurface;
  children?: ReactNode;
}

export function AgentSurfaceProvider({
  surface,
  children,
}: AgentSurfaceProviderProps): ReactNode {
  return createElement(AgentSurfaceContext.Provider, { value: surface }, children);
}

export function useAgentSurface(): AgentSurface {
  const surface = useContext(AgentSurfaceContext);
  if (!surface) {
    throw new Error("useAgentSurface requires an AgentSurfaceProvider");
  }
  return surface;
}

export function useAgentElement<T extends Element>(
  definition: AgentElementDefinition,
): RefCallback<T> {
  const surface = useAgentSurface();
  const cleanupRef = useRef<(() => void) | undefined>(undefined);
  const cleanup = useCallback(() => {
    const current = cleanupRef.current;
    cleanupRef.current = undefined;
    current?.();
  }, []);

  const ref = useCallback<RefCallback<T>>(
    (element) => {
      cleanup();
      if (element) cleanupRef.current = surface.register(element, definition);
    },
    [cleanup, definition, surface],
  );

  useEffect(() => cleanup, [cleanup]);
  return ref;
}

