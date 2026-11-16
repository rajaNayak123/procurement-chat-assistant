# Corvo Engineering — Policy-Driven PR-to-PO Platform

> **Cantill.ai Round-1 Procurement Automation System**  
> Fictional Enterprise: Corvo Engineering (Plants: PUN1 Pune - Bhosari, CHK1 Chakan)

This repository implements a full-stack, policy-driven requisition-to-purchase-order system. Requisitions can be raised via interactive conversational AI chat or bulk CSV batch upload. An immutable, pure decision engine interprets versioned policy JSON documents to classify requirements into Purchase Orders (Contract, Spot, Emergency) or Sourcing Requests (Capex, RFQ, RFP, New Item), with anti-splitting clubbing and 24-hour purchase order consolidation.

---

## 1. Quick Start (One-Command Local Run)

```bash
docker compose up --build
```
* **Frontend Web App**: http://localhost:3000
* **Backend API**: http://localhost:3001
* **OpenAPI Documentation**: http://localhost:3001/docs
* **Healthcheck**: http://localhost:3001/api/health

On initial startup, database migrations execute automatically. If master data is mounted in `./data`, it is auto-imported; otherwise, a synthetic test baseline is seeded immediately.

---

## 2. Seeded Demo Users

Graders never fight authentication. Use the "Sign in as" picker in the header:
* **Aditi Sharma** (`Requester`): Can converse with the AI assistant to raise PRs.
* **Rajesh Nair** (`Buyer`): Reviews consolidated requirements, approves orders, applies overrides.
* **Vikram Mehta** (`Procurement Head`): Approves policy version amendments and capex sourcing.

---

## 3. Environment Variables

Configure in `.env` (see `.env.example`):

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | SQLite / PostgreSQL connection string | `file:./dev.db` |
| `PORT` | API server port | `3001` |
| `GROQ_API_KEY` | Groq API Key for AI extraction (optional) | `""` |
| `GROQ_MODEL` | Fast LLM model with structured JSON support | `llama-3.3-70b-versatile` |
| `APP_NOW` | Configurable application clock in IST (UTC+5:30) | `2026-11-16T10:00:00Z` |

*Note: If no Groq API key is supplied or rate limits are reached, the system automatically falls back to deterministic rule-based parsing for both conversational intake and policy amendments.*

---

## 4. Master Data Import

### Via Web UI
1. Navigate to the **Master Data** tab (`/admin`).
2. Drag & drop the 6 CSV files (`plants.csv`, `item_master.csv`, `supplier_master.csv`, `po_history.csv`, `contract_register.csv`, `contract_lines.csv`) and signed contract PDFs.
3. Click **Import Master Data**.

### Via CLI Seed Command
```bash
# Place files in ./data/ and run:
npm run seed
```

---

## 5. How to Run Tests

```bash
# Run all unit, policy mutation, and API integration tests
npm test

# Run pure decision engine unit tests
npm run test:engine

# Run policy-as-data mutation & amendment tests
npm run test:policy

# Run API integration tests
npm run test:api

# Run pre-commit task data check
npm run check-data
```

---

## 6. Batch Processing via API (cURL Example)

Process a CSV batch and receive decisions in the exact 13-column output format:

```bash
curl -X POST "http://localhost:3001/api/process-batch?format=csv&persist=true" \
  -H "Content-Type: text/csv" \
  --data-binary @pr_batches/sample_pr_batch.csv \
  -o decisions.csv
```

---

## 7. Blind-Day Runbook (Thursday 19 Nov)

1. **10:00 AM — Run 1 (v5.0)**:
   * Process the blind batch under Policy v5.0:
     ```bash
     curl -X POST "http://localhost:3001/api/process-batch?format=csv" \
       -H "Content-Type: text/csv" \
       --data-binary @blind_batch.csv \
       -o submission/run1_decisions.csv
     ```
2. **Upload Amendment & Review**:
   * Navigate to the **Policy Governance** screen (`/policy`).
   * Upload the amendment document (or paste the text).
   * Review the plain-language diff, citations, and impact preview.
   * Acknowledge assumptions, confirm the effective date, and click **Approve and activate**.
3. **Run 2 (v5.1 Reprocess)**:
   * Reprocess the same batch under the activated amendment:
     ```bash
     curl -X POST "http://localhost:3001/api/process-batch?format=csv" \
       -H "Content-Type: text/csv" \
       --data-binary @blind_batch.csv \
       -o submission/run2_decisions.csv
     ```
4. **Export Preferred Suppliers**:
   * Export preferred supplier list as of the evaluation date:
     ```bash
     curl -X GET "http://localhost:3001/api/preferred-suppliers/export?as_of=YYYY-MM-DD" \
       -o submission/preferred_suppliers.csv
     ```
5. **Noon IST Verification**:
   * Verify row counts match input lines.
   * Verify zero Blocked/Inactive vendors.
   * Push `submission/` files to Git.

---

## 8. Integrity Note: No Task Data Files Committed
Per the brief requirements, kit data files (`data/`, `kit/`, `*.zip`, `local_validation/`, contract PDFs) are strictly excluded from git tracking. The repository includes `scripts/check-no-task-data.sh` to enforce this policy in CI.
