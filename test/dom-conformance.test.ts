// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentActionNotFoundError,
  AgentElementNotFoundError,
  AgentInputValidationError,
  AgentVerificationFailedError,
  createAgentSurface,
} from "../src/index.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadDomFixture(name: string): Promise<void> {
  document.body.innerHTML = await readFile(
    resolve(projectRoot, "fixtures", "dom", name),
    "utf8",
  );
}

describe("DOM conformance", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("excludes hidden subtrees and secret-shaped hidden content", async () => {
    await loadDomFixture("visibility.html");

    const snapshot = createAgentSurface().snapshot();
    const ids = snapshot.nodes.map((node) => node.id);

    expect(ids).toEqual(
      expect.arrayContaining(["visible", "closed-summary", "open-details-child"]),
    );
    for (const hiddenId of [
      "hidden-parent",
      "aria-hidden-child",
      "inert-child",
      "display-none-child",
      "visibility-hidden-child",
      "hidden-input",
      "closed-dialog-child",
      "closed-details-child",
    ]) {
      expect(ids).not.toContain(hiddenId);
    }
    const serialized = JSON.stringify(snapshot);
    for (const secret of [
      "hidden-parent-secret",
      "aria-hidden-secret",
      "inert-secret",
      "display-secret",
      "visibility-secret",
      "hidden-input-secret",
      "dialog-secret",
      "details-secret",
      "nested-text-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("rejects a guessed action on a hidden registered element", async () => {
    document.body.innerHTML = `
      <div hidden><button>Hidden operation</button></div>
      <button data-agent-id="visible">Visible</button>
    `;
    const hidden = document.querySelector("div button")!;
    const handler = vi.fn();
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const surface = createAgentSurface({ policy, verifyEffect: () => true });
    surface.register(hidden, {
      id: "hidden-operation",
      actions: {
        execute: { risk: "write", effects: ["done"], handler },
      },
    });
    const snapshot = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "hidden-operation",
        action: "execute",
      }),
    ).rejects.toBeInstanceOf(AgentElementNotFoundError);
    expect(policy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps disabled controls observable but removes their actions", async () => {
    await loadDomFixture("disabled.html");
    const surface = createAgentSurface();
    const nodes = surface.snapshot().nodes;

    for (const id of [
      "disabled-button",
      "fieldset-input",
      "aria-disabled-child",
      "aria-disabled-role",
      "disabled-optgroup-option",
      "disabled-option",
    ]) {
      expect(nodes.find((node) => node.id === id)).toEqual(
        expect.objectContaining({
          state: expect.objectContaining({ disabled: true }),
          actions: [],
        }),
      );
    }
    expect(nodes.find((node) => node.id === "enabled-button")?.actions).toEqual([
      { name: "click", risk: "write" },
    ]);
  });

  it("rejects guessed native and custom actions on disabled controls", async () => {
    await loadDomFixture("disabled.html");
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const handler = vi.fn();
    const surface = createAgentSurface({ policy, verifyEffect: () => true });
    const custom = document.querySelector('[data-agent-id="aria-disabled-role"]')!;
    surface.register(custom, {
      id: "aria-disabled-role",
      actions: {
        execute: { risk: "write", effects: ["done"], handler },
      },
    });
    const snapshot = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "disabled-button",
        action: "click",
      }),
    ).rejects.toBeInstanceOf(AgentActionNotFoundError);
    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "aria-disabled-role",
        action: "execute",
      }),
    ).rejects.toBeInstanceOf(AgentActionNotFoundError);
    expect(policy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("exposes and executes a constrained native select action", async () => {
    await loadDomFixture("select-submit.html");
    const select = document.querySelector("select")!;
    const inputEvent = vi.fn();
    const changeEvent = vi.fn();
    select.addEventListener("input", inputEvent);
    select.addEventListener("change", changeEvent);
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();
    const selectNode = snapshot.nodes.find((node) => node.id === "color");

    expect(selectNode).toEqual(
      expect.objectContaining({
        state: expect.objectContaining({ value: "red", disabled: false }),
        actions: [
          {
            name: "select",
            risk: "write",
            inputSchema: { type: "string", enum: ["red", "yellow"] },
          },
        ],
      }),
    );

    const result = await surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "color",
      action: "select",
      input: "yellow",
    });

    expect(select.value).toBe("yellow");
    expect(inputEvent).toHaveBeenCalledOnce();
    expect(changeEvent).toHaveBeenCalledOnce();
    expect(result.revision).toBe("1");
    expect(result.node?.state.value).toBe("yellow");
  });

  it("rejects invalid or disabled select choices before policy", async () => {
    await loadDomFixture("select-submit.html");
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const surface = createAgentSurface({ policy });
    const snapshot = surface.snapshot();

    for (const input of ["blue", "green", "purple", "missing"]) {
      await expect(
        surface.perform({
          surfaceId: snapshot.surfaceId,
          revision: snapshot.revision,
          elementId: "color",
          action: "select",
          input,
        }),
      ).rejects.toBeInstanceOf(AgentInputValidationError);
    }
    expect(policy).not.toHaveBeenCalled();
    expect(document.querySelector("select")!.value).toBe("red");
  });

  it("rejects the legacy select set_value action without mutation", async () => {
    await loadDomFixture("select-submit.html");
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const surface = createAgentSurface({ policy });
    const snapshot = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "color",
        action: "set_value",
        input: "yellow",
      }),
    ).rejects.toBeInstanceOf(AgentActionNotFoundError);
    expect(policy).not.toHaveBeenCalled();
    expect(document.querySelector("select")!.value).toBe("red");
  });

  it("selects an enabled duplicate value instead of a disabled match", async () => {
    document.body.innerHTML = `
      <select aria-label="Duplicate" data-agent-id="duplicate">
        <option value="same" disabled>Disabled same</option>
        <option value="same">Enabled same</option>
        <option value="other" selected>Other</option>
      </select>
    `;
    const select = document.querySelector("select")!;
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();

    await surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "duplicate",
      action: "select",
      input: "same",
    });

    expect(select.selectedIndex).toBe(1);
    expect(select.options[0]?.selected).toBe(false);
    expect(select.options[1]?.selected).toBe(true);
  });

  it("publishes no select action when every option is disabled", () => {
    document.body.innerHTML = `
      <select aria-label="Unavailable" data-agent-id="unavailable">
        <option value="one" disabled>One</option>
        <optgroup label="Disabled" disabled><option value="two">Two</option></optgroup>
      </select>
    `;

    const node = createAgentSurface()
      .snapshot()
      .nodes.find((item) => item.id === "unavailable");

    expect(node?.actions).toEqual([]);
  });

  it("keeps sensitive select values out of snapshots and results", async () => {
    document.body.innerHTML = `
      <select aria-label="Credential" data-agent-id="credential" data-agent-sensitive="true">
        <option value="secret-one" selected>First credential</option>
        <option value="secret-two">Second credential</option>
      </select>
    `;
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();
    const node = snapshot.nodes.find((item) => item.id === "credential");

    expect(node?.state).toEqual(
      expect.objectContaining({ sensitive: true, valuePresent: true }),
    );
    expect(node?.state.value).toBeUndefined();
    expect(node?.actions[0]?.inputSchema).toEqual({ type: "string" });
    expect(JSON.stringify(snapshot)).not.toContain("secret-one");

    const result = await surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "credential",
      action: "select",
      input: "secret-two",
    });

    expect(JSON.stringify(result)).not.toContain("secret-two");
    expect(result.node?.state.value).toBeUndefined();
  });

  it("rejects an invalid sensitive select choice before policy", async () => {
    document.body.innerHTML = `
      <select aria-label="Credential" data-agent-id="credential" data-agent-sensitive="true">
        <option value="secret-one">First credential</option>
      </select>
    `;
    const policy = vi.fn(() => ({ outcome: "allow" as const }));
    const surface = createAgentSurface({ policy });
    const snapshot = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "credential",
        action: "select",
        input: "must-not-leak",
      }),
    ).rejects.toBeInstanceOf(AgentInputValidationError);
    expect(policy).not.toHaveBeenCalled();
  });

  it("submits through the native form lifecycle and verifies a transition", async () => {
    await loadDomFixture("select-submit.html");
    const form = document.querySelector("form")!;
    const submitEvent = vi.fn((event: Event) => {
      event.preventDefault();
      document.querySelector("output")!.textContent = "Submitted";
    });
    form.addEventListener("submit", submitEvent);
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();
    const formNode = snapshot.nodes.find((node) => node.id === "checkout-form");

    expect(formNode?.actions).toEqual([
      { name: "submit", risk: "consequential" },
    ]);

    const result = await surface.perform({
      surfaceId: snapshot.surfaceId,
      revision: snapshot.revision,
      elementId: "checkout-form",
      action: "submit",
    });

    expect(submitEvent).toHaveBeenCalledOnce();
    expect(result.revision).toBe("1");
    expect(
      surface.snapshot().nodes.find((node) => node.id === "submit-status")?.name,
    ).toBe("Submitted");
  });

  it("does not verify a submit with no semantic transition", async () => {
    await loadDomFixture("select-submit.html");
    const form = document.querySelector("form")!;
    form.addEventListener("submit", (event) => event.preventDefault());
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "checkout-form",
        action: "submit",
      }),
    ).rejects.toBeInstanceOf(AgentVerificationFailedError);
  });

  it("preserves native constraint validation during submit", async () => {
    await loadDomFixture("select-submit.html");
    const form = document.querySelector("form")!;
    const email = document.querySelector('input[type="email"]')!;
    email.value = "";
    const submitEvent = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submitEvent);
    const surface = createAgentSurface({ authorize: () => true });
    const snapshot = surface.snapshot();

    await expect(
      surface.perform({
        surfaceId: snapshot.surfaceId,
        revision: snapshot.revision,
        elementId: "checkout-form",
        action: "submit",
      }),
    ).rejects.toBeInstanceOf(AgentVerificationFailedError);
    expect(submitEvent).not.toHaveBeenCalled();
  });

  it("tracks dynamic visibility, enablement, options, and selection", () => {
    document.body.innerHTML = `
      <button data-agent-id="dynamic" hidden>Dynamic</button>
      <select aria-label="Choice" data-agent-id="choice">
        <option value="one">One</option>
      </select>
    `;
    const surface = createAgentSurface();
    const button = document.querySelector("button")!;
    const select = document.querySelector("select")!;

    expect(surface.snapshot().revision).toBe("0");
    button.hidden = false;
    expect(surface.snapshot().revision).toBe("1");
    button.disabled = true;
    const disabled = surface.snapshot();
    expect(disabled.revision).toBe("2");
    expect(disabled.nodes.find((node) => node.id === "dynamic")?.actions).toEqual(
      [],
    );
    button.disabled = false;
    expect(surface.snapshot().revision).toBe("3");
    select.insertAdjacentHTML("beforeend", `<option value="two">Two</option>`);
    expect(surface.snapshot().revision).toBe("4");
    select.value = "two";
    const selected = surface.snapshot();
    expect(selected.revision).toBe("5");
    expect(selected.nodes.find((node) => node.id === "choice")?.state.value).toBe(
      "two",
    );
  });
});
