#!/usr/bin/env bash
set -euo pipefail

RESULTS_PATH="${1:-}"

if [[ -z "$RESULTS_PATH" ]]; then
  echo "Qase upload skipped: no results path was provided."
  exit 0
fi

if [[ "${REPORT_TO_QASE:-false}" != "true" ]]; then
  echo "Qase upload skipped: reporting is disabled for this run."
  exit 0
fi

if [[ -z "${QASE_TEST_RUN_ID:-}" ]]; then
  echo "Qase upload skipped: no Qase test run ID was provided."
  exit 0
fi

if [[ -z "${QASE_PROJECT_CODE:-}" ]]; then
  echo "Qase upload skipped: Qase project code is missing."
  exit 0
fi

if [[ -z "${QASE_AUTOMATION_TOKEN:-}" ]]; then
  echo "Qase upload skipped: Qase automation token is missing."
  exit 0
fi

if [[ ! -e "$RESULTS_PATH" ]]; then
  echo "Qase upload skipped: results path '$RESULTS_PATH' does not exist."
  exit 0
fi

qasectl testops result upload \
  --project "$QASE_PROJECT_CODE" \
  --token "$QASE_AUTOMATION_TOKEN" \
  --id "$QASE_TEST_RUN_ID" \
  --format junit \
  --path "$RESULTS_PATH" \
  --batch 200 \
  --verbose
