import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/index.js';

describe('API Integration Tests', () => {
  it('GET /api/health returns healthy and app clock', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.app_now).toBeDefined();
  });

  it('POST /api/process-batch processes CSV and outputs exact 13 columns in CSV mode', async () => {
    const csvData = `pr_no,pr_line,created_at,requester,department,plant,item_code,description,quantity,uom,estimated_unit_price,need_by_date,urgency
PR-001,1,2026-11-05 09:00,Alice,Production,PUN1,ITM-1048,High Tensile Hex Bolt M16x60,100,NOS,7.5,2026-11-20,Normal
PR-002,1,2026-11-05 10:00,Bob,Safety,PUN1,ITM-1016,VCI Anti Rust Poly Bag,50,NOS,22.5,2026-11-22,Normal
PR-BAD,1,2026-11-05 11:00,Charlie,Production,PUN2,ITM-1001,Ball bearing,10,NOS,,2026-11-22,Normal`;

    const res = await request(app)
      .post('/api/process-batch?format=csv&persist=true')
      .set('Content-Type', 'text/csv')
      .send(csvData);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');

    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(4); // header + 3 rows

    const header = lines[0];
    expect(header).toBe(
      'pr_no,pr_line,resolved_item_code,group_id,po_id,decision,route,supplier_id,unit_price,group_value_inr,suggested_supplier_ids,policy_version,reason'
    );

    // Row 3 (PUN2) should be NOT_PROCESSED
    const row3 = lines[3];
    expect(row3).toContain('PR-BAD');
    expect(row3).toContain('NOT_PROCESSED');
    expect(row3).toContain('Invalid plant');
  });

  it('POST /api/requirements/:id/override enforces comment length and guardrail against Blocked supplier', async () => {
    // Fetch requirements
    const reqList = await request(app).get('/api/requirements');
    expect(reqList.status).toBe(200);
    expect(reqList.body.length).toBeGreaterThan(0);

    const targetReq = reqList.body[0];

    // 1. Attempt override without comment -> must reject
    const failRes = await request(app)
      .post(`/api/requirements/${targetReq.id}/override`)
      .send({
        comment: 'short',
        new_route: 'SPOT_PO',
      });
    expect(failRes.status).toBe(400);
    expect(failRes.body.error).toContain('at least 10 characters');

    // 2. Attempt override with Blocked supplier S004 -> MUST FAIL GUARDRAIL
    const guardrailRes = await request(app)
      .post(`/api/requirements/${targetReq.id}/override`)
      .send({
        comment: 'Attempting to force order to blocked supplier for urgent maintenance',
        new_supplier_id: 'S004', // S004 is Blocked!
      });
    expect(guardrailRes.status).toBe(400);
    expect(guardrailRes.body.error).toContain('GUARDRAIL VIOLATION');

    // 3. Valid override
    const validRes = await request(app)
      .post(`/api/requirements/${targetReq.id}/override`)
      .send({
        comment: 'Overriding to RFQ for commercial price discovery per purchasing head directive',
        new_route: 'RFQ',
      });
    expect(validRes.status).toBe(200);
    expect(validRes.body.requirement.status).toBe('overridden');
  });

  it('GET /api/preferred-suppliers/export returns top 3 per item in CSV', async () => {
    const res = await request(app).get('/api/preferred-suppliers/export?as_of=2026-11-15');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');

    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('item_code,rank,supplier_id,reference_price');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('POST /api/chat/sessions and messages drives multi-turn intake dialogue', async () => {
    // 1. Create session
    const sessRes = await request(app).post('/api/chat/sessions').send({});
    expect(sessRes.status).toBe(200);
    const sessionId = sessRes.body.session.id;

    // 2. Multi-turn dialogue 1: "need 200 nitrile gloves for Chakan by next Friday"
    const msg1 = await request(app)
      .post(`/api/chat/sessions/${sessionId}/messages`)
      .send({ text: 'need 200 nitrile gloves for Chakan by next Friday' });

    expect(msg1.status).toBe(200);
    expect(msg1.body.state.lines[0].plant).toBe('CHK1');
    expect(msg1.body.state.lines[0].quantity).toBe(200);
    // Should prompt for urgency
    expect(msg1.body.reply).toContain('urgency');

    // 3. Provide urgency: "Normal"
    const msg2 = await request(app)
      .post(`/api/chat/sessions/${sessionId}/messages`)
      .send({ text: 'Normal' });

    expect(msg2.status).toBe(200);
    expect(msg2.body.state.ready_to_confirm).toBe(true);
    expect(msg2.body.quickReplies).toContain('Confirm and submit');

    // 4. Confirm and submit
    const msg3 = await request(app)
      .post(`/api/chat/sessions/${sessionId}/messages`)
      .send({ text: 'Confirm and submit' });

    expect(msg3.status).toBe(200);
    expect(msg3.body.prNumber).toMatch(/^PR-26-\d{5}$/);
    expect(msg3.body.reply).toContain('submitted successfully');
  });

  it('POST /api/policy/changes/chat extracts change set, diff, and impact preview', async () => {
    const res = await request(app)
      .post('/api/policy/changes/chat')
      .send({ text: 'Raise the spot limit for Packaging to 3 lakh from 25 Nov 2026.' });

    expect(res.status).toBe(200);
    expect(res.body.changeSet).toBeDefined();
    expect(res.body.diff).toBeDefined();
    expect(res.body.impactPreview).toBeDefined();
  });

  it('Batch persistence and reprocessing preserves raw created_at, input order, and NOT_PROCESSED lines', async () => {
    const batchCsv = `pr_no,pr_line,created_at,requester,department,plant,item_code,description,quantity,uom,estimated_unit_price,need_by_date,urgency
PR-T1,1,2026-11-02 08:30,Alice,Production,PUN1,ITM-1048,High Tensile Hex Bolt M16x60,100,NOS,7.5,2026-11-15,Normal
PR-T2,1,2026-11-03 09:15,Bob,Maintenance,PUN2,,Invalid plant free text,50,NOS,20,2026-11-16,Normal
PR-T3,1,2026-11-04 10:45,Charlie,Safety,CHK1,ITM-1016,VCI Bag,200,NOS,22,2026-11-18,Normal`;

    // 1. Process batch with persist=true
    const postRes = await request(app)
      .post('/api/process-batch?persist=true')
      .set('Content-Type', 'text/csv')
      .send(batchCsv);

    expect(postRes.status).toBe(200);
    const batchId = postRes.body.batchId;
    expect(batchId).toBeDefined();
    expect(postRes.body.outputRows.length).toBe(3);

    // 2. Fetch batch lines from DB via GET /api/batches/:id
    const getBatchRes = await request(app).get(`/api/batches/${batchId}`);
    expect(getBatchRes.status).toBe(200);
    expect(getBatchRes.body.lines.length).toBe(3); // ALL 3 lines persisted, including PUN2!

    // Check line 0 created_at matches raw CSV timestamp date (2026-11-02)
    const line0 = getBatchRes.body.lines.find((l: any) => l.input_index === 0);
    expect(line0.raw_created_at).toBe('2026-11-02 08:30');
    expect(line0.status).toBe('grouped');

    // Check line 1 (PUN2) is persisted as not_processed with input_index 1
    const line1 = getBatchRes.body.lines.find((l: any) => l.input_index === 1);
    expect(line1.status).toBe('not_processed');
    expect(line1.error_reason).toContain('Invalid plant');

    // 3. Reprocess batch via POST /api/batches/:id/reprocess
    const reprocessRes = await request(app)
      .post(`/api/batches/${batchId}/reprocess`)
      .send({});

    expect(reprocessRes.status).toBe(200);
    expect(reprocessRes.body.outputRows.length).toBe(3); // Exact 3 rows preserved
    expect(reprocessRes.body.outputRows[1].route).toBe('NOT_PROCESSED');
    expect(reprocessRes.body.outputRows[0].pr_no).toBe('PR-T1');
    expect(reprocessRes.body.outputRows[1].pr_no).toBe('PR-T2');
    expect(reprocessRes.body.outputRows[2].pr_no).toBe('PR-T3');

    // 4. Export CSV via GET /api/batches/:id/export.csv
    const exportRes = await request(app).get(`/api/batches/${batchId}/export.csv`);
    expect(exportRes.status).toBe(200);
    const exportLines = exportRes.text.trim().split('\n');
    expect(exportLines.length).toBe(4); // 1 header + 3 rows
    expect(exportLines[2]).toContain('NOT_PROCESSED');
    expect(exportLines[2]).toContain('PR-T2');
  });

  it('POST /api/policy/changes/form creates structured change set and previews impact', async () => {
    const res = await request(app)
      .post('/api/policy/changes/form')
      .send({
        target_version: '5.2',
        effective_from: '2026-11-25',
        operations: [
          {
            op: 'set_param',
            param: 'spot_limit',
            value: 300000,
            citation: 'Form: Raised spot limit to 3 lakh',
          },
          {
            op: 'disable_rule',
            rule_id: '5.3',
            citation: 'Form: Withdrew emergency rule',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.changeSet.operations.length).toBe(2);
    expect(res.body.candidatePolicy.params.spot_limit).toBe(300000);
    expect(res.body.diff.summaryLines.length).toBeGreaterThan(0);
    expect(res.body.change_set_id).toBeDefined();
  });

  it('POST /api/policy/changes/chat returns 400 and needs_form_editor when 0 operations match', async () => {
    const res = await request(app)
      .post('/api/policy/changes/chat')
      .send({ text: 'Hello, this sentence has no policy operations whatsoever.' });

    expect(res.status).toBe(400);
    expect(res.body.needs_form_editor).toBe(true);
    expect(res.body.error).toContain('form editor');
  });
});
