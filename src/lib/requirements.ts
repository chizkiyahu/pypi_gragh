import type { ParsedRequirement } from '../types.ts'
import { parseMarkerExpression } from './marker.ts'
import { normalizePackageName } from './versions.ts'

export function parseRequirement(raw: string): ParsedRequirement {
  const trimmed = raw.trim()
  const markerSplit = splitRequirementMarker(trimmed)
  const requirementPart = markerSplit.requirementPart.trim()
  const markerText = markerSplit.markerText
  const match = requirementPart.match(
    /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([A-Za-z0-9._,\s-]+)\])?\s*(.*)$/,
  )

  if (!match) {
    throw new Error(`Unsupported requirement format: ${raw}`)
  }

  const name = match[1]
  const extras = match[2]
    ? match[2]
        .split(',')
        .map((extra) => extra.trim())
        .filter(Boolean)
    : []
  const remainder = match[3].trim()

  let directReference: string | null = null
  let specifier = ''

  if (remainder.startsWith('@')) {
    directReference = remainder.slice(1).trim()
  } else if (remainder) {
    specifier = remainder.replace(/\s+/g, '')
  }

  return {
    raw,
    name,
    normalizedName: normalizePackageName(name),
    extras,
    specifier,
    markerText,
    markerAst: markerText ? parseMarkerExpression(markerText) : null,
    directReference,
  }
}

function splitRequirementMarker(raw: string): { requirementPart: string; markerText: string | null } {
  let quote: '"' | "'" | null = null

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (quote) {
      if (char === '\\') {
        index += 1
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === ';') {
      return {
        requirementPart: raw.slice(0, index),
        markerText: raw.slice(index + 1).trim(),
      }
    }
  }

  return {
    requirementPart: raw,
    markerText: null,
  }
}
