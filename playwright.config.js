const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./backend/tests/interface",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8010",
    channel: "msedge",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
  },
  webServer: {
    command: "powershell.exe -NoProfile -ExecutionPolicy Bypass -File outils/lancer_serveur_tests_interface.ps1",
    url: "http://127.0.0.1:8010/api/sante",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
