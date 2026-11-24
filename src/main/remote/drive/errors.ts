// from: denislupookov/altersend@8c23d5b7d50cedae6c9dae66f82b1e235070c16a/packages/drive/src/engine/errors.ts (Apache-2.0, see src/main/remote/drive/NOTICE)
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityError'
  }
}
