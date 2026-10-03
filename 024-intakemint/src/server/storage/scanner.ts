// Malware scanning candidates. Built-in: EICAR test signature detection only (NOT a real antivirus).
// Production candidate: ClamAV daemon (clamd) over TCP INSTREAM — run as a separate service (GPL; not bundled).
import net from 'node:net'

export type ScanResult = 'clean' | 'infected' | 'error' | 'not_scanned'
export interface Scanner { readonly name: string; scan(buf: Buffer): Promise<ScanResult> }

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

export class BasicScanner implements Scanner {
  readonly name = 'basic-eicar'
  async scan(buf: Buffer): Promise<ScanResult> {
    return buf.includes(Buffer.from(EICAR)) ? 'infected' : 'not_scanned'
  }
}

export class ClamAvScanner implements Scanner {
  readonly name = 'clamav'
  constructor(private host: string, private port = 3310) {}
  scan(buf: Buffer): Promise<ScanResult> {
    if (buf.includes(Buffer.from(EICAR))) return Promise.resolve('infected')
    return new Promise((resolve) => {
      const sock = net.connect(this.port, this.host)
      let out = ''
      sock.setTimeout(15000, () => { sock.destroy(); resolve('error') })
      sock.on('error', () => resolve('error'))
      sock.on('data', (d) => { out += d.toString() })
      sock.on('end', () => resolve(/FOUND/.test(out) ? 'infected' : /OK/.test(out) ? 'clean' : 'error'))
      sock.on('connect', () => {
        sock.write('zINSTREAM\0')
        for (let i = 0; i < buf.length; i += 64 * 1024) {
          const chunk = buf.subarray(i, i + 64 * 1024)
          const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length)
          sock.write(len); sock.write(chunk)
        }
        sock.end(Buffer.alloc(4))
      })
    })
  }
}
