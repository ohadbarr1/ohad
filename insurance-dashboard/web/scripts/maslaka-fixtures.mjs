// W7 · writes the zip fixtures in tests/fixtures/maslaka from the XML fixtures there. Run once when the XML fixtures change:
//   node scripts/maslaka-fixtures.mjs        (from web/)
// Password for every encrypted fixture: fox-2026 (written in tests/import.unit.ts too).
//   fixture-plain.zip      no password; two provider XMLs + a stand-in PDF and Excel (which the reader must leave alone)
//   fixture-zipcrypto.zip  traditional PKWARE encryption, written by macOS /usr/bin/zip -e (an independent writer)
//   fixture-aes.zip        WinZip AES-256, written here by @zip.js/zip.js (no AES zip writer is installed on this machine: 7z is not;
//                          so this one proves the reader opens AES entries written to the WinZip spec by zip.js, not by a third party)
//   fixture-nested.zip     a plain zip holding fixture-zipcrypto.zip and a PDF (zip inside zip)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobReader, BlobWriter, ZipWriter, configure } from '@zip.js/zip.js';

configure({ useWebWorkers: false });
const FIX = new URL('../tests/fixtures/maslaka/', import.meta.url).pathname;
const PASS = 'fox-2026';
const xmls = ['fixture-pension.xml', 'fixture-bituach.xml'];
const pdf = new TextEncoder().encode('%PDF-1.4\n% fixture stand-in: not a real report\n%%EOF\n');
const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);  // a zip signature is what an .xlsx starts with

const tmp = mkdtempSync(join(tmpdir(), 'maslakafix-'));
try {
  for (const x of xmls) copyFileSync(join(FIX, x), join(tmp, x));
  writeFileSync(join(tmp, 'דוח מסלקה.pdf'), pdf);
  writeFileSync(join(tmp, 'summary.xlsx'), xlsx);
  const names = [...xmls, 'דוח מסלקה.pdf', 'summary.xlsx'];
  // plain and ZipCrypto by the system zip (an independent implementation)
  execFileSync('/usr/bin/zip', ['-q', '-j', join(FIX, 'fixture-plain.zip'), ...names.map((n) => join(tmp, n))]);
  execFileSync('/usr/bin/zip', ['-q', '-j', '-e', '-P', PASS, join(FIX, 'fixture-zipcrypto.zip'), ...names.map((n) => join(tmp, n))]);
  // AES-256 by zip.js
  const w = new ZipWriter(new BlobWriter('application/zip'), { password: PASS, encryptionStrength: 3, zipCrypto: false });
  for (const n of names) await w.add(n, new BlobReader(new Blob([readFileSync(join(tmp, n))])));
  const blob = await w.close();
  writeFileSync(join(FIX, 'fixture-aes.zip'), new Uint8Array(await blob.arrayBuffer()));
  // nested: plain outer, encrypted inner
  copyFileSync(join(FIX, 'fixture-zipcrypto.zip'), join(tmp, 'inner.zip'));
  execFileSync('/usr/bin/zip', ['-q', '-j', join(FIX, 'fixture-nested.zip'), join(tmp, 'inner.zip'), join(tmp, 'דוח מסלקה.pdf')]);
  console.log('wrote fixture-plain.zip, fixture-zipcrypto.zip, fixture-aes.zip, fixture-nested.zip');
} finally { rmSync(tmp, { recursive: true, force: true }); }
