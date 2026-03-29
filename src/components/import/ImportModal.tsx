import { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import type { ImportResult } from '../../store/useAppStore';
import type { FrictionLog, ApiStatusCode, DialogueTurn, CustomerTier } from '../../types';

type Format = 'json' | 'plaintext';
type Phase = 'idle' | 'parsing' | 'preview' | 'error';

interface ParseResult {
  log: FrictionLog;
  warnings: string[];
}

// ─── Metadata header parser ────────────────────────────────────────────────────
// Supports an optional first line like:
//   [tier: Platinum, latency: 11200ms, nps: -2, retries: 3, status: 504]
interface HeaderMeta {
  tier?: CustomerTier;
  latencyMs?: number;
  nps?: number;
  retryCount?: number;
  apiStatusCode?: ApiStatusCode;
}

function parseHeaderMeta(firstLine: string): HeaderMeta | null {
  const trimmed = firstLine.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1);
  const meta: HeaderMeta = {};
  const pairs = inner.split(',').map(s => s.trim());
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.split(':');
    const key = rawKey.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'tier') {
      if (/platinum/i.test(val)) meta.tier = 'Platinum';
      else if (/gold/i.test(val)) meta.tier = 'Gold';
    } else if (key === 'latency') {
      const n = parseInt(val.replace(/[^\d]/g, ''), 10);
      if (!isNaN(n)) meta.latencyMs = n;
    } else if (key === 'nps') {
      const n = parseInt(val, 10);
      if (!isNaN(n)) meta.nps = Math.max(-2, Math.min(2, n));
    } else if (key === 'retries' || key === 'retry') {
      const n = parseInt(val, 10);
      if (!isNaN(n)) meta.retryCount = n;
    } else if (key === 'status' || key === 'http') {
      const n = parseInt(val, 10);
      if ([402, 408, 500, 503, 504].includes(n)) meta.apiStatusCode = n as ApiStatusCode;
    }
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

// ─── Inference helpers ─────────────────────────────────────────────────────────
function inferStatusCode(text: string): ApiStatusCode {
  if (/504|timeout|timed out/i.test(text)) return 504;
  if (/503|unavailable|service down/i.test(text)) return 503;
  if (/408|request timeout/i.test(text)) return 408;
  if (/500|internal server|error/i.test(text)) return 500;
  if (/402|payment required|unauthorized|blocked/i.test(text)) return 402;
  return 500;
}

function inferLatency(text: string): number {
  const m = text.match(/(\d[\d,]+)\s*ms/i);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  if (/timeout|8\s*second|10\s*second/i.test(text)) return 9000;
  if (/slow|delay/i.test(text)) return 5000;
  return 3000;
}

let importCounter = 0;

// ─── Parsers ───────────────────────────────────────────────────────────────────
function parseJson(raw: string): ParseResult {
  const obj = JSON.parse(raw) as Partial<FrictionLog>;
  const warnings: string[] = [];
  importCounter++;
  const id = obj.id ?? `LOG-IMP-${String(importCounter).padStart(3, '0')}`;
  if (!obj.dialogue || obj.dialogue.length === 0) warnings.push('No dialogue found — using placeholder.');
  if (!obj.systemContext) warnings.push('No systemContext — defaults used.');
  if (!obj.userMetadata) warnings.push('No userMetadata — defaults used.');

  const log: FrictionLog = {
    id,
    archetype: obj.archetype ?? 'Imported',
    frictionScore: obj.frictionScore ?? 0.5,
    dialogue: obj.dialogue ?? [{ role: 'customer', text: '(imported transcript)' }],
    userMetadata: {
      tier: obj.userMetadata?.tier ?? 'Gold',
      tenureMonths: obj.userMetadata?.tenureMonths ?? 12,
      creditScore: obj.userMetadata?.creditScore ?? 650,
      nps: obj.userMetadata?.nps ?? -1,
    },
    systemContext: {
      apiStatusCode: obj.systemContext?.apiStatusCode ?? 500,
      latencyMs: obj.systemContext?.latencyMs ?? 3000,
      retryCount: obj.systemContext?.retryCount ?? 1,
      sessionId: obj.systemContext?.sessionId ?? `imp-${Date.now()}`,
      timestamp: obj.systemContext?.timestamp ?? new Date().toISOString(),
    },
  };
  return { log, warnings };
}

function parsePlaintext(raw: string): ParseResult {
  const warnings: string[] = [];
  importCounter++;
  const id = `LOG-IMP-${String(importCounter).padStart(3, '0')}`;

  // ── Check first line for optional metadata header ──
  const lines = raw.split('\n');
  let headerMeta: HeaderMeta | null = null;
  let bodyLines = lines;
  if (lines.length > 0) {
    headerMeta = parseHeaderMeta(lines[0]);
    if (headerMeta) {
      bodyLines = lines.slice(1);
      warnings.push(`Metadata header detected — applied: ${JSON.stringify(headerMeta)}`);
    }
  }

  // ── Parse dialogue turns ──
  const turns: DialogueTurn[] = [];
  let currentRole: 'customer' | 'agent' | null = null;
  let currentText: string[] = [];

  const flush = () => {
    if (currentRole && currentText.length > 0)
      turns.push({ role: currentRole, text: currentText.join(' ').trim() });
  };

  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const custMatch = trimmed.match(/^(?:Customer|User|CX)\s*[:：]\s*(.*)/i);
    const agentMatch = trimmed.match(/^(?:Agent|Support|Rep|CS|AG)\s*[:：]\s*(.*)/i);
    if (custMatch) { flush(); currentRole = 'customer'; currentText = [custMatch[1]]; }
    else if (agentMatch) { flush(); currentRole = 'agent'; currentText = [agentMatch[1]]; }
    else if (currentRole) { currentText.push(trimmed); }
  }
  flush();

  if (turns.length === 0) {
    warnings.push('Could not detect Customer:/Agent: prefixes — treating as single customer turn.');
    turns.push({ role: 'customer', text: raw.trim() });
  }
  if (!turns.find(t => t.role === 'agent')) warnings.push('No agent turns detected.');

  const fullText = turns.map(t => t.text).join(' ');
  const statusCode = headerMeta?.apiStatusCode ?? inferStatusCode(fullText);
  const latencyMs = headerMeta?.latencyMs ?? inferLatency(fullText);
  const frictionScore = Math.min((latencyMs / 12000) * 0.35 + 0.25 * 0.6 + 0.25 * 0.7, 1);

  const log: FrictionLog = {
    id,
    archetype: 'Imported',
    frictionScore: parseFloat(frictionScore.toFixed(4)),
    dialogue: turns,
    userMetadata: {
      tier: headerMeta?.tier ?? 'Gold',
      tenureMonths: 12,
      creditScore: 650,
      nps: headerMeta?.nps ?? -1,
    },
    systemContext: {
      apiStatusCode: statusCode,
      latencyMs,
      retryCount: headerMeta?.retryCount ?? 1,
      sessionId: `imp-${Date.now()}`,
      timestamp: new Date().toISOString(),
    },
  };
  return { log, warnings };
}

// ─── File extraction ───────────────────────────────────────────────────────────
async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'txt') return file.text();
  if (ext === 'docx' || ext === 'doc') {
    const mammoth = await import('mammoth/mammoth.browser.min.js');
    const ab = await file.arrayBuffer();
    const result = await (mammoth as { extractRawText: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> }).extractRawText({ arrayBuffer: ab });
    return result.value;
  }
  if (ext === 'pdf') {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url,
    ).toString();
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: { str?: string; [key: string]: unknown }) => item.str ?? '').join(' '));
    }
    return pages.join('\n');
  }
  return file.text();
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtSGD(n: number) {
  return `SGD ${n.toLocaleString('en-SG', { minimumFractionDigits: 0 })}`;
}

function lossDelta(prev: number, next: number) {
  const delta = next - prev;
  const pct = prev > 0 ? ((delta / prev) * 100).toFixed(1) : '—';
  return { delta, pct, up: delta > 0 };
}

const DEBT_COLOR: Record<string, string> = {
  Critical: '#dc2626', High: '#ca8a04', Medium: '#2563eb', Low: '#16a34a',
};
const PRIORITY_COLOR: Record<string, string> = {
  P0: '#dc2626', P1: '#ca8a04', P2: '#2563eb', P3: '#6b7280',
};
const AGENT_COLOR: Record<string, string> = {
  Analyst: '#7c3aed', Strategist: '#0369a1', Architect: '#065f46',
};

// ─── Component ────────────────────────────────────────────────────────────────
export function ImportModal() {
  const importModalOpen = useAppStore(s => s.importModalOpen);
  const setImportModalOpen = useAppStore(s => s.setImportModalOpen);
  const addImportedLog = useAppStore(s => s.addImportedLog);
  const importResults = useAppStore(s => s.importResults);
  const aiPipelineStatus = useAppStore(s => s.aiPipelineStatus);

  const [format, setFormat] = useState<Format>('plaintext');
  const [raw, setRaw] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [importedLogId, setImportedLogId] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track when AI pipeline result arrives for our imported log
  const importResult: ImportResult | null = importedLogId ? (importResults[importedLogId] ?? null) : null;
  const pipelineStatus = importResult
    ? 'done'
    : importedLogId
      ? (() => {
          // Find the cluster status by checking all clusters
          const statuses = Object.values(aiPipelineStatus);
          if (statuses.includes('loading')) return 'loading';
          if (statuses.includes('error')) return 'error';
          return 'waiting';
        })()
      : null;

  // Auto-scroll to result when it arrives
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (importResult && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [importResult]);

  if (!importModalOpen) return null;

  const reset = () => {
    setRaw(''); setPhase('idle'); setParseResult(null);
    setErrorMsg(''); setImportedLogId(null); setFileName(null);
  };

  const close = () => { reset(); setImportModalOpen(false); };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true); setFileName(file.name);
    try {
      const text = await extractTextFromFile(file);
      setRaw(text); setPhase('idle'); setParseResult(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      setFileLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleParse = () => {
    if (!raw.trim()) return;
    setPhase('parsing');
    try {
      const result = format === 'json' ? parseJson(raw.trim()) : parsePlaintext(raw.trim());
      setParseResult(result); setPhase('preview');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const handleConfirm = () => {
    if (!parseResult) return;
    addImportedLog(parseResult.log);
    setImportedLogId(parseResult.log.id);
  };

  const placeholder = format === 'json'
    ? `{
  "dialogue": [
    {"role": "customer", "text": "My PayNow transfer is stuck..."},
    {"role": "agent", "text": "I can see the transaction..."}
  ],
  "systemContext": {"apiStatusCode": 504, "latencyMs": 9200, "retryCount": 3},
  "userMetadata": {"tier": "Platinum", "tenureMonths": 24, "creditScore": 720, "nps": -2}
}`
    : `[tier: Platinum, latency: 9200ms, nps: -2, retries: 3, status: 504]
Customer: I sent SGD 3,000 via PayNow to a DuitNow account 40 mins ago. Timeout error but my account was debited.
Agent: I can see the transaction. The cross-border gateway returned a 504 timeout. Let me check the settlement queue.
Customer: When will this be resolved? My supplier needs the funds urgently.
Agent: I have flagged this as urgent, reference INC-9921. Update within 45 minutes.`;

  return ReactDOM.createPortal(
    <>
      <div onClick={importedLogId ? undefined : close} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        zIndex: 300, backdropFilter: 'blur(3px)', animation: 'fadeIn 0.18s ease',
      }} />

      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '660px', maxHeight: '92vh',
        background: '#ffffff', borderRadius: '12px',
        border: '1px solid #e5e7eb',
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        zIndex: 301, display: 'flex', flexDirection: 'column',
        animation: 'fadeIn 0.2s ease', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #f3f4f6',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#fafafa', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 700, color: '#111827' }}>
              Import Transcript
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>
              Paste text or upload .txt · .docx · .pdf — optional metadata header supported
            </div>
          </div>
          <button onClick={close} style={{
            background: 'none', border: '1px solid #e5e7eb', borderRadius: '5px',
            color: '#6b7280', cursor: 'pointer', padding: '4px 10px',
            fontFamily: 'var(--font-mono)', fontSize: '11px',
          }}>esc</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── POST-IMPORT RESULT PANEL ── */}
          {importedLogId && (
            <div ref={resultRef} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

              {/* Status header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '12px 14px', borderRadius: '8px',
                background: pipelineStatus === 'done' ? '#f0fdf4' : pipelineStatus === 'error' ? '#fef2f2' : '#fffbeb',
                border: `1px solid ${pipelineStatus === 'done' ? '#bbf7d0' : pipelineStatus === 'error' ? '#fecaca' : '#fde68a'}`,
              }}>
                <span style={{ fontSize: '18px' }}>
                  {pipelineStatus === 'done' ? '✓' : pipelineStatus === 'error' ? '✗' : '⏳'}
                </span>
                <div>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 700, color: '#111827' }}>
                    {pipelineStatus === 'done'
                      ? `${importedLogId} — AI analysis complete`
                      : pipelineStatus === 'error'
                        ? 'AI pipeline error — fell back to deterministic'
                        : `${importedLogId} — Gemini analyzing…`}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
                    {pipelineStatus === 'done'
                      ? 'Observer re-clustered · Analyst → Strategist → Architect complete'
                      : 'Observer re-clustering · running Analyst → Strategist → Architect pipeline'}
                  </div>
                </div>
              </div>

              {/* Result details — only when done */}
              {importResult && (
                <>
                  {/* Cluster classification */}
                  <SectionLabel>Cluster Classification</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <MetaCard
                      label="Assigned Cluster"
                      value={importResult.clusterLabel}
                      sub={importResult.clusterId}
                      badge={importResult.isNewCluster ? { text: 'NEW CLUSTER', color: '#7c3aed', bg: '#f5f3ff' } : { text: 'EXISTING', color: '#16a34a', bg: '#f0fdf4' }}
                    />
                    <MetaCard
                      label="Primary Issue"
                      value={importResult.primaryIssue}
                    />
                    <MetaCard
                      label="Technical Debt"
                      value={importResult.technicalDebtLevel}
                      valueColor={DEBT_COLOR[importResult.technicalDebtLevel] ?? '#374151'}
                    />
                    <MetaCard
                      label="Priority"
                      value={importResult.priority}
                      valueColor={PRIORITY_COLOR[importResult.priority] ?? '#374151'}
                    />
                  </div>

                  {/* Loss impact */}
                  <SectionLabel>Annual Loss Impact</SectionLabel>
                  <LossDeltaPanel
                    prev={importResult.prevAnnualLossSGD}
                    next={importResult.newAnnualLossSGD}
                    isNew={importResult.isNewCluster}
                  />

                  {/* Gemini calls */}
                  <SectionLabel>Gemini API Calls</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {importResult.geminiCalls.map((call, i) => {
                      const reasoningKey = call.agent.toLowerCase() as 'analyst' | 'strategist' | 'architect';
                      const reasoning = importResult.agentReasoning?.[reasoningKey];
                      return <GeminiCallRow key={i} call={call} reasoning={reasoning} />;
                    })}
                    {importResult.geminiCalls.length === 0 && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#9ca3af', padding: '8px' }}>
                        No Gemini calls recorded — deterministic path used.
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
                    <ActionBtn onClick={reset} variant="ghost">Import Another</ActionBtn>
                    <ActionBtn onClick={close} variant="primary">Done</ActionBtn>
                  </div>
                </>
              )}

              {/* Still loading — spinner */}
              {pipelineStatus === 'loading' || pipelineStatus === 'waiting' ? (
                <div style={{
                  display: 'flex', gap: '10px', alignItems: 'center',
                  padding: '12px', background: '#f9fafb', borderRadius: '6px',
                  border: '1px solid #f3f4f6',
                }}>
                  <span style={{
                    display: 'inline-block', width: '14px', height: '14px',
                    border: '2px solid #e5e7eb', borderTopColor: '#111827',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#6b7280' }}>
                    Gemini is analyzing — Analyst → Strategist → Architect…
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {/* ── INPUT FORM — hidden after import ── */}
          {!importedLogId && (
            <>
              {/* Format toggle */}
              <div>
                <FieldLabel>Input Format</FieldLabel>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(['plaintext', 'json'] as Format[]).map(f => (
                    <button key={f} onClick={() => { setFormat(f); reset(); }} style={{
                      padding: '5px 14px', borderRadius: '20px', cursor: 'pointer',
                      fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: format === f ? 700 : 400,
                      background: format === f ? '#111827' : '#f9fafb',
                      color: format === f ? '#ffffff' : '#6b7280',
                      border: `1px solid ${format === f ? '#111827' : '#e5e7eb'}`,
                      transition: 'all 0.12s',
                    }}>
                      {f === 'plaintext' ? 'Plain Text' : 'JSON'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Metadata hint (plain text only) */}
              {format === 'plaintext' && (
                <div style={{
                  padding: '9px 12px', background: '#f8faff', border: '1px solid #dbeafe',
                  borderRadius: '6px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#1e40af', lineHeight: '1.7',
                }}>
                  <span style={{ fontWeight: 700 }}>Optional metadata header</span> (first line):{' '}
                  <span style={{ color: '#374151' }}>[tier: Platinum, latency: 9200ms, nps: -2, retries: 3, status: 504]</span>
                  <br />
                  Without it, tier/latency/status are inferred from dialogue keywords.
                </div>
              )}

              {/* File upload */}
              <div>
                <FieldLabel>Upload File</FieldLabel>
                <input ref={fileInputRef} type="file" accept=".txt,.docx,.doc,.pdf"
                  onChange={handleFileChange} style={{ display: 'none' }} id="sierra-file-upload" />
                <label htmlFor="sierra-file-upload" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '10px', padding: '13px 20px',
                  border: '1.5px dashed #d1d5db', borderRadius: '8px',
                  cursor: fileLoading ? 'wait' : 'pointer',
                  background: '#fafafa', transition: 'all 0.15s',
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#6b7280'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#d1d5db'; }}
                >
                  {fileLoading ? (
                    <><span>⏳</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#6b7280' }}>Extracting…</span></>
                  ) : fileName ? (
                    <><span>📄</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#111827', fontWeight: 600 }}>{fileName}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af' }}>— click to replace</span>
                    </>
                  ) : (
                    <><span>📁</span>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#374151', fontWeight: 600 }}>Click to upload</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>.txt · .docx · .pdf supported</div>
                      </div>
                    </>
                  )}
                </label>
              </div>

              {/* Textarea */}
              <div>
                <FieldLabel>Paste Transcript {fileName ? '(extracted from file)' : ''}</FieldLabel>
                <textarea
                  value={raw}
                  onChange={e => { setRaw(e.target.value); if (phase !== 'idle') { setPhase('idle'); setParseResult(null); } }}
                  placeholder={placeholder}
                  style={{
                    width: '100%', height: '180px', resize: 'vertical',
                    padding: '12px', borderRadius: '6px',
                    border: `1px solid ${phase === 'error' ? '#fca5a5' : '#e5e7eb'}`,
                    fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#374151',
                    lineHeight: '1.6', outline: 'none', background: '#fafafa',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {phase === 'error' && (
                <div style={{
                  padding: '10px 12px', background: '#fef2f2',
                  border: '1px solid #fecaca', borderRadius: '6px',
                  fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#dc2626',
                }}>
                  Parse error: {errorMsg}
                </div>
              )}

              {/* Preview */}
              {phase === 'preview' && parseResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <FieldLabel>Preview</FieldLabel>
                  {parseResult.warnings.length > 0 && (
                    <div style={{ padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '5px' }}>
                      {parseResult.warnings.map((w, i) => (
                        <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#92400e' }}>⚠ {w}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <PreviewMeta label="Log ID" value={parseResult.log.id} />
                    <PreviewMeta label="Tier" value={parseResult.log.userMetadata.tier}
                      color={parseResult.log.userMetadata.tier === 'Platinum' ? '#7c3aed' : '#b45309'} />
                    <PreviewMeta label="HTTP Code" value={String(parseResult.log.systemContext.apiStatusCode)} color="#dc2626" />
                    <PreviewMeta label="Latency" value={`${parseResult.log.systemContext.latencyMs.toLocaleString()}ms`} color="#ca8a04" />
                    <PreviewMeta label="NPS" value={String(parseResult.log.userMetadata.nps)}
                      color={parseResult.log.userMetadata.nps < 0 ? '#dc2626' : '#16a34a'} />
                    <PreviewMeta label="Retries" value={String(parseResult.log.systemContext.retryCount)} />
                  </div>
                  <div style={{ maxHeight: '130px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {parseResult.log.dialogue.map((turn, i) => (
                      <div key={i} style={{
                        padding: '6px 10px', borderRadius: '5px', fontSize: '11px',
                        fontFamily: 'var(--font-sans)', lineHeight: '1.5', color: '#374151',
                        background: turn.role === 'customer' ? '#eff6ff' : '#f9fafb',
                        border: `1px solid ${turn.role === 'customer' ? '#dbeafe' : '#f3f4f6'}`,
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', marginRight: '6px', color: turn.role === 'customer' ? '#1d4ed8' : '#16a34a' }}>
                          {turn.role}
                        </span>
                        {turn.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                {phase === 'preview' ? (
                  <>
                    <ActionBtn onClick={() => { setPhase('idle'); setParseResult(null); }} variant="ghost">Back</ActionBtn>
                    <ActionBtn onClick={handleConfirm} variant="primary">Confirm & Import →</ActionBtn>
                  </>
                ) : (
                  <>
                    <ActionBtn onClick={close} variant="ghost">Cancel</ActionBtn>
                    <ActionBtn onClick={handleParse} variant="primary" disabled={!raw.trim() || fileLoading}>
                      Parse Transcript
                    </ActionBtn>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>,
    document.body,
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
      textTransform: 'uppercase', letterSpacing: '0.08em',
      borderBottom: '1px solid #f3f4f6', paddingBottom: '5px', marginTop: '2px',
    }}>{children}</div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af',
      textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px',
    }}>{children}</div>
  );
}

function MetaCard({ label, value, sub, valueColor, badge }: {
  label: string; value: string; sub?: string;
  valueColor?: string;
  badge?: { text: string; color: string; bg: string };
}) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af' }}>{label}</div>
        {badge && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '8px', fontWeight: 700,
            color: badge.color, background: badge.bg,
            padding: '1px 6px', borderRadius: '4px', border: `1px solid ${badge.color}22`,
          }}>{badge.text}</div>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: valueColor ?? '#111827', lineHeight: '1.3' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

function LossDeltaPanel({ prev, next, isNew }: { prev: number; next: number; isNew: boolean }) {
  const { delta, pct, up } = lossDelta(prev, next);
  return (
    <div style={{
      padding: '12px 14px', borderRadius: '8px',
      background: up ? '#fef2f2' : '#f0fdf4',
      border: `1px solid ${up ? '#fecaca' : '#bbf7d0'}`,
      display: 'flex', gap: '20px', alignItems: 'center',
    }}>
      {isNew ? (
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', marginBottom: '3px' }}>NEW CLUSTER · PROJECTED ANNUAL LOSS</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '20px', fontWeight: 800, color: '#dc2626' }}>{fmtSGD(next)}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#6b7280', marginTop: '3px' }}>
            This log created a new cluster — no prior baseline exists.
          </div>
        </div>
      ) : (
        <>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', marginBottom: '3px' }}>BEFORE IMPORT</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: '#374151' }}>{fmtSGD(prev)}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', marginTop: '2px' }}>annual loss</div>
          </div>
          <div style={{ fontSize: '18px', color: '#9ca3af' }}>→</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', marginBottom: '3px' }}>AFTER IMPORT</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: up ? '#dc2626' : '#16a34a' }}>{fmtSGD(next)}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', marginTop: '2px' }}>annual loss</div>
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
            padding: '8px 12px', borderRadius: '6px',
            background: up ? '#fee2e2' : '#dcfce7',
            border: `1px solid ${up ? '#fca5a5' : '#86efac'}`,
          }}>
            <div style={{ fontSize: '16px' }}>{up ? '▲' : '▼'}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 800, color: up ? '#dc2626' : '#16a34a' }}>
              {up ? '+' : ''}{fmtSGD(Math.abs(delta))}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: up ? '#991b1b' : '#166534' }}>
              {up ? '+' : ''}{pct}%
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function GeminiCallRow({ call, reasoning }: { call: import('../../store/useAppStore').GeminiCallRecord; reasoning?: string }) {
  const isFallback = call.status === 'fallback';
  const color = AGENT_COLOR[call.agent] ?? '#374151';
  return (
    <div style={{
      borderRadius: '6px',
      background: isFallback ? '#fafafa' : '#fafffe',
      border: `1px solid ${isFallback ? '#f3f4f6' : '#d1fae5'}`,
      overflow: 'hidden',
    }}>
      {/* Top row: badge + model + stats + dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px' }}>
        {/* Agent badge */}
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700,
          color, background: `${color}15`,
          padding: '3px 8px', borderRadius: '4px', border: `1px solid ${color}30`,
          minWidth: '68px', textAlign: 'center', flexShrink: 0,
        }}>{call.agent}</div>

        {/* Model */}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#6b7280', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isFallback ? (
            <span style={{ color: '#ca8a04' }}>⚠ fallback — deterministic result used</span>
          ) : (
            <span style={{ color: '#374151' }}>{call.model}</span>
          )}
        </div>

        {/* Stats */}
        {!isFallback && (
          <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
            <Stat label="in" value={`${(call.inputChars / 1000).toFixed(1)}k`} />
            <Stat label="out" value={`${call.outputChars}c`} />
            <Stat label="ms" value={String(call.tookMs)} color="#ca8a04" />
          </div>
        )}

        {/* Status dot */}
        <div style={{
          width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
          background: isFallback ? '#ca8a04' : '#16a34a',
        }} />
      </div>

      {/* Reasoning row — only shown when AI succeeded and reasoning is available */}
      {!isFallback && reasoning && (
        <div style={{
          padding: '6px 10px 8px 10px',
          borderTop: `1px solid ${color}20`,
          background: `${color}06`,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color, marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Reasoning
          </div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', color: '#374151', lineHeight: '1.5' }}>
            {reasoning}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = '#9ca3af' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: '#9ca3af' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function PreviewMeta({ label, value, color = '#111827' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '5px', padding: '7px 9px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#9ca3af', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function ActionBtn({ onClick, children, variant, disabled }: {
  onClick: () => void; children: React.ReactNode;
  variant: 'primary' | 'ghost'; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '7px 18px', borderRadius: '6px', cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600,
      opacity: disabled ? 0.4 : 1, transition: 'all 0.12s',
      ...(variant === 'primary'
        ? { background: '#111827', color: '#ffffff', border: '1px solid #111827' }
        : { background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb' }),
    }}>{children}</button>
  );
}
