# Deploy `orthographic-car` to Azure Static Web Apps

This project should be deployed as a static frontend, not as an Azure server application. Astro builds HTML, CSS, and browser JavaScript into `dist/`; Vue and Three.js run in the visitor's browser. No Cloudflare Worker, Astro server adapter, Azure Function, or server route is required.

## Repo-specific deployment contract

Current repo settings:

| Setting | Value | Why |
| --- | --- | --- |
| Project root | `/` | `package.json` and `astro.config.mjs` live at repository root. |
| Build command | `npm run build` | Type-checks, runs tests, then creates the static Astro build. |
| App location | `/` | Azure must install and build from repository root. |
| API location | empty | Project has no server API. Do not enter `api`. |
| Output location | `dist` | Astro's default output directory. |
| Node version | `>=22.12.0` | Declared in `package.json`; required by current Astro. |
| Production branch | `main` | Change only if repository uses another production branch. |

`astro.config.mjs` explicitly sets `output: 'static'`, does not change `outDir`, and installs no server adapter. Astro's default output directory remains `./dist` ([Astro configuration: `output`](https://docs.astro.build/en/reference/configuration-reference/#output), [`outDir`](https://docs.astro.build/en/reference/configuration-reference/#outdir)). Azure Static Web Apps can serve that output directly.

Vue hydration does not change this hosting model. Astro bundles hydrated Vue and Three.js code into static browser assets during `astro build`.

No `staticwebapp.config.json` is required for current root page. Add one only when Azure-specific routing, fallback, header, authentication, or networking rules become necessary. When building with Astro, place it under `public/` so Astro copies it to root of `dist/` ([Azure application configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration#file-location)).

## Prerequisites

- Azure account with an active subscription.
- GitHub account with this repository pushed to GitHub.
- Permission to authorize Azure Static Web Apps for the GitHub repository and to create Azure resources.
- Local Node.js 22.12.0 or newer, matching `package.json` and Astro's current requirement ([Astro installation prerequisites](https://docs.astro.build/en/install-and-setup/)).
- Optional: VS Code plus Azure Static Web Apps extension when using VS Code path.

Microsoft's portal quickstart lists Azure and GitHub accounts as prerequisites and explains GitHub authorization when a repository is not visible ([Azure portal quickstart](https://learn.microsoft.com/en-us/azure/static-web-apps/get-started-portal)). Azure reads frontend build runtime from `package.json` `engines` ([supported runtimes](https://learn.microsoft.com/en-us/azure/static-web-apps/languages-runtimes)).

No Cloudflare account, Worker, Pages project, or Wrangler configuration is involved.

## 1. Verify production build locally

Run from repository root:

```powershell
node --version
npm ci
npm run build
Test-Path .\dist\index.html
npm run preview -- --host 127.0.0.1
```

Expected result:

- Node reports `v22.12.0` or newer even-numbered supported release.
- Build exits successfully.
- `Test-Path` returns `True`.
- Preview URL loads game, keyboard controls work, and browser console shows no uncaught errors.
- Refreshing page still loads. Stop preview with `Ctrl+C`.

`astro preview` serves built `dist/` output for local verification; it is not a production server ([Astro CLI reference](https://docs.astro.build/en/reference/cli-reference/#astro-preview)). Commit and push source files and lockfile, not `dist/`.

## 2. Create Static Web App — Azure Portal path

Recommended first deployment:

1. Push working branch to GitHub and merge it into production branch.
2. Open [Azure Portal](https://portal.azure.com/), search for **Static Web Apps**, then select **Create**.
3. Select subscription and resource group. Use a dedicated resource group if easy cleanup matters.
4. Enter app name, select **Free** for a personal/test deployment, and select **GitHub** as source.
5. Authorize GitHub if prompted, then select organization, repository, and `main` branch.
6. Under build details, select **Custom** and enter:

   | Portal field | Enter |
   | --- | --- |
   | App location | `/` |
   | API location | leave empty |
   | Output location | `dist` |

7. Select **Review + create**, then **Create**.
8. Open created resource. Azure adds a workflow under `.github/workflows/` and a generated `AZURE_STATIC_WEB_APPS_API_TOKEN_...` GitHub Actions secret.
9. Open repository **Actions** tab. Wait for **Build and Deploy Job** to finish, then open Azure-generated `azurestaticapps.net` URL.

Azure creates both hosting resource and build/publish workflow; deployment is not ready until workflow finishes ([portal quickstart](https://learn.microsoft.com/en-us/azure/static-web-apps/get-started-portal)).

## Alternative: VS Code path

1. Install Azure Static Web Apps extension in VS Code.
2. Open repository root, open Static Web Apps panel, sign in to Azure, and select **+**.
3. Select subscription and repository, choose **Custom**, use `/` as app root, and `/dist` as built-files location.
4. Let extension create Static Web App and GitHub Actions workflow.
5. Inspect generated workflow and confirm repo-specific values in next section.

Astro's official Azure guide documents this wizard and its custom `/` plus `/dist` selections ([Astro Azure deployment guide](https://docs.astro.build/en/guides/deploy/microsoft-azure/)). In workflow YAML, Azure expresses output relative to app location, so use `dist` without leading slash.

## 3. Audit generated GitHub Actions workflow

Azure chooses random app and secret suffixes. Keep generated secret name unchanged. Build/deploy step should contain equivalent values:

```yaml
- name: Build And Deploy
  id: builddeploy
  uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_GENERATED_BY_AZURE }}
    repo_token: ${{ secrets.GITHUB_TOKEN }}
    action: upload
    app_location: /
    api_location: ""
    output_location: dist
    app_build_command: npm run build
    production_branch: main
```

Also keep generated pull-request close job with `action: close`; it removes closed PR preview environments.

Azure defines `app_location` as frontend source root and `output_location` as generated public folder relative to it. `app_build_command` is optional because build automation discovers `npm run build`, but keeping it explicit makes intent clear ([Azure build configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration)). Azure's Node build process installs packages and runs package build scripts; errors appear in GitHub workflow logs ([Azure troubleshooting](https://learn.microsoft.com/en-us/azure/static-web-apps/troubleshooting)).

### Deterministic-build fallback

Use this only if Azure's automatic build cannot select required Node release or you want `npm ci` enforced. Build before upload, then make deployment action upload existing `dist`:

```yaml
- uses: actions/checkout@v6
- name: Use repo Node version
  uses: actions/setup-node@v6
  with:
    node-version: 22.12.0
    cache: npm
- name: Install locked dependencies
  run: npm ci
- name: Build static site
  run: npm run build
- name: Deploy built site
  uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_GENERATED_BY_AZURE }}
    repo_token: ${{ secrets.GITHUB_TOKEN }}
    action: upload
    app_location: dist
    api_location: ""
    output_location: ""
    skip_app_build: true
```

When `skip_app_build: true`, Microsoft requires `app_location` to point at built files and `output_location` to be empty ([skip frontend build](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration#skip-building-front-end-app)). Do not combine first workflow values with this fallback.

## 4. Preview deployments

Generated workflow normally watches pull requests targeting `main`. Each open PR gets a pre-production URL; closing PR removes its environment. Use that URL to test controls, WebGL rendering, resize behavior, and asset loading before merge ([Azure PR environments](https://learn.microsoft.com/en-us/azure/static-web-apps/review-publish-pull-requests)).

For long-lived `dev` or `staging` previews, add those branch names to workflow push triggers and set `production_branch: main`. Azure documents stable branch preview URLs and portal deletion under **Environments** ([branch environments](https://learn.microsoft.com/en-us/azure/static-web-apps/branch-environments)).

## 5. Custom domain and HTTPS

For `www.example.com` managed by any external DNS provider:

1. Azure Portal → Static Web App → **Custom domains** → **+ Add** → **Custom domain on other DNS**.
2. Enter `www.example.com`.
3. At DNS provider, create CNAME record Azure requests, targeting generated Azure hostname.
4. Return to Azure, validate, and wait for DNS propagation.
5. Load `https://www.example.com` and verify certificate.
6. Optional: select domain → **Set default** so other attached domains redirect to it.

Azure automatically provisions free TLS certificates for generated and custom domains ([external DNS custom domain](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain-external)). Root/apex domains such as `example.com` use a different validation flow; follow Microsoft's [apex-domain guide](https://learn.microsoft.com/en-us/azure/static-web-apps/apex-domain-external). Default-domain redirects are configured in portal ([manage default domain](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain-default)).

Using a DNS provider does not move hosting there. DNS points visitors to Azure Static Web Apps.

## 6. Environment variables and secrets

Current game needs no deployment environment variables.

If a future client feature needs non-secret configuration, define a GitHub repository/environment variable and expose it to build job:

```yaml
jobs:
  build_and_deploy_job:
    env:
      PUBLIC_ANALYTICS_ID: ${{ vars.PUBLIC_ANALYTICS_ID }}
```

Read it in Astro/Vue client code with `import.meta.env.PUBLIC_ANALYTICS_ID`. Astro replaces these values at build time, and only `PUBLIC_`-prefixed values are accessible to client code ([Astro environment variables](https://docs.astro.build/en/guides/environment-variables/)). GitHub recommends variables for non-sensitive configuration and secrets for sensitive workflow values ([GitHub Actions variables](https://docs.github.com/en/actions/concepts/workflows-and-actions/variables)).

**Never put passwords, private API keys, or credentials in a `PUBLIC_*` value.** Static client code cannot keep secrets: bundled values are downloadable by every visitor. Even sourcing `PUBLIC_*` from a GitHub secret only hides it during build logs, not in deployed JavaScript.

Azure Portal → Static Web App → **Environment variables** applies to backend APIs, not frontend build. This repo has no API, so portal application settings do not configure Vue/Three.js code. Microsoft explicitly separates frontend build variables from backend API settings ([Azure configuration overview](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration-overview), [application settings](https://learn.microsoft.com/en-us/azure/static-web-apps/application-settings)). Add backend service before introducing real secrets.

## 7. Verify deployed site

After successful workflow:

1. Open generated Azure URL in private/incognito window.
2. Confirm page loads over HTTPS.
3. Check car movement with arrows and WASD; confirm `W`/up accelerates and `S`/down decelerates.
4. Drive across map boundary and verify procedural wrap/repetition.
5. Resize browser and test low-end-device settings if available.
6. Open browser DevTools:
   - Console: no uncaught exceptions.
   - Network: `index.html` and `/_astro/*` return 200/304, not 404.
7. Hard-refresh URL.
8. Repeat against custom domain after DNS validation.

Azure serves app at domain root. Current config needs no Astro `base` change.

## 8. Logs and monitoring

### Deployment/build logs

GitHub repository → **Actions** → Azure workflow → run → **Build and Deploy Job** → **Build And Deploy**. GitHub lets you view, search, and download each job's logs ([GitHub workflow logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs)). Azure troubleshooting points to same action log for Oryx/install/build failures ([Azure troubleshooting](https://learn.microsoft.com/en-us/azure/static-web-apps/troubleshooting)).

Useful checks:

- Wrong Node: confirm `package.json` still declares `>=22.12.0`.
- Missing output: confirm build log creates `dist/index.html` and workflow uses `output_location: dist`.
- API build error: confirm `api_location: ""`.
- Blank canvas after successful deploy: inspect browser console/WebGL support; this is client runtime, not Azure server log.

### Runtime monitoring caveat

For platform diagnosis, open Static Web App → **Diagnose and solve problems**. Azure provides availability/performance, configuration, and deployment diagnostics without adding application code ([Azure diagnostics overview](https://learn.microsoft.com/en-us/azure/static-web-apps/diagnostics-overview)). Azure Monitor's `Microsoft.Web/staticSites` reference also lists supported site/CDN metrics and diagnostic log categories; availability can depend on enabled features and plan ([supported metrics](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-web-staticsites-metrics), [supported logs](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-logs/microsoft-web-staticsites-logs)).

This site has no server runtime. Azure's documented Static Web Apps Application Insights integration requires an API and focuses on API requests, failures, and traces ([Azure monitoring](https://learn.microsoft.com/en-us/azure/static-web-apps/monitor)). Therefore, do not expect Worker-style server console logs from this static-only deployment.

For client gameplay/error telemetry, add browser telemetry explicitly in application code. Microsoft notes client-side trace calls as separate instrumentation, and Application Insights has separate pricing. That is optional and outside current deployment.

## 9. Rollback

Preferred, auditable rollback:

```powershell
git revert <bad-commit-sha>
git push origin main
```

Push triggers a fresh production deployment containing inverse of bad change.

Emergency temporary option: GitHub **Actions** → open last known-good successful run → **Re-run all jobs**. GitHub states re-run uses original `GITHUB_SHA` and `GITHUB_REF`, so re-running deployment should republish that commit ([re-running workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)). This is an inference from GitHub and deployment-action behavior, not an Azure version-slot feature. Follow with `git revert`; otherwise next push from bad branch head overwrites temporary rollback.

## 10. Cleanup

Preview only:

- Close PR to auto-delete PR environment.
- Or Azure Portal → Static Web App → **Environments** → delete named branch environment ([branch environments](https://learn.microsoft.com/en-us/azure/static-web-apps/branch-environments)).

Delete only Static Web App:

```powershell
az staticwebapp delete --name <app-name> --resource-group <resource-group-name>
```

Azure CLI documents this command ([`az staticwebapp delete`](https://learn.microsoft.com/en-us/cli/azure/staticwebapp?view=azure-cli-latest#az-staticwebapp-delete)). After resource deletion, remove generated Azure workflow and matching `AZURE_STATIC_WEB_APPS_API_TOKEN_...` repository secret if no other Static Web App uses them.

> **Warning:** Deleting an Azure resource group deletes every resource inside it and cannot be undone. Use resource-group deletion only when group was dedicated to this app and contents were verified.

Microsoft's deployment tutorial shows `az group delete`, with same irreversible warning ([Azure deployment tutorial cleanup](https://learn.microsoft.com/en-us/azure/static-web-apps/deploy-web-framework#clean-up-resources-optional)). Prefer deleting Static Web App alone when resource group is shared.

## Cloudflare Workers mental-model comparison

| Cloudflare concept familiar to you | Azure equivalent for this repo |
| --- | --- |
| Worker/Pages project | Azure Static Web Apps resource |
| Wrangler deploy command | GitHub Actions `Azure/static-web-apps-deploy` step |
| Static asset directory | Astro `dist/` |
| Worker script runtime | None; Vue + Three.js run in browser |
| Wrangler configuration | `.github/workflows/azure-static-web-apps-*.yml` plus optional `staticwebapp.config.json` |
| Worker binding/secret | No equivalent needed now; frontend build vars live in GitHub Actions, backend secrets require API |
| Preview deployment | Pull-request or branch environment |
| Custom route/domain | Static Web App custom domain + DNS record |
| Worker request logs | No server logs for static-only app; use Actions build logs and optional client telemetry |

Important distinction: Azure Static Web Apps is static hosting plus CI/CD here. Do not install Cloudflare adapter or deploy Worker bundle. If project later adds Astro server-rendered routes, reassess host architecture; current static settings would no longer be sufficient.

## Primary sources

Accessed 2026-07-17:

- [Astro: Deploy to Microsoft Azure](https://docs.astro.build/en/guides/deploy/microsoft-azure/)
- [Astro: Configuration reference](https://docs.astro.build/en/reference/configuration-reference/)
- [Astro: Environment variables](https://docs.astro.build/en/guides/environment-variables/)
- [Azure Static Web Apps: Portal quickstart](https://learn.microsoft.com/en-us/azure/static-web-apps/get-started-portal)
- [Azure Static Web Apps: Build configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration)
- [Azure Static Web Apps: Supported languages and runtimes](https://learn.microsoft.com/en-us/azure/static-web-apps/languages-runtimes)
- [Azure Static Web Apps: Custom domains](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain-external)
- [Azure Static Web Apps: Application settings](https://learn.microsoft.com/en-us/azure/static-web-apps/application-settings)
- [Azure Static Web Apps: Monitoring](https://learn.microsoft.com/en-us/azure/static-web-apps/monitor)
- [Azure Static Web Apps: Diagnostics](https://learn.microsoft.com/en-us/azure/static-web-apps/diagnostics-overview)
- [Azure Monitor: Static Web Apps metrics](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-web-staticsites-metrics)
- [Azure Monitor: Static Web Apps logs](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-logs/microsoft-web-staticsites-logs)
- [Azure Static Web Apps: Preview environments](https://learn.microsoft.com/en-us/azure/static-web-apps/review-publish-pull-requests)
- [Azure Static Web Apps: Troubleshooting](https://learn.microsoft.com/en-us/azure/static-web-apps/troubleshooting)
- [GitHub Actions: Workflow logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs)
- [GitHub Actions: Re-run workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
