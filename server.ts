import 'dotenv/config';
import express from 'express';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ExtractedEmployeeItem {
  name: string;
  roleHint: string;
  unitHint: string;
  shiftHint: 'Diurno' | 'Noturno';
  workHoursHint: string;
  scheduleRegimeHint: '12x36_ODD' | '12x36_EVEN' | '5x2' | '6x1';
  registrationNumber: string;
  notes: string;
}

// Gera um PNG válido em memória (sem dependências externas) com as cores do EscalaPro (#0f172a e cruz #0d9488)
function createEscalaProPngBuffer(size: number): Buffer {
  const width = size;
  const height = size;
  const rawData = Buffer.alloc(height * (1 + width * 4));

  const margin = Math.floor(size * 0.18);
  const crossArm = Math.floor(size * 0.16);
  const center = Math.floor(size / 2);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      let r = 15,
        g = 23,
        b = 42,
        a = 255;

      const inVerticalArm =
        x >= center - crossArm &&
        x <= center + crossArm &&
        y >= margin &&
        y <= size - margin;
      const inHorizontalArm =
        y >= center - crossArm &&
        y <= center + crossArm &&
        x >= margin &&
        x <= size - margin;

      if (inVerticalArm || inHorizontalArm) {
        r = 13;
        g = 148;
        b = 136;
      }

      if (
        Math.abs(y - center) <= Math.max(2, Math.floor(size * 0.02)) &&
        x >= margin + 8 &&
        x <= size - margin - 8
      ) {
        r = 255;
        g = 255;
        b = 255;
      }

      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
      rawData[px + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }

  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const combined = Buffer.concat([typeBuf, data]);
    crcBuf.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

const icon180 = createEscalaProPngBuffer(180);
const icon192 = createEscalaProPngBuffer(192);
const icon512 = createEscalaProPngBuffer(512);

const STOP_HEADER_WORDS = new Set([
  'nome',
  'colaborador',
  'colaboradores',
  'funcionario',
  'funcionarios',
  'funcionário',
  'funcionários',
  'profissional',
  'profissionais',
  'servidor',
  'plantonista',
  'cargo',
  'funcao',
  'função',
  'categoria',
  'setor',
  'unidade',
  'local',
  'lotacao',
  'lotação',
  'horario',
  'horário',
  'turno',
  'plantao',
  'plantão',
  'escala',
  'regime',
  'jornada',
  'matricula',
  'matrícula',
  'coren',
  'crf',
  'crm',
  'conselho',
  'registro',
  'assinatura',
  'rubrica',
  'observacao',
  'observação',
  'observacoes',
  'observações',
  'total',
  'subtotal',
  'resumo',
  'legenda',
  'hospital',
  'clinica',
  'clínica',
  'secretaria',
  'prefeitura',
  'janeiro',
  'fevereiro',
  'marco',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
  'segunda',
  'terca',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
  'sábado',
  'domingo',
  'diurno',
  'noturno',
  'manha',
  'manhã',
  'tarde',
  'noite',
  'folga',
  'ferias',
  'férias',
  'atestado',
  'falta',
  'data',
  'pagina',
  'página',
]);

function toTitleCasePtBr(raw: string): string {
  const lowerParticles = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && lowerParticles.has(lower)) return lower;
      if (lower === 'dr.' || lower === 'dr') return 'Dr.';
      if (lower === 'dra.' || lower === 'dra') return 'Dra.';
      if (lower === 'enf.' || lower === 'enf') return 'Enf.';
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function isLikelyPersonName(val: string): boolean {
  const cleaned = val
    .replace(/^\d+[\s.\-)]+/, '')
    .replace(/\([^)]*\)/g, '')
    .trim();

  if (cleaned.length < 3 || cleaned.length > 85) return false;
  // Rejeita se tiver muitos números ou caracteres de horário/data
  if (/\d{2}:\d{2}|\d{2}\/\d{2}|12\s*x\s*36|5\s*x\s*2|6\s*x\s*1/i.test(cleaned)) return false;
  const digitCount = (cleaned.match(/\d/g) || []).length;
  if (digitCount > 2) return false;

  // Deve ter apenas letras, acentos, espaços, pontos ou apóstrofos
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ\s.'-]+$/.test(cleaned)) return false;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const normalizedFull = cleaned
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (STOP_HEADER_WORDS.has(normalizedFull)) return false;

  // Se todas as palavras forem palavras de cabeçalho/cargo/turno, não é um nome de pessoa
  const nonStopWords = words.filter((w) => {
    const nw = w
      .toLowerCase()
      .replace(/\./g, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return nw.length >= 2 && !STOP_HEADER_WORDS.has(nw);
  });

  if (nonStopWords.length === 0) return false;

  // Rejeita frases longas que claramente são títulos de planilha
  if (
    /escala\s+mensal|quadro\s+de|folha\s+de\s+ponto|setor\s+de|departamento|coordena|supervis/i.test(
      cleaned
    )
  ) {
    return false;
  }

  return true;
}

function inferAttributesFromRowCells(
  cells: string[],
  availableUnits: string[],
  availableRoles: string[],
  currentSectionUnit: string,
  currentSectionRole: string
): Omit<ExtractedEmployeeItem, 'name'> {
  const joined = cells.join(' | ');
  const lowerJoined = joined.toLowerCase();

  // 1. Detecta Função / Cargo
  let roleHint = currentSectionRole || '';
  const allKnownRoles = Array.from(
    new Set([
      ...availableRoles,
      'Farmacêutico',
      'Auxiliar de Farmácia',
      'Técnico de Farmácia',
      'Auxiliar de Almoxarifado',
      'Auxiliar de Recebimento',
      'Jovem Aprendiz',
      'Enfermeiro',
      'Técnico de Enfermagem',
      'Auxiliar de Enfermagem',
      'Médico',
      'Maqueiro',
      'Técnico de Radiologia',
      'Biomédico',
      'Fisioterapeuta',
      'Nutricionista',
      'Psicólogo',
      'Recepcionista',
      'Auxiliar Administrativo',
      'Auxiliar de Higienização',
    ])
  );

  for (const r of allKnownRoles) {
    const rClean = r.toLowerCase();
    if (lowerJoined.includes(rClean)) {
      roleHint = r;
      break;
    }
  }
  if (!roleHint) {
    if (/\balmox/i.test(joined)) roleHint = 'Auxiliar de Almoxarifado';
    else if (/\brecebim/i.test(joined)) roleHint = 'Auxiliar de Recebimento';
    else if (/\baprendiz\b/i.test(joined)) roleHint = 'Jovem Aprendiz';
    else if (/\bfarm/i.test(joined) && /\baux/i.test(joined)) roleHint = 'Auxiliar de Farmácia';
    else if (/\bfarm/i.test(joined)) roleHint = 'Farmacêutico';
    else if (/\bt[eé]c.*enf/i.test(joined) || /\bte\b/i.test(joined))
      roleHint = 'Técnico de Enfermagem';
    else if (/\baux.*enf/i.test(joined)) roleHint = 'Auxiliar de Enfermagem';
    else if (/\benf/i.test(joined)) roleHint = 'Enfermeiro';
    else if (/\bm[eé]dic/i.test(joined)) roleHint = 'Médico';
    else if (/\brecep/i.test(joined)) roleHint = 'Recepcionista';
    else if (/\badm/i.test(joined)) roleHint = 'Auxiliar Administrativo';
    else if (/\bhigien/i.test(joined)) roleHint = 'Auxiliar de Higienização';
    else roleHint = availableRoles[0] || 'Enfermeiro';
  }

  // 2. Detecta Unidade / Setor
  let unitHint = currentSectionUnit || availableUnits[0] || 'Unidade Principal';
  for (const u of availableUnits) {
    if (u && lowerJoined.includes(u.toLowerCase())) {
      unitHint = u;
      break;
    }
  }

  // 3. Detecta Turno e Horário
  let shiftHint: 'Diurno' | 'Noturno' = 'Diurno';
  let workHoursHint = '07:00 às 19:00';

  const hoursMatch = joined.match(/(\d{1,2}[:h]\d{0,2})\s*(?:às|as|a|-|\/)\s*(\d{1,2}[:h]\d{0,2})/i);
  if (hoursMatch) {
    const normalizeHour = (h: string) => {
      const clean = h.toLowerCase().replace('h', ':');
      const [hh, mm] = clean.split(':');
      return `${hh.padStart(2, '0')}:${(mm || '00').padStart(2, '0')}`;
    };
    const startH = normalizeHour(hoursMatch[1]);
    const endH = normalizeHour(hoursMatch[2]);
    workHoursHint = `${startH} às ${endH}`;
    if (startH.startsWith('18') || startH.startsWith('19') || startH.startsWith('20') || startH.startsWith('21') || startH.startsWith('22')) {
      shiftHint = 'Noturno';
    }
  } else if (/\bnoturno\b|\bnoite\b|\b19:00\b|\b19h\b|\bsn\b/i.test(joined)) {
    shiftHint = 'Noturno';
    workHoursHint = '19:00 às 07:00';
  }

  // 4. Analisa células de dias (D, N, F, SD, SN, M, T) na linha para inferir regime 12x36 ímpar/par, 5x2 ou 6x1
  let scheduleRegimeHint: '12x36_ODD' | '12x36_EVEN' | '5x2' | '6x1' = '12x36_ODD';
  if (/12\s*x\s*36.*par|\bpares\b|\bdia\s+par/i.test(joined)) {
    scheduleRegimeHint = '12x36_EVEN';
  } else if (/12\s*x\s*36.*[ií]mpar|\b[ií]mpares\b|\bdia\s+[ií]mpar/i.test(joined)) {
    scheduleRegimeHint = '12x36_ODD';
  } else if (/5\s*x\s*2|seg.*sex|administrativo|diarista/i.test(joined)) {
    scheduleRegimeHint = '5x2';
    if (!hoursMatch && shiftHint === 'Diurno') workHoursHint = '08:00 às 17:00';
  } else if (/6\s*x\s*1/i.test(joined)) {
    scheduleRegimeHint = '6x1';
  } else {
    // Verifica códigos curtos de plantão (D, N, F, P, SD, SN, M, T) ao longo das colunas da linha
    const shiftCodes: { index: number; code: string }[] = [];
    cells.forEach((c, idx) => {
      const upper = c.trim().toUpperCase();
      if (['D', 'N', 'F', 'SD', 'SN', 'M', 'T', 'P', '12'].includes(upper)) {
        shiftCodes.push({ index: idx, code: upper });
      }
    });
    if (shiftCodes.length >= 4) {
      const nCount = shiftCodes.filter((s) => s.code === 'N' || s.code === 'SN').length;
      const dCount = shiftCodes.filter((s) => s.code === 'D' || s.code === 'SD' || s.code === 'M' || s.code === 'T').length;
      if (nCount > dCount) {
        shiftHint = 'Noturno';
        if (!hoursMatch) workHoursHint = '19:00 às 07:00';
      }
      // Se primeiro dia de código for F (folga no dia 1) e segundo for D/N (trabalha no dia 2), é 12x36 Par!
      if (shiftCodes[0].code === 'F' && shiftCodes[1] && shiftCodes[1].code !== 'F') {
        scheduleRegimeHint = '12x36_EVEN';
      }
    }
  }

  // 5. Detecta Matrícula / Registro (COREN, CRF, CRM, MAT)
  let registrationNumber = '';
  const regMatch = joined.match(/\b((?:COREN|CRF|CRM|MAT|REG)[-\s:/]*[A-Z0-9.-]{3,15})\b/i);
  if (regMatch) {
    registrationNumber = regMatch[1].trim();
  }

  return {
    roleHint,
    unitHint,
    shiftHint,
    workHoursHint,
    scheduleRegimeHint,
    registrationNumber,
    notes: '',
  };
}

/**
 * Extrator determinístico direto de Planilhas Excel (.xlsx/.xls/.ods/.csv), Word (.docx) e Texto.
 * Garante funcionamento instantâneo e à prova de falhas mesmo se a API Gemini estiver com erro 503.
 */
function extractEmployeesDeterministically(
  fileBuffer: Buffer,
  extractedText: string,
  availableUnits: string[],
  availableRoles: string[]
): ExtractedEmployeeItem[] {
  const results: ExtractedEmployeeItem[] = [];
  const seenNames = new Set<string>();

  const addCandidate = (nameRaw: string, attrs: Omit<ExtractedEmployeeItem, 'name'>) => {
    const cleanName = toTitleCasePtBr(
      nameRaw
        .replace(/^\d+[\s.\-)]+/, '')
        .replace(/\([^)]*\)/g, '')
        .trim()
    );
    const key = cleanName.toLowerCase();
    if (!cleanName || cleanName.length < 3 || seenNames.has(key)) return;
    if (!isLikelyPersonName(cleanName)) return;

    seenNames.add(key);
    results.push({
      name: cleanName,
      ...attrs,
    });
  };

  // 1. Tenta ler diretamente as células estruturadas via XLSX (para .xlsx, .xls, .ods, .csv)
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: '',
        blankrows: false,
      });

      let nameColIdx = -1;
      let currentSectionUnit =
        availableUnits.find((u) => sheetName.toLowerCase().includes(u.toLowerCase())) || '';
      let currentSectionRole = '';

      for (const rawRow of rows) {
        if (!Array.isArray(rawRow)) continue;
        const cells = rawRow.map((c) => String(c ?? '').trim());
        const nonEmptyCells = cells.filter(Boolean);
        if (nonEmptyCells.length === 0) continue;

        // Verifica se é uma linha de cabeçalho que declara a coluna "Nome" / "Colaborador" / "Funcionário"
        const detectedHeaderIdx = cells.findIndex((c) =>
          /^(nome|colaborador|colaboradores|funcion[aá]rio|funcion[aá]rios|profissional|servidor|plantonista)$/i.test(
            c.trim()
          )
        );
        if (detectedHeaderIdx >= 0) {
          nameColIdx = detectedHeaderIdx;
          continue;
        }

        // Verifica se é uma linha de título de seção (apenas 1 célula preenchida mencionando setor ou cargo)
        if (nonEmptyCells.length === 1) {
          const singleVal = nonEmptyCells[0];
          const matchedUnit = availableUnits.find((u) =>
            singleVal.toLowerCase().includes(u.toLowerCase())
          );
          if (matchedUnit) {
            currentSectionUnit = matchedUnit;
          }
          // Se a única célula da linha for um nome de pessoa válido (ex: lista simples de 1 coluna!), adiciona!
          if (isLikelyPersonName(singleVal)) {
            addCandidate(
              singleVal,
              inferAttributesFromRowCells(
                cells,
                availableUnits,
                availableRoles,
                currentSectionUnit,
                currentSectionRole
              )
            );
          }
          continue;
        }

        // Se já sabemos qual é a coluna de nome
        if (nameColIdx >= 0 && cells[nameColIdx] && isLikelyPersonName(cells[nameColIdx])) {
          const nameVal = cells[nameColIdx];
          const otherCells = cells.filter((_, idx) => idx !== nameColIdx);
          addCandidate(
            nameVal,
            inferAttributesFromRowCells(
              otherCells,
              availableUnits,
              availableRoles,
              currentSectionUnit,
              currentSectionRole
            )
          );
          continue;
        }

        // Caso a planilha não tenha cabeçalho explícito "Nome", procura a primeira célula nas 4 primeiras colunas que pareça um nome de pessoa
        for (let col = 0; col < Math.min(5, cells.length); col++) {
          const candidateCell = cells[col];
          if (candidateCell && isLikelyPersonName(candidateCell)) {
            const otherCells = cells.filter((_, idx) => idx !== col);
            addCandidate(
              candidateCell,
              inferAttributesFromRowCells(
                otherCells,
                availableUnits,
                availableRoles,
                currentSectionUnit,
                currentSectionRole
              )
            );
            break;
          }
        }
      }
    }
  } catch {
    // Segue para análise de linhas de texto
  }

  if (results.length > 0) {
    return results;
  }

  // 2. Analisa texto extraído linha por linha (para Word .docx, .txt, .csv ou texto de PDF)
  const lines = (extractedText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('===')) continue;
    // Divide por separadores comuns: ponto-e-vírgula, vírgula, tab, pipe ou " - "
    const parts = line
      .split(/[;\t|]+|\s+-\s+|,/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length === 0) continue;

    for (let i = 0; i < Math.min(3, parts.length); i++) {
      if (isLikelyPersonName(parts[i])) {
        const otherParts = parts.filter((_, idx) => idx !== i);
        addCandidate(
          parts[i],
          inferAttributesFromRowCells(otherParts, availableUnits, availableRoles, '', '')
        );
        break;
      }
    }
  }

  return results;
}

// Extrai texto estruturado de qualquer arquivo (Excel .xlsx/.xls/.ods/.csv, Word .docx/.doc, TXT, etc.)
async function extractTextOrInlinePart(
  fileBuffer: Buffer,
  fileName: string,
  declaredMime: string
): Promise<{
  mode: 'INLINE_MEDIA' | 'EXTRACTED_TEXT';
  inlineMimeType?: string;
  extractedText?: string;
}> {
  const lowerName = (fileName || '').toLowerCase();
  const lowerMime = (declaredMime || '').toLowerCase();

  // 1. Verifica se é PDF real (assinatura %PDF- ou extensão/mime PDF)
  const isPdfHeader =
    fileBuffer.length > 4 && fileBuffer.subarray(0, 4).toString('ascii') === '%PDF';
  if (isPdfHeader || lowerName.endsWith('.pdf') || lowerMime === 'application/pdf') {
    // Também extrai strings entre parênteses do PDF caso precisemos de fallback contra 503
    const rawAscii = fileBuffer.toString('latin1');
    const pdfTextMatches = Array.from(rawAscii.matchAll(/\(([^()]{3,120})\)\s*Tj/g)).map(
      (m) => m[1]
    );
    return {
      mode: 'INLINE_MEDIA',
      inlineMimeType: 'application/pdf',
      extractedText: pdfTextMatches.join('\n'),
    };
  }

  // 2. Verifica se é imagem suportada nativamente pelo Gemini inlineData
  const supportedImageMimes = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
    'image/heif',
  ];
  if (supportedImageMimes.includes(lowerMime)) {
    return {
      mode: 'INLINE_MEDIA',
      inlineMimeType: lowerMime,
    };
  }
  if (lowerName.endsWith('.png')) return { mode: 'INLINE_MEDIA', inlineMimeType: 'image/png' };
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    return { mode: 'INLINE_MEDIA', inlineMimeType: 'image/jpeg' };
  }
  if (lowerName.endsWith('.webp')) return { mode: 'INLINE_MEDIA', inlineMimeType: 'image/webp' };

  // 3. Verifica se é Word (.docx / .doc)
  const isWord =
    lowerName.endsWith('.docx') ||
    lowerName.endsWith('.doc') ||
    lowerMime.includes('wordprocessingml') ||
    lowerMime.includes('msword');

  if (isWord) {
    try {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      if (result.value && result.value.trim().length > 0) {
        return {
          mode: 'EXTRACTED_TEXT',
          extractedText: result.value.trim(),
        };
      }
    } catch {
      // Continua para tentativa com XLSX/texto
    }
  }

  // 4. Verifica se é Planilha Excel (.xlsx, .xls, .ods, .csv, .tsv)
  const isSpreadsheet =
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.ods') ||
    lowerName.endsWith('.csv') ||
    lowerName.endsWith('.tsv') ||
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('excel') ||
    lowerMime.includes('csv');

  if (isSpreadsheet) {
    try {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetsText: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv && csv.trim()) {
          sheetsText.push(`=== Planilha/Aba: ${sheetName} ===\n${csv.trim()}`);
        }
      }
      if (sheetsText.length > 0) {
        return {
          mode: 'EXTRACTED_TEXT',
          extractedText: sheetsText.join('\n\n'),
        };
      }
    } catch (e) {
      console.warn('Aviso ao ler planilha via XLSX:', e);
    }
  }

  // 5. Tentativa curinga para qualquer outro arquivo
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    if (workbook.SheetNames.length > 0) {
      const sheetsText = workbook.SheetNames.map((name) => {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
        return csv.trim() ? `=== Aba: ${name} ===\n${csv.trim()}` : '';
      }).filter(Boolean);
      if (sheetsText.length > 0) {
        return {
          mode: 'EXTRACTED_TEXT',
          extractedText: sheetsText.join('\n\n'),
        };
      }
    }
  } catch {
    // Continua
  }

  try {
    const docResult = await mammoth.extractRawText({ buffer: fileBuffer });
    if (docResult.value && docResult.value.trim().length > 0) {
      return {
        mode: 'EXTRACTED_TEXT',
        extractedText: docResult.value.trim(),
      };
    }
  } catch {
    // Continua
  }

  const rawUtf8 = fileBuffer
    .toString('utf-8')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ' ')
    .trim();

  return {
    mode: 'EXTRACTED_TEXT',
    extractedText: rawUtf8.slice(0, 120000),
  };
}

// Chama o Gemini com retry e fallback automático de modelos para evitar falhas 503 UNAVAILABLE
async function callGeminiWithFallback(
  ai: GoogleGenAI,
  contentParts: unknown[],
  responseSchema: unknown
): Promise<ExtractedEmployeeItem[]> {
  const modelsToTry = ['gemini-4-hydrogen', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastError: unknown = null;

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: contentParts as never,
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: responseSchema as never,
          },
        });

        const rawText = (response.text ?? '[]').trim();
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed)) {
          return parsed as ExtractedEmployeeItem[];
        }
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isTransient =
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('429') ||
          msg.includes('high demand') ||
          msg.includes('overloaded');

        if (isTransient && attempt === 1) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error('Serviço de análise temporariamente indisponível.');
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '30mb' }));

  app.get('/apple-touch-icon.png', (_req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(icon180);
  });

  app.get('/pwa-192x192.png', (_req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(icon192);
  });

  app.get(['/pwa-512x512.png', '/pwa-maskable-512x512.png'], (_req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(icon512);
  });

  // Endpoint universal de leitura inteligente de arquivos (PDF, Word, Excel, CSV, TXT, Imagem)
  app.post('/api/extract-pdf', async (req, res) => {
    try {
      const { base64Pdf, fileName, mimeType, availableUnits, availableRoles } = req.body as {
        base64Pdf?: string;
        fileName?: string;
        mimeType?: string;
        availableUnits?: string[];
        availableRoles?: string[];
      };

      if (!base64Pdf) {
        res.status(400).json({ error: 'Arquivo não fornecido para leitura.' });
        return;
      }

      const dataUrlMatch = base64Pdf.match(/^data:([^;]+);base64,(.+)$/s);
      const detectedMime = dataUrlMatch ? dataUrlMatch[1].trim() : mimeType || '';
      const cleanBase64 = (
        dataUrlMatch ? dataUrlMatch[2] : base64Pdf.replace(/^data:.*?,/, '')
      ).trim();

      const fileBuffer = Buffer.from(cleanBase64, 'base64');
      const safeUnits = Array.isArray(availableUnits) ? availableUnits : [];
      const safeRoles = Array.isArray(availableRoles) ? availableRoles : [];

      const parsedSource = await extractTextOrInlinePart(
        fileBuffer,
        fileName || '',
        detectedMime
      );

      // Extração local determinística de alta precisão (Excel / Word / CSV / Texto)
      const deterministicEmployees = extractEmployeesDeterministically(
        fileBuffer,
        parsedSource.extractedText || '',
        safeUnits,
        safeRoles
      );

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        if (deterministicEmployees.length > 0) {
          res.json({
            success: true,
            employees: deterministicEmployees,
          });
          return;
        }
        res.status(500).json({
          error:
            'Chave GEMINI_API_KEY não configurada no servidor. Verifique o painel Settings > Secrets.',
        });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const rolesContext =
        safeRoles.length > 0
          ? safeRoles.join(', ')
          : 'Farmacêutico, Auxiliar de Farmácia, Enfermeiro, Técnico de Enfermagem, Auxiliar de Enfermagem, Médico, Maqueiro, Técnico de Radiologia, Biomédico, Fisioterapeuta, Recepcionista, Auxiliar Administrativo, Auxiliar de Higienização';

      const unitsContext =
        safeUnits.length > 0
          ? safeUnits.join(', ')
          : 'Unidade Principal, Pronto-Socorro, Centro Cirúrgico, UTI';

      const promptText = `Você é um especialista em leitura de escalas hospitalares, planilhas Excel, documentos Word, PDFs, folhas de ponto e quadros de funcionários.
Analise o arquivo enviado (${fileName || 'documento'}) e extraia TODOS os nomes de colaboradores/funcionários encontrados.
Para cada colaborador encontrado, identifique pistas no documento sobre:
- name: Nome completo do colaborador (em formato Title Case limpo). Não inclua cabeçalhos de tabela, nomes de meses ou palavras genéricas como "Total", "Assinatura" ou "Unidade".
- roleHint: Função ou cargo hospitalar provável (prefira um destes se aplicável: ${rolesContext}).
- unitHint: Unidade ou setor hospitalar mencionado (ex: ${unitsContext}).
- shiftHint: Turno provável ("Diurno" ou "Noturno").
- workHoursHint: Horário provável (ex: "07:00 às 19:00", "19:00 às 07:00", "08:00 às 17:00", "07:00 às 13:00").
- scheduleRegimeHint: Regime de escala provável ("12x36_ODD" para 12x36 dias ímpares, "12x36_EVEN" para 12x36 dias pares, "5x2" para segunda a sexta, "6x1" para 6x1).
- registrationNumber: Matrícula, COREN, CRF, CRM ou registro se constar no arquivo (ou string vazia).
- notes: Breve observação encontrada no documento (ex: "Férias", "Plantonista noturno", etc.).

Se o arquivo for uma planilha ou tabela de escala, extraia cada profissional listado como um item.`;

      const responseSchema = {
        type: Type.ARRAY,
        description:
          'Lista de colaboradores extraídos do arquivo de escala hospitalar (PDF, Excel, Word ou Imagem).',
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Nome completo do colaborador.',
            },
            roleHint: {
              type: Type.STRING,
              description: 'Cargo ou função hospitalar identificada.',
            },
            unitHint: {
              type: Type.STRING,
              description: 'Unidade ou setor identificado no documento.',
            },
            shiftHint: {
              type: Type.STRING,
              description: 'Turno identificado: Diurno ou Noturno.',
            },
            workHoursHint: {
              type: Type.STRING,
              description: 'Horário de trabalho padrão identificado.',
            },
            scheduleRegimeHint: {
              type: Type.STRING,
              description: 'Código do regime: 12x36_ODD, 12x36_EVEN, 5x2 ou 6x1.',
            },
            registrationNumber: {
              type: Type.STRING,
              description: 'Conselho de classe (CRF/COREN/CRM) ou matrícula.',
            },
            notes: {
              type: Type.STRING,
              description: 'Observações adicionais extraídas do documento.',
            },
          },
          required: [
            'name',
            'roleHint',
            'unitHint',
            'shiftHint',
            'workHoursHint',
            'scheduleRegimeHint',
          ],
        },
      };

      const contentParts =
        parsedSource.mode === 'INLINE_MEDIA' && parsedSource.inlineMimeType
          ? [
              {
                inlineData: {
                  mimeType: parsedSource.inlineMimeType,
                  data: cleanBase64,
                },
              },
              {
                text: promptText,
              },
            ]
          : [
              {
                text: `${promptText}\n\n=== CONTEÚDO EXTRAÍDO DO ARQUIVO (${
                  fileName || 'escala'
                }) ===\n${(parsedSource.extractedText || '').slice(0, 90000)}`,
              },
            ];

      try {
        const aiEmployees = await callGeminiWithFallback(ai, contentParts, responseSchema);
        if (Array.isArray(aiEmployees) && aiEmployees.length > 0) {
          res.json({
            success: true,
            employees: aiEmployees,
          });
          return;
        }
      } catch (aiErr) {
        console.warn(
          'Aviso: Modelo IA indisponível temporariamente, utilizando motor nativo de extração de planilhas/documentos:',
          aiErr instanceof Error ? aiErr.message : aiErr
        );
        // Se o motor nativo extraiu os colaboradores da planilha/documento, retorna com sucesso sem exibir erro 503!
        if (deterministicEmployees.length > 0) {
          res.json({
            success: true,
            employees: deterministicEmployees,
          });
          return;
        }
        throw aiErr;
      }

      // Se a IA retornou vazio mas o motor nativo encontrou colaboradores na planilha/documento
      if (deterministicEmployees.length > 0) {
        res.json({
          success: true,
          employees: deterministicEmployees,
        });
        return;
      }

      res.json({
        success: true,
        employees: [],
      });
    } catch (error: unknown) {
      const errMessage =
        error instanceof Error ? error.message : 'Erro desconhecido ao processar arquivo.';
      console.error('Erro na extração de arquivo:', errMessage);
      res.status(500).json({
        error: `Não foi possível ler os nomes automaticamente deste arquivo (${
          req.body?.fileName || 'documento'
        }). Verifique se o arquivo possui nomes legíveis ou tente novamente.`,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EscalaPro Server rodando em http://0.0.0.0:${PORT}`);
  });
}

startServer();
