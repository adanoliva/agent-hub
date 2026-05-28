import React, { useState, useEffect, useRef } from 'react';
import type { OrchestrateNode, DataFlow, ContextExtra, TemporalContext } from '../../types';
import { useElectron } from '../../hooks/useElectron';

interface Props {
  node:        OrchestrateNode;
  fromAgent:   string;
  toAgent:     string;
  onUpdate:    (node: OrchestrateNode) => void;
  isInputNode?: boolean;  // true = Orquestador entry node (no dataFlow, task description)
}

function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeContextExtra(ce: ContextExtra): ContextExtra {
  const fc = (ce as any).fixed;
  return {
    ...ce,
    fixed: fc && typeof fc === 'object' && 'freeText' in fc
      ? fc
      : { freeText: '', files: [] },
  };
}

export function ConnectionConfigurator({ node, fromAgent, toAgent, onUpdate, isInputNode = false }: Props) {
  const [dataFlow,     setDataFlow]     = useState<DataFlow>(node.dataFlow);
  const [contextExtra, setContextExtra] = useState<ContextExtra>(() => normalizeContextExtra(node.contextExtra));
  const [dirty, setDirty]              = useState(false);

  // Keep refs in sync so the cleanup effect can read latest values
  const dataFlowRef     = useRef(dataFlow);
  const contextExtraRef = useRef(contextExtra);
  const dirtyRef        = useRef(dirty);
  const nodeRef         = useRef(node);
  const onUpdateRef     = useRef(onUpdate);

  useEffect(() => { dataFlowRef.current     = dataFlow;     }, [dataFlow]);
  useEffect(() => { contextExtraRef.current = contextExtra; }, [contextExtra]);
  useEffect(() => { dirtyRef.current        = dirty;        }, [dirty]);
  useEffect(() => { nodeRef.current         = node;         }, [node]);
  useEffect(() => { onUpdateRef.current     = onUpdate;     }, [onUpdate]);

  // Auto-save on node switch if dirty; reset state for new node
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        onUpdateRef.current({ ...nodeRef.current, dataFlow: dataFlowRef.current, contextExtra: contextExtraRef.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  useEffect(() => {
    setDataFlow(node.dataFlow);
    setContextExtra(normalizeContextExtra(node.contextExtra));
    setDirty(false);
  }, [node.id]);

  const patchDF = (patch: Partial<DataFlow>) => {
    setDataFlow(df => ({ ...df, ...patch }));
    setDirty(true);
  };

  const patchCE = (patch: Partial<ContextExtra>) => {
    setContextExtra(ce => ({ ...ce, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    onUpdate({ ...node, dataFlow, contextExtra });
    setDirty(false);
  };

  const handleAddTemporal = () => {
    const newTemp: TemporalContext = {
      id:       generateTempId(),
      type:     'text',
      label:    '',
      placeholder: '',
      required: false,
    };
    patchCE({ temporal: [...contextExtra.temporal, newTemp] });
  };

  const handleUpdateTemporal = (id: string, patch: Partial<TemporalContext>) => {
    patchCE({
      temporal: contextExtra.temporal.map(t => t.id === id ? { ...t, ...patch } : t),
    });
  };

  const handleRemoveTemporal = (id: string) => {
    patchCE({ temporal: contextExtra.temporal.filter(t => t.id !== id) });
  };

  return (
    <div className="orch-conn-config">
      <div className="orch-conn-config-header">
        <i className={isInputNode ? 'ti ti-circuit-diode' : 'ti ti-arrows-exchange'} />
        <span><strong>{fromAgent}</strong> → <strong>{toAgent}</strong></span>
      </div>

      {/* Data flow — hidden for inputNode (no previous agent output) */}
      {!isInputNode && (
      <section className="orch-config-section">
        <h4><i className="ti ti-transfer" /> Información que pasa</h4>
        <label className="orch-check-row">
          <input
            type="checkbox"
            checked={dataFlow.agentOutput}
            onChange={e => patchDF({ agentOutput: e.target.checked })}
          />
          <span>Respuesta del agente anterior</span>
        </label>
        <label className="orch-check-row">
          <input
            type="checkbox"
            checked={dataFlow.filesModified}
            onChange={e => patchDF({ filesModified: e.target.checked })}
          />
          <span>Lista de archivos modificados</span>
        </label>
        <label className="orch-check-row">
          <input
            type="checkbox"
            checked={dataFlow.projectContext}
            onChange={e => patchDF({ projectContext: e.target.checked })}
          />
          <span>Contexto del proyecto (CLAUDE.md / copilot-instructions.md)</span>
        </label>

        {dataFlow.filesModified && (
          <div className="orch-subsection">
            <label className="orch-label">Archivos específicos (opcional, uno por línea):</label>
            <textarea
              className="orch-textarea"
              placeholder={'src/main.ts\nsrc/utils.ts'}
              rows={3}
              value={dataFlow.selectiveFiles.join('\n')}
              onChange={e => patchDF({ selectiveFiles: e.target.value.split('\n').filter(Boolean) })}
            />
          </div>
        )}
      </section>
      )}

      {/* Fixed context */}
      <section className="orch-config-section">
        <h4><i className="ti ti-file-text" /> {isInputNode ? 'Descripción de la tarea' : 'Contexto fijo'}</h4>
        <div className="orch-subsection">
          <label className="orch-label">{isInputNode ? 'Tarea inicial (incluida en el primer agente):' : 'Texto libre (incluido en todas las ejecuciones):'}</label>
          <textarea
            className="orch-textarea"
            placeholder={isInputNode
              ? 'Describe la tarea que deben realizar los agentes…'
              : 'Instrucciones o contexto que siempre aplican a esta conexión…'
            }
            rows={isInputNode ? 5 : 4}
            value={contextExtra.fixed.freeText}
            onChange={e => patchCE({ fixed: { ...contextExtra.fixed, freeText: e.target.value } })}
          />
        </div>
        <div className="orch-subsection">
          <label className="orch-label">Archivos de contexto:</label>
          {contextExtra.fixed.files.map((f, idx) => (
            <div key={idx} className="orch-context-fixed-item" title={f}>
              <i className="ti ti-file" />
              <span className="orch-context-fixed-path" title={f}>{f.split(/[\\/]/).pop()}</span>
              <button
                className="btn ghost sm"
                onClick={() => patchCE({ fixed: { ...contextExtra.fixed, files: contextExtra.fixed.files.filter((_, i) => i !== idx) } })}
              >
                <i className="ti ti-x" />
              </button>
            </div>
          ))}
          <FilePicker onPick={filePath => patchCE({ fixed: { ...contextExtra.fixed, files: [...contextExtra.fixed.files, filePath] } })} />
        </div>
      </section>

      {/* Temporal context */}
      <section className="orch-config-section">
        <h4><i className="ti ti-input-check" /> Contexto temporal (se pide al ejecutar)</h4>
        {contextExtra.temporal.map(temp => (
          <div key={temp.id} className="orch-context-temp-item">
            <div className="orch-context-temp-fields">
              <input
                type="text"
                className="input sm"
                placeholder="Etiqueta del campo"
                value={temp.label}
                onChange={e => handleUpdateTemporal(temp.id, { label: e.target.value })}
              />
              <select
                className="input sm"
                value={temp.type}
                onChange={e => handleUpdateTemporal(temp.id, { type: e.target.value as 'text' | 'file' })}
              >
                <option value="text">Texto</option>
                <option value="file">Archivo</option>
              </select>
              {temp.type === 'text' && (
                <input
                  type="text"
                  className="input sm"
                  placeholder="Placeholder (opcional)"
                  value={temp.placeholder || ''}
                  onChange={e => handleUpdateTemporal(temp.id, { placeholder: e.target.value })}
                />
              )}
              <label className="orch-check-row sm">
                <input
                  type="checkbox"
                  checked={temp.required}
                  onChange={e => handleUpdateTemporal(temp.id, { required: e.target.checked })}
                />
                <span>Requerido</span>
              </label>
            </div>
            <button className="btn ghost sm" onClick={() => handleRemoveTemporal(temp.id)}>
              <i className="ti ti-trash" />
            </button>
          </div>
        ))}
        <button className="btn sm ghost" onClick={handleAddTemporal}>
          <i className="ti ti-plus" /> Agregar campo
        </button>
      </section>

      <button
        className="btn primary"
        disabled={!dirty}
        onClick={handleSave}
      >
        <i className="ti ti-check" /> {dirty ? 'Aplicar cambios' : 'Guardado'}
      </button>
    </div>
  );
}

// ── File picker ──────────────────────────────────────────────────────────────

function FilePicker({ onPick }: { onPick: (path: string) => void }) {
  const { pickFile } = useElectron();

  async function handlePick() {
    const picked = await pickFile();
    if (picked) onPick(picked);
  }

  return (
    <button className="btn sm" onClick={handlePick}>
      <i className="ti ti-plus" /> Añadir archivo
    </button>
  );
}
