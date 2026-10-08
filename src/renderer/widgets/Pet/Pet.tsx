import { useEffect, useRef, useState } from 'react'
import { FrostedGlassBackground } from '../FrostedGlassBackground'
import { PixelPetCanvas } from '@renderer/shared/PixelPetCanvas'
import {
  PIXEL_PET_STATES,
  createDefaultPixelPets,
  normalizePixelPet,
  normalizePixelPetSettings,
  resolvePixelPetPalette,
  type PixelPet,
  type PixelPetSettings,
  type PixelPetStateKey,
} from '@renderer/shared/pixel-pet'
import { useWidgetCommands } from '../shared/widgetCommandBus'
import './pet.css'

const CLICK_SLOP_PX = 5
const CLICK_MAX_MS = 500
const CLICK_REACTION_MS = 900

export function PetWidget({ config, editing = false }: { config?: Record<string, unknown>; editing?: boolean }) {
  const { pet, settings } = readPixelPetWidgetConfig(config)
  const palette = resolvePixelPetPalette(pet, settings.theme)
  // What the companion is doing right now (thinking, searching...), and short reactions on top of it.
  const [phaseState, setPhaseState] = useState<PixelPetStateKey | null>(null)
  const [reaction, setReaction] = useState<{ state?: PixelPetStateKey; message?: string } | null>(null)
  // A reply spoken while the chat was closed leaves a dot until the pet is clicked.
  const [unread, setUnread] = useState(false)
  const reactionTimer = useRef<number | null>(null)

  const react = (next: { state?: PixelPetStateKey; message?: string }, durationMs: number) => {
    if (reactionTimer.current) window.clearTimeout(reactionTimer.current)
    setReaction(next)
    reactionTimer.current = window.setTimeout(() => {
      setReaction(null)
      reactionTimer.current = null
      if (next.message) setUnread(true)
    }, durationMs)
  }

  useWidgetCommands('pet', (command) => {
    if (command.command === 'phase') {
      setPhaseState(command.state && command.state in PIXEL_PET_STATES ? command.state : null)
      return
    }
    const state = command.state && command.state in PIXEL_PET_STATES ? command.state : undefined
    react({ state, message: command.message }, command.durationMs)
  })

  const onClick = () => {
    setUnread(false)
    if (!reaction?.message) react({ state: 'joy' }, CLICK_REACTION_MS)
    window.canvasBridge?.toggleQuickChat?.()
  }

  useEffect(() => () => {
    if (reactionTimer.current) window.clearTimeout(reactionTimer.current)
  }, [])

  const shownState: PixelPetStateKey = reaction?.state ?? phaseState ?? settings.state
  const shownSettings: PixelPetSettings = shownState === settings.state ? settings : { ...settings, state: shownState }
  const message = reaction?.message

  return (
    <div
      className={`pet-widget ${editing ? '' : 'pet-widget--clickable'}`}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: 16,
        border: '1px solid rgba(0,0,0,0.08)',
        overflow: 'hidden',
        cursor: editing ? undefined : 'pointer',
      }}
      title={editing ? undefined : unread ? '有新回复，点我看看' : '点我说话'}
      onPointerDown={(event) => {
        if (editing || event.button !== 0) return
        const start = { x: event.clientX, y: event.clientY, at: Date.now() }
        // The canvas captures the pointer for long-press dragging, so the release
        // is watched on the window: only a short, still press opens the chat.
        window.addEventListener('pointerup', (up) => {
          const moved = Math.hypot(up.clientX - start.x, up.clientY - start.y)
          if (moved <= CLICK_SLOP_PX && Date.now() - start.at <= CLICK_MAX_MS) onClick()
        }, { once: true, capture: true })
      }}
    >
      <FrostedGlassBackground overlayColor="rgba(253,249,243,0.70)" />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.34,
          backgroundImage: `linear-gradient(${palette.inkSoft}22 1px, transparent 1px), linear-gradient(90deg, ${palette.inkSoft}22 1px, transparent 1px)`,
          backgroundSize: '16px 16px',
        }}
      />
      {unread && !message && <div className="pet-widget__unread" aria-label="有新回复" />}
      {!editing && !message && <div className="pet-widget__hint">点我聊天</div>}
      {message && (
        <div
          className="pet-widget__bubble"
          style={{
            position: 'absolute',
            zIndex: 2,
            top: 8,
            left: 8,
            right: 8,
            padding: '6px 8px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.94)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            color: palette.ink,
            fontSize: 11.5,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {message}
        </div>
      )}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: message ? 'flex-end' : 'center',
          width: '100%',
          height: '100%',
          gap: 6,
          paddingBottom: message ? 8 : 0,
          boxSizing: 'border-box',
        }}
      >
        <PixelPetCanvas pet={pet} settings={shownSettings} width={112} height={message ? 72 : 90} />
        {!message && (
          <>
            <div
              style={{
                maxWidth: '86%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: 700,
                color: palette.ink,
              }}
            >
              {settings.petName || pet.name}
            </div>
            <div style={{ fontSize: 11, color: palette.inkSoft }}>{PIXEL_PET_STATES[shownState].label}</div>
          </>
        )}
      </div>
    </div>
  )
}

function readPixelPetWidgetConfig(config?: Record<string, unknown>): { pet: PixelPet; settings: PixelPetSettings } {
  const defaults = createDefaultPixelPets()
  const fallbackSettings = normalizePixelPetSettings({}, defaults)
  const pixelConfig = isRecord(config?.pixelPet) ? config.pixelPet : {}
  const pet = isRecord(pixelConfig.pet) ? normalizePixelPet(pixelConfig.pet) : defaults[0]
  const settings = normalizePixelPetSettings(isRecord(pixelConfig.settings) ? pixelConfig.settings : fallbackSettings, [pet, ...defaults])
  return {
    pet,
    settings: {
      ...settings,
      petId: pet.id,
      petName: settings.petName || pet.name,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
