import { DocumentInterpreterAgent } from '../../src/agents/a03-document-interpreter/agent.js';
import { DocumentStore } from '../../src/agents/a03-document-interpreter/documents.js';
import { registerDocumentTools } from '../../src/agents/a03-document-interpreter/tools.js';
import type { ModelGateway } from '../../src/model/gateway.js';
import type { MalwareScanner, QuarantineLimits } from '../../src/agents/a03-document-interpreter/quarantine.js';
import { NullModelGateway } from '../../src/model/gateway.js';
import { makeKernel, TENANT } from './kernel.js';

export function makeDocumentHarness(opts: { model?: ModelGateway; scanner?: MalwareScanner; limits?: QuarantineLimits } = {}) {
  const model = opts.model ?? new NullModelGateway();
  const h = makeKernel({ model });
  const store = new DocumentStore(h.clock, h.ids, h.kernel.records.permissions, opts.scanner ?? null, opts.limits, 'test-secret');
  registerDocumentTools(h.kernel.gateway, store, h.kernel.records.permissions);
  h.kernel.records.registerDerivativeStore(store);
  h.kernel.registerSpecialist(new DocumentInterpreterAgent(model));
  const upload = (bytes: Uint8Array, extra: Partial<Parameters<DocumentStore['upload']>[0]> = {}) =>
    store.upload({ tenantId: TENANT, studentId: h.studentId, uploader: h.student, bytes, declaredMediaType: null, ...extra });
  const interpret = async (documentId: string, scope: Record<string, unknown> = {}) => {
    const req = h.task({ role: '03', purpose: 'document_import', objective: 'interpret_document', completionContract: 'document_import_v1', scope: { documentId, ...scope } });
    const out = await h.kernel.invoke(req);
    if (!out.accepted) throw new Error(`document result rejected: ${out.issues.join('; ')} / ${JSON.stringify(out.result.payload).slice(0, 400)}`);
    return out;
  };
  return { ...h, store, upload, interpret, model };
}
