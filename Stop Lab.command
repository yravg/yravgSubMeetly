#!/bin/bash
cd "$(dirname "$0")"
./scripts/stop-lab.sh
echo ""
read -r -p "Press Enter to close this window…" _
