// Pure engine & security utility tests (required tests #4 #5 #6 #7 #9 #10 #11 #13 #25 #26 + SSRF).
import { describe, it, expect } from 'vitest'
import { evaluateCompleteness } from '../src/shared/completeness'
import { detectCycles, evaluateLogic } from '../src/shared/logic'
import { webTemplate } from '../src/shared/sampleTemplates'
import { validateAnswer } from '../src/shared/validate'
import { lintDefinition } from '../src/server/services/templates'
import { LocalHeuristicProvider } from '../src/server/ai/providers'
import { checkUpload } from '../src/server/security/upload'
import { signObjectUrl, verifySignedUrl } from '../src/server/security/crypto'
import { safeZipEntryPath } from '../src/server/security/paths'
import { csvCell, toCsv } from '../src/server/security/csv'
import { assertPublicUrl, isPrivateIp } from '../src/server/security/ssrf'
import { makePng, makePdf } from '../src/server/seed'
import type { FileInfo, TemplateDefinition } from '../src/shared/types'

const def = webTemplate.definition
const fullAnswers = {
  company_name: 'A', company_address: 'Tokyo', ceo_message: 'hello', site_purpose: ['company'], site_goal: '問い合わせを増やしたい（月20件）',
  business_description: 'x', reference_sites: [{ url: 'https://example.com', reason: 'design' }], contact_name: 'B', contact_email: 'b@example.com', privacy_ack: true,
}
const f = (itemId: string, n: number, status: FileInfo['status'] = 'pending_review'): FileInfo[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${itemId}${i}`, itemId, status, originalName: `${i}.png`, mime: 'image/png', size: 10 }))

describe('#4 required progress', () => {
  it('shows numerator/denominator of required items (5/7 => 71%)', () => {
    const r = evaluateCompleteness({ def, answers: fullAnswers, files: [], itemStates: [] })
    expect(r.progress.denominator).toBe(7)
    expect(r.progress.submitted).toBe(5) // logo + images missing
    expect(r.progress.percent).toBe(71)
    expect(r.items.find((i) => i.itemId === 'logo')!.status).toBe('missing')
  })
})

describe('#5 hidden questions and progress', () => {
  it('hidden (non-applicable) questions are excluded from the denominator; shown+required ones are added', () => {
    const base = evaluateCompleteness({ def, answers: fullAnswers, files: [], itemStates: [] })
    expect(base.items.some((i) => i.itemId === 'q:ec_product_count')).toBe(true)
    expect(base.items.find((i) => i.itemId === 'q:ec_product_count')!.applicable).toBe(false)
    const ec = evaluateCompleteness({ def, answers: { ...fullAnswers, site_purpose: ['company', 'ec'] }, files: [], itemStates: [] })
    expect(ec.progress.denominator).toBe(9) // + ec_product_count + ec_payment
    expect(ec.progress.submitted).toBe(5)
  })
  it('answers of hidden questions are retained but excluded (effectiveAnswers)', () => {
    const st = evaluateLogic(def, { ...fullAnswers, ec_product_count: 10 })
    expect(st.visible.ec_product_count).toBe(false)
    expect(st.effectiveAnswers.ec_product_count).toBeUndefined()
  })
})

describe('#6 conditional logic', () => {
  it('EC shows EC questions and keeps recruiting hidden (E2E-3 logic)', () => {
    const st = evaluateLogic(def, { site_purpose: ['ec'] })
    expect(st.visible.ec_product_count).toBe(true)
    expect(st.required.ec_product_count).toBe(true)
    expect(st.visible.recruit_positions).toBe(false)
    const rec = evaluateLogic(def, { site_purpose: ['recruit'] })
    expect(rec.visible.recruit_positions).toBe(true)
    expect(rec.visible.ec_payment).toBe(false)
  })
  it('cascades: a question shown by a hidden question stays hidden', () => {
    const d: TemplateDefinition = structuredClone(def)
    d.rules.push({ id: 'r_c', when: { questionId: 'ec_membership', op: 'eq', value: 'yes' }, then: [{ type: 'show', target: 'recruit_flow' }] })
    expect(evaluateLogic(d, { site_purpose: ['ec'], ec_membership: 'yes' }).visible.recruit_flow).toBe(true)
    expect(evaluateLogic(d, { site_purpose: ['company'], ec_membership: 'yes' }).visible.recruit_flow).toBe(false)
  })
  it('AI-proposed draft rules are ignored until activated', () => {
    const d: TemplateDefinition = structuredClone(def)
    d.rules.push({ id: 'r_ai', status: 'draft', origin: 'ai', when: { questionId: 'company_name', op: 'answered' }, then: [{ type: 'show', target: 'recruit_flow' }] })
    expect(evaluateLogic(d, { company_name: 'x' }).visible.recruit_flow).toBe(false)
  })
})

describe('#7 circular rule detection', () => {
  it('detects A->B->A and blocks via lint', () => {
    const d: TemplateDefinition = structuredClone(def)
    d.rules.push({ id: 'c1', when: { questionId: 'ec_shipping', op: 'answered' }, then: [{ type: 'show', target: 'ec_membership' }] })
    d.rules.push({ id: 'c2', when: { questionId: 'ec_membership', op: 'eq', value: 'yes' }, then: [{ type: 'hide', target: 'ec_shipping' }] })
    expect(detectCycles(d).length).toBeGreaterThan(0)
    expect(lintDefinition(d).errors.join()).toMatch(/循環/)
    expect(lintDefinition(def).errors).toEqual([])
  })
})

describe('#9 required file 3/5 => partial', () => {
  it('counts files against minCount', () => {
    const r = evaluateCompleteness({ def, answers: fullAnswers, files: f('product_images', 3), itemStates: [] })
    const it = r.items.find((i) => i.itemId === 'product_images')!
    expect(it.status).toBe('partial'); expect(it.count).toBe(3); expect(it.minCount).toBe(5)
    const r5 = evaluateCompleteness({ def, answers: fullAnswers, files: f('product_images', 5), itemStates: [] })
    expect(r5.items.find((i) => i.itemId === 'product_images')!.status).toBe('submitted') // upload != accepted
    const ok = evaluateCompleteness({ def, answers: fullAnswers, files: f('product_images', 5, 'accepted'), itemStates: [] })
    expect(ok.items.find((i) => i.itemId === 'product_images')!.status).toBe('accepted')
    const rej = evaluateCompleteness({ def, answers: fullAnswers, files: [...f('product_images', 4, 'accepted'), ...f('x', 0)].concat([{ ...f('product_images', 1, 'rejected')[0], id: 'r' }]), itemStates: [] })
    expect(rej.items.find((i) => i.itemId === 'product_images')!.status).toBe('partial')
  })
})

describe('question validation', () => {
  const q = (type: any, extra = {}) => ({ id: 'x', sectionId: 's', type, label: 'x', ...extra })
  it('validates each type', () => {
    expect(validateAnswer(q('email'), 'a@b')).not.toBeNull()
    expect(validateAnswer(q('email'), 'a@b.jp')).toBeNull()
    expect(validateAnswer(q('url'), 'javascript:alert(1)')).not.toBeNull()
    expect(validateAnswer(q('number', { min: 0, max: 10 }), 11)).not.toBeNull()
    expect(validateAnswer(q('date'), '2026-02-30')).not.toBeNull()
    expect(validateAnswer(q('single_choice', { options: [{ value: 'a', label: 'A' }] }), 'b')).not.toBeNull()
    expect(validateAnswer(q('yes_no'), 'maybe')).not.toBeNull()
    expect(validateAnswer(q('phone'), '03-1234-5678')).toBeNull()
    expect(validateAnswer(q('repeating_group', { fields: [{ id: 'url', label: 'URL', type: 'url' }] }), [{ url: 'nope' }])).not.toBeNull()
  })
})

describe('#13 contradiction candidate', () => {
  it('product count 10 vs "全25商品" becomes a candidate (not auto-fixed)', async () => {
    const p = new LocalHeuristicProvider()
    const answers = { ...fullAnswers, site_purpose: ['ec'], ec_product_count: 10, requests: '全25商品を掲載したい' }
    const out = await p.analyzeCase({ def, answers, fileTexts: [], today: '2026-10-05' })
    expect(out.contradictions.length).toBe(1)
    expect(out.contradictions[0].text).toMatch(/10.*25/)
    expect(out.contradictions[0].sourceRefs.map((s) => s.questionId)).toEqual(['ec_product_count', 'requests'])
    expect(answers.ec_product_count).toBe(10) // untouched
  })
  it('vague goal answer => follow-up candidate with purpose options', async () => {
    const out = await new LocalHeuristicProvider().analyzeCase({ def, answers: { ...fullAnswers, site_goal: '会社のサイトです' }, fileTexts: [], today: '2026-10-05' })
    expect(out.followUps[0].questionId).toBe('site_goal')
    expect(out.followUps[0].options).toEqual(['問い合わせ獲得', '採用', '会社案内', '販売'])
  })
  it('file name alone never yields high confidence classification', async () => {
    const c = await new LocalHeuristicProvider().classifyFile({ fileId: 'f', name: 'logo_final.png', mime: 'image/png' })
    expect(c.category).toBe('brand'); expect(c.confidence).toBe('low')
  })
})

describe('#10 upload MIME / size validation', () => {
  it('rejects disguised, oversized, wrong-extension files', () => {
    expect(checkUpload('a.png', makePng(1, 2, 3), ['png'], 1e6).ok).toBe(true)
    expect(checkUpload('a.png', Buffer.from('MZ\x90\x00 fake exe'), ['png'], 1e6).ok).toBe(false)
    expect(checkUpload('a.exe', makePng(1, 2, 3), ['png'], 1e6).ok).toBe(false)
    expect(checkUpload('a.png', makePng(1, 2, 3), ['png'], 10).error).toMatch(/上限/)
    expect(checkUpload('logo.pdf', makePdf(), ['pdf', 'ai'], 1e6).ok).toBe(true)
    expect(checkUpload('logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), ['svg'], 1e6).ok).toBe(true)
    expect(checkUpload('noext', makePng(1, 2, 3), undefined, 1e6).ok).toBe(false)
  })
})

describe('#11 signed URL expiry', () => {
  it('valid within TTL, expired after, tampered rejected', () => {
    const now = Date.parse('2026-10-05T00:00:00Z')
    const u = new URL('http://x' + signObjectUrl('s3cr3t', 'org/case/f.png', 60, now))
    const [k, e, d, s] = ['k', 'e', 'd', 's'].map((x) => u.searchParams.get(x)!)
    expect(verifySignedUrl('s3cr3t', k, Number(e), d, s, now + 30_000)).toBe('ok')
    expect(verifySignedUrl('s3cr3t', k, Number(e), d, s, now + 61_000)).toBe('expired')
    expect(verifySignedUrl('s3cr3t', 'org/other/f.png', Number(e), d, s, now)).toBe('invalid')
    expect(verifySignedUrl('s3cr3t', k, Number(e) + 1000, d, s, now)).toBe('invalid')
  })
})

describe('#25 ZIP path traversal', () => {
  it('rejects traversal and absolute paths', () => {
    expect(safeZipEntryPath('../../etc/passwd')).toBeNull()
    expect(safeZipEntryPath('objects/../../x')).toBeNull()
    expect(safeZipEntryPath('/abs')).toBeNull()
    expect(safeZipEntryPath('C:\\win')).toBeNull()
    expect(safeZipEntryPath('objects\\..\\..\\x')).toBeNull()
    expect(safeZipEntryPath('data/cases.json')).toBe('data/cases.json')
  })
})

describe('#26 CSV formula injection', () => {
  it('neutralises formula prefixes', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`)
    expect(csvCell('+1')).toBe("'+1"); expect(csvCell('-1+2')).toBe("'-1+2"); expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('普通の文字')).toBe('普通の文字')
    expect(toCsv([['a', '=1']])).toContain("'=1")
  })
})

describe('SSRF guard (URL ingestion)', () => {
  it('blocks private / metadata / non-http targets', async () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true); expect(isPrivateIp('10.0.0.1')).toBe(true); expect(isPrivateIp('::1')).toBe(true)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow()
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow()
    await expect(assertPublicUrl('http://localhost:8080/')).rejects.toThrow()
    await expect(assertPublicUrl('http://rebind.example/', async () => ['127.0.0.1'])).rejects.toThrow()
    await expect(assertPublicUrl('https://public.example/', async () => ['93.184.216.34'])).resolves.toBeInstanceOf(URL)
  })
})
