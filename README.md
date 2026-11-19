# AI Explorer

AI Explorer autonomously explores Fieldwork, a demo project-management workspace. It discovers visible links, buttons, and forms in Chromium, submits ordinary sample data, and checks the published demo API contract. The exploration rules are shared across screens. There are no scripted per-screen test cases in the runner.

Open the dashboard, keep the prefilled Fieldwork URL or enter one of its screen URLs, and select **Run exploration**. The dashboard streams activity as it happens. Expand a finding for reproduction steps, expected and observed behavior, and available logs or screenshots. **Download JSON** exports the report and includes captured screenshots.

Fieldwork contains three intentional functional defects for the demo. The Activity view throws an unhandled JavaScript exception, Settings returns HTTP 500 when saving valid preferences, and the Projects Summary API returns a string in an integer field. Demo project changes are isolated to the browser session.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npx playwright install chromium
npm start
```

Open [AI Explorer](http://127.0.0.1:3000) or the [Fieldwork demo](http://127.0.0.1:3000/demo/). On Linux, use `npx playwright install --with-deps chromium` if browser system dependencies are missing. Run `npm run check` to validate the target scope and exercise the complete browser and API run. Run `npm run sample` to refresh the sample report from Chromium.

## Deploy on Railway

Connect the GitHub repository as the source of a Railway service and choose `main` as the deployment branch. Subsequent pushes to `main` trigger new builds. The checked-in Dockerfile installs the matching Playwright package and Chromium runtime. `railway.toml` defines the `/healthz` health check. Generate a public Railway domain for the dashboard. If you add a custom domain, set `PUBLIC_ORIGIN` to its HTTPS origin so visitors can run the demo from that domain.
