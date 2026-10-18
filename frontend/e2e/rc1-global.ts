import baseSetup from "./global-setup";
import regressionSetup from "./regression/setup";

// rc1 acceptance only: the sales reset, then the regression fixtures (both are local-test-DB only).
export default async function globalSetup(): Promise<void> {
  await baseSetup();
  await regressionSetup();
}
