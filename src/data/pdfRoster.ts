// Abre um PDF do SISQUAL no próprio dispositivo (pdf.js) e devolve a linha do colaborador.
// O ficheiro não sai do telemóvel/PC: só o resultado (códigos por dia) é guardado.

import { parseSisqualPage, type PdfPage, type PdfText, type SisqualRoster } from '../domain/sisqual'
import type { ShiftType } from '../domain/types'

const SCALE = 2

const isGreen = (r: number, g: number, b: number) => g > 90 && g > r + 35 && g > b + 35

export async function readSisqualPdf(file: Blob, employee: string, types: ShiftType[]): Promise<SisqualRoster> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  try {
    let header = ''
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: 1 })
      const tc = await page.getTextContent()
      const items: PdfText[] = []
      for (const it of tc.items) {
        if (!('str' in it) || !it.str.trim()) continue
        const [, , , d, e, f] = it.transform as number[]
        const [x, yBase] = viewport.convertToViewportPoint(e, f)
        const h = Math.abs(it.height || d)
        items.push({ str: it.str, x, y: yBase - h, w: it.width, h })
      }
      if (p === 1) header = items.slice(0, 30).map((i) => i.str).join(' ')
      if (!items.some((i) => i.str.trim() === employee.trim())) continue

      // Desenha a página para ver as cores das células (turnos extra a verde).
      const vp = page.getViewport({ scale: SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(vp.width)
      canvas.height = Math.ceil(vp.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('Este navegador não consegue desenhar o PDF.')
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
      const greenRatio: PdfPage['greenRatio'] = (x0, x1, y0, y1) => {
        const X0 = Math.max(0, Math.floor(x0 * SCALE))
        const Y0 = Math.max(0, Math.floor(y0 * SCALE))
        const w = Math.max(1, Math.min(canvas.width - X0, Math.ceil((x1 - x0) * SCALE)))
        const h = Math.max(1, Math.min(canvas.height - Y0, Math.ceil((y1 - y0) * SCALE)))
        const px = ctx.getImageData(X0, Y0, w, h).data
        let n = 0
        for (let i = 0; i < px.length; i += 4) if (isGreen(px[i], px[i + 1], px[i + 2])) n++
        return n / (w * h)
      }
      const r = parseSisqualPage({ items, greenRatio }, employee, types, header)
      canvas.width = canvas.height = 0
      if (r) return r
    }
  } finally {
    await task.destroy()
  }
  throw new Error(`Não encontrei o número ${employee} neste PDF.`)
}
