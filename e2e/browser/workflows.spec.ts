import { expect, test } from "@playwright/test";

import { openScenario } from "./helpers";

for (const scenario of ["checkout", "approval", "legacy"] as const) {
  test(`${scenario} human and exported-agent paths reach the same state`, async ({ page }) => {
    await openScenario(page, scenario);
    const human = await page.evaluate(() => globalThis.browserEvidence.runHuman());

    await openScenario(page, scenario);
    const agent = await page.evaluate(() => globalThis.browserEvidence.runAgent());

    if (scenario === "checkout") {
      expect(agent.state).toEqual(human.state);
      expect(agent.run.result.status).toBe("succeeded");
      expect(agent.run.result.output.orderId).toBe("ORDER-1001");
    } else if (scenario === "approval") {
      expect(agent.state).toEqual(human.state);
      expect(agent.run.result.status).toBe("succeeded");
      expect(agent.run.invokedTool).toBe("documents.approve");
    } else {
      expect(agent.state).toEqual(human.state);
      expect(agent.count).toBe(1);
      expect(agent.result.status).toBe("succeeded");
      expect(agent.status).toBe(human.status);
    }
  });

  test(`${scenario} browser evidence is secret-safe and within metadata budgets`, async ({ page }) => {
    await openScenario(page, scenario);
    const result = await page.evaluate(() => globalThis.browserEvidence.runAgent());
    const history = await page.evaluate(() => globalThis.browserEvidence.history());
    const serialized = JSON.stringify({ history, result });

    for (const secret of [
      "PAYMENT_SECRET_SENTINEL_4242",
      "SECRET_SENTINEL_DO_NOT_EXPOSE",
      "LEGACY_SECRET_SENTINEL",
      "4821",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    for (const tool of history) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(JSON.stringify(tool.inputSchema).length).toBeLessThanOrEqual(32_768);
      expect(tool.optionsKeys).toEqual(["signal"]);
    }
    const actionResult = scenario === "legacy" ? result.result : result.run.result;
    expect(JSON.stringify(actionResult.output).length).toBeLessThanOrEqual(4_096);
  });
}
