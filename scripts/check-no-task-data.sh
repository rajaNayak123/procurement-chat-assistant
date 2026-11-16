#!/usr/bin/env bash
set -euo pipefail

echo "==> Running check-no-task-data.sh to verify no kit files are committed..."

FORBIDDEN_FILENAMES=(
  "item_master.csv"
  "supplier_master.csv"
  "po_history.csv"
  "contract_register.csv"
  "contract_lines.csv"
  "sample_pr_batch.csv"
  "plants.csv"
)

FORBIDDEN_HEADERS=(
  "item_code,description,uom,category,item_type,standard_price"
  "supplier_id,name,city,categories,status,on_time_pct,quality_rating"
  "po_number,po_date,supplier_id,item_code,quantity,uom,unit_price,plant,delivered_on_time"
  "contract_id,supplier_id,supplier_name,start_date,end_date,value_cap,consumed_value"
  "contract_id,item_code,description,uom,rate"
  "pr_no,pr_line,created_at,requester,department,plant,item_code,description,quantity,uom,estimated_unit_price,need_by_date,urgency"
)

FAILED=0

# Check tracked files in git
TRACKED_FILES=$(git ls-files || true)

for FILE in $TRACKED_FILES; do
  # Skip submission/ and tests/fixtures/
  if [[ "$FILE" =~ ^submission/ ]] || [[ "$FILE" =~ ^tests/fixtures/ ]] || [[ "$FILE" =~ ^packages/.*/tests/fixtures/ ]]; then
    continue
  fi

  BASENAME=$(basename "$FILE")
  for FORBIDDEN in "${FORBIDDEN_FILENAMES[@]}"; do
    if [[ "$BASENAME" == "$FORBIDDEN" ]]; then
      echo "ERROR: Forbidden task data file tracked: $FILE"
      FAILED=1
    fi
  done

  # Also check if tracked file ends with .pdf or .zip unless in ignored/fixture
  if [[ "$FILE" =~ \.pdf$ ]] || [[ "$FILE" =~ \.zip$ ]]; then
    echo "ERROR: Binary/task asset tracked in git: $FILE"
    FAILED=1
  fi

  # If it's a file, check for exact kit headers
  if [ -f "$FILE" ]; then
    FIRST_LINE=$(head -n 1 "$FILE" 2>/dev/null || true)
    for HEADER in "${FORBIDDEN_HEADERS[@]}"; do
      if [[ "$FIRST_LINE" == "$HEADER" ]]; then
        echo "ERROR: Forbidden kit CSV header found in tracked file: $FILE"
        FAILED=1
      fi
    done
  fi
done

if [ $FAILED -ne 0 ]; then
  echo "Task data check FAILED! Please remove task data files from git."
  exit 1
fi

echo "Task data check PASSED. No task data found in git tracking."
exit 0
