import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLOUD_STORE_PATH = path.join(__dirname, '.cloud-workspaces.json');

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
  currentSectionRole: string,
  firstScheduleDayNumber = 16
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
    else roleHint = availableRoles[0] || 'Auxiliar de Farmácia';
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
  const firstDayIsEven = firstScheduleDayNumber % 2 === 0;
  let scheduleRegimeHint: '12x36_ODD' | '12x36_EVEN' | '5x2' | '6x1' = firstDayIsEven
    ? '12x36_EVEN'
    : '12x36_ODD';

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
      // Considera se a escala começa no dia 16 (par, padrão quinzenal 16 a 15) ou no dia 1 (ímpar)
      if (shiftCodes[0].code === 'F' && shiftCodes[1] && shiftCodes[1].code !== 'F') {
        scheduleRegimeHint = firstDayIsEven ? '12x36_ODD' : '12x36_EVEN';
      } else if (shiftCodes[0].code !== 'F' && shiftCodes[1]?.code === 'F') {
        scheduleRegimeHint = firstDayIsEven ? '12x36_EVEN' : '12x36_ODD';
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
      let firstScheduleDayNumber = 16; // Padrão quinzenal: começa no dia 16 (2ª quinzena do mês inicial, ex: 16/11 a 30/11 e 01/12 a 15/12)
      let currentSectionUnit =
        availableUnits.find((u) => sheetName.toLowerCase().includes(u.toLowerCase())) || '';
      let currentSectionRole = '';

      for (const rawRow of rows) {
        if (!Array.isArray(rawRow)) continue;
        const cells = rawRow.map((c) => String(c ?? '').trim());
        const nonEmptyCells = cells.filter(Boolean);
        if (nonEmptyCells.length === 0) continue;

        // Detecta se a linha contém a sequência de dias do cabeçalho da escala (ex: 16, 17, 18... ou 01, 02, 03...)
        const dayHeaderNums: number[] = [];
        for (const c of cells) {
          const m = c.match(/^(?:dia\s*)?(\d{1,2})(?:\/\d{1,2})?$/i);
          if (m) {
            const n = Number(m[1]);
            if (n >= 1 && n <= 31) dayHeaderNums.push(n);
          }
        }
        if (dayHeaderNums.length >= 6 && (dayHeaderNums[0] === 16 || dayHeaderNums[0] === 1)) {
          firstScheduleDayNumber = dayHeaderNums[0];
        }

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
                currentSectionRole,
                firstScheduleDayNumber
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
              currentSectionRole,
              firstScheduleDayNumber
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
                currentSectionRole,
                firstScheduleDayNumber
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

interface ExtractedHourBankItem {
  name: string;
  hoursBalance: number;
  formattedOriginal?: string;
  unitHint?: string;
  roleHint?: string;
  registrationNumber?: string;
  notes?: string;
}

function parseHourBalanceString(rawVal: string): { parsed: boolean; hours: number; original: string } {
  const cleaned = String(rawVal || '').trim();
  if (!cleaned) return { parsed: false, hours: 0, original: '' };

  // Evita confundir horários de expediente (ex: "07:00 às 19:00") ou datas ("12/11/2026") ou regimes ("12x36", "5x2", "6x1") com saldo de banco de horas
  if (
    /\d{1,2}:\d{2}\s*(?:as|às|a|-)\s*\d{1,2}:\d{2}/i.test(cleaned) ||
    /\b(?:12\s*x\s*36|5\s*x\s*2|6\s*x\s*1)\b/i.test(cleaned) ||
    /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(cleaned) ||
    /^\d{4}-\d{2}-\d{2}$/.test(cleaned)
  ) {
    return { parsed: false, hours: 0, original: '' };
  }

  const lower = cleaned.toLowerCase();
  const isNegativeContext =
    lower.includes('debito') ||
    lower.includes('débito') ||
    lower.includes('negativ') ||
    lower.includes('falta') ||
    lower.includes('devendo') ||
    cleaned.startsWith('-') ||
    /^\(.*\)$/.test(cleaned);

  // Formato HH:MM (ex: "+12:30", "-04:15", "08:30h", "14:00")
  const hhmmMatch = cleaned.match(/([+-])?\s*(\d{1,3}):(\d{2})(?:\s*h(?:oras?)?)?\b/i);
  if (hhmmMatch) {
    const sign = hhmmMatch[1] === '-' || isNegativeContext ? -1 : 1;
    const h = Number(hhmmMatch[2]) || 0;
    const m = Number(hhmmMatch[3]) || 0;
    if (h <= 400 && m < 60) {
      const total = Math.round((h + m / 60) * 100) / 100;
      return { parsed: true, hours: sign * total, original: cleaned };
    }
  }

  // Formato explícito com "h" ou "horas" ou sinal +/- (ex: "+12h", "-6,5h", "+8 horas", "12.5h")
  const explicitHoursMatch = cleaned.match(
    /([+-])\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:h(?:oras?|rs?)?)?|\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:h(?:oras?|rs?)|bh|saldo)\b/i
  );
  if (explicitHoursMatch) {
    const numStr = (explicitHoursMatch[2] || explicitHoursMatch[3] || '0').replace(',', '.');
    const val = Number(numStr);
    if (!Number.isNaN(val) && val <= 400) {
      const sign = explicitHoursMatch[1] === '-' || isNegativeContext ? -1 : 1;
      return { parsed: true, hours: sign * val, original: cleaned };
    }
  }

  // Número puro em coluna de saldo (ex: "12", "-4,5", "8.5", "0")
  const pureNumMatch = cleaned.match(/^([+-])?\s*(\d{1,3}(?:[.,]\d{1,2})?)$/);
  if (pureNumMatch) {
    const val = Number(pureNumMatch[2].replace(',', '.'));
    if (!Number.isNaN(val) && val <= 300) {
      const sign = pureNumMatch[1] === '-' || isNegativeContext ? -1 : 1;
      return { parsed: true, hours: sign * val, original: cleaned };
    }
  }

  return { parsed: false, hours: 0, original: '' };
}

function extractHourBankDeterministically(
  fileBuffer: Buffer,
  extractedText: string,
  availableUnits: string[],
  availableRoles: string[]
): ExtractedHourBankItem[] {
  const results: ExtractedHourBankItem[] = [];
  const seenNames = new Set<string>();

  const addEntry = (
    rawName: string,
    hoursBalance: number,
    formattedOriginal: string,
    otherCells: string[]
  ) => {
    const cleanName = toTitleCasePtBr(
      rawName
        .replace(/^\d+[\s.)-]+/, '')
        .replace(/\([^)]*\)/g, '')
        .trim()
    );
    const key = cleanName.toLowerCase();
    if (!cleanName || seenNames.has(key)) return;
    seenNames.add(key);

    const attrs = inferAttributesFromRowCells(
      otherCells,
      availableUnits,
      availableRoles,
      '',
      ''
    );

    results.push({
      name: cleanName,
      hoursBalance,
      formattedOriginal:
        formattedOriginal || `${hoursBalance >= 0 ? '+' : ''}${hoursBalance}h`,
      unitHint: attrs.unitHint,
      roleHint: attrs.roleHint,
      registrationNumber: attrs.registrationNumber,
      notes: attrs.notes || 'Importado via planilha/documento de Banco de Horas',
    });
  };

  // 1. Tenta ler estruturadamente das abas do Excel/CSV via XLSX
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json< unknown[] >(sheet, {
        header: 1,
        defval: '',
        blankrows: false,
      });

      let nameColIdx = -1;
      let balanceColIdx = -1;
      let positiveColIdx = -1;
      let negativeColIdx = -1;

      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const cells = row.map((c) => String(c ?? '').trim());
        const nonEmpty = cells.filter(Boolean);
        if (nonEmpty.length === 0) continue;

        // Detecta cabeçalhos de Nome e de Saldo / Banco de Horas / Extras / Débito
        cells.forEach((cellVal, idx) => {
          const norm = normalizeServerKey(cellVal);
          if (
            norm === 'nome' ||
            norm === 'colaborador' ||
            norm === 'funcionario' ||
            norm === 'profissional' ||
            norm.startsWith('nome do ') ||
            norm.includes('nome completo')
          ) {
            nameColIdx = idx;
          }
          if (
            norm.includes('saldo') ||
            norm.includes('banco de horas') ||
            norm === 'bh' ||
            norm === 'horas' ||
            norm.includes('total de horas') ||
            norm.includes('hora extra') ||
            norm.includes('horas extras')
          ) {
            balanceColIdx = idx;
          }
          if (norm.includes('credito') || norm.includes('positiv')) {
            positiveColIdx = idx;
          }
          if (norm.includes('debito') || norm.includes('negativ')) {
            negativeColIdx = idx;
          }
        });

        let foundName = '';
        let foundNameIdx = -1;

        if (nameColIdx >= 0 && cells[nameColIdx] && isLikelyPersonName(cells[nameColIdx])) {
          foundName = cells[nameColIdx];
          foundNameIdx = nameColIdx;
        } else {
          for (let col = 0; col < Math.min(5, cells.length); col++) {
            if (cells[col] && isLikelyPersonName(cells[col])) {
              foundName = cells[col];
              foundNameIdx = col;
              break;
            }
          }
        }

        if (!foundName) continue;

        let hoursVal = 0;
        let origStr = '';
        let foundBalance = false;

        if (balanceColIdx >= 0 && balanceColIdx !== foundNameIdx && cells[balanceColIdx]) {
          const p = parseHourBalanceString(cells[balanceColIdx]);
          if (p.parsed) {
            hoursVal = p.hours;
            origStr = p.original;
            foundBalance = true;
          }
        }

        if (!foundBalance && (positiveColIdx >= 0 || negativeColIdx >= 0)) {
          const posP =
            positiveColIdx >= 0 ? parseHourBalanceString(cells[positiveColIdx] || '') : null;
          const negP =
            negativeColIdx >= 0 ? parseHourBalanceString(cells[negativeColIdx] || '') : null;
          if (posP?.parsed || negP?.parsed) {
            const posH = posP?.parsed ? Math.abs(posP.hours) : 0;
            const negH = negP?.parsed ? Math.abs(negP.hours) : 0;
            hoursVal = Math.round((posH - negH) * 100) / 100;
            origStr = `${hoursVal >= 0 ? '+' : ''}${hoursVal}h`;
            foundBalance = true;
          }
        }

        if (!foundBalance) {
          // Procura em qualquer outra célula da linha um valor de horas
          for (let idx = 0; idx < cells.length; idx++) {
            if (idx === foundNameIdx || !cells[idx]) continue;
            // Ignora números pequenos isolados que sejam apenas número de ordem na coluna 0 (ex: 1, 2, 3...)
            if (idx === 0 && foundNameIdx > 0 && /^\d{1,2}$/.test(cells[idx])) continue;
            const p = parseHourBalanceString(cells[idx]);
            if (p.parsed) {
              hoursVal = p.hours;
              origStr = p.original;
              foundBalance = true;
              break;
            }
          }
        }

        const otherCells = cells.filter((_, idx) => idx !== foundNameIdx);
        addEntry(foundName, hoursVal, origStr, otherCells);
      }
    }
  } catch {
    // Segue para análise de texto
  }

  if (results.length > 0) {
    return results;
  }

  // 2. Analisa texto linha por linha (Word, TXT, CSV ou PDF)
  const lines = (extractedText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('===')) continue;
    const parts = line
      .split(/[;\t|]+|\s+-\s+|,/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length === 0) continue;

    for (let i = 0; i < Math.min(3, parts.length); i++) {
      if (isLikelyPersonName(parts[i])) {
        const otherParts = parts.filter((_, idx) => idx !== i);
        let hoursVal = 0;
        let origStr = '';
        for (const part of otherParts) {
          const p = parseHourBalanceString(part);
          if (p.parsed) {
            hoursVal = p.hours;
            origStr = p.original;
            break;
          }
        }
        addEntry(parts[i], hoursVal, origStr, otherParts);
        break;
      }
    }
  }

  return results;
}

// Chama o Gemini com retry e fallback automático de modelos para evitar falhas 503 UNAVAILABLE
async function callGeminiWithFallback<T = ExtractedEmployeeItem>(
  ai: GoogleGenAI,
  contentParts: unknown[],
  responseSchema: unknown
): Promise<T[]> {
  const modelsToTry = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
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
          return parsed as T[];
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

interface CloudWorkspaceEntry {
  email: string;
  uid: string;
  passwordHash?: string;
  account: Record<string, unknown>;
  state: Record<string, unknown>;
  updatedAt: string;
}

function readCloudStore(): Record<string, CloudWorkspaceEntry> {
  try {
    if (!fs.existsSync(CLOUD_STORE_PATH)) return {};
    const raw = fs.readFileSync(CLOUD_STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCloudStore(store: Record<string, CloudWorkspaceEntry>): void {
  try {
    fs.writeFileSync(CLOUD_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Aviso ao persistir .cloud-workspaces.json:', err);
  }
}

function normalizeServerKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function deduplicateWorkspaceOnServer(rawState: Record<string, unknown>): Record<string, unknown> {
  const rawUnits = Array.isArray(rawState.units)
    ? (rawState.units as Array<Record<string, unknown>>)
    : [];
  const rawEmployees = Array.isArray(rawState.employees)
    ? (rawState.employees as Array<Record<string, unknown>>)
    : [];
  const rawSchedules =
    rawState.schedules && typeof rawState.schedules === 'object'
      ? (rawState.schedules as Record<string, Record<string, Record<string, Record<string, unknown>>>>)
      : {};

  // 1. Deduplica Unidades / Setores por nome normalizado
  const unitIdRedirect = new Map<string, string>();
  const canonicalUnitsByName = new Map<string, Record<string, unknown>>();
  const dedupedUnits: Array<Record<string, unknown>> = [];

  for (const unit of rawUnits) {
    if (!unit || !unit.id) continue;
    const uId = String(unit.id);
    const trimmedName = String(unit.name || '').trim() || 'Unidade Principal';
    const key = normalizeServerKey(trimmedName);

    const existing = canonicalUnitsByName.get(key);
    if (!existing) {
      const cleanUnit = { ...unit, name: trimmedName };
      canonicalUnitsByName.set(key, cleanUnit);
      dedupedUnits.push(cleanUnit);
      unitIdRedirect.set(uId, uId);
    } else {
      unitIdRedirect.set(uId, String(existing.id));
    }
  }

  let finalUnits = dedupedUnits;
  if (finalUnits.length > 1) {
    const nonPlaceholder = finalUnits.filter(
      (u) =>
        !(
          String(u.id) === 'unit-default-1' &&
          normalizeServerKey(u.name) === 'unidade principal'
        )
    );
    if (nonPlaceholder.length > 0) {
      const fallbackId = String(nonPlaceholder[0].id);
      for (const u of finalUnits) {
        if (
          String(u.id) === 'unit-default-1' &&
          normalizeServerKey(u.name) === 'unidade principal'
        ) {
          unitIdRedirect.set(String(u.id), fallbackId);
        }
      }
      finalUnits = nonPlaceholder;
    }
  }

  const validUnitIds = new Set(finalUnits.map((u) => String(u.id)));
  const defaultUnitId = String(finalUnits[0]?.id || 'unit-default-1');

  const resolveUnitId = (uid: unknown): string => {
    const s = String(uid || '');
    const mapped = unitIdRedirect.get(s) || s;
    return validUnitIds.has(mapped) ? mapped : defaultUnitId;
  };

  // 2. Deduplica Colaboradores por nome normalizado
  const empIdRedirect = new Map<string, string>();
  const canonicalEmpByName = new Map<string, Record<string, unknown>>();
  const dedupedEmployees: Array<Record<string, unknown>> = [];

  for (const emp of rawEmployees) {
    if (!emp || !emp.id) continue;
    const eId = String(emp.id);
    const remappedEmp: Record<string, unknown> = {
      ...emp,
      name: String(emp.name || '').trim(),
      unitId: resolveUnitId(emp.unitId),
    };
    const nameKey = normalizeServerKey(remappedEmp.name);
    if (!nameKey) {
      dedupedEmployees.push(remappedEmp);
      empIdRedirect.set(eId, eId);
      continue;
    }

    const existing = canonicalEmpByName.get(nameKey);
    if (!existing) {
      canonicalEmpByName.set(nameKey, remappedEmp);
      dedupedEmployees.push(remappedEmp);
      empIdRedirect.set(eId, eId);
    } else {
      // Se um está ativo e outro inativo, preserva o status mais recente ou mescla se ambos ativos
      const existingId = String(existing.id);
      empIdRedirect.set(eId, existingId);

      const histMap = new Map<string, Record<string, unknown>>();
      const h1 = Array.isArray(existing.history)
        ? (existing.history as Array<Record<string, unknown>>)
        : [];
      const h2 = Array.isArray(remappedEmp.history)
        ? (remappedEmp.history as Array<Record<string, unknown>>)
        : [];
      for (const h of [...h1, ...h2]) {
        if (!h) continue;
        const sig = `${String(h.type || '')}_${String(h.startDate || '')}_${String(h.daysCount || '')}`;
        if (!histMap.has(sig)) histMap.set(sig, h);
      }

      const existingCustomUnit =
        String(existing.unitId) !== 'unit-default-1' &&
        normalizeServerKey(
          finalUnits.find((u) => String(u.id) === String(existing.unitId))?.name
        ) !== 'unidade principal';

      const resolveServerHourBank = (
        priEmp: Record<string, unknown>,
        secEmp: Record<string, unknown>
      ): number => {
        const priBal = Math.round((Number(priEmp.hourBankBalance) || 0) * 100) / 100;
        const secBal = Math.round((Number(secEmp.hourBankBalance) || 0) * 100) / 100;
        if (priBal === secBal) return priBal;
        const getHbTs = (empObj: Record<string, unknown>): number => {
          const hist = Array.isArray(empObj.history)
            ? (empObj.history as Array<Record<string, unknown>>)
            : [];
          let maxTs = 0;
          for (const h of hist) {
            if (!h) continue;
            const t = String(h.type || '');
            const eh = Number(h.extraHours || 0);
            if (t === 'HORA_EXTRA' || t === 'BANCO_HORAS' || t === 'DECLARACAO_HORAS' || eh !== 0) {
              const ts = new Date(String(h.createdAt || h.startDate || 0)).getTime();
              if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;
            }
          }
          return maxTs;
        };
        const priTs = getHbTs(priEmp);
        const secTs = getHbTs(secEmp);
        if (priBal !== 0 && secBal === 0) return secTs > priTs ? 0 : priBal;
        if (priBal === 0 && secBal !== 0) return priTs > secTs ? 0 : secBal;
        return secTs > priTs ? secBal : priBal;
      };

      const mergedEmp: Record<string, unknown> = {
        ...existing,
        ...remappedEmp,
        id: existingId,
        active: Boolean(existing.active && remappedEmp.active),
        unitId: existingCustomUnit ? existing.unitId : remappedEmp.unitId,
        registrationNumber: remappedEmp.registrationNumber || existing.registrationNumber || '',
        avatarBase64: remappedEmp.avatarBase64 || existing.avatarBase64 || '',
        hourBankBalance: resolveServerHourBank(remappedEmp, existing),
        history: Array.from(histMap.values()),
      };
      canonicalEmpByName.set(nameKey, mergedEmp);
      const idx = dedupedEmployees.findIndex((item) => String(item.id) === existingId);
      if (idx !== -1) dedupedEmployees[idx] = mergedEmp;
    }
  }

  // 3. Remapeia Escalas
  const cleanedSchedules: Record<string, Record<string, Record<string, Record<string, unknown>>>> = {};
  for (const [ym, monthData] of Object.entries(rawSchedules)) {
    if (!monthData || typeof monthData !== 'object') continue;
    cleanedSchedules[ym] = {};
    for (const [oldEmpId, daysMap] of Object.entries(monthData)) {
      if (!daysMap || typeof daysMap !== 'object') continue;
      const targetEmpId = empIdRedirect.get(oldEmpId) || oldEmpId;
      if (!cleanedSchedules[ym][targetEmpId]) {
        cleanedSchedules[ym][targetEmpId] = {};
      }
      for (const [dayKey, cell] of Object.entries(daysMap)) {
        if (!cell || typeof cell !== 'object') continue;
        const remappedCell: Record<string, unknown> = {
          ...cell,
          unitOverrideId: cell.unitOverrideId
            ? resolveUnitId(cell.unitOverrideId)
            : undefined,
        };
        const existingCell = cleanedSchedules[ym][targetEmpId][dayKey];
        if (!existingCell) {
          cleanedSchedules[ym][targetEmpId][dayKey] = remappedCell;
        } else {
          const isSpecial = (st: unknown) =>
            st === 'F' || st === 'BH' || st === 'FA' || st === 'AT' || st === 'FE' || st === 'TR';
          if (
            (isSpecial(remappedCell.status) && !isSpecial(existingCell.status)) ||
            remappedCell.unitOverrideId ||
            remappedCell.note
          ) {
            cleanedSchedules[ym][targetEmpId][dayKey] = {
              ...existingCell,
              ...remappedCell,
            };
          }
        }
      }
    }
  }

  return {
    ...rawState,
    units: finalUnits,
    employees: dedupedEmployees,
    schedules: cleanedSchedules,
  };
}

function mergeWorkspacesOnServer(
  existingStateRaw: Record<string, unknown> | undefined,
  incomingStateRaw: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!existingStateRaw || typeof existingStateRaw !== 'object') {
    return deduplicateWorkspaceOnServer(incomingStateRaw || {});
  }
  if (!incomingStateRaw || typeof incomingStateRaw !== 'object') {
    return deduplicateWorkspaceOnServer(existingStateRaw);
  }

  const ex = deduplicateWorkspaceOnServer(existingStateRaw) as {
    manager?: Record<string, unknown>;
    units?: Array<Record<string, unknown>>;
    customRoles?: string[];
    employees?: Array<Record<string, unknown>>;
    schedules?: Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    pushConfig?: Record<string, unknown>;
    lastUpdated?: string;
  };
  const inc = deduplicateWorkspaceOnServer(incomingStateRaw) as typeof ex;

  const rawExTime = new Date(String(ex.lastUpdated || 0)).getTime();
  const rawIncTime = new Date(String(inc.lastUpdated || 0)).getTime();
  const exTime = Number.isFinite(rawExTime) ? rawExTime : 0;
  const incTime = Number.isFinite(rawIncTime) ? rawIncTime : 0;
  const exEmpCount = Array.isArray(ex.employees) ? ex.employees.length : 0;
  const incEmpCount = Array.isArray(inc.employees) ? inc.employees.length : 0;

  // Só aceita o incoming como prioritário se ele estiver populado e for tão recente quanto (ou mais novo que) o servidor
  const preferIncoming =
    exEmpCount > 0 && incEmpCount === 0 && !inc.manager?.onboardingCompleted
      ? false
      : incEmpCount > 0 && exEmpCount === 0
      ? true
      : incTime >= exTime;

  const primaryMgr = (preferIncoming ? inc.manager : ex.manager) || {};
  const secondaryMgr = (preferIncoming ? ex.manager : inc.manager) || {};

  const isPlaceholderHospital = (h: unknown) =>
    !h || String(h).trim() === '' || String(h).trim() === 'Instituição' || String(h).trim() === 'Hospital / Instituição';

  const mergedManager = {
    ...secondaryMgr,
    ...primaryMgr,
    name: String(primaryMgr.name || secondaryMgr.name || ''),
    hospitalName: !isPlaceholderHospital(primaryMgr.hospitalName)
      ? String(primaryMgr.hospitalName)
      : String(secondaryMgr.hospitalName || primaryMgr.hospitalName || ''),
    role: String(primaryMgr.role || secondaryMgr.role || ''),
    sectorName:
      primaryMgr.sectorName && String(primaryMgr.sectorName) !== 'Geral'
        ? String(primaryMgr.sectorName)
        : String(secondaryMgr.sectorName || primaryMgr.sectorName || ''),
    avatarBase64: String(primaryMgr.avatarBase64 || secondaryMgr.avatarBase64 || ''),
    onboardingCompleted: Boolean(
      primaryMgr.onboardingCompleted || secondaryMgr.onboardingCompleted
    ),
  };

  // Unidades: respeita integralmente a lista enviada pelo aparelho mais recente
  const exUnits = Array.isArray(ex.units) ? ex.units : [];
  const incUnits = Array.isArray(inc.units) ? inc.units : [];
  const primaryUnits = preferIncoming ? incUnits : exUnits;
  const secondaryUnits = preferIncoming ? exUnits : incUnits;

  const isOnlyDefaultPlaceholder = (list: Array<Record<string, unknown>>) =>
    list.length === 0 ||
    (list.length === 1 &&
      String(list[0].id) === 'unit-default-1' &&
      normalizeServerKey(list[0].name) === 'unidade principal');

  const mergedUnits =
    !isOnlyDefaultPlaceholder(primaryUnits)
      ? primaryUnits
      : !isOnlyDefaultPlaceholder(secondaryUnits)
      ? secondaryUnits
      : primaryUnits.length > 0
      ? primaryUnits
      : secondaryUnits;

  // Colaboradores: respeita o estado mais recente, mas preserva saldos de Banco de Horas não zerados do outro lado caso não haja registro mais novo zerando
  const exEmps = Array.isArray(ex.employees) ? ex.employees : [];
  const incEmps = Array.isArray(inc.employees) ? inc.employees : [];
  const primaryEmps = preferIncoming ? incEmps : exEmps;
  const secondaryEmps = preferIncoming ? exEmps : incEmps;
  const secById = new Map(secondaryEmps.map((e) => [String(e.id || ''), e]));
  const secByName = new Map(secondaryEmps.map((e) => [normalizeServerKey(e.name), e]));

  const chosenEmployees = primaryEmps.map((emp) => {
    const priBal = Math.round((Number(emp.hourBankBalance) || 0) * 100) / 100;
    if (priBal !== 0) return emp;
    const sibling = secById.get(String(emp.id || '')) || secByName.get(normalizeServerKey(emp.name));
    if (!sibling) return emp;
    const secBal = Math.round((Number(sibling.hourBankBalance) || 0) * 100) / 100;
    if (secBal === 0) return emp;

    const hasNewerPriHbLog =
      Array.isArray(emp.history) &&
      (emp.history as Array<Record<string, unknown>>).some((h) => {
        const t = String(h?.type || '');
        return t === 'HORA_EXTRA' || t === 'BANCO_HORAS' || t === 'DECLARACAO_HORAS';
      });
    if (hasNewerPriHbLog) return emp;

    return {
      ...emp,
      hourBankBalance: secBal,
    };
  });

  // Escalas: respeita o lado mais recente
  const exSched = ex.schedules && typeof ex.schedules === 'object' ? ex.schedules : {};
  const incSched = inc.schedules && typeof inc.schedules === 'object' ? inc.schedules : {};
  const mergedSchedules = preferIncoming
    ? { ...exSched, ...incSched }
    : { ...incSched, ...exSched };

  const customRolesSet = new Set<string>([
    ...(Array.isArray(ex.customRoles) ? ex.customRoles : []),
    ...(Array.isArray(inc.customRoles) ? inc.customRoles : []),
  ]);

  const finalTimestamp = Math.max(exTime, incTime);

  return deduplicateWorkspaceOnServer({
    ...(preferIncoming ? inc : ex),
    manager: mergedManager,
    units: mergedUnits,
    customRoles: Array.from(customRolesSet),
    employees: chosenEmployees,
    schedules: mergedSchedules,
    lastUpdated: new Date(finalTimestamp > 0 ? finalTimestamp : Date.now()).toISOString(),
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '30mb' }));

  // Endpoints de Sincronização em Nuvem por E-mail (unifica Celular, PC 1, PC 2 e qualquer navegador)
  app.post('/api/cloud-sync/push', (req, res) => {
    try {
      const { email, uid, passwordHash, account, state } = req.body as {
        email?: string;
        uid?: string;
        passwordHash?: string;
        account?: Record<string, unknown>;
        state?: Record<string, unknown>;
      };
      const cleanEmail = String(email || account?.email || '')
        .trim()
        .toLowerCase();
      if (!cleanEmail) {
        res.status(400).json({ ok: false, error: 'E-mail obrigatório para sincronização.' });
        return;
      }

      const store = readCloudStore();
      const existing = store[cleanEmail];
      const mergedState = mergeWorkspacesOnServer(existing?.state, state);
      const mgr = (mergedState.manager as Record<string, unknown>) || {};
      const units = Array.isArray(mergedState.units) ? mergedState.units : [];

      const mergedAccount: Record<string, unknown> = {
        ...(existing?.account || {}),
        ...(account || {}),
        uid: String(uid || account?.uid || existing?.uid || `cloud_${Date.now()}`),
        email: cleanEmail,
        emailVerified: true,
        name: String(mgr.name || account?.name || existing?.account?.name || ''),
        hospitalName: String(
          mgr.hospitalName || account?.hospitalName || existing?.account?.hospitalName || ''
        ),
        sectorName: String(
          mgr.sectorName || account?.sectorName || existing?.account?.sectorName || ''
        ),
        role: String(mgr.role || account?.role || existing?.account?.role || ''),
        units: units.length > 0 ? units : account?.units || existing?.account?.units || [],
      };

      store[cleanEmail] = {
        email: cleanEmail,
        uid: String(mergedAccount.uid),
        passwordHash: passwordHash || existing?.passwordHash || '',
        account: mergedAccount,
        state: mergedState,
        updatedAt: new Date().toISOString(),
      };

      writeCloudStore(store);
      res.json({
        ok: true,
        account: mergedAccount,
        state: mergedState,
      });
    } catch (err) {
      console.error('Erro em /api/cloud-sync/push:', err);
      res.status(500).json({ ok: false, error: 'Falha ao sincronizar dados.' });
    }
  });

  app.post('/api/cloud-sync/pull', (req, res) => {
    try {
      const { email, uid } = req.body as { email?: string; uid?: string };
      const cleanEmail = String(email || '')
        .trim()
        .toLowerCase();
      const store = readCloudStore();

      let entry: CloudWorkspaceEntry | undefined = cleanEmail ? store[cleanEmail] : undefined;
      if (!entry && uid) {
        entry = Object.values(store).find((item) => item.uid === uid);
      }

      if (!entry) {
        res.json({ ok: true, found: false });
        return;
      }

      const cleanedState = deduplicateWorkspaceOnServer(entry.state || {});
      entry.state = cleanedState;
      if (Array.isArray(cleanedState.units) && cleanedState.units.length > 0) {
        entry.account = { ...entry.account, units: cleanedState.units };
      }

      res.json({
        ok: true,
        found: true,
        account: entry.account,
        state: cleanedState,
        updatedAt: entry.updatedAt,
      });
    } catch (err) {
      console.error('Erro em /api/cloud-sync/pull:', err);
      res.status(500).json({ ok: false, found: false });
    }
  });

  app.post('/api/cloud-sync/login', (req, res) => {
    try {
      const { email, passwordHash, name } = req.body as {
        email?: string;
        passwordHash?: string;
        name?: string;
      };
      const cleanEmail = String(email || '')
        .trim()
        .toLowerCase();
      if (!cleanEmail) {
        res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });
        return;
      }

      const store = readCloudStore();
      const existing = store[cleanEmail];

      if (existing) {
        existing.state = deduplicateWorkspaceOnServer(existing.state || {});
        if (Array.isArray(existing.state.units) && existing.state.units.length > 0) {
          existing.account = { ...existing.account, units: existing.state.units };
        }
        if (passwordHash && !existing.passwordHash) {
          existing.passwordHash = passwordHash;
        }
        writeCloudStore(store);
        res.json({
          ok: true,
          found: true,
          account: {
            ...existing.account,
            emailVerified: true,
          },
          state: existing.state,
        });
        return;
      }

      // Se a conta ainda não sincronizou a partir do outro aparelho, inicializa sessão pronta na nuvem (sem exigir novo cadastro!)
      const defaultUnit = {
        id: 'unit-default-1',
        name: 'Unidade Principal',
        shiftMode: '24H',
        minStaffDay: 2,
        minStaffNight: 1,
      };
      const fallbackName = String(name || cleanEmail.split('@')[0] || 'Gestor(a)');
      const newAccount: Record<string, unknown> = {
        uid: `cloud_${Buffer.from(cleanEmail).toString('hex').slice(0, 20)}`,
        name: fallbackName,
        email: cleanEmail,
        authMode: 'firebase-email',
        emailVerified: true,
        hospitalName: '',
        sectorName: 'Farmácia',
        role: 'Supervisor(a)',
        units: [defaultUnit],
        createdAt: new Date().toISOString(),
      };
      const newState: Record<string, unknown> = {
        manager: {
          name: fallbackName,
          hospitalName: '',
          role: 'Supervisor(a)',
          sectorName: 'Farmácia',
          avatarBase64: '',
          onboardingCompleted: true,
        },
        units: [defaultUnit],
        customRoles: [],
        employees: [],
        schedules: {},
        pushConfig: {
          enabled: false,
          alertUncoveredShift1hBefore: true,
          dailySummaryAt0630: true,
          instantCertificateAlert: true,
          webhookOrVapidKey: '',
        },
        lastUpdated: new Date(0).toISOString(),
      };

      res.json({
        ok: true,
        found: false,
        account: newAccount,
        state: newState,
      });
    } catch (err) {
      console.error('Erro em /api/cloud-sync/login:', err);
      res.status(500).json({ ok: false, error: 'Erro ao autenticar conta na nuvem.' });
    }
  });

  app.post('/api/cloud-sync/delete-account', (req, res) => {
    try {
      const { email, uid } = req.body as { email?: string; uid?: string };
      const cleanEmail = String(email || '')
        .trim()
        .toLowerCase();
      const store = readCloudStore();

      if (cleanEmail && store[cleanEmail]) {
        delete store[cleanEmail];
      }
      if (uid) {
        for (const [k, v] of Object.entries(store)) {
          if (v.uid === uid) {
            delete store[k];
          }
        }
      }

      writeCloudStore(store);
      res.json({ ok: true });
    } catch (err) {
      console.error('Erro em /api/cloud-sync/delete-account:', err);
      res.status(500).json({ ok: false });
    }
  });

  // Endpoint inteligente de leitura de arquivos de Banco de Horas (Excel, Word, CSV, PDF ou Imagem)
  app.post('/api/extract-hour-bank', async (req, res) => {
    try {
      const { base64File, fileName, mimeType, availableUnits, availableRoles } = req.body as {
        base64File?: string;
        fileName?: string;
        mimeType?: string;
        availableUnits?: string[];
        availableRoles?: string[];
      };

      if (!base64File) {
        res.status(400).json({ error: 'Arquivo não fornecido para leitura.' });
        return;
      }

      const dataUrlMatch = base64File.match(/^data:([^;]+);base64,(.+)$/s);
      const detectedMime = dataUrlMatch ? dataUrlMatch[1].trim() : mimeType || '';
      const cleanBase64 = (
        dataUrlMatch ? dataUrlMatch[2] : base64File.replace(/^data:.*?,/, '')
      ).trim();

      const fileBuffer = Buffer.from(cleanBase64, 'base64');
      const safeUnits = Array.isArray(availableUnits) ? availableUnits : [];
      const safeRoles = Array.isArray(availableRoles) ? availableRoles : [];

      const parsedSource = await extractTextOrInlinePart(
        fileBuffer,
        fileName || '',
        detectedMime
      );

      // Extração determinística local imediata (Excel / Word / CSV / TXT)
      const deterministicEntries = extractHourBankDeterministically(
        fileBuffer,
        parsedSource.extractedText || '',
        safeUnits,
        safeRoles
      );

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.json({
          success: true,
          entries: deterministicEntries,
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

      const promptText = `Você é um especialista em leitura de planilhas e relatórios de Banco de Horas e escalas hospitalares.
Analise o arquivo enviado (${fileName || 'relatório'}) e extraia TODOS os colaboradores listados junto com o respectivo saldo de Banco de Horas (em horas decimais, ex: +12, -4.5, 8, 0).
Regras de conversão:
- Se o documento mostrar "+12:30" ou "12h30", converta para 12.5.
- Se mostrar débito/negativo como "-04:00", "(04:00)" ou "4h devendo", converta para -4.
- Se o arquivo for uma planilha de cadastro/escala que tem os nomes dos colaboradores mas alguma linha não tiver saldo explícito, retorne hoursBalance: 0 para que o colaborador ainda seja identificado e vinculado!`;

      const responseSchema = {
        type: Type.ARRAY,
        description: 'Lista de colaboradores e seus saldos de banco de horas extraídos do arquivo.',
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Nome completo do colaborador.',
            },
            hoursBalance: {
              type: Type.NUMBER,
              description: 'Saldo do banco de horas em número decimal (positivo, negativo ou zero).',
            },
            formattedOriginal: {
              type: Type.STRING,
              description: 'Texto original do saldo encontrado no arquivo (ex: "+12:30", "-4h").',
            },
            unitHint: {
              type: Type.STRING,
              description: 'Setor ou unidade identificada, se houver.',
            },
            roleHint: {
              type: Type.STRING,
              description: 'Cargo ou função identificada, se houver.',
            },
            notes: {
              type: Type.STRING,
              description: 'Observação sobre horas extras, folga compensatória ou período.',
            },
          },
          required: ['name', 'hoursBalance'],
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
              { text: promptText },
            ]
          : [
              {
                text: `${promptText}\n\n=== CONTEÚDO EXTRAÍDO DO ARQUIVO (${
                  fileName || 'banco_de_horas'
                }) ===\n${(parsedSource.extractedText || '').slice(0, 90000)}`,
              },
            ];

      try {
        const aiEntries = await callGeminiWithFallback<ExtractedHourBankItem>(
          ai,
          contentParts,
          responseSchema
        );
        if (Array.isArray(aiEntries) && aiEntries.length > 0) {
          res.json({
            success: true,
            entries: aiEntries,
          });
          return;
        }
      } catch (aiErr) {
        console.warn(
          'Aviso na leitura IA de Banco de Horas, utilizando extração nativa de planilha:',
          aiErr instanceof Error ? aiErr.message : aiErr
        );
        if (deterministicEntries.length > 0) {
          res.json({
            success: true,
            entries: deterministicEntries,
          });
          return;
        }
      }

      res.json({
        success: true,
        entries: deterministicEntries,
      });
    } catch (err) {
      console.error('Erro em /api/extract-hour-bank:', err);
      res.status(500).json({
        error: 'Não foi possível processar o arquivo de Banco de Horas. Verifique se o documento possui nomes legíveis.',
      });
    }
  });

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

      const promptText = `Você é um especialista em leitura de escalas hospitalares quinzenais (16 a 15), planilhas Excel, documentos Word, PDFs, folhas de ponto e quadros de funcionários.
Analise o arquivo enviado (${fileName || 'documento'}) e extraia TODOS os nomes de colaboradores/funcionários encontrados.
Para cada colaborador encontrado, identifique pistas no documento sobre:
- name: Nome completo do colaborador (em formato Title Case limpo). Não inclua cabeçalhos de tabela, nomes de meses ou palavras genéricas como "Total", "Assinatura" ou "Unidade".
- roleHint: Função ou cargo hospitalar provável (prefira um destes se aplicável: ${rolesContext}).
- unitHint: Unidade ou setor hospitalar mencionado (ex: ${unitsContext}).
- shiftHint: Turno provável ("Diurno" ou "Noturno").
- workHoursHint: Horário provável (ex: "07:00 às 19:00", "19:00 às 07:00", "08:00 às 17:00", "07:00 às 13:00").
- scheduleRegimeHint: Regime de escala provável ("12x36_ODD" para 12x36 dias ímpares, "12x36_EVEN" para 12x36 dias pares, "5x2" para segunda a sexta, "6x1" para 6x1).
  ATENÇÃO À ESCALA QUINZENAL (16 a 15): As escalas hospitalares começam na 2ª quinzena de um mês (ex: 16/11 a 30/11) e terminam na 1ª quinzena do mês seguinte (ex: 01/12 a 15/12). O primeiro dia da tabela é o dia 16 (PAR)! Portanto:
  * Quem trabalha nos dias 16, 18, 20, 22, 24, 26, 28, 30 e 02, 04, 06, 08, 10, 12, 14 é "12x36_EVEN" (12x36 Dias Pares).
  * Quem trabalha nos dias 17, 19, 21, 23, 25, 27, 29 e 01, 03, 05, 7, 9, 11, 13, 15 é "12x36_ODD" (12x36 Dias Ímpares).
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
