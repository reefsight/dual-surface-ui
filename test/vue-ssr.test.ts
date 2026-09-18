// @vitest-environment node
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { describe, expect, it } from "vitest";

import type { AgentElementDefinition } from "../src/index.js";
import { useAgentElement } from "../src/vue/index.js";

describe("Vue adapter server rendering", () => {
  it("renders human markup without a DOM root, provider, or agent marker", async () => {
    expect("document" in globalThis).toBe(false);
    expect("Element" in globalThis).toBe(false);
    const definition: AgentElementDefinition = {
      id: "server-confirm",
      actions: {
        confirm: {
          risk: "consequential",
          effects: ["operation_confirmed"],
        },
      },
    };
    const App = defineComponent({
      setup() {
        const element = useAgentElement<HTMLButtonElement>(definition);
        return () => h("button", { ref: element }, "Confirm");
      },
    });

    const html = await renderToString(createSSRApp(App));

    expect(html).toBe("<button>Confirm</button>");
    expect(html).not.toContain("data-agent-id");
  });
});
