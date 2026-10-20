// Turns a résumé PDF into SVG strips the desktop pane draws with its `Svg` element. Each `Svg`
// source is capped at 131,072 characters, so every page is cut into horizontal strips and each
// strip is a JPEG embedded in its own small SVG, re-encoded smaller until it fits.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SVG_LIMIT = 131_072
const BUDGET = 120_000
const DPI = 125
const STRIP_PX = 320

/** Runs a program and returns its stdout; `execFileSync` by default, a fake in tests. */
export type Run = (file: string, args: readonly string[]) => string

const runProgram: Run = (file, args) => execFileSync(file, args, { encoding: 'utf8' })

/** Wraps one JPEG strip (base64) of `width` x `height` pixels in an SVG document. */
export function stripSvg(base64: string, width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>` +
    `<image width="${width}" height="${height}" href="data:image/jpeg;base64,${base64}"/></svg>`
  )
}

/** Page count and page size in points, from pdfinfo's output. */
export function parsePdfInfo(text: string): { pages: number; width: number; height: number } {
  const pages = Number(/Pages:\s+(\d+)/.exec(text)?.[1] ?? 1)
  const size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(text)
  return { pages, width: Number(size?.[1] ?? 612), height: Number(size?.[2] ?? 792) }
}

/** Horizontal strips covering a page `pageH` pixels tall: `[y, height]` each. */
export function strips(pageH: number, stripPx = STRIP_PX): [number, number][] {
  const out: [number, number][] = []
  for (let y = 0; y < pageH; y += stripPx) out.push([y, Math.min(stripPx, pageH - y)])
  return out
}

/**
 * Renders `pdf` into `outDir` as `page-<p>-<n>.svg` strips and returns their file names in
 * reading order. Needs poppler's pdfinfo and pdftocairo (MiKTeX and TeX Live ship them).
 */
export function renderPreview(pdf: string, outDir: string, run: Run = runProgram): string[] {
  if (!existsSync(pdf)) throw new Error(`No PDF at ${pdf}`)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const { pages, width, height } = parsePdfInfo(run('pdfinfo', [pdf]))
  const pageW = Math.round((width / 72) * DPI)
  const pageH = Math.round((height / 72) * DPI)
  const names: string[] = []
  for (let page = 1; page <= pages; page += 1) {
    for (const [n, [y, h]] of strips(pageH).entries()) {
      const prefix = join(outDir, `strip-${page}-${n}`)
      let svg = ''
      for (const quality of [72, 60, 45, 30]) {
        run('pdftocairo', [
          '-jpeg',
          '-jpegopt',
          `quality=${quality},optimize=y`,
          '-r',
          String(DPI),
          '-f',
          String(page),
          '-l',
          String(page),
          '-x',
          '0',
          '-y',
          String(y),
          '-W',
          String(pageW),
          '-H',
          String(h),
          '-singlefile',
          pdf,
          prefix,
        ])
        svg = stripSvg(readFileSync(`${prefix}.jpg`).toString('base64'), pageW, h)
        if (svg.length <= BUDGET) break
      }
      if (svg.length > SVG_LIMIT) throw new Error(`Strip ${page}-${n} is too large to draw`)
      const name = `page-${page}-${n}.svg`
      writeFileSync(join(outDir, name), svg)
      names.push(name)
    }
  }
  for (const stray of readdirSync(outDir)) {
    if (stray.endsWith('.jpg')) rmSync(join(outDir, stray), { force: true })
  }
  return names
}
