// chatModel.ts pulls in the AI SDK providers; the detector itself is pure, so
// load just that module with the provider packages stubbed out.
import { createTsLoader } from './load-ts.mjs'

const stub = new Proxy({}, { get: () => () => ({}) })
const chatModel = createTsLoader({
  mocks: {
    '@ai-sdk/openai': stub,
    '@ai-sdk/google': stub,
    ai: stub,
    './deepseekToolChat': stub,
  },
})('src/main/memory/models/chatModel.ts')

export const detectVisionModelForTest = chatModel.detectVisionModel
