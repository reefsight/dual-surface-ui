import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  InjectionToken,
  Input,
  type OnChanges,
  type Provider,
} from "@angular/core";

import type { AgentElementDefinition, AgentSurface } from "dual-surface-ui";

export const AGENT_SURFACE = new InjectionToken<AgentSurface>(
  "dual-surface-ui AgentSurface",
);

export function provideAgentSurface(surface: AgentSurface): Provider {
  return { provide: AGENT_SURFACE, useValue: surface };
}

export function injectAgentSurface(): AgentSurface {
  const surface = inject(AGENT_SURFACE, { optional: true });
  if (!surface) {
    throw new Error("injectAgentSurface requires provideAgentSurface()");
  }
  return surface;
}

@Directive({
  selector: "[dualSurfaceAgentElement]",
  standalone: true,
})
export class AgentElementDirective implements OnChanges {
  @Input({ required: true })
  dualSurfaceAgentElement!: AgentElementDefinition;

  readonly #destroyRef = inject(DestroyRef);
  readonly #element = inject<ElementRef<Element>>(ElementRef);
  readonly #surface = inject(AGENT_SURFACE, { optional: true });
  #ready = false;
  #unregister: (() => void) | undefined;

  constructor() {
    afterNextRender(() => {
      if (this.#destroyRef.destroyed) return;
      this.#ready = true;
      this.#bind();
    });
    this.#destroyRef.onDestroy(() => this.#dispose());
  }

  ngOnChanges(): void {
    if (this.#ready) this.#bind();
  }

  #bind(): void {
    this.#dispose();
    if (!this.#surface) {
      throw new Error(
        "AgentElementDirective requires provideAgentSurface()",
      );
    }
    if (!this.dualSurfaceAgentElement) {
      throw new Error("dualSurfaceAgentElement requires a definition");
    }
    this.#unregister = this.#surface.register(
      this.#element.nativeElement,
      this.dualSurfaceAgentElement,
    );
  }

  #dispose(): void {
    const unregister = this.#unregister;
    this.#unregister = undefined;
    unregister?.();
  }
}

