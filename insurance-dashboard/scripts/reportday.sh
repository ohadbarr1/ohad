#!/usr/bin/env bash
# Report Day runbook (lane P1): one company's new periodic report from MAYA to a deploy-ready build, every step timed.
#
#   scripts/reportday.sh <company> [period]        period default: the company's next report in calendar.json (e.g. 2026Q3)
#   scripts/reportday.sh <company> [period] --t0   stop after the T+0 stage (XBRL skeleton, unverified changes, feed, gate)
#   scripts/reportday.sh <company> [period] --no-fetch   the filing is already on disk (data/sources/pdf, data/sources/xbrl)
#
# Stages (docs/REPORTDAY.md has the season-day procedure and the timing budget):
#   A  T+0, deterministic, minutes:  MAYA pass for this company (owner-run, <= 1 request / 2 s, stops on 403/429) -> XBRL registry ->
#      kpi.json T+0 skeleton (unverified) -> report card skeleton -> changes (XBRL rows, unverified) -> feed -> gate
#   B  human/LLM extraction, the long pole: per-page text, then the extraction passes of EXTRACT_SPEC.md for this one report
#      (v6 primary statements, v1/v10 IFRS 17 + CSM roll-forward, solvency in the board report). This script never calls an LLM:
#      it prints the exact passes, inputs and output files, and waits for them (re-run it when they exist).
#   C  deterministic, minutes:  page checks -> facts -> IFRS/CSM -> cards -> changes -> feed/RSS -> xlsx -> gate -> deploy --check-only
#
# Nothing here deploys, commits or pushes. Wall-clock per step goes to the screen and to data/work/reportday/<company>_<period>.log
# (on the synced drive; untracked). Exit 0 = the stage reached is complete; 2 = waiting for the extraction pass (stage B).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
PY=/usr/bin/python3                                  # the gate, the DAG and every automatic step: standard library only
DRIVE_VENV="$HOME/Library/CloudStorage/GoogleDrive-thebarrs14@gmail.com/My Drive/Chief of Staff/Fox/ohad/insurance-dashboard/.venv/bin/python"
VPY=${FOX_VENV_PY:-$DRIVE_VENV}                      # duckdb steps (build_kpi, build_ifrs, fetch_maya): the owner's .venv

usage() { sed -n '2,8p' "$0"; exit 64; }
[ $# -ge 1 ] || usage
CO=$1; shift
PER=""; T0=0; FETCH=1
for a in "$@"; do
  case "$a" in
    --t0) T0=1 ;; --no-fetch) FETCH=0 ;; -h|--help) usage ;;
    [0-9][0-9][0-9][0-9]Q[1-3]|[0-9][0-9][0-9][0-9]FY) PER=$a ;;
    *) echo "unknown argument: $a"; usage ;;
  esac
done
if [ -z "$PER" ]; then
  PER=$($PY -c "import json,sys; c={x['id']:x for x in json.load(open('web/public/data/calendar.json'))['companies']}.get(sys.argv[1]); print(c['next']['period'] if c else '')" "$CO")
fi
[ -n "$PER" ] || { echo "no period for $CO (not in calendar.json); give one, e.g. 2026Q3"; exit 64; }
LOGDIR="data/work/reportday"; mkdir -p "$LOGDIR" 2>/dev/null || LOGDIR="${TMPDIR:-/tmp}"
LOG="$LOGDIR/${CO}_${PER}.log"
T_START=$(date +%s)
echo "== Report Day · $CO · $PER · $(date '+%d.%m.%y %H:%M')" | tee -a "$LOG"

# step <name> <command...>: run, time, log; stop the run on failure
step() {
  local name=$1; shift
  local t0=$(date +%s)
  printf '%-34s ' "$name" | tee -a "$LOG"
  if "$@" >>"$LOG" 2>&1; then
    local dt=$(( $(date +%s) - t0 )); printf 'ok   %4ss\n' "$dt" | tee -a "$LOG"
  else
    local dt=$(( $(date +%s) - t0 )); printf 'FAIL %4ss  (see %s)\n' "$dt" "$LOG" | tee -a "$LOG"
    tail -15 "$LOG"; exit 1
  fi
}
# soft step: a failure is reported, the run goes on (an optional input)
soft() {
  local name=$1; shift
  local t0=$(date +%s)
  printf '%-34s ' "$name" | tee -a "$LOG"
  if "$@" >>"$LOG" 2>&1; then printf 'ok   %4ss\n' "$(( $(date +%s) - t0 ))" | tee -a "$LOG"
  else printf 'skip %4ss  (failed or not available; see log)\n' "$(( $(date +%s) - t0 ))" | tee -a "$LOG"; fi
}
have_venv() { [ -x "$VPY" ] && "$VPY" -c "import duckdb" >/dev/null 2>&1; }

# ------------------------------------------------------------------------------------------------ A: T+0
echo "-- A · T+0 (deterministic)" | tee -a "$LOG"
if [ $FETCH = 1 ]; then
  # the owner's one-shot MAYA pass (docs/AUTOPILOT.md): PDFs + XBRL of new filings for this company, <= 1 request / 2 s; a bot wall stops it
  if have_venv; then step "MAYA pass (fetch filing + XBRL)" "$VPY" pipeline/autopilot/run.py --maya-once --companies "$CO" --no-regulator --no-notify --skip-gate --skip-build
  else echo "MAYA pass: needs duckdb (.venv: FOX_VENV_PY); fetch the filing by hand or run with --no-fetch" | tee -a "$LOG"; fi
fi
step "XBRL registry (local instances)"   $PY pipeline/fetch_xbrl.py --registry
step "T+0 skeleton -> kpi.json"           $PY pipeline/autopilot/t0.py --apply
step "deploy steps (cards, changes, feed)" $PY pipeline/dag.py --only deploy --no-deps
step "changes check"                      $PY pipeline/build_changes.py --check
step "gate"                               $PY pipeline/gate.py
$PY pipeline/build_changes.py --show "$CO" "$PER" 2>/dev/null | tee -a "$LOG" || echo "(no $PER report in changes yet: the XBRL instance is not on disk)" | tee -a "$LOG"
[ $T0 = 1 ] && { echo "== T+0 done in $(( $(date +%s) - T_START ))s; stage B is the extraction pass" | tee -a "$LOG"; exit 0; }

# ------------------------------------------------------------------------------------------------ B: extraction (human / LLM)
echo "-- B · extraction (human/LLM pass; this script does not call an LLM)" | tee -a "$LOG"
PDF=$(ls data/sources/pdf/"$CO"/"$PER"/*_quarterly.pdf data/sources/pdf/"$CO"/"$PER"/*_annual.pdf 2>/dev/null | head -1)
if [ -z "$PDF" ]; then
  echo "the $PER report of $CO is not on disk (data/sources/pdf/$CO/$PER/): run the MAYA pass first (stage A) or place the PDF there" | tee -a "$LOG"
  exit 2
fi
WORK="data/work/${CO}_${PER}/he"
[ -f "$WORK/p001.txt" ] || step "per-page text (pdftotext)" $PY pipeline/split_pages.py "$PDF" "$WORK"
soft "search text of the new PDF" $PY pipeline/build_pages.py --only "$(basename "$PDF" | cut -d_ -f1)"
need=()
[ -f "data/extracted_fs/$CO/$PER.json" ] || need+=("v6 primary statements      -> data/extracted_fs/$CO/$PER.json   (P&L, OCI, balance sheet, cash flow, every column; ~25-40 min)")
[ -f "data/extracted/$CO/$PER.json" ]    || need+=("v1 headline + CSM + solvency -> data/extracted/$CO/$PER.json      (board report + IFRS 17 notes; ~30-60 min)")
[ -f "data/extracted_ifrs_std/$CO/$PER.json" ] || need+=("v10 IFRS 17 by portfolio group -> data/extracted_ifrs_std/$CO/$PER.json (optional for Report Day; ~20-30 min)")
if [ ${#need[@]} -gt 0 ] && { [ ! -f "data/extracted_fs/$CO/$PER.json" ] || [ ! -f "data/extracted/$CO/$PER.json" ]; }; then
  echo "WAITING for the extraction pass of $CO $PER (pipeline/EXTRACT_SPEC.md; input: $WORK/pNNN.txt, $PDF):" | tee -a "$LOG"
  for n in "${need[@]}"; do echo "   - $n" | tee -a "$LOG"; done
  echo "   then: python3 pipeline/verify_fs.py $CO $PER  and re-run: scripts/reportday.sh $CO $PER --no-fetch" | tee -a "$LOG"
  echo "== stage A done in $(( $(date +%s) - T_START ))s; waiting for stage B" | tee -a "$LOG"
  exit 2
fi
step "page check, primary statements"   $PY pipeline/verify_fs.py "$CO" "$PER"
have_venv && soft "page check, IFRS 17 / CSM"  "$VPY" pipeline/verify_extraction.py "$CO" "$PER"

# ------------------------------------------------------------------------------------------------ C: rebuild
echo "-- C · rebuild (deterministic)" | tee -a "$LOG"
step "facts (statements -> workbook)"   $PY pipeline/dag.py --only facts
if have_venv; then
  step "build_kpi (printed beats tagged)" "$VPY" pipeline/build_kpi.py
  step "build_ifrs (IFRS 17 facts)"       "$VPY" pipeline/build_ifrs.py
else
  echo "build_kpi / build_ifrs: need duckdb (.venv, FOX_VENV_PY); skipped: kpi.json keeps the T+0 figure, CSM keeps the last report" | tee -a "$LOG"
fi
step "solvency, CSM, series"            $PY pipeline/dag.py --only build_solvency,build_csm,build_series
step "deploy steps (cards ... xlsx)"    $PY pipeline/dag.py --only deploy --no-deps
step "changes check"                    $PY pipeline/build_changes.py --check
step "gate"                             $PY pipeline/gate.py
$PY pipeline/build_changes.py --show "$CO" "$PER" | tee -a "$LOG"
soft "deploy.sh --check-only"           ./deploy.sh --check-only
echo "== $CO $PER: deploy-ready build in $(( $(date +%s) - T_START ))s (wall clock of this run). Next: review the diff, commit, push, wait for fox-ci, ./deploy.sh" | tee -a "$LOG"
