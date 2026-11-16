import { Router, Request, Response } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';
import { prisma } from '../prisma.js';
import {
  getActivePolicy,
  parsePolicyAmendment,
  computeImpactPreview,
} from '../services/policy.service.js';
import {
  applyChangeSet,
  diffPolicies,
  lintPolicy,
  renderPolicyInPlainLanguage,
  DEFAULT_POLICY_V5,
  PolicyChangeSet,
} from '@cantill/policy';
import { logAuditEvent } from '../services/audit.service.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
export const policyRouter = Router();

function getRetroactiveWarning(effectiveFrom: string): string | null {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (effectiveFrom < todayStr) {
    return `Effective date ${effectiveFrom} is retroactive (earlier than today ${todayStr}). Reprocessing batch will re-evaluate requirements under this retroactive version.`;
  }
  return null;
}

// GET /api/policy/versions
policyRouter.get('/policy/versions', async (_req: Request, res: Response) => {
  const versions = await prisma.policyVersion.findMany({
    orderBy: { effective_from: 'desc' },
  });
  return res.json(versions);
});

// GET /api/policy/active
policyRouter.get('/policy/active', async (req: Request, res: Response) => {
  const date = req.query.date as string | undefined;
  const policy = await getActivePolicy(date);
  return res.json(policy);
});

// GET /api/policy/versions/:v/readable
policyRouter.get('/policy/versions/:v/readable', async (req: Request, res: Response) => {
  const version = await prisma.policyVersion.findUnique({
    where: { version: req.params.v },
  });

  const policy = version ? JSON.parse(version.policy_json) : DEFAULT_POLICY_V5;
  const readable = renderPolicyInPlainLanguage(policy);
  return res.json({ version: policy.version, rules: readable, policy });
});

// POST /api/policy/changes (File upload: PDF, DOCX, TXT, MD)
policyRouter.post(
  '/policy/changes',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No policy file uploaded' });
      }

      let text = '';
      const mime = req.file.mimetype;
      const originalName = req.file.originalname.toLowerCase();

      if (mime === 'application/pdf' || originalName.endsWith('.pdf')) {
        const data = await pdfParse(req.file.buffer);
        text = data.text;
      } else if (
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        originalName.endsWith('.docx')
      ) {
        const docxRes = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = docxRes.value;
      } else {
        // Text / Markdown
        text = req.file.buffer.toString('utf-8');
      }

      const basePolicy = await getActivePolicy();
      const changeSet = await parsePolicyAmendment(text, basePolicy);

      // Persist uploaded policy file to disk and record in policyDocument table
      const uploadsDir = path.resolve(process.cwd(), 'uploads/policies');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const safeFileName = `${Date.now()}_${req.file.originalname}`;
      const savedPath = path.join(uploadsDir, safeFileName);
      fs.writeFileSync(savedPath, req.file.buffer);

      const policyDoc = await prisma.policyDocument.create({
        data: {
          file_name: req.file.originalname,
          file_path: savedPath,
          version: changeSet.target_version,
        },
      });

      // Apply to copy to get candidate policy
      const candidatePolicy = applyChangeSet(basePolicy, changeSet);
      const diff = diffPolicies(basePolicy, candidatePolicy);
      const lintIssues = lintPolicy(candidatePolicy);
      const impactPreview = await computeImpactPreview(basePolicy, candidatePolicy);
      const retroactiveWarning = getRetroactiveWarning(changeSet.effective_from);

      // Save change set to database with status 'pending_approval'
      const saved = await prisma.policyChangeSet.create({
        data: {
          policy_id: changeSet.policy_id,
          base_version: changeSet.base_version,
          target_version: changeSet.target_version,
          effective_from: changeSet.effective_from,
          is_amendment: changeSet.is_amendment,
          operations: JSON.stringify(changeSet.operations),
          citations: JSON.stringify(changeSet.citations),
          assumptions: JSON.stringify(changeSet.assumptions),
          status: 'pending_approval',
        },
      });

      return res.json({
        change_set_id: saved.id,
        changeSet,
        diff,
        lintIssues,
        impactPreview,
        candidatePolicy,
        retroactive_warning: retroactiveWarning,
        document: {
          id: policyDoc.id,
          file_name: policyDoc.file_name,
          file_path: policyDoc.file_path,
        },
      });
    } catch (err: any) {
      console.error('Error parsing amendment document:', err);
      const needsFormEditor =
        err.message?.includes('No policy operations could be extracted') ||
        err.message?.includes('form editor') ||
        false;
      return res.status(400).json({
        error: err.message || 'Failed to parse policy document',
        needs_form_editor: needsFormEditor,
      });
    }
  }
);

// POST /api/policy/changes/chat (Text input in chat)
policyRouter.post('/policy/changes/chat', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text description of change required' });
    }

    const basePolicy = await getActivePolicy();
    const changeSet = await parsePolicyAmendment(text, basePolicy);

    const candidatePolicy = applyChangeSet(basePolicy, changeSet);
    const diff = diffPolicies(basePolicy, candidatePolicy);
    const lintIssues = lintPolicy(candidatePolicy);
    const impactPreview = await computeImpactPreview(basePolicy, candidatePolicy);
    const retroactiveWarning = getRetroactiveWarning(changeSet.effective_from);

    const saved = await prisma.policyChangeSet.create({
      data: {
        policy_id: changeSet.policy_id,
        base_version: changeSet.base_version,
        target_version: changeSet.target_version,
        effective_from: changeSet.effective_from,
        is_amendment: changeSet.is_amendment,
        operations: JSON.stringify(changeSet.operations),
        citations: JSON.stringify(changeSet.citations),
        assumptions: JSON.stringify(changeSet.assumptions),
        status: 'pending_approval',
      },
    });

    return res.json({
      change_set_id: saved.id,
      changeSet,
      diff,
      lintIssues,
      impactPreview,
      candidatePolicy,
      retroactive_warning: retroactiveWarning,
    });
  } catch (err: any) {
    console.error('Error parsing chat change:', err);
    const needsFormEditor =
      err.message?.includes('No policy operations could be extracted') ||
      err.message?.includes('form editor') ||
      false;
    return res.status(400).json({
      error: err.message || 'Failed to parse policy change',
      needs_form_editor: needsFormEditor,
    });
  }
});

// POST /api/policy/changes/form (Structured Form Editor input)
policyRouter.post('/policy/changes/form', async (req: Request, res: Response) => {
  try {
    const { target_version, effective_from, operations, assumptions = [] } = req.body;
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      return res.status(400).json({ error: 'At least one structured operation is required.' });
    }

    const basePolicy = await getActivePolicy();
    const [major, minor] = basePolicy.version.split('.').map(Number);
    const resolvedTargetVersion = target_version || `${major}.${(minor || 0) + 1}`;
    const resolvedEffectiveFrom = effective_from || '2026-11-25';

    const changeSet: PolicyChangeSet = {
      policy_id: basePolicy.policy_id,
      base_version: basePolicy.version,
      target_version: resolvedTargetVersion,
      effective_from: resolvedEffectiveFrom,
      is_amendment: true,
      operations,
      citations: operations.map((op, idx) => ({
        operation_index: idx,
        sentence: op.citation || `Structured edit: ${op.op}`,
      })),
      assumptions,
    };

    const candidatePolicy = applyChangeSet(basePolicy, changeSet);
    const diff = diffPolicies(basePolicy, candidatePolicy);
    const lintIssues = lintPolicy(candidatePolicy);
    const impactPreview = await computeImpactPreview(basePolicy, candidatePolicy);
    const retroactiveWarning = getRetroactiveWarning(changeSet.effective_from);

    const saved = await prisma.policyChangeSet.create({
      data: {
        policy_id: changeSet.policy_id,
        base_version: changeSet.base_version,
        target_version: changeSet.target_version,
        effective_from: changeSet.effective_from,
        is_amendment: changeSet.is_amendment,
        operations: JSON.stringify(changeSet.operations),
        citations: JSON.stringify(changeSet.citations),
        assumptions: JSON.stringify(changeSet.assumptions),
        status: 'pending_approval',
      },
    });

    return res.json({
      change_set_id: saved.id,
      changeSet,
      diff,
      lintIssues,
      impactPreview,
      candidatePolicy,
      retroactive_warning: retroactiveWarning,
    });
  } catch (err: any) {
    console.error('Error applying structured form change:', err);
    return res.status(400).json({ error: err.message || 'Failed to process structured form change' });
  }
});

// GET /api/policy/changes/:id
policyRouter.get('/policy/changes/:id', async (req: Request, res: Response) => {
  const changeSetDb = await prisma.policyChangeSet.findUnique({
    where: { id: req.params.id },
  });

  if (!changeSetDb) {
    return res.status(404).json({ error: 'Policy change set not found' });
  }

  const basePolicy = await getActivePolicy();
  const changeSet: PolicyChangeSet = {
    policy_id: changeSetDb.policy_id,
    base_version: changeSetDb.base_version,
    target_version: changeSetDb.target_version,
    effective_from: changeSetDb.effective_from,
    is_amendment: changeSetDb.is_amendment,
    operations: JSON.parse(changeSetDb.operations),
    citations: JSON.parse(changeSetDb.citations),
    assumptions: JSON.parse(changeSetDb.assumptions),
  };

  const candidatePolicy = applyChangeSet(basePolicy, changeSet);
  const diff = diffPolicies(basePolicy, candidatePolicy);
  const lintIssues = lintPolicy(candidatePolicy);
  const impactPreview = await computeImpactPreview(basePolicy, candidatePolicy);
  const retroactiveWarning = getRetroactiveWarning(changeSet.effective_from);

  return res.json({
    changeSet,
    diff,
    lintIssues,
    impactPreview,
    candidatePolicy,
    retroactive_warning: retroactiveWarning,
    status: changeSetDb.status,
  });
});

// POST /api/policy/changes/:id/approve
policyRouter.post('/policy/changes/:id/approve', async (req: Request, res: Response) => {
  const changeSetDb = await prisma.policyChangeSet.findUnique({
    where: { id: req.params.id },
  });

  if (!changeSetDb) {
    return res.status(404).json({ error: 'Policy change set not found' });
  }

  const {
    actor = 'Procurement Head Demo',
    role = 'Procurement Head',
    effective_from,
    version,
    comment = '',
    confirmed_assumptions = [],
    all_assumptions_confirmed = false,
  } = req.body;

  const targetVersion = (version || changeSetDb.target_version).trim();

  // 1. Unique constraint guardrail: prevent duplicate version string crash
  const existingVersion = await prisma.policyVersion.findUnique({
    where: { version: targetVersion },
  });
  if (existingVersion) {
    return res.status(400).json({
      error: `Version '${targetVersion}' already exists. Please choose a new unique version label (e.g. v5.2).`,
    });
  }

  // 2. Unticked assumptions guardrail: all assumptions must be confirmed
  const assumptions: string[] = JSON.parse(changeSetDb.assumptions || '[]');
  if (assumptions.length > 0) {
    const unconfirmed = assumptions.filter((a) => !confirmed_assumptions.includes(a));
    if (!all_assumptions_confirmed && unconfirmed.length > 0) {
      return res.status(400).json({
        error: `Unticked assumptions: all ${assumptions.length} assumptions must be acknowledged and confirmed before approval.`,
        unconfirmed_assumptions: unconfirmed,
      });
    }
  }

  const basePolicy = await getActivePolicy();
  const changeSet: PolicyChangeSet = {
    policy_id: changeSetDb.policy_id,
    base_version: changeSetDb.base_version,
    target_version: targetVersion,
    effective_from: effective_from || changeSetDb.effective_from,
    is_amendment: changeSetDb.is_amendment,
    operations: JSON.parse(changeSetDb.operations),
    citations: JSON.parse(changeSetDb.citations),
    assumptions,
  };

  const approvedPolicy = applyChangeSet(basePolicy, changeSet);

  // 3. Lint errors guardrail: errors block approval
  const lintIssues = lintPolicy(approvedPolicy);
  const lintErrors = lintIssues.filter((i) => i.severity === 'error');
  if (lintErrors.length > 0) {
    return res.status(400).json({
      error: 'Approval blocked: candidate policy has lint errors that must be resolved first.',
      lintErrors,
      lintIssues,
    });
  }

  // 4. Status lifecycle: scheduled vs active vs superseded
  const todayStr = new Date().toISOString().slice(0, 10);
  const isFuture = approvedPolicy.effective_from > todayStr;
  const versionStatus = isFuture ? 'scheduled' : 'active';

  if (versionStatus === 'active') {
    // Supersede previously active versions with effective_from <= this one
    await prisma.policyVersion.updateMany({
      where: {
        status: 'active',
        effective_from: { lte: approvedPolicy.effective_from },
      },
      data: { status: 'superseded' },
    });
  }

  // Save new policy version in database
  await prisma.policyVersion.create({
    data: {
      policy_id: approvedPolicy.policy_id,
      version: approvedPolicy.version,
      effective_from: approvedPolicy.effective_from,
      status: versionStatus,
      policy_json: JSON.stringify(approvedPolicy, null, 2),
      approved_by: actor,
      approved_at: new Date(),
    },
  });

  // Mark change set as approved
  await prisma.policyChangeSet.update({
    where: { id: req.params.id },
    data: { status: 'approved' },
  });

  // Log audit
  await logAuditEvent(
    'PolicyVersion',
    approvedPolicy.version,
    isFuture ? 'approve_and_schedule' : 'approve_and_activate',
    actor,
    role,
    { target_version: approvedPolicy.version, effective_from: approvedPolicy.effective_from, status: versionStatus, comment }
  );

  const retroactiveWarning = getRetroactiveWarning(approvedPolicy.effective_from);

  return res.json({
    message: isFuture
      ? `Policy v${approvedPolicy.version} approved and scheduled for activation on ${approvedPolicy.effective_from}`
      : `Policy v${approvedPolicy.version} approved and activated successfully`,
    policy: approvedPolicy,
    status: versionStatus,
    retroactive_warning: retroactiveWarning,
  });
});

// POST /api/policy/changes/:id/reject
policyRouter.post('/policy/changes/:id/reject', async (req: Request, res: Response) => {
  const { actor = 'Procurement Head Demo', role = 'Procurement Head', reason = '' } = req.body;

  await prisma.policyChangeSet.update({
    where: { id: req.params.id },
    data: { status: 'rejected' },
  });

  await logAuditEvent(
    'PolicyChangeSet',
    req.params.id,
    'reject',
    actor,
    role,
    { reason }
  );

  return res.json({ message: 'Policy change set rejected' });
});
