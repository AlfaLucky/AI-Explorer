# AI Explorer

AI Explorer autonomously explores Fieldwork, a demo project-management workspace. It discovers visible links, buttons, and forms in Chromium, submits ordinary sample data, and checks the published demo API contract. The exploration rules are shared across screens. There are no scripted per-screen test cases in the runner.

[Open the live Railway demo](https://ai-explorer-production-2c9618b3.up.railway.app/).

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

The **Deploy to Railway** GitHub Actions workflow uploads each push to `main` to the `ai-explorer` Railway service. It uses the `RAILWAY_TOKEN` repository secret, a project token scoped to the Railway production environment.

The checked-in Dockerfile installs the matching Playwright package and Chromium runtime. The Railway service uses `/healthz` as its health check. If you add a custom domain, set `PUBLIC_ORIGIN` to its HTTPS origin so visitors can run the demo from that domain.
