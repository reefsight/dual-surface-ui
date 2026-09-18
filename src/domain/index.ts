import type {
  AgentActionDefinition,
  AgentElementDefinition,
  AgentRisk,
} from "../types.js";
import type { WebMcpToolBinding } from "../webmcp/types.js";
import { captureDomainElementAnnotation } from "../definition.js";

export interface DomainActionAnnotation extends AgentActionDefinition {
  description: string;
  risk: AgentRisk;
  handler: NonNullable<AgentActionDefinition["handler"]>;
  webMcpName?: string;
}

export interface DomainElementAnnotation {
  id: string;
  description?: string;
  actions: Record<string, DomainActionAnnotation>;
}

export interface CompiledDomainElement {
  definition: AgentElementDefinition;
  webMcpBindings: readonly WebMcpToolBinding[];
}

function freezeJson(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const item of Object.values(value)) freezeJson(item);
  Object.freeze(value);
}

function freezeDefinition(definition: AgentElementDefinition): void {
  for (const action of Object.values(definition.actions ?? {})) {
    if (action.inputSchema) freezeJson(action.inputSchema);
    if (action.outputSchema) freezeJson(action.outputSchema);
    if (action.preconditions) Object.freeze(action.preconditions);
    if (action.effects) Object.freeze(action.effects);
    Object.freeze(action);
  }
  if (definition.actions) Object.freeze(definition.actions);
  Object.freeze(definition);
}

export function defineDomainElement(
  annotation: DomainElementAnnotation,
): CompiledDomainElement {
  const captured = captureDomainElementAnnotation(annotation);
  const definition = captured.definition;
  const toolNames = new Set<string>();
  const toolBindings: WebMcpToolBinding[] = [];
  for (const exposure of captured.exposures) {
    if (exposure.risk === "credential") {
      throw new TypeError("Credential domain actions cannot be exported");
    }
    if (toolNames.has(exposure.name)) {
      throw new TypeError("Duplicate domain tool name");
    }
    toolNames.add(exposure.name);
    toolBindings.push(
      Object.freeze({
        name: exposure.name,
        description: definition.actions![exposure.action]!.description!,
        elementId: definition.id,
        action: exposure.action,
      }),
    );
  }
  freezeDefinition(definition);
  return Object.freeze({
    definition,
    webMcpBindings: Object.freeze(toolBindings),
  });
}
