import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({ ...base, globalSetup: "./e2e/rc1-global.ts" });
