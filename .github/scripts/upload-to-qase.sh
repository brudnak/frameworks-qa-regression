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

if [[ -z "${QASE_TEST_RUN_ID:-}" && -z "${QASE_RUN_TITLE:-}" ]]; then
  echo "Qase upload skipped: no Qase run ID or run title was provided."
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

find_existing_run_id() {
  local response_file
  response_file="$(mktemp)"

  curl --fail --silent --show-error --get \
    -H "Token: ${QASE_AUTOMATION_TOKEN}" \
    --data-urlencode "search=${QASE_RUN_TITLE}" \
    --data-urlencode "limit=100" \
    "https://api.qase.io/v1/run/${QASE_PROJECT_CODE}" >"$response_file"

  python3 - "$response_file" "$QASE_RUN_TITLE" <<'PY'
import json
import sys

response_path = sys.argv[1]
expected_title = sys.argv[2].strip()

with open(response_path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)

entities = ((payload.get("result") or {}).get("entities") or [])
matches = [
    entity for entity in entities if (entity.get("title") or "").strip() == expected_title
]
matches.sort(key=lambda entity: entity.get("id", 0), reverse=True)
open_matches = [
    entity
    for entity in matches
    if (entity.get("status") or "").strip().lower() not in {"passed", "failed", "aborted", "complete"}
]

selected = open_matches[0] if open_matches else (matches[0] if matches else None)
if selected:
    print(selected["id"])
PY

  rm -f "$response_file"
}

create_run_id() {
  local output_file
  local create_args
  local created_run_id
  output_file="$(mktemp)"
  create_args=(
    testops run create
    --project "$QASE_PROJECT_CODE"
    --token "$QASE_AUTOMATION_TOKEN"
    --title "$QASE_RUN_TITLE"
    --output "$output_file"
    --verbose
  )

  if [[ -n "${QASE_RUN_DESCRIPTION:-}" ]]; then
    create_args+=(--description "$QASE_RUN_DESCRIPTION")
  fi

  qasectl "${create_args[@]}" >&2
  created_run_id="$(sed -n 's/^QASE_TESTOPS_RUN_ID=//p' "$output_file")"
  rm -f "$output_file"

  printf '%s\n' "$created_run_id"
}

resolve_run_id() {
  if [[ -n "${QASE_TEST_RUN_ID:-}" ]]; then
    echo "$QASE_TEST_RUN_ID"
    return 0
  fi

  local existing_run_id
  existing_run_id="$(find_existing_run_id)"
  if [[ -n "$existing_run_id" ]]; then
    echo "$existing_run_id"
    return 0
  fi

  create_run_id
}

QASE_RESOLVED_RUN_ID="$(resolve_run_id)"

if [[ -z "$QASE_RESOLVED_RUN_ID" ]]; then
  echo "Qase upload skipped: unable to resolve a Qase run ID."
  exit 0
fi

if [[ ! "$QASE_RESOLVED_RUN_ID" =~ ^[0-9]+$ ]]; then
  echo "Qase upload failed: resolved run ID '$QASE_RESOLVED_RUN_ID' is not numeric."
  exit 1
fi

if [[ -n "${QASE_RUN_TITLE:-}" ]]; then
  echo "Uploading Qase results to run ${QASE_RESOLVED_RUN_ID} (${QASE_RUN_TITLE})."
else
  echo "Uploading Qase results to run ${QASE_RESOLVED_RUN_ID}."
fi

qasectl testops result upload \
  --project "$QASE_PROJECT_CODE" \
  --token "$QASE_AUTOMATION_TOKEN" \
  --id "$QASE_RESOLVED_RUN_ID" \
  --format junit \
  --path "$RESULTS_PATH" \
  --batch 200 \
  --verbose
