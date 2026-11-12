import React, { useState } from 'react';
import {
  Employee,
  EscalaProState,
  ExtractedPdfEmployee,
  NATIVE_HOSPITAL_ROLES,
  NavigationContext,
  REGIME_LABELS,
  ScheduleRegime,
  WORK_HOURS_PRESETS,
} from '../types';
import {
  computeRegimeShiftForDay,
  getDaysInMonth,
  getYearMonthKey,
  storageService,
} from '../services/storageService';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  FileUp,
  Loader2,
  Printer,
  SkipForward,
  Sparkles,
  Upload,
} from 'lucide-react';

interface ImportExportPageProps {
  state: EscalaProState;
  onImportEmployeesBatch: (newEmployees: Employee[]) => void;
  onRestoreBackupState: (restored: EscalaProState) => void;
  onNavigate: (updates: Partial<NavigationContext>) => void;
}

interface WizardCandidate {
  name: string;
  role: string;
  unitId: string;
  defaultShift: 'Diurno' | 'Noturno';
  workHours: string;
  regime: ScheduleRegime;
  registrationNumber: string;
  notes: string;
  skipped: boolean;
}

export const ImportExportPage: React.FC<ImportExportPageProps> = ({
  state,
  onImportEmployeesBatch,
  onRestoreBackupState,
  onNavigate,
}) => {
  const [isAnalyzingPdf, setIsAnalyzingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [candidates, setCandidates] = useState<WizardCandidate[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  const allRoles = Array.from(new Set([...NATIVE_HOSPITAL_ROLES, ...state.customRoles]));

  // Converte a lista bruta extraída pelo Gemini em candidatos prontos para a entrevista guiada
  const initializeWizardFromExtracted = (extractedList: ExtractedPdfEmployee[]) => {
    const defaultUnitId = state.units[0]?.id || 'unit-1';

    const mapped: WizardCandidate[] = extractedList.map((item) => {
      // Tenta casar a pista de unidade com alguma unidade cadastrada
      const matchedUnit = state.units.find((u) =>
        u.name.toLowerCase().includes((item.unitHint || '').toLowerCase())
      );

      // Tenta casar a pista de função
      const matchedRole = allRoles.find(
        (r) => r.toLowerCase() === (item.roleHint || '').toLowerCase()
      );

      const validRegimes: ScheduleRegime[] = ['12x36_ODD', '12x36_EVEN', '5x2', '6x1'];
      const regime: ScheduleRegime = validRegimes.includes(
        item.scheduleRegimeHint as ScheduleRegime
      )
        ? (item.scheduleRegimeHint as ScheduleRegime)
        : '12x36_ODD';

      const shift: 'Diurno' | 'Noturno' =
        item.shiftHint === 'Noturno' ? 'Noturno' : 'Diurno';

      return {
        name: item.name || 'Colaborador Identificado',
        role: matchedRole || item.roleHint || allRoles[0] || 'Auxiliar de Farmácia',
        unitId: matchedUnit?.id || defaultUnitId,
        defaultShift: shift,
        workHours:
          item.workHoursHint ||
          (shift === 'Noturno' ? '19:00 às 07:00' : '07:00 às 19:00'),
        regime,
        registrationNumber: item.registrationNumber || '',
        notes: item.notes || '',
        skipped: false,
      };
    });

    setCandidates(mapped);
    setCurrentStepIndex(0);
  };

  // Envia qualquer arquivo selecionado (PDF, Excel, Word, CSV, Imagem) para o endpoint backend /api/extract-pdf (@google/genai)
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPdfError(null);
    setImportSuccessMsg(null);
    setUploadedFileName(file.name);
    setIsAnalyzingPdf(true);

    try {
      const base64Pdf = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Falha ao converter o arquivo selecionado.'));
        };
        reader.onerror = () => reject(new Error('Erro na leitura do arquivo selecionado.'));
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/extract-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Pdf,
          fileName: file.name,
          mimeType: file.type,
          availableUnits: state.units.map((u) => u.name),
          availableRoles: allRoles,
        }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Erro ao analisar o documento.');
      }

      if (!Array.isArray(data.employees) || data.employees.length === 0) {
        throw new Error(
          'Nenhum nome de colaborador foi identificado neste arquivo. Verifique se o documento contém texto ou planilha legível.'
        );
      }

      initializeWizardFromExtracted(data.employees);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Erro inesperado ao processar o arquivo.';
      setPdfError(msg);
    } finally {
      setIsAnalyzingPdf(false);
      e.target.value = '';
    }
  };

  // Cria um PDF válido em memória e envia para a IA Gemini ler de verdade (caso o usuário queira testar a leitura IA sem ter um PDF no celular)
  const handleSimulateSamplePdfWithGemini = async () => {
    setPdfError(null);
    setImportSuccessMsg(null);
    setUploadedFileName('escala_hospitalar_exemplo.pdf');
    setIsAnalyzingPdf(true);

    try {
      // Gera um PDF 1.4 mínimo válido contendo nomes e cargos hospitalares
      const pdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length 340 >> stream
BT
/F1 12 Tf
50 720 Td
(ESCALA MENSAL HOSPITALAR - SETOR FARMACIA E ENFERMAGEM) Tj
0 -30 Td
(1. Dra. Helena Vasconcelos - Farmaceutico - Farmacia Central - 07:00 as 19:00 - 12x36 Impar) Tj
0 -24 Td
(2. Marcos Vinicius Prado - Auxiliar de Farmacia - Pronto-Socorro - 19:00 as 07:00 - 12x36 Par) Tj
0 -24 Td
(3. Aline Cardoso Nunes - Tecnico de Enfermagem - Centro Cirurgico - 08:00 as 17:00 - 5x2) Tj
ET
endstream endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000229 00000 n 
0000000297 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
689
%%EOF`;

      const base64Pdf = btoa(pdfContent);
      const response = await fetch('/api/extract-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Pdf,
          fileName: 'escala_hospitalar_exemplo.pdf',
          availableUnits: state.units.map((u) => u.name),
          availableRoles: allRoles,
        }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Falha ao testar leitura de PDF.');
      }

      initializeWizardFromExtracted(data.employees);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao processar PDF de teste.';
      setPdfError(msg);
    } finally {
      setIsAnalyzingPdf(false);
    }
  };

  const updateCurrentCandidate = <K extends keyof WizardCandidate>(
    field: K,
    value: WizardCandidate[K]
  ) => {
    setCandidates((prev) =>
      prev.map((c, idx) => (idx === currentStepIndex ? { ...c, [field]: value } : c))
    );
  };

  const handleFinalizeWizardImport = () => {
    const activeCandidates = candidates.filter((c) => !c.skipped && c.name.trim());
    if (activeCandidates.length === 0) {
      setCandidates([]);
      return;
    }

    const createdEmployees: Employee[] = activeCandidates.map((c, idx) => ({
      id: `emp-pdf-${Date.now()}-${idx}`,
      name: c.name.trim(),
      registrationNumber: c.registrationNumber.trim(),
      role: c.role,
      unitId: c.unitId,
      defaultShift: c.defaultShift,
      workHours: c.workHours,
      regime: c.regime,
      hourBankBalance: 0,
      active: true,
      history: [],
    }));

    onImportEmployeesBatch(createdEmployees);
    setCandidates([]);
    setImportSuccessMsg(
      `${createdEmployees.length} colaboradores importados do PDF com sucesso! A escala mensal deles já foi gerada automaticamente.`
    );
  };

  // Exporta Planilha CSV compatível com Excel do mês atual
  const handleExportFullExcelCsv = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month0 = now.getMonth();
    const ymKey = getYearMonthKey(year, month0);
    const daysCount = getDaysInMonth(year, month0);
    const daysArray = Array.from({ length: daysCount }, (_, i) => i + 1);

    const headers = [
      'Nome_Colaborador',
      'Matricula_Conselho',
      'Funcao',
      'Unidade_Setor',
      'Turno_Padrao',
      'Horario_Trabalho',
      'Regime_Escala',
      'Saldo_Banco_Horas',
      ...daysArray.map((d) => `Dia_${String(d).padStart(2, '0')}`),
    ];

    const rows = state.employees
      .filter((e) => e.active)
      .map((emp) => {
        const unitName = state.units.find((u) => u.id === emp.unitId)?.name || '';
        const dayStatuses = daysArray.map(
          (d) =>
            state.schedules[ymKey]?.[emp.id]?.[d]?.status ||
            computeRegimeShiftForDay(emp, year, month0, d)
        );

        return [
          `"${emp.name}"`,
          `"${emp.registrationNumber || ''}"`,
          `"${emp.role}"`,
          `"${unitName}"`,
          `"${emp.defaultShift}"`,
          `"${emp.workHours}"`,
          `"${REGIME_LABELS[emp.regime]}"`,
          emp.hourBankBalance,
          ...dayStatuses,
        ].join(';');
      });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `escalapro-planilha-${ymKey}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRestoreJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = ev.target?.result as string;
        const parsed = storageService.validateAndParseBackupJson(raw);
        onRestoreBackupState(parsed);
        setBackupMessage('Backup JSON restaurado com sucesso!');
        setTimeout(() => setBackupMessage(null), 4000);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Arquivo de backup inválido.';
        setPdfError(msg);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const currentCandidate = candidates[currentStepIndex];

  return (
    <div className="space-y-6">
      {/* SEÇÃO 1: IMPORTAÇÃO INTELIGENTE DE ARQUIVOS (PDF, EXCEL, WORD) COM ENTREVISTA GUIADA */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <span className="text-xs font-bold text-teal-700">
              Leitura Universal com IA · PDF, Excel (.xlsx/.xls), Word (.docx/.doc), CSV e Fotos
            </span>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5">
              Importador Inteligente de Escalas (PDF, Word ou Excel)
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Envie qualquer arquivo de escala antiga, planilha do Excel, documento do Word, PDF
              ou foto da folha de ponto. A IA extrai todos os nomes e conduz a entrevista guiada.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSimulateSamplePdfWithGemini}
            disabled={isAnalyzingPdf}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4 text-teal-600" />
            <span>Testar Leitura IA com Escala Exemplo</span>
          </button>
        </div>

        {pdfError && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
            {pdfError}
          </div>
        )}

        {importSuccessMsg && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{importSuccessMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate({ activePage: 'escala' })}
              className="px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              Ver Escala Gerada →
            </button>
          </div>
        )}

        {/* Área de Upload ou Assistente Passo a Passo */}
        {isAnalyzingPdf ? (
          <div className="p-10 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-3">
            <Loader2 className="w-9 h-9 text-teal-600 animate-spin mx-auto" />
            <h3 className="text-base font-bold text-slate-900">
              Lendo arquivo ({uploadedFileName})...
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Extraindo nomes de colaboradores, cargos, turnos e pistas de unidade do seu
              documento (PDF, Excel, Word ou Imagem) para iniciar a confirmação guiada.
            </p>
          </div>
        ) : candidates.length > 0 && currentCandidate ? (
          /* ASSISTENTE INTERATIVO PASSO A PASSO (ENTREVISTA GUIADA) */
          <div className="rounded-2xl border-2 border-teal-600 bg-slate-50/70 p-5 md:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold text-teal-700">
                  Encontrei {candidates.length} colaboradores no arquivo. Vamos confirmar os
                  detalhes de cada um:
                </span>
                <h2 className="text-lg font-bold text-slate-900 mt-0.5">
                  Profissional {currentStepIndex + 1} de {candidates.length}
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  updateCurrentCandidate('skipped', !currentCandidate.skipped)
                }
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  currentCandidate.skipped
                    ? 'bg-amber-100 border-amber-300 text-amber-900'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <SkipForward className="w-3.5 h-3.5" />
                <span>
                  {currentCandidate.skipped
                    ? 'Nome Ignorado (Clique para reativar)'
                    : 'Pular este nome do arquivo'}
                </span>
              </button>
            </div>

            {/* Barra de Progresso */}
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#0d9488] transition-all duration-300"
                style={{
                  width: `${Math.round(((currentStepIndex + 1) / candidates.length) * 100)}%`,
                }}
              />
            </div>

            {!currentCandidate.skipped ? (
              <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-5">
                {/* Pergunta 1: Confirme o Nome */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-800 mb-1.5">
                      1. Confirme o Nome do colaborador:
                    </label>
                    <input
                      type="text"
                      value={currentCandidate.name}
                      onChange={(e) => updateCurrentCandidate('name', e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1.5">
                      Matrícula / CRF / COREN (se houver):
                    </label>
                    <input
                      type="text"
                      value={currentCandidate.registrationNumber}
                      onChange={(e) =>
                        updateCurrentCandidate('registrationNumber', e.target.value)
                      }
                      placeholder="Opcional"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>
                </div>

                {/* Pergunta 2: Qual a Função dele? (Botões rápidos) */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-2">
                    2. Qual a Função hospitalar dele(a)?
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {allRoles.map((r) => {
                      const active = currentCandidate.role === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => updateCurrentCandidate('role', r)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#0d9488] text-white border-teal-700'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {r}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Pergunta 3: Em qual Unidade/Setor ele fica fixo? */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-2">
                    3. Em qual Unidade / Setor ele(a) fica fixo?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {state.units.map((u) => {
                      const active = currentCandidate.unitId === u.id;
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => updateCurrentCandidate('unitId', u.id)}
                          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                            active
                              ? 'border-teal-600 bg-teal-50/70 text-teal-950 font-bold'
                              : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className="text-xs font-bold">{u.name}</div>
                          <div className="text-[11px] text-slate-500">
                            Turnos: {u.shiftMode}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Pergunta 4: Qual o Horário e Regime de trabalho dele? */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-2">
                    4. Qual o Horário e Regime de trabalho dele(a)?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
                    {(
                      [
                        {
                          label: '07:00 às 19:00 | 12x36 Dias Ímpares (Diurno)',
                          shift: 'Diurno' as const,
                          hours: '07:00 às 19:00',
                          regime: '12x36_ODD' as ScheduleRegime,
                        },
                        {
                          label: '07:00 às 19:00 | 12x36 Dias Pares (Diurno)',
                          shift: 'Diurno' as const,
                          hours: '07:00 às 19:00',
                          regime: '12x36_EVEN' as ScheduleRegime,
                        },
                        {
                          label: '19:00 às 07:00 | 12x36 Dias Ímpares (Noturno)',
                          shift: 'Noturno' as const,
                          hours: '19:00 às 07:00',
                          regime: '12x36_ODD' as ScheduleRegime,
                        },
                        {
                          label: '19:00 às 07:00 | 12x36 Dias Pares (Noturno)',
                          shift: 'Noturno' as const,
                          hours: '19:00 às 07:00',
                          regime: '12x36_EVEN' as ScheduleRegime,
                        },
                        {
                          label: '08:00 às 17:00 | 5x2 Segunda a Sexta',
                          shift: 'Diurno' as const,
                          hours: '08:00 às 17:00',
                          regime: '5x2' as ScheduleRegime,
                        },
                        {
                          label: '07:00 às 19:00 | 6x1 Escala Semanal',
                          shift: 'Diurno' as const,
                          hours: '07:00 às 19:00',
                          regime: '6x1' as ScheduleRegime,
                        },
                      ]
                    ).map((preset, idx) => {
                      const isMatch =
                        currentCandidate.workHours === preset.hours &&
                        currentCandidate.regime === preset.regime &&
                        currentCandidate.defaultShift === preset.shift;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            updateCurrentCandidate('defaultShift', preset.shift);
                            updateCurrentCandidate('workHours', preset.hours);
                            updateCurrentCandidate('regime', preset.regime);
                          }}
                          className={`p-3 rounded-xl border text-left text-xs font-bold transition-colors cursor-pointer ${
                            isMatch
                              ? 'border-teal-600 bg-teal-50 text-teal-950'
                              : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Ajuste fino personalizado de horário/regime */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Turno
                      </label>
                      <select
                        value={currentCandidate.defaultShift}
                        onChange={(e) =>
                          updateCurrentCandidate(
                            'defaultShift',
                            e.target.value as 'Diurno' | 'Noturno'
                          )
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      >
                        <option value="Diurno">Diurno</option>
                        <option value="Noturno">Noturno</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Horário Personalizado
                      </label>
                      <input
                        type="text"
                        list="wizard-hours"
                        value={currentCandidate.workHours}
                        onChange={(e) =>
                          updateCurrentCandidate('workHours', e.target.value)
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      />
                      <datalist id="wizard-hours">
                        {WORK_HOURS_PRESETS.map((h) => (
                          <option key={h} value={h} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Regime
                      </label>
                      <select
                        value={currentCandidate.regime}
                        onChange={(e) =>
                          updateCurrentCandidate(
                            'regime',
                            e.target.value as ScheduleRegime
                          )
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      >
                        {Object.entries(REGIME_LABELS).map(([k, lbl]) => (
                          <option key={k} value={k}>
                            {lbl}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-center text-xs text-amber-900 font-semibold">
                Este nome foi marcado para ser pulado e não será importado para a equipe.
              </div>
            )}

            {/* Navegação Anterior / Próximo / Finalizar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentStepIndex === 0}
                  onClick={() => setCurrentStepIndex((i) => Math.max(0, i - 1))}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 disabled:opacity-40 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Anterior</span>
                </button>

                {currentStepIndex < candidates.length - 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentStepIndex((i) => Math.min(candidates.length - 1, i + 1))
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                  >
                    <span>Próximo Colaborador</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCandidates([])}
                  className="px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200 cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleFinalizeWizardImport}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Importar Todos ({candidates.filter((c) => !c.skipped).length}) e Gerar
                    Escala
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Dropzone Universal de Upload (PDF, Word, Excel, CSV, Imagens) */
          <label className="block border-2 border-dashed border-teal-500/50 hover:border-teal-600 bg-teal-50/20 hover:bg-teal-50/40 rounded-2xl p-8 text-center transition-colors cursor-pointer">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center mx-auto mb-3">
              <FileUp className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-900">
              Clique para selecionar um arquivo PDF, Planilha Excel, Documento Word ou Foto
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Aceita .PDF, .XLSX, .XLS, .CSV, .DOCX, .DOC, .TXT e Imagens · Extração inteligente via IA
            </p>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ods,.txt,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
              onChange={handlePdfUpload}
              className="hidden"
            />
          </label>
        )}
      </section>

      {/* SEÇÃO 2: EXPORTAÇÃO PROFISSIONAL E BACKUP JSON */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Gerar PDF / Imprimir Escala A4 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-teal-400 flex items-center justify-center">
              <Printer className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold text-slate-900">
              Gerar PDF / Imprimir Escala A4
            </h2>
            <p className="text-xs text-slate-500">
              Abre o layout oficial formatado em folha A4 Paisagem com cabeçalho do hospital,
              setor, grade completa, legenda de siglas e linha de assinatura e carimbo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onNavigate({ activePage: 'escala' });
              setTimeout(() => window.print(), 250);
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Imprimir / Salvar PDF A4</span>
          </button>
        </div>

        {/* Card 2: Exportar Planilha CSV / Excel */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold text-slate-900">
              Exportar Planilha (CSV / Excel)
            </h2>
            <p className="text-xs text-slate-500">
              Baixa arquivo .CSV codificado em UTF-8 compatível diretamente com Microsoft
              Excel e Google Sheets contendo todos os dias do mês e banco de horas.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportFullExcelCsv}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Baixar Planilha Excel (.CSV)</span>
          </button>
        </div>

        {/* Card 3: Backup e Restauração em JSON */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold text-slate-900">
              Backup e Restauração (JSON)
            </h2>
            <p className="text-xs text-slate-500">
              Exporte uma cópia completa dos dados locais (unidades, colaboradores, atestados e
              escalas) ou restaure em outro dispositivo.
            </p>
            {backupMessage && (
              <p className="text-xs font-bold text-emerald-700">{backupMessage}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => storageService.exportBackupJson(state)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar JSON</span>
            </button>
            <label className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Restaurar</span>
              <input
                type="file"
                accept="application/json"
                onChange={handleRestoreJsonFile}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
};
