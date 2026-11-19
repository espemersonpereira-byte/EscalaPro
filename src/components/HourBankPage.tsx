import React, { useMemo, useState } from 'react';
import {
  AbsenceRecord,
  Employee,
  EscalaProState,
  ExtractedHourBankEntry,
  NATIVE_HOSPITAL_ROLES,
  TimeTrackingSubType,
} from '../types';
import {
  computeHoursDiffBetweenTimes,
  formatDateWithWeekdayPtBr,
  formatDecimalHoursPtBr,
  formatIsoDate,
  hydrateTimeTrackingRecord,
  matchEmployeeByName,
  parseEmployeeWorkHours,
} from '../services/storageService';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  FileCheck2,
  FileUp,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';

interface HourBankPageProps {
  state: EscalaProState;
  onApplyHourBankBatch: (
    updates: {
      employeeId?: string;
      newEmployee?: Employee;
      hoursValue: number;
      mode: 'REPLACE' | 'ADD';
      reason: string;
    }[]
  ) => void;
  onUpdateSingleEmployeeHourBank: (
    employeeId: string,
    newBalance: number,
    deltaHours: number,
    reason: string
  ) => void;
  onApplyLeaveOrOccurrence?: (params: {
    employeeId: string;
    record: AbsenceRecord;
    hourBankDelta?: number;
  }) => void;
  onToggleDeclarationDelivered?: (recordId: string, employeeId: string) => void;
  onDeleteTimeRecord?: (recordId: string, employeeId: string) => void;
}

interface HourBankImportCandidate {
  id: string;
  extractedName: string;
  matchedEmployeeId: string | '__CREATE_NEW__' | '__SKIP__';
  hoursValue: number;
  formattedOriginal: string;
  unitId: string;
  role: string;
  notes: string;
  autoMatched: boolean;
}

export function formatHoursDisplay(hours: number): string {
  const num = Math.round((Number(hours) || 0) * 100) / 100;
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  const wholeHours = Math.floor(abs);
  const mins = Math.round((abs - wholeHours) * 60);
  if (mins === 0) {
    return `${sign}${wholeHours}h`;
  }
  return `${sign}${wholeHours}h${String(mins).padStart(2, '0')}m`;
}

export const HourBankPage: React.FC<HourBankPageProps> = ({
  state,
  onApplyHourBankBatch,
  onUpdateSingleEmployeeHourBank,
  onApplyLeaveOrOccurrence,
  onToggleDeclarationDelivered,
  onDeleteTimeRecord,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('TODAS');
  const [balanceFilter, setBalanceFilter] = useState<'TODOS' | 'POSITIVOS' | 'NEGATIVOS' | 'ZERADOS'>(
    'TODOS'
  );

  // Estado do Importador de Arquivo de Banco de Horas
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [importMode, setImportMode] = useState<'REPLACE' | 'ADD'>('REPLACE');
  const [candidates, setCandidates] = useState<HourBankImportCandidate[]>([]);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Estado para edição manual rápida de saldo de um colaborador
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState<'SET' | 'DELTA'>('DELTA');
  const [manualHoursInput, setManualHoursInput] = useState<string>('');
  const [manualReasonInput, setManualReasonInput] = useState<string>('');

  const activeEmployees = useMemo(
    () => state.employees.filter((e) => e.active),
    [state.employees]
  );

  // Estado do Painel de Controle de Horários do Dia (Prorrogação, Atraso, Declaração de Horas)
  const [showNewTimeForm, setShowNewTimeForm] = useState<boolean>(true);
  const [timeEmpId, setTimeEmpId] = useState<string>(() => activeEmployees[0]?.id || '');
  const [timeDate, setTimeDate] = useState<string>(() => {
    const now = new Date();
    return formatIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [timeScenario, setTimeScenario] = useState<TimeTrackingSubType>('FICOU_MAIS_TARDE');
  const [plannedStart, setPlannedStart] = useState<string>('07:00');
  const [plannedEnd, setPlannedEnd] = useState<string>('19:00');
  const [actualStart, setActualStart] = useState<string>('07:00');
  const [actualEnd, setActualEnd] = useState<string>('21:00');
  const [declDelivered, setDeclDelivered] = useState<boolean>(true);
  const [timeReason, setTimeReason] = useState<string>('');
  const [timeLogFilter, setTimeLogFilter] = useState<
    'TODOS' | 'FICOU_MAIS_TARDE' | 'DECLARACOES' | 'DECLARACOES_PENDENTES' | 'DESCONTOS_BH'
  >('TODOS');

  const selectedTimeEmp = useMemo(
    () => activeEmployees.find((e) => e.id === timeEmpId) || activeEmployees[0] || null,
    [activeEmployees, timeEmpId]
  );

  // Atualiza horários base ao trocar de colaborador ou cenário no formulário rápido
  const handleSelectTimeEmployee = (empId: string) => {
    setTimeEmpId(empId);
    const emp = activeEmployees.find((e) => e.id === empId);
    if (emp) {
      const parsed = parseEmployeeWorkHours(emp.workHours);
      setPlannedStart(parsed.plannedStart);
      setPlannedEnd(parsed.plannedEnd);
      applyTimeScenarioPreset(timeScenario, parsed.plannedStart, parsed.plannedEnd);
    }
  };

  const applyTimeScenarioPreset = (
    scenario: TimeTrackingSubType,
    baseStart = plannedStart,
    baseEnd = plannedEnd
  ) => {
    setTimeScenario(scenario);
    const addMins = (hhmm: string, delta: number) => {
      const [h, m] = hhmm.split(':').map(Number);
      const total = (((h || 0) * 60 + (m || 0) + delta) % 1440 + 1440) % 1440;
      const nh = Math.floor(total / 60);
      const nm = total % 60;
      return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
    };

    if (scenario === 'FICOU_MAIS_TARDE') {
      setActualStart(baseStart);
      setActualEnd(addMins(baseEnd, 120));
    } else if (
      scenario === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
      scenario === 'ATRASO_DESCONTO_BH'
    ) {
      setActualStart(addMins(baseStart, 120));
      setActualEnd(baseEnd);
      if (scenario === 'ENTROU_MAIS_TARDE_DECLARACAO') setDeclDelivered(true);
    } else if (
      scenario === 'SAIU_MAIS_CEDO_DECLARACAO' ||
      scenario === 'SAIDA_ANTECIPADA_BH'
    ) {
      setActualStart(baseStart);
      setActualEnd(addMins(baseEnd, -120));
      if (scenario === 'SAIU_MAIS_CEDO_DECLARACAO') setDeclDelivered(true);
    }
  };

  // Cálculo automático da diferença entre horário previsto e realizado
  const calculatedFormDiffHours = useMemo(() => {
    if (timeScenario === 'FICOU_MAIS_TARDE') {
      return computeHoursDiffBetweenTimes(plannedEnd, actualEnd);
    }
    if (
      timeScenario === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
      timeScenario === 'ATRASO_DESCONTO_BH'
    ) {
      return computeHoursDiffBetweenTimes(plannedStart, actualStart);
    }
    if (
      timeScenario === 'SAIU_MAIS_CEDO_DECLARACAO' ||
      timeScenario === 'SAIDA_ANTECIPADA_BH'
    ) {
      return computeHoursDiffBetweenTimes(actualEnd, plannedEnd);
    }
    return 0;
  }, [timeScenario, plannedStart, plannedEnd, actualStart, actualEnd]);

  const handleSaveTimeControlRecord = () => {
    if (!selectedTimeEmp || !onApplyLeaveOrOccurrence) return;
    const duration = Math.max(0.25, calculatedFormDiffHours || 1);

    let recordType: AbsenceRecord['type'] = 'HORA_EXTRA';
    let bhDelta = 0;
    let aboned = 0;
    let labelPrefix = '';

    if (timeScenario === 'FICOU_MAIS_TARDE') {
      recordType = 'HORA_EXTRA';
      bhDelta = duration;
      labelPrefix = `Ficou até mais tarde (+${formatDecimalHoursPtBr(duration)})`;
    } else if (timeScenario === 'ENTROU_MAIS_TARDE_DECLARACAO') {
      recordType = 'DECLARACAO_HORAS';
      bhDelta = 0;
      aboned = duration;
      labelPrefix = `Entrou mais tarde c/ Declaração (${formatDecimalHoursPtBr(duration)} abonadas)`;
    } else if (timeScenario === 'SAIU_MAIS_CEDO_DECLARACAO') {
      recordType = 'DECLARACAO_HORAS';
      bhDelta = 0;
      aboned = duration;
      labelPrefix = `Saiu mais cedo c/ Declaração (${formatDecimalHoursPtBr(duration)} abonadas)`;
    } else if (timeScenario === 'ATRASO_DESCONTO_BH') {
      recordType = 'BANCO_HORAS';
      bhDelta = -duration;
      labelPrefix = `Entrou mais tarde sem declaração (-${formatDecimalHoursPtBr(duration)} no BH)`;
    } else if (timeScenario === 'SAIDA_ANTECIPADA_BH') {
      recordType = 'BANCO_HORAS';
      bhDelta = -duration;
      labelPrefix = `Saiu mais cedo sem declaração (-${formatDecimalHoursPtBr(duration)} no BH)`;
    }

    const scheduleWindow = `Previsto: ${plannedStart} às ${plannedEnd} · Realizado: ${actualStart} às ${actualEnd}`;
    const declText =
      recordType === 'DECLARACAO_HORAS'
        ? declDelivered
          ? ' · Declaração Entregue'
          : ' · Pendente Entregar Declaração'
        : '';
    const customNote = timeReason.trim() ? ` — ${timeReason.trim()}` : '';
    const finalReason = `${labelPrefix} [${scheduleWindow}${declText}]${customNote}`;

    const newRecord: AbsenceRecord = {
      id: `abs-time-${Date.now()}`,
      employeeId: selectedTimeEmp.id,
      type: recordType,
      timeTrackingSubType: timeScenario,
      startDate: timeDate,
      endDate: timeDate,
      daysCount: 1,
      reason: finalReason,
      plannedStartTime: plannedStart,
      plannedEndTime: plannedEnd,
      actualStartTime: actualStart,
      actualEndTime: actualEnd,
      hoursDuration: bhDelta !== 0 ? bhDelta : aboned,
      abonedHours: aboned > 0 ? aboned : undefined,
      declarationDelivered: recordType === 'DECLARACAO_HORAS' ? declDelivered : undefined,
      createdAt: new Date().toISOString(),
    };

    onApplyLeaveOrOccurrence({
      employeeId: selectedTimeEmp.id,
      record: newRecord,
      hourBankDelta: bhDelta,
    });

    setTimeReason('');
    setFeedbackMsg(
      `Horário de ${selectedTimeEmp.name} registrado com sucesso (${scheduleWindow})!`
    );
    setTimeout(() => setFeedbackMsg(null), 5000);
  };

  // Lista unificada de todos os registros de controle de horário e declarações de todos os colaboradores
  const allTimeTrackingLogs = useMemo(() => {
    const list: {
      emp: Employee;
      unitName: string;
      record: AbsenceRecord;
    }[] = [];

    for (const emp of activeEmployees) {
      const uName =
        state.units.find((u) => u.id === emp.unitId)?.name || 'Unidade Principal';
      for (const rawRec of emp.history || []) {
        if (
          rawRec.type === 'HORA_EXTRA' ||
          rawRec.type === 'DECLARACAO_HORAS' ||
          rawRec.type === 'BANCO_HORAS'
        ) {
          const rec = hydrateTimeTrackingRecord(rawRec);
          list.push({ emp, unitName: uName, record: rec });
        }
      }
    }

    return list.sort((a, b) => {
      const dateCmp = (b.record.startDate || '').localeCompare(a.record.startDate || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.record.createdAt || '').localeCompare(a.record.createdAt || '');
    });
  }, [activeEmployees, state.units]);

  const filteredTimeLogs = useMemo(() => {
    return allTimeTrackingLogs.filter(({ emp, record }) => {
      if (unitFilter !== 'TODAS' && emp.unitId !== unitFilter) return false;
      if (timeLogFilter === 'FICOU_MAIS_TARDE') {
        return (
          record.type === 'HORA_EXTRA' ||
          record.timeTrackingSubType === 'FICOU_MAIS_TARDE' ||
          (record.hoursDuration || 0) > 0
        );
      }
      if (timeLogFilter === 'DECLARACOES') {
        return record.type === 'DECLARACAO_HORAS';
      }
      if (timeLogFilter === 'DECLARACOES_PENDENTES') {
        return record.type === 'DECLARACAO_HORAS' && record.declarationDelivered === false;
      }
      if (timeLogFilter === 'DESCONTOS_BH') {
        return record.type === 'BANCO_HORAS' || (record.hoursDuration || 0) < 0;
      }
      return true;
    });
  }, [allTimeTrackingLogs, unitFilter, timeLogFilter]);

  const pendingDeclarationsCount = useMemo(
    () =>
      allTimeTrackingLogs.filter(
        ({ record }) =>
          record.type === 'DECLARACAO_HORAS' && record.declarationDelivered === false
      ).length,
    [allTimeTrackingLogs]
  );

  const allRoles = useMemo(
    () => Array.from(new Set([...NATIVE_HOSPITAL_ROLES, ...state.customRoles])),
    [state.customRoles]
  );

  // Estatísticas gerais do Banco de Horas
  const summary = useMemo(() => {
    let positiveCount = 0;
    let negativeCount = 0;
    let zeroCount = 0;
    let totalPositiveHours = 0;
    let totalNegativeHours = 0;

    for (const emp of activeEmployees) {
      const bal = Number(emp.hourBankBalance) || 0;
      if (bal > 0) {
        positiveCount++;
        totalPositiveHours += bal;
      } else if (bal < 0) {
        negativeCount++;
        totalNegativeHours += Math.abs(bal);
      } else {
        zeroCount++;
      }
    }

    return {
      positiveCount,
      negativeCount,
      zeroCount,
      totalPositiveHours: Math.round(totalPositiveHours * 100) / 100,
      totalNegativeHours: Math.round(totalNegativeHours * 100) / 100,
      netBalance: Math.round((totalPositiveHours - totalNegativeHours) * 100) / 100,
    };
  }, [activeEmployees]);

  const filteredEmployees = useMemo(() => {
    return activeEmployees.filter((emp) => {
      if (unitFilter !== 'TODAS' && emp.unitId !== unitFilter) return false;
      const bal = Number(emp.hourBankBalance) || 0;
      if (balanceFilter === 'POSITIVOS' && bal <= 0) return false;
      if (balanceFilter === 'NEGATIVOS' && bal >= 0) return false;
      if (balanceFilter === 'ZERADOS' && bal !== 0) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const unitName =
          state.units.find((u) => u.id === emp.unitId)?.name.toLowerCase() || '';
        const matches =
          emp.name.toLowerCase().includes(q) ||
          emp.role.toLowerCase().includes(q) ||
          unitName.includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [activeEmployees, unitFilter, balanceFilter, searchQuery, state.units]);

  // Converte lista extraída do arquivo em candidatos vinculados automaticamente aos colaboradores já cadastrados
  const initializeCandidatesFromExtracted = (extracted: ExtractedHourBankEntry[]) => {
    const defaultUnitId = state.units[0]?.id || 'unit-default-1';

    const mapped: HourBankImportCandidate[] = extracted.map((item, idx) => {
      const matchedEmp = matchEmployeeByName(item.name, activeEmployees);
      const matchedUnit = state.units.find((u) =>
        u.name.toLowerCase().includes((item.unitHint || '').toLowerCase())
      );
      const matchedRole = allRoles.find(
        (r) => r.toLowerCase() === (item.roleHint || '').toLowerCase()
      );

      return {
        id: `hb-cand-${Date.now()}-${idx}`,
        extractedName: item.name,
        matchedEmployeeId: matchedEmp ? matchedEmp.id : '__CREATE_NEW__',
        hoursValue: Number(item.hoursBalance) || 0,
        formattedOriginal:
          item.formattedOriginal || formatHoursDisplay(Number(item.hoursBalance) || 0),
        unitId: matchedEmp?.unitId || matchedUnit?.id || defaultUnitId,
        role: matchedEmp?.role || matchedRole || item.roleHint || allRoles[0] || 'Auxiliar de Farmácia',
        notes: item.notes || `Importado do arquivo ${uploadedFileName || 'de Banco de Horas'}`,
        autoMatched: Boolean(matchedEmp),
      };
    });

    setCandidates(mapped);
  };

  // Envia arquivo (Excel, Word, PDF, CSV ou Foto) para /api/extract-hour-bank
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setFeedbackMsg(null);
    setUploadedFileName(file.name);
    setIsAnalyzingFile(true);

    try {
      const base64File = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Falha ao ler o arquivo selecionado.'));
        };
        reader.onerror = () => reject(new Error('Erro na leitura do arquivo.'));
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/extract-hour-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64File,
          fileName: file.name,
          mimeType: file.type,
          availableUnits: state.units.map((u) => u.name),
          availableRoles: allRoles,
        }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Erro ao analisar arquivo de Banco de Horas.');
      }

      if (!Array.isArray(data.entries) || data.entries.length === 0) {
        throw new Error(
          'Nenhum colaborador foi identificado neste arquivo. Verifique se a planilha ou documento possui uma coluna com nomes.'
        );
      }

      initializeCandidatesFromExtracted(data.entries);
    } catch (err: unknown) {
      setFileError(
        err instanceof Error ? err.message : 'Erro inesperado ao processar o arquivo.'
      );
    } finally {
      setIsAnalyzingFile(false);
      e.target.value = '';
    }
  };

  // Simula leitura com os próprios colaboradores já cadastrados pelo usuário (para testar vínculo automático pelo nome)
  const handleSimulateWithCurrentTeam = () => {
    setFileError(null);
    setFeedbackMsg(null);
    setUploadedFileName('banco_de_horas_equipe.xlsx');

    const sampleEntries: ExtractedHourBankEntry[] =
      activeEmployees.length > 0
        ? activeEmployees.slice(0, 8).map((emp, idx) => {
            const sampleHours = idx % 3 === 0 ? 12 : idx % 3 === 1 ? -4 : 6.5;
            return {
              name: emp.name,
              hoursBalance: sampleHours,
              formattedOriginal: formatHoursDisplay(sampleHours),
              unitHint: state.units.find((u) => u.id === emp.unitId)?.name || '',
              roleHint: emp.role,
              notes: 'Saldo apurado na planilha mensal de ponto',
            };
          })
        : [
            {
              name: 'Colaborador Exemplo 1',
              hoursBalance: 12,
              formattedOriginal: '+12h',
              unitHint: state.units[0]?.name || 'Farmácia',
              roleHint: 'Auxiliar de Farmácia',
              notes: 'Plantão extra diurno',
            },
          ];

    initializeCandidatesFromExtracted(sampleEntries);
  };

  const handleUpdateCandidate = <K extends keyof HourBankImportCandidate>(
    candId: string,
    field: K,
    value: HourBankImportCandidate[K]
  ) => {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.id !== candId) return c;
        const updated = { ...c, [field]: value };
        if (field === 'matchedEmployeeId' && typeof value === 'string') {
          const emp = activeEmployees.find((e) => e.id === value);
          if (emp) {
            updated.unitId = emp.unitId;
            updated.role = emp.role;
            updated.autoMatched = true;
          }
        }
        return updated;
      })
    );
  };

  const handleConfirmBatchImport = () => {
    const validCandidates = candidates.filter((c) => c.matchedEmployeeId !== '__SKIP__');
    if (validCandidates.length === 0) {
      setCandidates([]);
      return;
    }

    const batchPayload = validCandidates.map((c, idx) => {
      if (c.matchedEmployeeId !== '__CREATE_NEW__') {
        return {
          employeeId: c.matchedEmployeeId,
          hoursValue: Number(c.hoursValue) || 0,
          mode: importMode,
          reason:
            c.notes.trim() ||
            `Importado do arquivo ${uploadedFileName || 'de Banco de Horas'}`,
        };
      }

      const newEmp: Employee = {
        id: `emp-hb-${Date.now()}-${idx}`,
        name: c.extractedName.trim(),
        registrationNumber: '',
        role: c.role,
        unitId: c.unitId || state.units[0]?.id || 'unit-default-1',
        defaultShift: 'Diurno',
        workHours: '07:00 às 19:00',
        regime: '5x2',
        hourBankBalance: Number(c.hoursValue) || 0,
        active: true,
        history: [],
      };

      return {
        newEmployee: newEmp,
        hoursValue: Number(c.hoursValue) || 0,
        mode: 'REPLACE' as const,
        reason:
          c.notes.trim() ||
          `Cadastrado via importação de Banco de Horas (${uploadedFileName || 'planilha'})`,
      };
    });

    onApplyHourBankBatch(batchPayload);
    const linkedCount = validCandidates.filter(
      (c) => c.matchedEmployeeId !== '__CREATE_NEW__'
    ).length;
    const createdCount = validCandidates.length - linkedCount;

    setCandidates([]);
    setFeedbackMsg(
      `Banco de Horas atualizado com sucesso! ${linkedCount} colaborador(es) identificado(s) tiveram o saldo vinculado${
        createdCount > 0 ? ` e ${createdCount} novo(s) cadastrado(s)` : ''
      }.`
    );
    setTimeout(() => setFeedbackMsg(null), 6000);
  };

  // Ajuste rápido de +1h, -1h, +6h, +12h, etc.
  const handleQuickDelta = (emp: Employee, delta: number, defaultReason: string) => {
    const current = Number(emp.hourBankBalance) || 0;
    const nextBalance = Math.round((current + delta) * 100) / 100;
    onUpdateSingleEmployeeHourBank(emp.id, nextBalance, delta, defaultReason);
    setFeedbackMsg(
      `Saldo de ${emp.name} atualizado para ${formatHoursDisplay(nextBalance)}!`
    );
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  const handleOpenManualEdit = (emp: Employee) => {
    setEditingEmpId(emp.id);
    setManualMode('SET');
    setManualHoursInput(String(emp.hourBankBalance || 0));
    setManualReasonInput('Ajuste manual de Banco de Horas');
  };

  const handleSaveManualEdit = (emp: Employee) => {
    const parsedVal = Number(manualHoursInput.replace(',', '.'));
    if (Number.isNaN(parsedVal)) return;

    const current = Number(emp.hourBankBalance) || 0;
    const nextBalance =
      manualMode === 'SET'
        ? Math.round(parsedVal * 100) / 100
        : Math.round((current + parsedVal) * 100) / 100;
    const delta = Math.round((nextBalance - current) * 100) / 100;

    onUpdateSingleEmployeeHourBank(
      emp.id,
      nextBalance,
      delta,
      manualReasonInput.trim() || 'Ajuste de Banco de Horas'
    );
    setEditingEmpId(null);
    setFeedbackMsg(
      `Banco de Horas de ${emp.name} salvo em ${formatHoursDisplay(nextBalance)}!`
    );
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  // Exporta planilha CSV compatível com Excel
  const handleExportHourBankCsv = () => {
    const headers = [
      'Nome do Colaborador',
      'Cargo / Função',
      'Setor / Unidade',
      'Turno',
      'Saldo Banco de Horas (Decimal)',
      'Saldo Formatado',
      'Situação',
    ];

    const rows = activeEmployees.map((emp) => {
      const unitName =
        state.units.find((u) => u.id === emp.unitId)?.name || 'Unidade Principal';
      const bal = Number(emp.hourBankBalance) || 0;
      const status =
        bal > 0 ? 'CRÉDITO POSITIVO' : bal < 0 ? 'DÉBITO NEGATIVO' : 'ZERADO';
      return [
        `"${emp.name.replace(/"/g, '""')}"`,
        `"${emp.role.replace(/"/g, '""')}"`,
        `"${unitName.replace(/"/g, '""')}"`,
        `"${emp.defaultShift}"`,
        String(bal).replace('.', ','),
        `"${formatHoursDisplay(bal)}"`,
        `"${status}"`,
      ].join(';');
    });

    const csvContent = `\uFEFF${headers.join(';')}\n${rows.join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateTag = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `banco-de-horas-${dateTag}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {feedbackMsg && (
        <div className="no-print p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* CABEÇALHO E EXPORTAÇÃO RÁPIDA */}
      <section className="no-print bg-white rounded-2xl border border-slate-200 p-5 md:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#0d9488] text-white flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
              Central de Banco de Horas &amp; Controle de Horários
            </h1>
            <p className="text-xs text-slate-600 mt-0.5 max-w-2xl">
              Controle quem ficou até mais tarde (+BH), quem entrou mais tarde ou saiu mais cedo e
              entregou Declaração de Horas (abonado), além de importar saldos da sua planilha.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportHourBankCsv}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-teal-700" />
            <span>Exportar Planilha (.CSV / Excel)</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4 text-teal-400" />
            <span>Imprimir / PDF Banco de Horas</span>
          </button>
        </div>
      </section>

      {/* CARDS DE RESUMO DO BANCO DE HORAS */}
      <section className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block">
              Saldos Positivos (Crédito)
            </span>
            <span className="text-2xl font-extrabold text-emerald-700 tabular-nums mt-1 block">
              +{summary.totalPositiveHours}h
            </span>
            <span className="text-[11px] text-slate-500">
              {summary.positiveCount} colaborador(es) com horas extras
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block">
              Saldos Negativos (Débito)
            </span>
            <span className="text-2xl font-extrabold text-red-600 tabular-nums mt-1 block">
              -{summary.totalNegativeHours}h
            </span>
            <span className="text-[11px] text-slate-500">
              {summary.negativeCount} colaborador(es) devendo horas
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
            <TrendingDown className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block">
              Balanço Geral da Equipe
            </span>
            <span
              className={`text-2xl font-extrabold tabular-nums mt-1 block ${
                summary.netBalance > 0
                  ? 'text-teal-700'
                  : summary.netBalance < 0
                  ? 'text-red-600'
                  : 'text-slate-800'
              }`}
            >
              {formatHoursDisplay(summary.netBalance)}
            </span>
            <span className="text-[11px] text-slate-500">
              {activeEmployees.length} colaboradores ativos no total
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block">
              Horários &amp; Declarações
            </span>
            <span className="text-2xl font-extrabold text-indigo-700 tabular-nums mt-1 block">
              {allTimeTrackingLogs.length}
            </span>
            <span className="text-[11px] text-slate-500">
              {pendingDeclarationsCount > 0 ? (
                <span className="text-amber-700 font-bold">
                  {pendingDeclarationsCount} declaração(ões) pendente(s)
                </span>
              ) : (
                'Todas as declarações em dia'
              )}
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <CalendarClock className="w-5 h-5" />
          </div>
        </div>
      </section>

      {/* PAINEL DE CONTROLE DE HORÁRIOS DO DIA (FICOU ATÉ MAIS TARDE / ENTROU MAIS TARDE COM DECLARAÇÃO) */}
      <section className="no-print bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 border border-teal-200 flex items-center justify-center shrink-0 mt-0.5">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-bold text-slate-900">
                Controle Diário de Horários, Prorrogações e Declarações de Horas
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Registre quando um colaborador precisou ficar até mais tarde (+BH) ou quando entrou
                mais tarde / saiu mais cedo e entregou Declaração de Horas (abonado sem descontar).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowNewTimeForm((v) => !v)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 text-teal-400" />
            <span>{showNewTimeForm ? 'Ocultar Lançamento' : 'Novo Registro de Horário'}</span>
          </button>
        </div>

        {showNewTimeForm && selectedTimeEmp && (
          <div className="p-4 md:p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
            {/* Seleção de Colaborador e Data */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-7">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  1. Colaborador
                </label>
                <select
                  value={selectedTimeEmp.id}
                  onChange={(e) => handleSelectTimeEmployee(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
                >
                  {activeEmployees.map((emp) => {
                    const uName =
                      state.units.find((u) => u.id === emp.unitId)?.name || 'Setor';
                    return (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} — {uName} ({emp.workHours || '07:00 às 19:00'}) · Saldo:{' '}
                        {formatHoursDisplay(emp.hourBankBalance)}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="md:col-span-5">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  2. Data da Ocorrência de Horário
                </label>
                <input
                  type="date"
                  value={timeDate}
                  onChange={(e) => setTimeDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
                />
              </div>
            </div>

            {/* Seleção do Cenário de Horário */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                3. O que aconteceu com o horário deste colaborador?
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => applyTimeScenarioPreset('FICOU_MAIS_TARDE')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    timeScenario === 'FICOU_MAIS_TARDE'
                      ? 'bg-emerald-900 text-white border-emerald-900 shadow-sm'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-emerald-300'
                  }`}
                >
                  <span className="text-xs font-extrabold block">
                    Ficou até mais tarde (+BH)
                  </span>
                  <span
                    className={`text-[11px] mt-0.5 block ${
                      timeScenario === 'FICOU_MAIS_TARDE'
                        ? 'text-emerald-200'
                        : 'text-slate-500'
                    }`}
                  >
                    Prorrogou a saída e soma horas no Banco
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => applyTimeScenarioPreset('ENTROU_MAIS_TARDE_DECLARACAO')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    timeScenario === 'ENTROU_MAIS_TARDE_DECLARACAO'
                      ? 'bg-sky-900 text-white border-sky-900 shadow-sm'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-sky-300'
                  }`}
                >
                  <span className="text-xs font-extrabold block">
                    Entrou mais tarde + Declaração
                  </span>
                  <span
                    className={`text-[11px] mt-0.5 block ${
                      timeScenario === 'ENTROU_MAIS_TARDE_DECLARACAO'
                        ? 'text-sky-200'
                        : 'text-slate-500'
                    }`}
                  >
                    Entregou declaração de horas (Abonado 0h)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => applyTimeScenarioPreset('SAIU_MAIS_CEDO_DECLARACAO')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    timeScenario === 'SAIU_MAIS_CEDO_DECLARACAO'
                      ? 'bg-sky-900 text-white border-sky-900 shadow-sm'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-sky-300'
                  }`}
                >
                  <span className="text-xs font-extrabold block">
                    Saiu mais cedo + Declaração
                  </span>
                  <span
                    className={`text-[11px] mt-0.5 block ${
                      timeScenario === 'SAIU_MAIS_CEDO_DECLARACAO'
                        ? 'text-sky-200'
                        : 'text-slate-500'
                    }`}
                  >
                    Consulta/exame com declaração (Abonado 0h)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => applyTimeScenarioPreset('ATRASO_DESCONTO_BH')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    timeScenario === 'ATRASO_DESCONTO_BH' ||
                    timeScenario === 'SAIDA_ANTECIPADA_BH'
                      ? 'bg-amber-900 text-white border-amber-900 shadow-sm'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-amber-300'
                  }`}
                >
                  <span className="text-xs font-extrabold block">
                    Atraso / Saída sem Declaração (-BH)
                  </span>
                  <span
                    className={`text-[11px] mt-0.5 block ${
                      timeScenario === 'ATRASO_DESCONTO_BH' ||
                      timeScenario === 'SAIDA_ANTECIPADA_BH'
                        ? 'text-amber-200'
                        : 'text-slate-500'
                    }`}
                  >
                    Desconta as horas não trabalhadas do BH
                  </span>
                </button>
              </div>
            </div>

            {/* Horário Previsto vs Realizado */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center bg-white p-3.5 rounded-xl border border-slate-200">
              <div className="lg:col-span-4 grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    Entrada Prevista
                  </label>
                  <input
                    type="time"
                    value={plannedStart}
                    onChange={(e) => setPlannedStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-base font-bold text-slate-800 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    Saída Prevista
                  </label>
                  <input
                    type="time"
                    value={plannedEnd}
                    onChange={(e) => setPlannedEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-base font-bold text-slate-800 tabular-nums"
                  />
                </div>
              </div>

              <div className="lg:col-span-4 grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-teal-800 mb-1">
                    Entrada Realizada
                  </label>
                  <input
                    type="time"
                    value={actualStart}
                    onChange={(e) => setActualStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border-2 border-teal-500 bg-teal-50/30 text-base font-extrabold text-slate-900 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-teal-800 mb-1">
                    Saída Realizada
                  </label>
                  <input
                    type="time"
                    value={actualEnd}
                    onChange={(e) => setActualEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border-2 border-teal-500 bg-teal-50/30 text-base font-extrabold text-slate-900 tabular-nums"
                  />
                </div>
              </div>

              {/* Resumo Automático do Cálculo */}
              <div className="lg:col-span-4 p-3 rounded-xl bg-slate-900 text-white flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
                    Cálculo Automático
                  </span>
                  <span className="text-xs font-bold text-slate-200 block mt-0.5">
                    {timeScenario === 'FICOU_MAIS_TARDE'
                      ? 'Crédito no Banco de Horas:'
                      : timeScenario === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
                        timeScenario === 'SAIU_MAIS_CEDO_DECLARACAO'
                      ? 'Horas Abonadas c/ Declaração:'
                      : 'Desconto no Banco de Horas:'}
                  </span>
                </div>
                <span
                  className={`text-lg font-extrabold tabular-nums px-2.5 py-1 rounded-lg ${
                    timeScenario === 'FICOU_MAIS_TARDE'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : timeScenario === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
                        timeScenario === 'SAIU_MAIS_CEDO_DECLARACAO'
                      ? 'bg-sky-500/20 text-sky-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {timeScenario === 'FICOU_MAIS_TARDE'
                    ? `+${formatDecimalHoursPtBr(Math.max(0.25, calculatedFormDiffHours))}`
                    : timeScenario === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
                      timeScenario === 'SAIU_MAIS_CEDO_DECLARACAO'
                    ? `${formatDecimalHoursPtBr(Math.max(0.25, calculatedFormDiffHours))} (0h BH)`
                    : `-${formatDecimalHoursPtBr(Math.max(0.25, calculatedFormDiffHours))}`}
                </span>
              </div>
            </div>

            {/* Controle de Entrega da Declaração + Observação */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
              {(timeScenario === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
                timeScenario === 'SAIU_MAIS_CEDO_DECLARACAO') && (
                <div className="lg:col-span-5">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Situação do Comprovante / Declaração de Horas
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDeclDelivered(true)}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                        declDelivered
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      <FileCheck2 className="w-4 h-4" />
                      <span>Já Entregou Papel</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeclDelivered(false)}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                        !declDelivered
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      <AlertCircle className="w-4 h-4" />
                      <span>Pendente Entregar</span>
                    </button>
                  </div>
                </div>
              )}

              <div
                className={
                  timeScenario === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
                  timeScenario === 'SAIU_MAIS_CEDO_DECLARACAO'
                    ? 'lg:col-span-4'
                    : 'lg:col-span-9'
                }
              >
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Motivo / Observação (Opcional)
                </label>
                <input
                  type="text"
                  value={timeReason}
                  onChange={(e) => setTimeReason(e.target.value)}
                  placeholder={
                    timeScenario === 'FICOU_MAIS_TARDE'
                      ? 'Ex: Cobriu atraso de colega / movimento intenso na farmácia...'
                      : 'Ex: Consulta médica / exames laboratoriais pela manhã...'
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                />
              </div>

              <div className="lg:col-span-3">
                <button
                  type="button"
                  onClick={handleSaveTimeControlRecord}
                  className="w-full px-4 py-3 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs md:text-sm font-bold shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Registrar Horário</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* HISTÓRICO E CONTROLE DE DECLARAÇÕES E PRORROGAÇÕES DA EQUIPE */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">
              Histórico de Horários, Prorrogações e Declarações ({filteredTimeLogs.length})
            </h3>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'TODOS', label: 'Todos' },
                  { id: 'FICOU_MAIS_TARDE', label: 'Ficou até mais tarde (+BH)' },
                  { id: 'DECLARACOES', label: 'Declarações de Horas' },
                  {
                    id: 'DECLARACOES_PENDENTES',
                    label: `Declarações Pendentes (${pendingDeclarationsCount})`,
                  },
                  { id: 'DESCONTOS_BH', label: 'Atrasos / Folgas (-BH)' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTimeLogFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    timeLogFilter === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredTimeLogs.length === 0 ? (
            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
              Nenhum registro de horário, prorrogação ou declaração encontrado para este filtro. Use
              o painel acima ou clique em qualquer dia da Escala para registrar.
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {filteredTimeLogs.map(({ emp, unitName, record }) => {
                const isDecl = record.type === 'DECLARACAO_HORAS';
                const isPositive =
                  record.type === 'HORA_EXTRA' || (record.hoursDuration || 0) > 0;
                const isPendingDecl = isDecl && record.declarationDelivered === false;

                return (
                  <div
                    key={record.id}
                    className={`p-3.5 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                      isPendingDecl
                        ? 'bg-amber-50/60 border-amber-200'
                        : isDecl
                        ? 'bg-sky-50/40 border-sky-200'
                        : isPositive
                        ? 'bg-emerald-50/40 border-emerald-200'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {emp.name}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 text-[10px] font-bold">
                          {unitName}
                        </span>
                        <span className="text-xs font-bold text-slate-700">
                          {formatDateWithWeekdayPtBr(record.startDate)}
                        </span>

                        {isDecl ? (
                          <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-900 text-[10px] font-extrabold">
                            DECLARAÇÃO DE HORAS (ABONADO)
                          </span>
                        ) : isPositive ? (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-[10px] font-extrabold">
                            FICOU ATÉ MAIS TARDE / HORA EXTRA
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                            DESCONTO / COMPENSAÇÃO BH
                          </span>
                        )}
                      </div>

                      {record.plannedStartTime && record.actualStartTime && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700 font-semibold tabular-nums">
                          <span>
                            Horário Previsto:{' '}
                            <strong className="text-slate-900">
                              {record.plannedStartTime} às {record.plannedEndTime}
                            </strong>
                          </span>
                          <span>→</span>
                          <span>
                            Horário Realizado:{' '}
                            <strong className="text-teal-800">
                              {record.actualStartTime} às {record.actualEndTime}
                            </strong>
                          </span>
                        </div>
                      )}

                      <p className="text-xs text-slate-600">{record.reason}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {/* Badge de Impacto no Banco de Horas */}
                      {isDecl ? (
                        <span className="px-3 py-1.5 rounded-xl bg-sky-100 text-sky-900 text-xs font-extrabold tabular-nums">
                          {record.abonedHours
                            ? `${formatDecimalHoursPtBr(record.abonedHours)} Abonadas (0h BH)`
                            : 'Abonado (0h BH)'}
                        </span>
                      ) : (
                        <span
                          className={`px-3 py-1.5 rounded-xl text-xs font-extrabold tabular-nums ${
                            (record.hoursDuration || 0) >= 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {formatHoursDisplay(record.hoursDuration || 0)} no BH
                        </span>
                      )}

                      {/* Botão para alternar status de entrega da Declaração de Horas */}
                      {isDecl && onToggleDeclarationDelivered && (
                        <button
                          type="button"
                          onClick={() => onToggleDeclarationDelivered(record.id, emp.id)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                            record.declarationDelivered !== false
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'bg-amber-500 hover:bg-amber-600 text-white'
                          }`}
                          title="Clique para alternar entre Declaração Entregue e Pendente"
                        >
                          {record.declarationDelivered !== false ? (
                            <>
                              <FileCheck2 className="w-3.5 h-3.5" />
                              <span>Declaração Entregue</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>Pendente Papel (Confirmar)</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Botão para excluir / estornar lançamento */}
                      {onDeleteTimeRecord && (
                        <button
                          type="button"
                          onClick={() => onDeleteTimeRecord(record.id, emp.id)}
                          className="p-2 rounded-xl bg-white hover:bg-red-50 text-slate-400 hover:text-red-600 border border-slate-200 transition-colors cursor-pointer"
                          title="Excluir registro e estornar horas do saldo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* IMPORTADOR INTELIGENTE DE ARQUIVO DE BANCO DE HORAS */}
      <section className="no-print bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base md:text-lg font-bold text-slate-900">
              Importar Arquivo de Banco de Horas (Excel, Word, PDF ou Foto)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Envie a planilha de banco de horas ou o mesmo arquivo usado no cadastro: os nomes
              iguais são reconhecidos e vinculados automaticamente ao colaborador cadastrado.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSimulateWithCurrentTeam}
            disabled={isAnalyzingFile}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            <Sparkles className="w-4 h-4 text-teal-600" />
            <span>Simular Vínculo com Minha Equipe</span>
          </button>
        </div>

        {fileError && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold">
            {fileError}
          </div>
        )}

        {candidates.length === 0 ? (
          <label className="flex flex-col items-center justify-center p-7 border-2 border-dashed border-teal-300 hover:border-teal-500 rounded-2xl bg-teal-50/30 hover:bg-teal-50/60 transition-colors cursor-pointer text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#0d9488] text-white flex items-center justify-center mb-3 shadow-sm">
              {isAnalyzingFile ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <FileUp className="w-6 h-6" />
              )}
            </div>
            <span className="text-sm font-bold text-slate-900">
              {isAnalyzingFile
                ? `Lendo nomes e saldos de horas em "${uploadedFileName}"...`
                : 'Clique para enviar planilha Excel (.xlsx/.csv), Word, PDF ou Foto do Banco de Horas'}
            </span>
            <span className="text-xs text-slate-500 mt-1">
              Reconhecimento automático de colaboradores já cadastrados pelo nome
            </span>
            <input
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,.ods,.docx,.doc,.txt,image/*"
              onChange={handleFileUpload}
              disabled={isAnalyzingFile}
              className="hidden"
            />
          </label>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-teal-400 block">
                  Arquivo Analisado: {uploadedFileName}
                </span>
                <h3 className="text-sm md:text-base font-bold mt-0.5">
                  {candidates.length} nome(s) encontrado(s) ·{' '}
                  {
                    candidates.filter(
                      (c) =>
                        c.matchedEmployeeId !== '__CREATE_NEW__' &&
                        c.matchedEmployeeId !== '__SKIP__'
                    ).length
                  }{' '}
                  vinculado(s) automaticamente ao cadastro!
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl bg-slate-800 p-1 border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setImportMode('REPLACE')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      importMode === 'REPLACE'
                        ? 'bg-[#0d9488] text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Substituir Saldo Atual
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode('ADD')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      importMode === 'ADD'
                        ? 'bg-[#0d9488] text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Somar ao Saldo Atual
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setCandidates([])}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>

            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {candidates.map((cand) => {
                const linkedEmp = activeEmployees.find(
                  (e) => e.id === cand.matchedEmployeeId
                );
                const linkedUnitName = linkedEmp
                  ? state.units.find((u) => u.id === linkedEmp.unitId)?.name || ''
                  : '';

                return (
                  <div
                    key={cand.id}
                    className={`p-4 rounded-2xl border transition-colors ${
                      cand.matchedEmployeeId === '__SKIP__'
                        ? 'bg-slate-50 border-slate-200 opacity-60'
                        : linkedEmp
                        ? 'bg-emerald-50/40 border-emerald-200'
                        : 'bg-amber-50/40 border-amber-200'
                    }`}
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                      {/* Nome lido no arquivo e status de vínculo */}
                      <div className="lg:col-span-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {cand.extractedName}
                          </span>
                          {linkedEmp ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              <UserCheck className="w-3 h-3" />
                              Identificado
                            </span>
                          ) : cand.matchedEmployeeId === '__CREATE_NEW__' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                              <UserPlus className="w-3 h-3" />
                              Novo Cadastro
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {linkedEmp
                            ? `Setor: ${linkedUnitName} · Saldo atual: ${formatHoursDisplay(
                                linkedEmp.hourBankBalance
                              )}`
                            : 'Não encontrado no cadastro atual — você pode vincular abaixo ou cadastrar agora'}
                        </p>
                      </div>

                      {/* Seletor de vínculo com colaborador cadastrado */}
                      <div className="lg:col-span-4">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Vincular ao Colaborador:
                        </label>
                        <select
                          value={cand.matchedEmployeeId}
                          onChange={(e) =>
                            handleUpdateCandidate(
                              cand.id,
                              'matchedEmployeeId',
                              e.target.value
                            )
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                        >
                          {activeEmployees.map((emp) => {
                            const uName =
                              state.units.find((u) => u.id === emp.unitId)?.name || '';
                            return (
                              <option key={emp.id} value={emp.id}>
                                {emp.name} ({uName})
                              </option>
                            );
                          })}
                          <option value="__CREATE_NEW__">
                            + Cadastrar &quot;{cand.extractedName}&quot; Automaticamente
                          </option>
                          <option value="__SKIP__">Ignorar esta linha</option>
                        </select>
                      </div>

                      {/* Valor do Banco de Horas */}
                      <div className="lg:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Horas no Arquivo (h):
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={cand.hoursValue}
                          onChange={(e) =>
                            handleUpdateCandidate(
                              cand.id,
                              'hoursValue',
                              Number(e.target.value)
                            )
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base font-bold text-slate-900 tabular-nums"
                        />
                      </div>

                      {/* Resultado final previsto */}
                      <div className="lg:col-span-2 text-right">
                        <span className="text-[11px] font-semibold text-slate-500 block">
                          Novo Saldo Final:
                        </span>
                        {cand.matchedEmployeeId === '__SKIP__' ? (
                          <span className="text-xs font-bold text-slate-400">Ignorado</span>
                        ) : (
                          <span className="text-base font-extrabold text-teal-700 tabular-nums">
                            {formatHoursDisplay(
                              linkedEmp && importMode === 'ADD'
                                ? (Number(linkedEmp.hourBankBalance) || 0) +
                                    (Number(cand.hoursValue) || 0)
                                : Number(cand.hoursValue) || 0
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCandidates([])}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-100 cursor-pointer"
              >
                Descartar Leitura
              </button>
              <button
                type="button"
                onClick={handleConfirmBatchImport}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs md:text-sm font-bold shadow-sm transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Aplicar Banco de Horas aos Colaboradores</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* FILTROS E TABELA DE BANCO DE HORAS POR COLABORADOR */}
      <section className="no-print bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base md:text-lg font-bold text-slate-900">
              Saldos Individuais da Equipe ({filteredEmployees.length})
            </h2>
            <p className="text-xs text-slate-500">
              Ajuste horas extras, folgas compensatórias ou saldos diretamente em cada colaborador
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:w-60">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar colaborador..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-base text-slate-900"
              />
            </div>

            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-800 font-semibold"
            >
              <option value="TODAS">Todos os Setores ({state.units.length})</option>
              {state.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            <select
              value={balanceFilter}
              onChange={(e) =>
                setBalanceFilter(
                  e.target.value as 'TODOS' | 'POSITIVOS' | 'NEGATIVOS' | 'ZERADOS'
                )
              }
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-800 font-semibold"
            >
              <option value="TODOS">Todos os Saldos</option>
              <option value="POSITIVOS">Saldos Positivos (+)</option>
              <option value="NEGATIVOS">Saldos Negativos (-)</option>
              <option value="ZERADOS">Saldos Zerados (0h)</option>
            </select>
          </div>
        </div>

        {filteredEmployees.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            Nenhum colaborador encontrado para este filtro.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEmployees.map((emp) => {
              const unitName =
                state.units.find((u) => u.id === emp.unitId)?.name || 'Unidade Principal';
              const bal = Number(emp.hourBankBalance) || 0;
              const isEditing = editingEmpId === emp.id;

              const recentHourLogs: AbsenceRecord[] = (emp.history || [])
                .filter(
                  (h) =>
                    h.type === 'HORA_EXTRA' ||
                    h.type === 'DECLARACAO_HORAS' ||
                    h.type === 'BANCO_HORAS'
                )
                .slice(0, 3)
                .map((h) => hydrateTimeTrackingRecord(h));

              return (
                <div
                  key={emp.id}
                  className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm md:text-base font-bold text-slate-900">
                          {emp.name}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-lg bg-slate-200/80 text-slate-800 text-[11px] font-bold">
                          {unitName}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          {emp.role} · {emp.defaultShift} ({emp.workHours || '07:00 às 19:00'})
                        </span>
                      </div>

                      {recentHourLogs.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {recentHourLogs.map((log) => (
                            <span
                              key={log.id}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                log.type === 'DECLARACAO_HORAS'
                                  ? 'bg-sky-100 text-sky-900'
                                  : log.type === 'HORA_EXTRA'
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              <span>{log.startDate.slice(8, 10)}/{log.startDate.slice(5, 7)}:</span>
                              <span className="truncate max-w-[240px]">{log.reason}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {/* Saldo atual destacado */}
                      <div
                        className={`px-3.5 py-2 rounded-xl border font-extrabold text-sm md:text-base tabular-nums min-w-[92px] text-center ${
                          bal > 0
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : bal < 0
                            ? 'bg-red-50 border-red-200 text-red-600'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        {formatHoursDisplay(bal)}
                      </div>

                      {/* Botões de ajuste rápido */}
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickDelta(emp, -1, 'Desconto / Compensação de 1h no Banco')
                        }
                        className="px-2.5 py-2 rounded-xl bg-white hover:bg-red-50 text-red-600 border border-slate-200 text-xs font-bold cursor-pointer"
                        title="Descontar 1 hora"
                      >
                        -1h
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleQuickDelta(emp, 1, 'Acúmulo de +1h no Banco de Horas')
                        }
                        className="px-2.5 py-2 rounded-xl bg-white hover:bg-emerald-50 text-emerald-700 border border-slate-200 text-xs font-bold cursor-pointer"
                        title="Adicionar 1 hora"
                      >
                        +1h
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleQuickDelta(emp, 6, 'Meio plantão extra (+6h) no Banco de Horas')
                        }
                        className="px-2.5 py-2 rounded-xl bg-white hover:bg-emerald-50 text-emerald-700 border border-slate-200 text-xs font-bold cursor-pointer"
                        title="Adicionar 6 horas"
                      >
                        +6h
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleQuickDelta(emp, 12, 'Plantão extra (+12h) no Banco de Horas')
                        }
                        className="px-2.5 py-2 rounded-xl bg-white hover:bg-emerald-50 text-emerald-700 border border-slate-200 text-xs font-bold cursor-pointer"
                        title="Adicionar 12 horas"
                      >
                        +12h
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          isEditing ? setEditingEmpId(null) : handleOpenManualEdit(emp)
                        }
                        className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                      >
                        {isEditing ? 'Fechar' : 'Editar Saldo'}
                      </button>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="pt-3 border-t border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                      <div className="md:col-span-3">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Tipo de Ajuste
                        </label>
                        <select
                          value={manualMode}
                          onChange={(e) => setManualMode(e.target.value as 'SET' | 'DELTA')}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                        >
                          <option value="SET">Definir Saldo Exato</option>
                          <option value="DELTA">Somar / Subtrair Horas</option>
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Horas (ex: 12 ou -4.5)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={manualHoursInput}
                          onChange={(e) => setManualHoursInput(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base font-bold text-slate-900 tabular-nums"
                        />
                      </div>

                      <div className="md:col-span-5">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Motivo / Observação
                        </label>
                        <input
                          type="text"
                          value={manualReasonInput}
                          onChange={(e) => setManualReasonInput(e.target.value)}
                          placeholder="Ex: Horas extras de plantão, compensação de folga..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                        />
                      </div>

                      <div className="md:col-span-2 flex justify-end gap-2">
                        {bal !== 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateSingleEmployeeHourBank(
                                emp.id,
                                0,
                                -bal,
                                'Saldo de Banco de Horas zerado/quitado'
                              )
                            }
                            title="Zerar saldo"
                            className="p-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSaveManualEdit(emp)}
                          className="w-full px-4 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
                        >
                          Salvar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* RELATÓRIO DE IMPRESSÃO A4 DO BANCO DE HORAS */}
      <section className="hidden print-only print-container bg-white p-6">
        <div className="border-b-2 border-slate-900 pb-3 mb-4 flex justify-between items-end">
          <div>
            <h1 className="text-lg font-extrabold uppercase">
              {state.manager.hospitalName || 'Instituição Hospitalar'} — Relatório Oficial de Banco
              de Horas
            </h1>
            <p className="text-xs text-slate-600">
              Setor: {state.manager.sectorName} · Responsável: {state.manager.name} (
              {state.manager.role})
            </p>
          </div>
          <span className="text-xs font-semibold">
            Emitido em: {new Date().toLocaleDateString('pt-BR')}
          </span>
        </div>

        <table className="print-table">
          <thead>
            <tr className="bg-slate-100">
              <th className="text-left">Colaborador</th>
              <th className="text-left">Cargo / Função</th>
              <th className="text-left">Setor / Unidade</th>
              <th className="text-center">Turno</th>
              <th className="text-right">Saldo Banco de Horas</th>
              <th className="text-left">Assinatura do Colaborador</th>
            </tr>
          </thead>
          <tbody>
            {activeEmployees.map((emp) => {
              const uName =
                state.units.find((u) => u.id === emp.unitId)?.name || 'Unidade Principal';
              return (
                <tr key={emp.id}>
                  <td className="font-bold">{emp.name}</td>
                  <td>{emp.role}</td>
                  <td>{uName}</td>
                  <td className="text-center">{emp.defaultShift}</td>
                  <td className="text-right font-bold">
                    {formatHoursDisplay(emp.hourBankBalance)}
                  </td>
                  <td className="w-48"></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
};
