#!/bin/bash
# mihomo 启动/重启（arXiv 专用代理，监听 127.0.0.1:7893）
pkill -f 'asv-app/mihomo-arxiv' 2>/dev/null
sleep 1
exec ~/bin/mihomo -f ~/asv-app/mihomo-arxiv.yaml >> ~/asv-app/mihomo.log 2>&1
