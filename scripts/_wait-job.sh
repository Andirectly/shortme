#!/bin/bash
# Aufruf: _wait-job.sh <port> <jobId> <logfile>  – schreibt Zustandswechsel, endet bei done/error/stopped
last=""; while true; do r=$(node scripts/cdp.cjs $1 eval "const j=(await window.cutawan.shortme.jobs()).find(x=>x.id==='$2'); return j ? [j.state, j.stage, (j.progress||0).toFixed(2), j.message, j.error||''].join(' | ') : 'weg'" 2>&1); if [ "$r" != "$last" ]; then echo "$(date +%H:%M:%S) $r" >> "$3"; last="$r"; fi; case "$r" in *done*|*error*|*stopped*|*weg*|*FAIL*) break;; esac; sleep 10; done
