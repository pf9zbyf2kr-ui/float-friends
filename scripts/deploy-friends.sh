#!/usr/bin/env bash
set -Eeuo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
remote_host="${FLOAT_PROD_HOST:-154.219.105.171}"
remote_user="${FLOAT_PROD_USER:-root}"
remote_root="${FLOAT_REMOTE_ROOT:-/root/float-friends}"
ssh_key="${FLOAT_SSH_KEY:-$HOME/.ssh/codex_cpa_154_219_105_171}"
release_id="${FLOAT_RELEASE_ID:-$(date '+%Y%m%d-%H%M%S-cli')}"
release_path="$remote_root/releases/$release_id"
public_domain="${FLOAT_PUBLIC_DOMAIN:-float.154.219.105.171.sslip.io}"
caddy_file="${FLOAT_CADDY_FILE:-/root/hiphone/server/Caddyfile.testing}"
ssh_opts=(-i "$ssh_key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
rsync_transport="ssh -i $ssh_key -o BatchMode=yes -o StrictHostKeyChecking=accept-new"

ssh_run() {
  ssh "${ssh_opts[@]}" "$remote_user@$remote_host" "$@"
}

printf 'Checking existing momo production before Float deployment...\n'
ssh_run "docker ps --format '{{.Names}} {{.Status}}' | grep '^hiphone-' && curl -fsS -o /dev/null https://sbtitest.asia/"

printf 'Creating isolated Float release %s...\n' "$release_id"
ssh_run "mkdir -p '$release_path/source' '$remote_root/releases'"
rsync -az --delete \
  --exclude='.git/' --exclude='.next/' --exclude='node_modules/' --exclude='.env' \
  -e "$rsync_transport" "$project_root/" "$remote_user@$remote_host:$release_path/source/"

ssh "${ssh_opts[@]}" "$remote_user@$remote_host" bash -s -- "$remote_root" "$release_path" <<'REMOTE'
set -Eeuo pipefail
remote_root="$1"
release_path="$2"
if [[ -f "$remote_root/current/.env" ]]; then
  cp "$remote_root/current/.env" "$release_path/source/.env"
elif [[ -f "$remote_root/.env" ]]; then
  cp "$remote_root/.env" "$release_path/source/.env"
else
  umask 077
  cat > "$remote_root/.env" <<EOF
NEXT_PUBLIC_SOURCE_CODE_URL=https://github.com/afufu/float-friends
ACCOUNT_GATE_SECRET=$(openssl rand -hex 32)
NEXT_PUBLIC_OPEN_REGISTRATION=true
NEXT_PUBLIC_PLATFORM_AI_MANAGED=true
OPEN_REGISTRATION=true
FLOAT_BIND_ADDRESS=127.0.0.1
FLOAT_PORT=3100
EOF
  cp "$remote_root/.env" "$release_path/source/.env"
fi
# Reuse the existing momo Gateway as a private platform AI provider. The token
# stays server-side and is never written into a NEXT_PUBLIC variable.
if ! grep -q '^PLATFORM_AI_TOKEN=' "$remote_root/.env"; then
  platform_token="$(sed -n 's/^GATEWAY_TOKENS=//p' /root/hiphone/server/.env | cut -d, -f1 | tr -d '\r\n')"
  test -n "$platform_token"
  {
    printf '\nPLATFORM_AI_BASE_URL=http://gateway:8787/v1\n'
    printf 'PLATFORM_AI_TOKEN=%s\n' "$platform_token"
    printf 'PLATFORM_AI_MODEL=gpt-5.5\n'
  } >> "$remote_root/.env"
fi
cp "$remote_root/.env" "$release_path/source/.env"
cd "$release_path/source"
docker compose -p float-friends build app
docker compose -p float-friends up -d --no-build app
for _ in $(seq 1 30); do
  if docker compose -p float-friends exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)})"; then
    break
  fi
  sleep 2
done
docker compose -p float-friends ps
ln -sfn "$release_path/source" "$remote_root/current.next"
mv -Tf "$remote_root/current.next" "$remote_root/current"
printf 'release=%s\nverifiedAt=%s\n' "$(basename "$release_path")" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$release_path/release-success"
REMOTE

printf 'Connecting Float to HTTPS domain %s...\n' "$public_domain"
ssh "${ssh_opts[@]}" "$remote_user@$remote_host" bash -s -- "$caddy_file" "$release_path" "$public_domain" <<'REMOTE'
set -Eeuo pipefail
caddy_file="$1"
release_path="$2"
public_domain="$3"
backup="$release_path/Caddyfile.testing.before-float"
cp "$caddy_file" "$backup"
if ! grep -q '^# float-friends-managed$' "$caddy_file"; then
  cat >> "$caddy_file" <<EOF

# float-friends-managed
$public_domain {
	encode zstd gzip
	header {
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		X-Frame-Options "SAMEORIGIN"
		Permissions-Policy "camera=(self), microphone=(self), geolocation=(self)"
		-Server
	}
	reverse_proxy float-friends:3000
}
EOF
fi
if ! docker exec hiphone-caddy-1 caddy validate --config /etc/caddy/Caddyfile; then
  cp "$backup" "$caddy_file"
  exit 1
fi
if ! docker exec hiphone-caddy-1 caddy reload --config /etc/caddy/Caddyfile; then
  cp "$backup" "$caddy_file"
  docker exec hiphone-caddy-1 caddy reload --config /etc/caddy/Caddyfile || true
  exit 1
fi
REMOTE

printf 'Verifying Float port and existing momo production...\n'
ssh_run "curl -fsS http://127.0.0.1:3100/api/health && curl -fsS -o /dev/null https://sbtitest.asia/"
for _ in $(seq 1 30); do
  if curl -fsS "https://$public_domain/api/health"; then
    printf '\n'
    break
  fi
  sleep 2
done
curl -fsS -o /dev/null "https://$public_domain/"
printf '\nFloat deployment complete: %s\n' "$release_id"
