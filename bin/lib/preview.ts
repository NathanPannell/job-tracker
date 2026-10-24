// Turns a résumé PDF into the SVG pages the desktop pane draws with its `Svg` element. A pane's
// whole tree is capped at 100,000 characters serialized, the preview included, so each page is
// one 1-bit PNG (text stays sharp and small) in its own SVG, rendered at a lower resolution
// until it fits PAGE_BUDGET. The pane draws the pages that fit together; Open PDF has the rest.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A pane tree's bound, in characters serialized. */
export const TREE_LIMIT = 100_000
/** What one page may take, leaving the rest of the package view room within TREE_LIMIT. */
export const PAGE_BUDGET = 90_000
const RESOLUTIONS = [125, 100, 80]

/** Runs a program and returns its stdout; `execFileSync` by default, a fake in tests. */
export type Run = (file: string, args: readonly string[]) => string

const runProgram: Run = (file, args) => execFileSync(file, args, { encoding: 'utf8' })

/** Wraps one PNG page (base64) of `width` x `height` pixels in an SVG document. */
export function pageSvg(base64: string, width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>` +
    `<image width="${width}" height="${height}" href="data:image/png;base64,${base64}"/></svg>`
  )
}

/** Page count and page size in points, from pdfinfo's output. */
export function parsePdfInfo(text: string): { pages: number; width: number; height: number } {
  const pages = Number(/Pages:\s+(\d+)/.exec(text)?.[1] ?? 1)
  const size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(text)
  return { pages, width: Number(size?.[1] ?? 612), height: Number(size?.[2] ?? 792) }
}

/**
 * Renders `pdf` into `outDir` as `page-<p>.svg` and returns their file names in reading order.
 * Needs poppler's pdfinfo and pdftocairo (MiKTeX and TeX Live ship them).
 */
export function renderPreview(pdf: string, outDir: string, run: Run = runProgram): string[] {
  if (!existsSync(pdf)) throw new Error(`No PDF at ${pdf}`)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const { pages, width, height } = parsePdfInfo(run('pdfinfo', [pdf]))
  const names: string[] = []
  for (let page = 1; page <= pages; page += 1) {
    const prefix = join(outDir, `page-${page}`)
    let svg = ''
    for (const dpi of RESOLUTIONS) {
      run('pdftocairo', [
        '-png',
        '-mono',
        '-r',
        String(dpi),
        '-f',
        String(page),
        '-l',
        String(page),
        '-singlefile',
        pdf,
        prefix,
      ])
      const w = Math.round((width / 72) * dpi)
      const h = Math.round((height / 72) * dpi)
      svg = pageSvg(readFileSync(`${prefix}.png`).toString('base64'), w, h)
      if (svg.length <= PAGE_BUDGET) break
    }
    if (svg.length > PAGE_BUDGET) throw new Error(`Page ${page} is too large to draw`)
    const name = `page-${page}.svg`
    writeFileSync(join(outDir, name), svg)
    names.push(name)
  }
  for (const stray of readdirSync(outDir)) {
    if (stray.endsWith('.png')) rmSync(join(outDir, stray), { force: true })
  }
  return names
}
