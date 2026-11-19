# AI Explorer

AI Explorer has two exploration modes. Public website exploration reads HTML, follows same-site navigation links, and reports failed page loads, HTTP errors, and redirect loops. Fieldwork is an interactive project-management demo that adds Chromium actions, sample form data, browser exceptions, and API contract checks. The agents discover links and controls during the run.

[Open the live Railway demo](https://ai-explorer-production-2c9618b3.up.railway.app/).

Enter a public website URL, or use **Use demo URL** to try Fieldwork, and select **Run exploration**. The dashboard streams activity as it happens. Expand a finding for reproduction steps and expected versus observed behavior. **Download JSON** exports the report along with available evidence.

For public sites, each run makes read-only GET requests and checks up to six pages. It respects `robots.txt` and follows links to HTML pages within the entered site. Public runs cover server responses and navigation. Interactive controls, JavaScript execution, screenshots, and API contract checks are available in Fieldwork.

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
