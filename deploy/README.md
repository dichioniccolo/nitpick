# Deploying to k3s

Run these once, in order. After that, every push to `main` deploys.

1. Create the GitHub App (README, "GitHub App"). Webhook URL
   `https://nitpick.niccolodichio.it/api/github/webhook`, callback URL
   `https://nitpick.niccolodichio.it/api/auth/callback/github`.
2. Add the DNS record for `nitpick.niccolodichio.it`, as for the other sites.
3. Apply the database and the deploy identity:

   ```sh
   kubectl apply -f deploy/cnpg-cluster.yaml
   kubectl apply -f deploy/ci-deployer.yaml
   ```

4. Create the Secret. Secrets do not cross namespaces, so copy the operator's
   `fqdn-uri` and add the SSL parameters. `uselibpqcompat=true` matters: `pg`
   otherwise reads `sslmode=require` as `verify-full`, which CloudNativePG's own
   CA fails.

   ```sh
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

5. Copy the image pull secret (see `charts/nitpick/values.yaml`).
6. In the repository, add the `KUBECONFIG`, `TS_OAUTH_CLIENT_ID` and
   `TS_OAUTH_SECRET` secrets as for the other sites, then
   `gh variable set DEPLOY_ENABLED --body true`.

Set `GITHUB_APP_SLUG` in `charts/nitpick/values.yaml` to the App's real slug. It
is the name people mention in `@<slug> review`.
