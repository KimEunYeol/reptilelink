#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! docker network inspect reptilelink-local >/dev/null 2>&1; then
  docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 reptilelink-local >/dev/null
fi
./node_modules/.bin/supabase start --network-id reptilelink-local -x realtime,imgproxy,edge-runtime,logflare,vector,supavisor,studio,postgres-meta > /tmp/reptilelink-local-start.log 2>&1
node scripts/local-env.mjs
node scripts/local-policy-preview.mjs
printf 'Local Supabase ready on http://127.0.0.1:56321. Service output is in /tmp/reptilelink-local-start.log.\n'
