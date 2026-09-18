import {
  getCurrentInstance,
  inject,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  shallowRef,
  toValue,
  watch,
  type App,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Plugin,
  type ShallowRef,
  type WatchHandle,
} from "vue";

import type { AgentSurface } from "../surface.js";
import type { AgentElementDefinition } from "../types.js";

const AGENT_SURFACE: InjectionKey<AgentSurface> = Symbol(
  "dual-surface-ui AgentSurface",
);

export function createAgentSurfacePlugin(surface: AgentSurface): Plugin {
  return {
    install(app: App): void {
      app.provide(AGENT_SURFACE, surface);
    },
  };
}

export function useAgentSurface(): AgentSurface {
  if (!getCurrentInstance()) {
    throw new Error("useAgentSurface must be called during component setup");
  }
  const surface = inject(AGENT_SURFACE, null);
  if (!surface) {
    throw new Error(
      "useAgentSurface requires createAgentSurfacePlugin()",
    );
  }
  return surface;
}

export function useAgentElement<T extends Element>(
  definition: MaybeRefOrGetter<AgentElementDefinition>,
): ShallowRef<T | null> {
  if (!getCurrentInstance()) {
    throw new Error("useAgentElement must be called during component setup");
  }
  const surface = inject(AGENT_SURFACE, null);
  const element = shallowRef<T | null>(null) as ShallowRef<T | null>;
  let active = false;
  let stop: WatchHandle | undefined;

  const stopBinding = (): void => {
    active = false;
    const current = stop;
    stop = undefined;
    current?.();
  };

  const startBinding = (): void => {
    if (active) return;
    if (!surface) {
      throw new Error(
        "useAgentElement requires createAgentSurfacePlugin() on the client",
      );
    }
    active = true;
    stop = watch(
      () => [element.value, toValue(definition)] as const,
      ([currentElement, currentDefinition], _previous, onCleanup) => {
        if (!currentElement) return;
        if (
          typeof Element === "undefined" ||
          !(currentElement instanceof Element)
        ) {
          throw new TypeError(
            "useAgentElement template ref must resolve to a native Element",
          );
        }
        const unregister = surface.register(
          currentElement,
          currentDefinition,
        );
        onCleanup(unregister);
      },
      { flush: "post", immediate: true },
    );
  };

  onMounted(startBinding);
  onActivated(startBinding);
  onDeactivated(stopBinding);
  onBeforeUnmount(stopBinding);

  return element;
}
