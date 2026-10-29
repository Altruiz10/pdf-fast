import createModule from '@neslinesli93/qpdf-wasm';

const wasmUrl = new URL('./qpdf.wasm', document.baseURI).href;

/**
 * Runs qpdf on one input file and returns the output bytes.
 * A fresh module per call keeps each run isolated (qpdf's main may exit the runtime).
 */
async function runQpdf(input: Uint8Array, args: (inPath: string, outPath: string) => string[]) {
  const errors: string[] = [];
  const qpdf = await (createModule as unknown as (o: object) => Promise<{
    callMain: (a: string[]) => number;
    FS: { writeFile: (p: string, d: Uint8Array) => void; readFile: (p: string) => Uint8Array };
  }>)({
    locateFile: () => wasmUrl,
    noInitialRun: true,
    print: () => {},
    printErr: (s: string) => errors.push(s),
  });
  qpdf.FS.writeFile('/in.pdf', input);
  let code: number;
  try {
    code = qpdf.callMain(args('/in.pdf', '/out.pdf'));
  } catch (e) {
    // Emscripten signals exit through an exception carrying the status.
    code = (e as { status?: number }).status ?? 2;
  }
  // qpdf exit code 3 means "succeeded with warnings".
  if (code !== 0 && code !== 3) {
    throw new Error(errors.join('\n') || `qpdf falhou (código ${code})`);
  }
  return new Uint8Array(qpdf.FS.readFile('/out.pdf'));
}

export function decrypt(bytes: Uint8Array, password = '') {
  return runQpdf(bytes, (i, o) => [`--password=${password}`, '--decrypt', i, o]);
}

export interface EncryptOptions {
  userPassword: string;
  ownerPassword: string;
  allowPrint: boolean;
  allowCopy: boolean;
  allowModify: boolean;
}

export function encrypt(bytes: Uint8Array, opt: EncryptOptions) {
  return runQpdf(bytes, (i, o) => [
    '--encrypt',
    opt.userPassword,
    opt.ownerPassword || opt.userPassword,
    '256',
    `--print=${opt.allowPrint ? 'full' : 'none'}`,
    `--extract=${opt.allowCopy ? 'y' : 'n'}`,
    `--modify=${opt.allowModify ? 'all' : 'none'}`,
    '--',
    i,
    o,
  ]);
}

/** Lossless size reduction: object streams + recompressed flate streams. */
export function optimize(bytes: Uint8Array) {
  return runQpdf(bytes, (i, o) => [
    '--object-streams=generate',
    '--compress-streams=y',
    '--recompress-flate',
    '--compression-level=9',
    '--remove-unreferenced-resources=yes',
    i,
    o,
  ]);
}
