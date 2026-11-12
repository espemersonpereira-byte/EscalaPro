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
    rawData[rowStart] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      // Fundo azul-escuro #0f172a
      let r = 15, g = 23, b = 42, a = 255;

      const inVerticalArm = x >= center - crossArm && x <= center + crossArm && y >= margin && y <= size - margin;
      const inHorizontalArm = y >= center - crossArm && y <= center + crossArm && x >= margin && x <= size - margin;

      if (inVerticalArm || inHorizontalArm) {
        // Cruz verde-esmeralda #0d9488
        r = 13;
        g = 148;
        b = 136;
      }

      // Linha central branca simbolizando pulso/grade
      if (Math.abs(y - center) <= Math.max(2, Math.floor(size * 0.02)) && x >= margin + 8 && x <= size - margin - 8) {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
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

// Extrai texto estruturado de qualquer arquivo (Excel .xlsx/.xls/.ods/.csv, Word .docx/.doc, TXT, etc.)
async function extractTextOrInlinePart(
  fileBuffer: Buffer,
  cleanBase64: string,
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
    return {
      mode: 'INLINE_MEDIA',
      inlineMimeType: 'application/pdf',
    };
  }

  // 2. Verifica se é imagem suportada nativamente pelo Gemini inlineData
  const supportedImageMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
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
      // Caso seja um .doc antigo ou formato híbrido, tenta ler como planilha ou extrair texto legível
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

  // 5. Tentativa curinga para qualquer outro arquivo (tenta XLSX, depois Mammoth, depois texto UTF-8)
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
    // Continua para tentativa com mammoth/texto
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
    // Continua para texto puro
  }

  // Extrai texto UTF-8 limpo (para .txt, .csv, .rtf, .html, .xml ou arquivos gerais)
  const rawUtf8 = fileBuffer
    .toString('utf-8')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ' ')
    .trim();

  return {
    mode: 'EXTRACTED_TEXT',
    extractedText: rawUtf8.slice(0, 120000),
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '30mb' }));

  // Rotas de ícones PNG válidos para PWA (Android, Desktop e iOS Safari)
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

  // Endpoint universal de leitura inteligente de arquivos (PDF, Word, Excel, CSV, TXT, Imagem) via @google/genai
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

      // Remove qualquer cabeçalho data:<mime>;base64, de qualquer tipo de arquivo (PDF, Excel, Word, Imagem, etc.)
      const dataUrlMatch = base64Pdf.match(/^data:([^;]+);base64,(.+)$/s);
      const detectedMime = dataUrlMatch ? dataUrlMatch[1].trim() : mimeType || '';
      const cleanBase64 = (
        dataUrlMatch ? dataUrlMatch[2] : base64Pdf.replace(/^data:.*?,/, '')
      ).trim();

      const fileBuffer = Buffer.from(cleanBase64, 'base64');

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
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
        Array.isArray(availableRoles) && availableRoles.length > 0
          ? availableRoles.join(', ')
          : 'Farmacêutico, Auxiliar de Farmácia, Enfermeiro, Técnico de Enfermagem, Auxiliar de Enfermagem, Médico, Maqueiro, Técnico de Radiologia, Biomédico, Fisioterapeuta, Recepcionista, Auxiliar Administrativo, Auxiliar de Higienização';

      const unitsContext =
        Array.isArray(availableUnits) && availableUnits.length > 0
          ? availableUnits.join(', ')
          : 'Unidade Central, Pronto-Socorro, Centro Cirúrgico, UTI';

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

      const parsedSource = await extractTextOrInlinePart(
        fileBuffer,
        cleanBase64,
        fileName || '',
        detectedMime
      );

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
                }) ===\n${parsedSource.extractedText || ''}`,
              },
            ];

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: contentParts,
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

      const rawText = (response.text ?? '[]').trim();
      const extracted = JSON.parse(rawText);

      res.json({
        success: true,
        employees: Array.isArray(extracted) ? extracted : [],
      });
    } catch (error: unknown) {
      const errMessage =
        error instanceof Error ? error.message : 'Erro desconhecido ao processar arquivo.';
      console.error('Erro na extração de arquivo via Gemini:', errMessage);
      res.status(500).json({
        error: `Falha ao analisar o arquivo (${req.body?.fileName || 'documento'}): ${errMessage}`,
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
