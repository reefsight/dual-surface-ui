import type {
  ConformanceCaseBinding,
  ConformanceDriverInput,
  ConformanceExecutionPlan,
  ConformanceTarget,
} from "../../test/conformance/types.js";
import type { InstalledPackageBinding } from "../../test/conformance/installed-package.js";
import {
  createNativeWebMcpConformanceBinding,
  hasNativeWebMcpApi,
} from "./conformance-driver.js";

let active: ConformanceCaseBinding | undefined;
let activeOracleToken: string | undefined;
const target: ConformanceTarget = Object.freeze({
  targetId: "webmcp-native",
  family: "webmcp",
  tier: "native-webmcp",
});

function installSetupCapability(): void {
  globalThis.nativeConformanceSetup = Object.freeze({
    async prepare(
      plan: Readonly<ConformanceExecutionPlan>,
      packageBinding: InstalledPackageBinding,
      oracleToken: string,
    ) {
    if (active) throw new TypeError("native_binding_already_active");
    delete globalThis.nativeConformanceSetup;
    active = await createNativeWebMcpConformanceBinding(
      plan,
      target,
      packageBinding,
      (state) => globalThis.__dsuiNativeOracleCommit(oracleToken, plan.scenarioId, state),
    );
    activeOracleToken = oracleToken;
    },
  });
}

globalThis.nativeConformanceDriver = Object.freeze({
  async run(input: Readonly<ConformanceDriverInput>) {
    const binding = active;
    const oracleToken = activeOracleToken;
    if (!binding || !oracleToken) throw new TypeError("native_binding_unavailable");
    try {
      const raw = await binding.driver.run(input, new AbortController().signal);
      return raw;
    } finally {
      active = undefined;
      activeOracleToken = undefined;
      await binding.execution.dispose();
      installSetupCapability();
    }
  },
});

installSetupCapability();

document.documentElement.dataset.nativeConformance = hasNativeWebMcpApi()
  ? "ready"
  : "unavailable";

declare global {
  var nativeConformanceDriver: Readonly<{
    run(input: Readonly<ConformanceDriverInput>): Promise<unknown>;
  }>;
  var nativeConformanceSetup: Readonly<{
    prepare(
      plan: Readonly<ConformanceExecutionPlan>,
      packageBinding: InstalledPackageBinding,
      oracleToken: string,
    ): Promise<void>;
  }> | undefined;
  var __dsuiNativeOracleCommit: (
    oracleToken: string,
    scenarioId: ConformanceExecutionPlan["scenarioId"],
    state: unknown,
  ) => Promise<void>;
}
