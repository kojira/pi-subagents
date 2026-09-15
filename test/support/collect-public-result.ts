import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../../src/shared/types.ts';

/** Test-driver collection only. The public tool itself must return a launch receipt. */
export async function collectPublicResult(started: any): Promise<any> {
  if (!started.details?.asyncId) return started;
  const id = started.details.asyncId;
  const resultPath = path.join(DIRS.results, `${id}.json`);
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(resultPath)) {
    assert.ok(Date.now() < deadline, `No completion artifact for ${id}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  return {
    content: [{ type: 'text', text: result.error || result.output || result.summary || '' }],
    ...(result.success === false ? { isError: true } : {}),
    details: {
      ...started.details,
      results: result.results || [],
      ...(result.workflow ? { workflow: { ...result.workflow, receipt: result.workflowReceipt?.receipt } } : {}),
    },
  };
}
