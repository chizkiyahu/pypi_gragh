import { compare, satisfies, valid } from '@renovatebot/pep440'
import type {
  DependencyInsights,
  MarkerComparisonNode,
  MarkerContext,
  MarkerEvaluation,
  MarkerNode,
  MarkerOperand,
  MarkerOperator,
} from '../types.ts'
import { normalizePythonVersion } from './versions.ts'

interface Token {
  type: 'lparen' | 'rparen' | 'logical' | 'operator' | 'identifier' | 'string'
  value: string
}

const VERSION_FIELDS = new Set([
  'python_version',
  'python_full_version',
  'implementation_version',
])

export function parseMarkerExpression(input: string): MarkerNode {
  const tokens = tokenize(input)
  let index = 0

  function peek(): Token | undefined {
    return tokens[index]
  }

  function consume(expected?: Token['type']): Token {
    const token = tokens[index]
    if (!token) {
      throw new Error('Unexpected end of marker expression')
    }
    if (expected && token.type !== expected) {
      throw new Error(`Expected ${expected} but found ${token.type}`)
    }
    index += 1
    return token
  }

  function parseOperand(): MarkerOperand {
    const token = peek()
    if (!token) {
      throw new Error('Expected marker operand')
    }

    if (token.type === 'identifier') {
      consume()
      return { kind: 'identifier', value: token.value }
    }

    if (token.type === 'string') {
      consume()
      return { kind: 'string', value: token.value }
    }

    throw new Error('Expected marker operand')
  }

  function parseComparison(): MarkerNode {
    const left = parseOperand()
    const operator = consume('operator').value as MarkerOperator
    const right = parseOperand()
    return { kind: 'comparison', left, operator, right }
  }

  function parsePrimary(): MarkerNode {
    if (peek()?.type === 'lparen') {
      consume('lparen')
      const node = parseOr()
      consume('rparen')
      return node
    }

    return parseComparison()
  }

  function parseAnd(): MarkerNode {
    const children = [parsePrimary()]
    while (peek()?.type === 'logical' && peek()?.value === 'and') {
      consume('logical')
      children.push(parsePrimary())
    }

    return children.length === 1 ? children[0] : { kind: 'group', operator: 'and', children }
  }

  function parseOr(): MarkerNode {
    const children = [parseAnd()]
    while (peek()?.type === 'logical' && peek()?.value === 'or') {
      consume('logical')
      children.push(parseAnd())
    }

    return children.length === 1 ? children[0] : { kind: 'group', operator: 'or', children }
  }

  const expression = parseOr()
  if (index !== tokens.length) {
    throw new Error('Unexpected trailing marker tokens')
  }

  return expression
}

export function evaluateMarker(node: MarkerNode, context: MarkerContext, markerText: string): MarkerEvaluation {
  return {
    active: evaluateNode(node, context),
    reason: `Excluded by marker: ${markerText}`,
  }
}

export function collectMarkerInsights(node: MarkerNode, insights: MutableInsights, markerText: string): void {
  walk(node, (comparison) => {
    const identifiers = [comparison.left, comparison.right].filter(
      (operand): operand is MarkerOperand => operand.kind === 'identifier',
    )

    for (const operand of identifiers) {
      insights.markerFields.add(operand.value)
    }

    const leftIdentifier = comparison.left.kind === 'identifier' ? comparison.left.value : null
    const rightIdentifier = comparison.right.kind === 'identifier' ? comparison.right.value : null
    const leftString = comparison.left.kind === 'string' ? comparison.left.value : null
    const rightString = comparison.right.kind === 'string' ? comparison.right.value : null

    const identifier = leftIdentifier ?? rightIdentifier
    const literal = leftString ?? rightString

    if (!identifier || !literal) {
      return
    }

    if (identifier === 'extra') {
      insights.extras.add(literal)
    }

    if (identifier === 'sys_platform' || identifier === 'platform_system') {
      const platform = normalizePlatformToken(literal)
      if (platform) {
        insights.platforms.add(platform)
      }
    }

    if (identifier === 'python_version' || identifier === 'python_full_version') {
      insights.pythonMarkers.add(markerText)
    }
  })
}

export interface MutableInsights {
  extras: Set<string>
  platforms: Set<string>
  pythonMarkers: Set<string>
  markerFields: Set<string>
}

export function createMutableInsights(rootExtras: string[]): MutableInsights {
  return {
    extras: new Set(rootExtras),
    platforms: new Set<string>(),
    pythonMarkers: new Set<string>(),
    markerFields: new Set<string>(),
  }
}

export function finalizeInsights(rootExtras: string[], mutable: MutableInsights): DependencyInsights {
  return {
    rootExtras: [...new Set(rootExtras)].sort((left, right) => left.localeCompare(right)),
    observedExtras: [...mutable.extras].sort((left, right) => left.localeCompare(right)),
    observedPlatforms: [...mutable.platforms].sort((left, right) => left.localeCompare(right)),
    pythonMarkers: [...mutable.pythonMarkers].sort((left, right) => left.localeCompare(right)),
    markerFields: [...mutable.markerFields].sort((left, right) => left.localeCompare(right)),
  }
}

export function normalizePlatformToken(value: string): string | null {
  const normalized = value.toLowerCase()
  if (normalized === 'linux') {
    return 'linux'
  }
  if (normalized === 'win32' || normalized === 'windows') {
    return 'windows'
  }
  if (normalized === 'darwin' || normalized === 'macos') {
    return 'macos'
  }
  return null
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index]

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (char === '(') {
      tokens.push({ type: 'lparen', value: char })
      index += 1
      continue
    }

    if (char === ')') {
      tokens.push({ type: 'rparen', value: char })
      index += 1
      continue
    }

    const operatorMatch =
      input.slice(index).match(/^(not\s+in\b|===|==|!=|<=|>=|~=|<|>|in\b)/) ?? null
    if (operatorMatch) {
      tokens.push({
        type: operatorMatch[1] === 'in' || operatorMatch[1].includes('in') ? 'operator' : 'operator',
        value: operatorMatch[1].replace(/\s+/g, ' '),
      })
      index += operatorMatch[0].length
      continue
    }

    const logicalMatch = input.slice(index).match(/^(and|or)\b/)
    if (logicalMatch) {
      tokens.push({ type: 'logical', value: logicalMatch[1] })
      index += logicalMatch[0].length
      continue
    }

    if (char === '"' || char === "'") {
      const quote = char
      let cursor = index + 1
      let value = ''
      while (cursor < input.length) {
        const next = input[cursor]
        if (next === '\\') {
          value += input[cursor + 1] ?? ''
          cursor += 2
          continue
        }
        if (next === quote) {
          break
        }
        value += next
        cursor += 1
      }

      if (input[cursor] !== quote) {
        throw new Error('Unterminated quoted marker value')
      }

      tokens.push({ type: 'string', value })
      index = cursor + 1
      continue
    }

    const identifierMatch = input.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (identifierMatch) {
      tokens.push({ type: 'identifier', value: identifierMatch[0] })
      index += identifierMatch[0].length
      continue
    }

    throw new Error(`Unexpected marker token near "${input.slice(index, index + 12)}"`)
  }

  return tokens
}

function walk(node: MarkerNode, visitor: (comparison: MarkerComparisonNode) => void): void {
  if (node.kind === 'comparison') {
    visitor(node)
    return
  }

  for (const child of node.children) {
    walk(child, visitor)
  }
}

function evaluateNode(node: MarkerNode, context: MarkerContext): boolean {
  if (node.kind === 'group') {
    if (node.operator === 'and') {
      return node.children.every((child) => evaluateNode(child, context))
    }
    return node.children.some((child) => evaluateNode(child, context))
  }

  return evaluateComparison(node, context)
}

function evaluateComparison(node: MarkerComparisonNode, context: MarkerContext): boolean {
  const leftIdentifier = node.left.kind === 'identifier' ? node.left.value : null
  const rightIdentifier = node.right.kind === 'identifier' ? node.right.value : null

  if (leftIdentifier === 'extra' || rightIdentifier === 'extra') {
    return evaluateExtraComparison(node, context)
  }

  const left = resolveOperand(node.left, context)
  const right = resolveOperand(node.right, context)
  const versionField = leftIdentifier && VERSION_FIELDS.has(leftIdentifier)
    ? leftIdentifier
    : rightIdentifier && VERSION_FIELDS.has(rightIdentifier)
      ? rightIdentifier
      : null

  if (versionField) {
    return compareVersionValues(left, node.operator, right)
  }

  return compareStrings(left, node.operator, right)
}

function evaluateExtraComparison(node: MarkerComparisonNode, context: MarkerContext): boolean {
  const extras = context.extras.length > 0 ? context.extras : ['']
  return extras.some((extra) => {
    const left = node.left.kind === 'identifier' && node.left.value === 'extra'
      ? extra
      : node.left.value
    const right = node.right.kind === 'identifier' && node.right.value === 'extra'
      ? extra
      : node.right.value
    return compareStrings(left, node.operator, right)
  })
}

function resolveOperand(operand: MarkerOperand, context: MarkerContext): string {
  if (operand.kind === 'string') {
    return operand.value
  }

  switch (operand.value) {
    case 'python_version':
      return context.pythonVersion
    case 'python_full_version':
      return context.pythonFullVersion
    case 'sys_platform':
      return context.sysPlatform
    case 'platform_system':
      return context.platformSystem
    case 'os_name':
      return context.osName
    case 'platform_machine':
      return context.platformMachine
    case 'implementation_name':
      return context.implementationName
    case 'implementation_version':
      return context.implementationVersion
    case 'platform_python_implementation':
      return context.platformPythonImplementation
    case 'extra':
      return context.extras[0] ?? ''
    default:
      return ''
  }
}

function compareVersionValues(left: string, operator: MarkerOperator, right: string): boolean {
  const normalizedLeft = valid(left) ?? normalizePythonVersion(left)
  const normalizedRight = valid(right) ?? normalizePythonVersion(right)

  if (operator === '==' || operator === '!=' || operator === '~=' || operator === '===') {
    const matches = satisfies(normalizedLeft, `${operator}${normalizedRight}`, { prereleases: true })
    return operator === '!=' ? !matches : matches
  }

  const relation = compare(normalizedLeft, normalizedRight)
  switch (operator) {
    case '<':
      return relation < 0
    case '<=':
      return relation <= 0
    case '>':
      return relation > 0
    case '>=':
      return relation >= 0
    case 'in':
      return normalizedRight.includes(normalizedLeft)
    case 'not in':
      return !normalizedRight.includes(normalizedLeft)
    default:
      return false
  }
}

function compareStrings(left: string, operator: MarkerOperator, right: string): boolean {
  const relation = left.localeCompare(right)
  switch (operator) {
    case '==':
    case '===':
      return left === right
    case '!=':
      return left !== right
    case '<':
      return relation < 0
    case '<=':
      return relation <= 0
    case '>':
      return relation > 0
    case '>=':
      return relation >= 0
    case 'in':
      return right.includes(left)
    case 'not in':
      return !right.includes(left)
    case '~=':
      return left.startsWith(right)
    default:
      return false
  }
}
