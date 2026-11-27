// Lê o talão de vencimento em PDF no próprio aparelho (pdf.js). Só o resultado (rubricas e valores) é guardado.

import { parsePayslipPages, type Payslip, type SlipText } from '../domain/payslip'

export async function readPayslipPdf(file: Blob): Promise<Payslip> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const doc = await task.promise
    const pages: SlipText[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const vp = page.getViewport({ scale: 1 })
      const tc = await page.getTextContent()
      const items: SlipText[] = []
      for (const it of tc.items) {
        if (!('str' in it) || !it.str.trim()) continue
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5])
        items.push({ str: it.str, x, y })
      }
      pages.push(items)
    }
    return parsePayslipPages(pages)
  } finally {
    await task.destroy()
  }
}
