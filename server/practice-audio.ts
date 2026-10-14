import { PracticeFeedbackError } from './practice-feedback-error.js'

// Check browser containers before sending any bytes to Gemini. This is not a
// decoder: damaged payloads that pass container checks are also handled safely
// if Gemini rejects them. Audio/video containers must contain only audio tracks.
function validWebm(bytes: Buffer): boolean {
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x1a45dfa3) return false
  let audioTrack = false
  let otherTrack = false
  let payload = false
  function vint(offset: number, size: boolean) {
    if (offset >= bytes.length || bytes[offset] === 0) throw new Error('Invalid EBML')
    let width = 1
    let marker = 0x80
    while (!(bytes[offset] & marker)) { width += 1; marker >>= 1 }
    if (width > (size ? 8 : 4) || offset + width > bytes.length) throw new Error('Invalid EBML')
    let value = size ? bytes[offset] & (marker - 1) : bytes[offset]
    let unknown = size && value === marker - 1
    for (let index = 1; index < width; index += 1) {
      value = value * 256 + bytes[offset + index]
      unknown = unknown && bytes[offset + index] === 255
    }
    return { value, width, unknown }
  }
  function scan(start: number, end: number, depth: number, inCluster = false): number {
    if (depth > 8) throw new Error('Invalid EBML')
    for (let cursor = start; cursor < end;) {
      const id = vint(cursor, false)
      if (inCluster && id.value === 0x1f43b675) return cursor
      const size = vint(cursor + id.width, true)
      const data = cursor + id.width + size.width
      let next = size.unknown ? end : data + size.value
      if (next > end || next <= cursor) throw new Error('Invalid EBML')
      if ([0x18538067, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0].includes(id.value)) {
        const consumed = scan(data, next, depth + 1, id.value === 0x1f43b675)
        if (size.unknown) next = consumed
      } else if (id.value === 0x83) {
        if (next - data !== 1) throw new Error('Invalid track')
        if (bytes[data] === 2) audioTrack = true
        else otherTrack = true
      } else if (id.value === 0xa3 || id.value === 0xa1) {
        if (next - data > vint(data, true).width + 3) payload = true
      }
      cursor = next
    }
    return end
  }
  try { scan(0, bytes.length, 0) } catch { return false }
  return audioTrack && !otherTrack && payload
}

function validMp4(bytes: Buffer): boolean {
  let audioTrack = false
  let otherTrack = false
  let payload = false
  let fileType = false
  function scan(start: number, end: number, depth: number) {
    if (depth > 8) throw new Error('Invalid MP4')
    for (let cursor = start; cursor < end;) {
      if (cursor + 8 > end) throw new Error('Invalid MP4')
      let size = bytes.readUInt32BE(cursor)
      const type = bytes.toString('ascii', cursor + 4, cursor + 8)
      let header = 8
      if (size === 1) {
        if (cursor + 16 > end) throw new Error('Invalid MP4')
        const large = bytes.readBigUInt64BE(cursor + 8)
        if (large > BigInt(bytes.length)) throw new Error('Invalid MP4')
        size = Number(large)
        header = 16
      } else if (size === 0) size = end - cursor
      const data = cursor + header
      const next = cursor + size
      if (size < header || next > end) throw new Error('Invalid MP4')
      if (['moov', 'trak', 'mdia'].includes(type)) scan(data, next, depth + 1)
      if (type === 'ftyp' && next - data >= 8) fileType = true
      if (type === 'mdat' && next > data) payload = true
      if (type === 'hdlr') {
        if (next - data < 12) throw new Error('Invalid handler')
        if (bytes.toString('ascii', data + 8, data + 12) === 'soun') audioTrack = true
        else otherTrack = true
      }
      cursor = next
    }
  }
  try { scan(0, bytes.length, 0) } catch { return false }
  return fileType && audioTrack && !otherTrack && payload
}

function validWav(bytes: Buffer): boolean {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WAVE') return false
  let format = false
  let payload = false
  for (let cursor = 12; cursor + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', cursor, cursor + 4)
    const size = bytes.readUInt32LE(cursor + 4)
    const data = cursor + 8
    if (data + size > bytes.length) return false
    if (name === 'fmt ' && size >= 16 && bytes.readUInt16LE(data + 2) > 0 && bytes.readUInt32LE(data + 4) > 0) format = true
    if (name === 'data' && size > 0) payload = true
    cursor = data + size + (size % 2)
  }
  return format && payload
}

function validOgg(bytes: Buffer): boolean {
  const streams = new Map<number, Buffer>()
  let payload = false
  for (let cursor = 0; cursor < bytes.length;) {
    if (cursor + 27 > bytes.length || bytes.toString('ascii', cursor, cursor + 4) !== 'OggS' || bytes[cursor + 4] !== 0) return false
    const segments = bytes[cursor + 26]
    if (cursor + 27 + segments > bytes.length) return false
    let size = 0
    for (let i = 0; i < segments; i += 1) size += bytes[cursor + 27 + i]
    const data = cursor + 27 + segments
    if (data + size > bytes.length) return false
    const serial = bytes.readUInt32LE(cursor + 14)
    const packet = bytes.subarray(data, data + size)
    if (!streams.has(serial)) {
      if (!packet.subarray(0, 8).equals(Buffer.from('OpusHead')) &&
          !(packet[0] === 1 && packet.toString('ascii', 1, 7) === 'vorbis')) return false
      streams.set(serial, packet)
    } else if (size > 0 && packet.toString('ascii', 0, 8) !== 'OpusTags') payload = true
    cursor = data + size
  }
  return streams.size > 0 && payload
}

export function validatePracticeAudio(bytes: Buffer, mimeType: string): void {
  if (!bytes.length) throw new PracticeFeedbackError(400, 'missing_audio')
  const baseType = mimeType.split(';')[0].trim().toLowerCase()
  let valid = false
  if (baseType === 'audio/webm') valid = validWebm(bytes)
  else if (baseType === 'audio/mp4' || baseType === 'audio/m4a') valid = validMp4(bytes)
  else if (baseType === 'audio/ogg') valid = validOgg(bytes)
  else if (baseType === 'audio/wav' || baseType === 'audio/x-wav') valid = validWav(bytes)
  else if (baseType === 'audio/flac') valid = bytes.length > 42 && bytes.toString('ascii', 0, 4) === 'fLaC'
  else if (baseType === 'audio/mpeg' || baseType === 'audio/mp3') {
    valid = bytes.length > 10 && (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0))
  } else if (baseType === 'audio/aac') {
    valid = bytes.length > 7 && bytes[0] === 255 && (bytes[1] & 0xf6) === 0xf0
  }
  if (!valid) throw new PracticeFeedbackError(400, 'invalid_audio')
}
