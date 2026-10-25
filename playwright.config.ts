import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the running backend and its dev seed (scripts/dev-seed.sql).
 * Start the Spring Boot API on :8080 first; the Angular dev server is started (or reused) here.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // tests share the seeded database
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4200',
    channel: 'chrome', // the installed Chrome; no browser download needed
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: 'chrome' },
      // The full flows run on desktop; on a phone we check layout and navigation.
      testMatch: /layout\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
