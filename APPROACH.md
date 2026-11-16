# Engineering Approach & Architecture (APPROACH.md)

## 1. Executive Summary
This project implements the Cantill.ai Round-1 PR-to-PO Web Application for Corvo Engineering (PUN1 Bhosari, CHK1 Chakan).
The platform ingests procurement requisitions via interactive conversational AI chat or bulk CSV batch upload, runs an immutable, pure, versioned decision engine against historical purchase orders, contracts, and supplier master data, and automatically routes each requirement to Purchase Order (Contract, Spot, Emergency) or Sourcing Request (Capex, RFQ, RFP, New Item).

## 2. AI Tools Used
### 2.1 In-App Runtime AI
* **Provider**: Groq Cloud API (`groq-sdk` / OpenAI-compatible endpoint).
* **Model**: `llama-3.3-70b-versatile` (configurable via `GROQ_MODEL`), chosen for fast token velocity, robust structured JSON output support, and high instruction adherence.
* **Roles in Application**:
  1. **Conversational Intake Assistant**: Extracts requisition slots (`item`, `quantity`, `plant`, `need_by_date`, `urgency`, `estimated_unit_price`) from multi-turn user conversation, with strict deterministic validation guardrails.
  2. **Policy Amendment Parser**: Analyzes natural language policy amendments and documents (PDF, DOCX, TXT) to generate a structured delta change set (`set_param`, `add_rule`, `update_rule`, `remove_rule`, `disable_rule`, `reorder`), accompanied by exact textual citations and explicit assumption extraction.
  3. **Contract Document Extractor**: Parses unstructured or scanned contract PDF text when regex fallbacks are insufficient.
* **Resilience & Fallbacks**:
  * Free-tier rate limits and network outages are mitigated by deterministic rule-based fallbacks for both chat slot extraction and policy amendment parsing. The application remains fully functional even with zero external API calls or depleted LLM quota.

### 2.2 Development & Coding AI
* **AI Coding Agent**: Antigravity (Google DeepMind Gemini 3.8 Flash) assisting in architectural design, implementation of deterministic rule engines, mathematical ranking formulas, TypeScript monorepo configuration, testing fixtures, and documentation.

## 3. Architecture & Strict Engine/UI Separation
The codebase is structured as a TypeScript monorepo with strict isolation between packages:

```
procurement-chat-assistant/
├── packages/
│   ├── engine/       # PURE DECISION ENGINE (Graded: Zero DB/HTTP/LLM dependencies)
│   │                 # Inputs: (policy, masters, contracts, history, ledger, pr_lines)
│   │                 # Outputs: Decisions, clubbed requirements, traces, consolidated POs
│   └── policy/       # POLICY AS DATA (Schema, Zod validation, linter, plain-language renderer,
│                     # diff engine, amendment extractor, and deterministic fallbacks)
├── apps/
│   ├── api/          # Express backend (Prisma ORM, SQLite/PostgreSQL, Groq API, file uploads)
│   └── web/          # React + Vite + Tailwind CSS frontend (TanStack Query, UI workflows)
├── tests/            # Vitest unit, golden fixtures, property tests, policy-change tests, supertest API
├── scripts/          # Database seeding, task data leak verification (`check-no-task-data.sh`)
├── docs/             # Policy schema documentation, architecture guides
└── submission/       # Output CSVs for blind evaluations
```

### Graded Engine Purity Guarantee
`packages/engine` has no dependencies on database libraries (Prisma/SQL), networking libraries (Express/Axios/Fetch), or LLM SDKs (Groq). It is a purely functional, deterministic engine taking in-memory typed data structures and producing decisions accompanied by exhaustive rule evaluation traces.

## 4. Policy as Data Model
The system enforces the "Zero Business Logic in Hardcoded Rules" paradigm:
* All thresholds (`spot_limit: 200000`, `emergency_limit: 500000`, `rfp_threshold: 1000000`), lookback windows (14-day clubbing, 7-day need-by, 365-day recent purchase, 548-day preferred lookback), ranking weights, and tie-breakers are stored in versioned JSON policy documents.
* Condition predicates support arbitrary composition (`all`, `any`, `not`) across an extensible field registry (`item.category`, `req.value`, `contract.usable`, `history.bought_from_active`, etc.).
* Amendments alter limits, category rules, plant-specific rules, and supplier weights purely through data edits without codebase redeployment.

## 5. Verification & Testing
* **Clause-by-Clause Unit Tests**: Item matching, abbreviation expansion, anti-splitting clubbing, multi-tier valuation fallback, contract ceiling exhaustion, rule evaluation order, preferred supplier scoring, and PO consolidation.
* **Property & Invariant Tests**: Hard rejection of blocked/inactive suppliers, deterministic repeatability across shuffled row orders.
* **Policy Mutation Tests**: Validating that changing a policy parameter or adding a plant-specific rule flips decisions dynamically without touching application code.

## 6. How to Run Tests
```bash
# Run all unit and integration tests across packages
npm test

# Run pure engine unit tests only
npm run test:engine

# Run policy-as-data mutation tests
npm run test:policy

# Run API tests
npm run test:api
```

## 7. Known Limits
* PDF extraction utilizes native text layer extraction (`pdf-parse`/`pdfjs-dist`); non-OCR image scans require digital text layers or LLM vision fallback.
* Indian number formatting is localized for the UI; CSV outputs adhere strictly to standard unformatted decimal numbers (`12345.67`) for tabular compliance.
