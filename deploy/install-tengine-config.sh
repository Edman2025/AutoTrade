#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root so Tengine can validate and reload its root-owned configuration." >&2
  exit 1
fi

app_root=/home/ttp/agent-trade
tengine_root=/usr/local/tengine-2.3.2
source_conf="$app_root/deploy/tengine-agent-trade.conf"
source_proxy="$app_root/deploy/tengine-agent-trade-proxy.inc"
target_conf="$tengine_root/conf/conf.d/agent-trade.xunlian.co.conf"
target_proxy="$tengine_root/conf/conf.d/agent-trade-proxy.inc"
backup_directory="$app_root/backups/tengine-$(date -u +%Y%m%dT%H%M%SZ)"

for path in "$source_conf" "$source_proxy" "$tengine_root/sbin/nginx" /root/.acme.sh/xunlian.co/fullchain.cer /root/.acme.sh/xunlian.co/xunlian.co.key; do
  [[ -e $path ]] || { echo "Required path is missing: $path" >&2; exit 1; }
done

mkdir -p -m 700 "$backup_directory"
cp -a "$target_conf" "$backup_directory/"
[[ ! -e $target_proxy ]] || cp -a "$target_proxy" "$backup_directory/"
install -o root -g root -m 0644 "$source_conf" "$target_conf"
install -o root -g root -m 0644 "$source_proxy" "$target_proxy"

if ! "$tengine_root/sbin/nginx" -t; then
  cp -a "$backup_directory/$(basename "$target_conf")" "$target_conf"
  if [[ -e $backup_directory/$(basename "$target_proxy") ]]; then
    cp -a "$backup_directory/$(basename "$target_proxy")" "$target_proxy"
  else
    rm -f "$target_proxy"
  fi
  echo "Tengine validation failed; the previous configuration was restored." >&2
  exit 1
fi

"$tengine_root/sbin/nginx" -s reload
echo "Tengine configuration installed and reloaded. Backup: $backup_directory"
