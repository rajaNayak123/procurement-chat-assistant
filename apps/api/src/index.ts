import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { prisma } from './prisma.js';
import { batchRouter } from './routes/batch.routes.js';
import { requirementsRouter } from './routes/requirements.routes.js';
import { policyRouter } from './routes/policy.routes.js';
import { contractsRouter } from './routes/contracts.routes.js';
import { suppliersRouter } from './routes/suppliers.routes.js';
import { chatRouter } from './routes/chat.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { auditRouter } from './routes/audit.routes.js';
import { getAppNow } from '@cantill/engine';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Healthcheck endpoint: /api/health
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      status: 'healthy',
      app_now: getAppNow().toISOString(),
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// Mount Routers under /api
app.use('/api', batchRouter);
app.use('/api', requirementsRouter);
app.use('/api', policyRouter);
app.use('/api', contractsRouter);
app.use('/api', suppliersRouter);
app.use('/api', chatRouter);
app.use('/api', adminRouter);
app.use('/api', auditRouter);

// OpenAPI Swagger Document definition
const openApiDoc = {
  openapi: '3.0.0',
  info: {
    title: 'Corvo Engineering PR-to-PO Procurement API',
    version: '1.0.0',
    description: 'Policy-driven procurement engine API for batch processing, conversational intake, and policy governance.',
  },
  paths: {
    '/api/health': {
      get: { summary: 'Healthcheck', responses: { '200': { description: 'Healthy' } } },
    },
    '/api/process-batch': {
      post: {
        summary: 'Process PR batch CSV or text',
        parameters: [
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] } },
          { name: 'persist', in: 'query', schema: { type: 'boolean' } },
          { name: 'policy_version', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Batch evaluation decisions' } },
      },
    },
    '/api/requirements': {
      get: { summary: 'Get list of clubbed requirements', responses: { '200': { description: 'List of requirements' } } },
    },
    '/api/requirements/{id}': {
      get: { summary: 'Get requirement detail and decision trace', responses: { '200': { description: 'Requirement detail' } } },
    },
    '/api/requirements/{id}/approve': {
      post: { summary: 'Approve requirement to create PO or Sourcing Request', responses: { '200': { description: 'Approved' } } },
    },
    '/api/requirements/{id}/override': {
      post: { summary: 'Override decision with comment and guardrails', responses: { '200': { description: 'Overridden' } } },
    },
    '/api/policy/versions': {
      get: { summary: 'List policy versions', responses: { '200': { description: 'Policy versions' } } },
    },
    '/api/policy/active': {
      get: { summary: 'Get active policy document', responses: { '200': { description: 'Active policy' } } },
    },
    '/api/policy/changes': {
      post: { summary: 'Upload policy amendment document', responses: { '200': { description: 'Extracted change set' } } },
    },
    '/api/policy/changes/chat': {
      post: { summary: 'Describe policy change in chat', responses: { '200': { description: 'Extracted change set' } } },
    },
    '/api/contracts': {
      get: { summary: 'List contracts with ceiling consumption', responses: { '200': { description: 'Contracts' } } },
      post: { summary: 'Create contract manually', responses: { '201': { description: 'Created' } } },
    },
    '/api/contracts/extract-pdf': {
      post: { summary: 'Extract contract fields from uploaded PDF', responses: { '200': { description: 'Extracted contract' } } },
    },
    '/api/preferred-suppliers': {
      get: { summary: 'Get preferred suppliers ranking for an item', responses: { '200': { description: 'Preferred list' } } },
    },
    '/api/preferred-suppliers/export': {
      get: { summary: 'Export top-3 preferred suppliers CSV for all items', responses: { '200': { description: 'CSV download' } } },
    },
    '/api/chat/sessions': {
      post: { summary: 'Start requisition chat session', responses: { '200': { description: 'Session created' } } },
    },
    '/api/chat/sessions/{id}/messages': {
      post: { summary: 'Send message in requisition chat', responses: { '200': { description: 'Assistant reply' } } },
    },
    '/api/admin/import-master-data': {
      post: { summary: 'Import master data CSVs and PDF contracts', responses: { '200': { description: 'Import status' } } },
    },
    '/api/audit': {
      get: { summary: 'Get append-only audit log', responses: { '200': { description: 'Audit entries' } } },
    },
  },
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

// Start server if not running inside test runner
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Corvo Engineering Procurement API listening on http://localhost:${PORT}`);
    console.log(`OpenAPI documentation available at http://localhost:${PORT}/docs`);
  });
}

export { app };
