// from: denislupookov/altersend@8c23d5b7d50cedae6c9dae66f82b1e235070c16a/packages/drive/src/api/drive.ts (Apache-2.0, see src/main/remote/drive/NOTICE)
import nodePath from 'node:path'
import type { DriveChannel } from './types'
import type { Bitmap } from './bitmap'
import type { AbortLike } from './types'
import { SenderSession } from './sender'
import { ReceiverSession } from './receiver'
import { DiskReader } from './disk-reader'
import { DiskWriter } from './disk-writer'

const { basename, join } = nodePath

function onAbort(signal: AbortLike | undefined, cancel: () => void): () => void {
  if (!signal) return () => {}
  if (signal.aborted) {
    cancel()
    return () => {}
  }
  signal.addEventListener('abort', cancel)
  return () => signal.removeEventListener('abort', cancel)
}

export interface SendFileOptions {
  transferId?: string
  name?: string
  signal?: AbortLike
  notifyPeerOnCancel?: boolean
  highWaterMark?: number
  onProgress?: (sentBytes: number, totalBytes: number) => void
}

export async function sendFile(
  path: string,
  channel: DriveChannel,
  opts: SendFileOptions = {}
): Promise<string> {
  const reader = new DiskReader(path)
  const sender = new SenderSession(reader, channel, {
    transferId: opts.transferId ?? String(Math.random()),
    name: opts.name ?? basename(path),
    highWaterMark: opts.highWaterMark,
    onProgress: opts.onProgress
  })
  const release = onAbort(opts.signal, () =>
    sender.cancel('Transfer cancelled', { notifyPeer: opts.notifyPeerOnCancel !== false })
  )
  try {
    return await sender.start()
  } finally {
    release()
    await reader.close()
  }
}

export interface ReceiveFileOptions {
  transferId?: string
  expectedSize?: number
  signal?: AbortLike
  resumeBits?: Uint8Array
  overwrite?: boolean
  onProgress?: (receivedBytes: number, totalBytes: number) => void
  onChunkWritten?: (bitmap: Bitmap) => void
}

export function receiveFile(
  targetPath: string,
  channel: DriveChannel,
  opts: ReceiveFileOptions = {}
): Promise<string> {
  const writer = new DiskWriter(targetPath, { overwrite: opts.overwrite })
  const receiver = new ReceiverSession(writer, channel, {
    transferId: opts.transferId,
    expectedSize: opts.expectedSize,
    resumeBits: opts.resumeBits,
    onProgress: opts.onProgress,
    onChunkWritten: opts.onChunkWritten
  })
  const release = onAbort(opts.signal, () => {
    receiver.cancel()
  })
  return receiver.receive().finally(release)
}

export class Drive {
  private readonly receiveDir: string

  constructor(receiveDir: string) {
    this.receiveDir = receiveDir
  }

  send(filePath: string, channel: DriveChannel, opts: SendFileOptions = {}): Promise<string> {
    return sendFile(filePath, channel, opts)
  }

  receive(name: string, channel: DriveChannel, opts: ReceiveFileOptions = {}): Promise<string> {
    return receiveFile(join(this.receiveDir, name), channel, opts)
  }
}
