import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({ ...base, globalSetup: "./e2e/rc2-global.ts" });
