interface KeyboardInputEvent {
  type: number
  u: {
    ki: {
      wVk: number
      wScan: number
      dwFlags: number
      time: number
      dwExtraInfo: number
    }
  }
}

const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002
const VK_LWIN = 0x5b
const VK_D = 0x44

let sendInputApi: ((count: number, inputs: KeyboardInputEvent[], size: number) => number) | null | undefined
let inputSize = 0

export function createShowDesktopInputEvents(): KeyboardInputEvent[] {
  const keyboardEvent = (virtualKey: number, keyUp = false): KeyboardInputEvent => ({
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: virtualKey,
        wScan: 0,
        dwFlags: keyUp ? KEYEVENTF_KEYUP : 0,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  })

  return [
    keyboardEvent(VK_LWIN),
    keyboardEvent(VK_D),
    keyboardEvent(VK_D, true),
    keyboardEvent(VK_LWIN, true),
  ]
}

function loadSendInputApi(): typeof sendInputApi {
  if (sendInputApi !== undefined) return sendInputApi
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const mouseInput = koffi.struct('LingyueShowDesktopMouseInput', {
      dx: 'long',
      dy: 'long',
      mouseData: 'uint32_t',
      dwFlags: 'uint32_t',
      time: 'uint32_t',
      dwExtraInfo: 'uintptr_t',
    })
    const keyboardInput = koffi.struct('LingyueShowDesktopKeyboardInput', {
      wVk: 'uint16_t',
      wScan: 'uint16_t',
      dwFlags: 'uint32_t',
      time: 'uint32_t',
      dwExtraInfo: 'uintptr_t',
    })
    const hardwareInput = koffi.struct('LingyueShowDesktopHardwareInput', {
      uMsg: 'uint32_t',
      wParamL: 'uint16_t',
      wParamH: 'uint16_t',
    })
    const input = koffi.struct('LingyueShowDesktopInput', {
      type: 'uint32_t',
      u: koffi.union('LingyueShowDesktopInputUnion', {
        mi: mouseInput,
        ki: keyboardInput,
        hi: hardwareInput,
      }),
    })
    sendInputApi = user32.func(
      'uint32 __stdcall SendInput(uint32 count, LingyueShowDesktopInput *inputs, int size)'
    )
    inputSize = koffi.sizeof(input)
  } catch {
    sendInputApi = null
  }
  return sendInputApi
}

export function toggleWindowsDesktop(): boolean {
  if (process.platform !== 'win32') return false
  const sendInput = loadSendInputApi()
  if (!sendInput || inputSize <= 0) return false
  const events = createShowDesktopInputEvents()
  try {
    return sendInput(events.length, events, inputSize) === events.length
  } catch {
    return false
  }
}

/** Press and release one virtual key (media / volume keys) `times` times. */
export function createVirtualKeyPressEvents(virtualKey: number, times = 1): KeyboardInputEvent[] {
  const count = Math.max(1, Math.min(50, Math.round(times)))
  const events: KeyboardInputEvent[] = []
  for (let index = 0; index < count; index += 1) {
    events.push(
      { type: INPUT_KEYBOARD, u: { ki: { wVk: virtualKey, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } } },
      { type: INPUT_KEYBOARD, u: { ki: { wVk: virtualKey, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } },
    )
  }
  return events
}

export function pressVirtualKey(virtualKey: number, times = 1): boolean {
  if (process.platform !== 'win32') return false
  const sendInput = loadSendInputApi()
  if (!sendInput || inputSize <= 0) return false
  const events = createVirtualKeyPressEvents(virtualKey, times)
  try {
    return sendInput(events.length, events, inputSize) === events.length
  } catch {
    return false
  }
}
