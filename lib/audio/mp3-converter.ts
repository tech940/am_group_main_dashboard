/**
 * Converts any browser-decodable audio ArrayBuffer (m4a, aac, wav, ogg, etc.) to an MP3 Blob.
 */
export async function convertAudioBufferToMp3(arrayBuffer: ArrayBuffer, kbps = 128): Promise<Blob> {
  if (typeof window === 'undefined') {
    throw new Error('Client-side audio conversion only')
  }

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContextClass) {
    throw new Error('Web Audio API is not supported on this browser')
  }

  const audioCtx = new AudioContextClass()
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    const channels = audioBuffer.numberOfChannels
    const sampleRate = audioBuffer.sampleRate
    const numChannels = Math.min(2, Math.max(1, channels))

    const lamejs = await import('@breezystack/lamejs')
    const Mp3Encoder = lamejs.Mp3Encoder || (lamejs as any).default?.Mp3Encoder
    if (!Mp3Encoder) {
      throw new Error('Failed to load MP3 encoder')
    }

    const mp3Encoder = new Mp3Encoder(numChannels, sampleRate, kbps)
    const mp3Data: Uint8Array[] = []
    const sampleBlockSize = 1152

    if (numChannels === 1) {
      const floatSamples = audioBuffer.getChannelData(0)
      const int16Samples = new Int16Array(floatSamples.length)
      for (let i = 0; i < floatSamples.length; i++) {
        const s = Math.max(-1, Math.min(1, floatSamples[i]))
        int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }

      for (let i = 0; i < int16Samples.length; i += sampleBlockSize) {
        const chunk = int16Samples.subarray(i, i + sampleBlockSize)
        const mp3buf = mp3Encoder.encodeBuffer(chunk)
        if (mp3buf.length > 0) {
          mp3Data.push(new Uint8Array(mp3buf))
        }
      }
    } else {
      const leftFloat = audioBuffer.getChannelData(0)
      const rightFloat = audioBuffer.getChannelData(1)
      const leftInt16 = new Int16Array(leftFloat.length)
      const rightInt16 = new Int16Array(rightFloat.length)

      for (let i = 0; i < leftFloat.length; i++) {
        const l = Math.max(-1, Math.min(1, leftFloat[i]))
        const r = Math.max(-1, Math.min(1, rightFloat[i]))
        leftInt16[i] = l < 0 ? l * 0x8000 : l * 0x7fff
        rightInt16[i] = r < 0 ? r * 0x8000 : r * 0x7fff
      }

      for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
        const leftChunk = leftInt16.subarray(i, i + sampleBlockSize)
        const rightChunk = rightInt16.subarray(i, i + sampleBlockSize)
        const mp3buf = mp3Encoder.encodeBuffer(leftChunk, rightChunk)
        if (mp3buf.length > 0) {
          mp3Data.push(new Uint8Array(mp3buf))
        }
      }
    }

    const endBuf = mp3Encoder.flush()
    if (endBuf.length > 0) {
      mp3Data.push(new Uint8Array(endBuf))
    }

    return new Blob(mp3Data as any, { type: 'audio/mp3' })
  } finally {
    audioCtx.close().catch(() => {})
  }
}
