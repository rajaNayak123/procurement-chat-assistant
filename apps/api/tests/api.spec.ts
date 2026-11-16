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
});
