# Deploying to k3s

Run these once, in order. After that, every push to `main` deploys.

1. Create the GitHub App (README, "GitHub App"), but do not install it yet: step 9
   does that. Webhook URL `https://nitpick.niccolodichio.it/api/github/webhook`,
   callback URL `https://nitpick.niccolodichio.it/api/auth/callback/github`.
2. Set `GITHUB_APP_SLUG` in `charts/nitpick/values.yaml` to the App's real slug and
   commit it. It is the name people mention in `@<slug> review`.
3. Add the DNS record for `nitpick.niccolodichio.it`, as for the other sites.
4. Apply the database and the deploy identity:

   ```sh
   kubectl apply -f deploy/cnpg-cluster.yaml
   kubectl apply -f deploy/ci-deployer.yaml
   ```

5. Create the Secret. Wait for the operator to create its own first. Secrets do not
   cross namespaces, so copy the operator's `fqdn-uri` and add the SSL parameters.
   `uselibpqcompat=true` matters: `pg` otherwise reads `sslmode=require` as
   `verify-full`, which CloudNativePG's own CA fails.

   ```sh
   kubectl -n databases wait --for=create secret/nitpick-app --timeout=5m
   DB_URI=$(kubectl -n databases get secret nitpick-app -o jsonpath='{.data.fqdn-uri}' | base64 -d)
   kubectl -n nitpick create secret generic nitpick-app \
     --from-literal=DATABASE_URL="${DB_URI}?uselibpqcompat=true&sslmode=require" \
     --from-literal=AUTH_SECRET="$(openssl rand -base64 32)" \
     --from-literal=ANTHROPIC_API_KEY=... \
     --from-literal=GITHUB_APP_ID=... \
     --from-file=GITHUB_APP_PRIVATE_KEY=./app.private-key.pem \
     --from-literal=GITHUB_WEBHOOK_SECRET=... \
     --from-literal=GITHUB_CLIENT_ID=... \
     --from-literal=GITHUB_CLIENT_SECRET=...
   ```

6. Copy the image pull secret (see `charts/nitpick/values.yaml`).
7. In the repository, add the `KUBECONFIG`, `TS_OAUTH_CLIENT_ID` and
   `TS_OAUTH_SECRET` secrets as for the other sites, then
   `gh variable set DEPLOY_ENABLED --body true`.
8. Trigger the first deploy. Setting the variable alone deploys nothing, because
   only a run of the workflow reads it. Then wait for the web pods:

   ```sh
   gh workflow run ci.yml --ref main
   sleep 5
   gh run watch "$(gh run list --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   kubectl -n nitpick rollout status deployment/nitpick-web
   ```

9. Install the App on your repositories, only now. GitHub sends the `installation`
   event once: delivered before the web pod is up it is lost, and a later
   `syncInstallation` returns without a row, so nothing gets indexed.
