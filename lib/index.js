/**
 * @import {CompileContext, Extension as FromMarkdownExtension, Handle as FromMarkdownHandle, Token} from 'mdast-util-from-markdown'
 * @import {Options as ToMarkdownExtension, Handle as ToMarkdownHandle, State, Info} from 'mdast-util-to-markdown'
 * @import {Emphasis, Strong, Link, Image, InlineCode, Heading, Code, Paragraph, Text, Nodes, Parents, Root, RootContent, PhrasingContent} from 'mdast'
 */

import {parseEntities} from 'parse-entities'
import {stringifyEntitiesLight} from 'stringify-entities'

/**
 * @typedef MdastAttributes
 * @property {'mdastAttributes'} type
 * @property {Record<string, string>} attributes
 * @property {import('unist').Position} [position]
 */

// Regex to match trailing attributes: {#id .class key="value"}
const trailingAttributesRegex = /(\s*)\{([^}]+)\}(\s*)$/

// Regex to parse individual attributes within braces
const attributeRegex = /(?:#([\w-]+))|(?:\.([\w-]+))|(?:([\w-:]+)(?:=(?:"([^"]*)"|'([^']*)'|([\w-]+)))?)/g

/**
 * Create an extension for `mdast-util-from-markdown` to enable attributes.
 *
 * This is a pure parsing extension that creates `mdastAttributes` nodes
 * with correct position information. It does NOT determine where attributes
 * should attach - that's the responsibility of a transform plugin.
 *
 * @returns {FromMarkdownExtension}
 */
export function attributesFromMarkdown() {
  return {
    enter: {
      attributes: enterAttributes
    },
    exit: {
      attributes: exitAttributes,
      attribute: exitAttribute,
      attributeIdValue: exitAttributeIdValue,
      attributeClassValue: exitAttributeClassValue,
      attributeName: exitAttributeName,
      attributeValue: exitAttributeValue,
      attributeValueData: exitAttributeValueData
    },
    transforms: [transformBlockAttributes]
  }
}

// =============================================================================
// Block-level attribute parsing (extracts attributes from text in blocks)
// =============================================================================

/**
 * Transform to process block-level attributes into nodes.
 * Creates `mdastAttributes` nodes with correct positions.
 * Recursively processes all block elements including list items and blockquotes.
 *
 * @param {Root} tree
 * @returns {Root}
 */
function transformBlockAttributes(tree) {
  processBlockChildren(tree.children)
  return tree
}

/**
 * Recursively process block children for attributes.
 * @param {Array<Nodes>} children
 */
function processBlockChildren(children) {
  for (let i = 0; i < children.length; i++) {
    const node = children[i]

    if (node.type === 'heading') {
      processHeadingAttributes(node)
    } else if (node.type === 'paragraph') {
      processParagraphAttributes(node)
    } else if (node.type === 'code') {
      processCodeAttributes(node)
    } else if (node.type === 'blockquote') {
      processBlockquoteAttributes(node)
    } else if (node.type === 'list') {
      processListAttributes(node)
    } else if (node.type === 'listItem') {
      processListItemAttributes(node)
    } else if (node.type === 'table') {
      processTableAttributes(node)
    }
  }
}

/**
 * Process attributes on a blockquote.
 * @param {import('mdast').Blockquote} node
 */
function processBlockquoteAttributes(node) {
  if (!node.children) return
  processBlockChildren(node.children)
}

/**
 * Process attributes on a list.
 * @param {import('mdast').List} node
 */
function processListAttributes(node) {
  if (!node.children) return
  processBlockChildren(node.children)
}

/**
 * Process attributes on a list item.
 * @param {import('mdast').ListItem} node
 */
function processListItemAttributes(node) {
  if (!node.children) return
  processBlockChildren(node.children)
}

/**
 * Process attributes on a table.
 * @param {import('mdast').Table} node
 */
function processTableAttributes(node) {
  if (!node.children) return
  for (const row of node.children) {
    if (row.children) {
      for (const cell of row.children) {
        if (cell.children) {
          processBlockChildren(cell.children)
        }
      }
    }
  }
}

/**
 * Process trailing attributes on a heading.
 * @param {Heading} node
 */
function processHeadingAttributes(node) {
  if (!node.children || node.children.length === 0) return

  const lastIndex = node.children.length - 1
  const lastChild = node.children[lastIndex]
  if (lastChild.type !== 'text') return

  const match = lastChild.value.match(trailingAttributesRegex)
  if (!match) return

  const [fullMatch, leadingSpace, attrContent, trailingSpace] = match
  const attrs = parseAttributeString(attrContent)
  if (!attrs || Object.keys(attrs).length === 0) return

  const textValue = lastChild.value
  const attrStartIndex = textValue.length - fullMatch.length + leadingSpace.length
  const textEndIndex = textValue.length - fullMatch.length

  // Extract the source value (the {…} part)
  const sourceValue = textValue.slice(attrStartIndex)

  /** @type {MdastAttributes} */
  const attrNode = {
    type: 'mdastAttributes',
    attributes: attrs,
    value: sourceValue
  }

  if (lastChild.position) {
    const pos = lastChild.position
    const textBefore = textValue.slice(0, attrStartIndex)
    const linesInText = textBefore.split('\n')
    const lastLine = linesInText[linesInText.length - 1]

    const attrStartLine = pos.start.line + linesInText.length - 1
    const attrStartColumn = linesInText.length === 1
      ? pos.start.column + textBefore.length
      : lastLine.length + 1

    attrNode.position = {
      start: {
        line: attrStartLine,
        column: attrStartColumn,
        offset: pos.start.offset !== undefined ? pos.start.offset + attrStartIndex : undefined
      },
      end: {
        line: pos.end.line,
        column: pos.end.column,
        offset: pos.end.offset
      }
    }

    lastChild.position = {
      start: pos.start,
      end: {
        line: attrStartLine,
        column: linesInText.length === 1
          ? pos.start.column + textEndIndex
          : lastLine.length + 1 - leadingSpace.length,
        offset: pos.start.offset !== undefined ? pos.start.offset + textEndIndex : undefined
      }
    }
  }

  const textBeforeAttrs = textValue.slice(0, textEndIndex)

  if (textBeforeAttrs === '') {
    if (leadingSpace.length > 0) {
      // Preserve leading whitespace as a text node
      lastChild.value = leadingSpace
      // Update position to cover just the whitespace
      if (lastChild.position) {
        const pos = lastChild.position
        lastChild.position = {
          start: pos.start,
          end: {
            line: pos.start.line,
            column: pos.start.column + leadingSpace.length,
            offset: pos.start.offset !== undefined ? pos.start.offset + leadingSpace.length : undefined
          }
        }
      }
      node.children.push(attrNode)
    } else {
      // No text at all, replace with attrs
      node.children.splice(lastIndex, 1, attrNode)
    }
  } else {
    lastChild.value = textBeforeAttrs
    node.children.push(attrNode)
  }
}

/**
 * Process trailing attributes on a paragraph.
 * @param {Paragraph} node
 */
function processParagraphAttributes(node) {
  if (!node.children || node.children.length === 0) return

  const lastIndex = node.children.length - 1
  const lastChild = node.children[lastIndex]
  if (lastChild.type !== 'text') return

  const match = lastChild.value.match(trailingAttributesRegex)
  if (!match) return

  const [fullMatch, leadingSpace, attrContent, trailingSpace] = match
  const attrs = parseAttributeString(attrContent)
  if (!attrs || Object.keys(attrs).length === 0) return

  const textValue = lastChild.value
  const attrStartIndex = textValue.length - fullMatch.length + leadingSpace.length
  const textEndIndex = textValue.length - fullMatch.length

  // Extract the source value (the {…} part)
  const sourceValue = textValue.slice(attrStartIndex)

  /** @type {MdastAttributes} */
  const attrNode = {
    type: 'mdastAttributes',
    attributes: attrs,
    value: sourceValue
  }

  if (lastChild.position) {
    const pos = lastChild.position
    const textBefore = textValue.slice(0, attrStartIndex)
    const linesInText = textBefore.split('\n')
    const lastLine = linesInText[linesInText.length - 1]

    const attrStartLine = pos.start.line + linesInText.length - 1
    const attrStartColumn = linesInText.length === 1
      ? pos.start.column + textBefore.length
      : lastLine.length + 1

    attrNode.position = {
      start: {
        line: attrStartLine,
        column: attrStartColumn,
        offset: pos.start.offset !== undefined ? pos.start.offset + attrStartIndex : undefined
      },
      end: {
        line: pos.end.line,
        column: pos.end.column,
        offset: pos.end.offset
      }
    }

    lastChild.position = {
      start: pos.start,
      end: {
        line: attrStartLine,
        column: linesInText.length === 1
          ? pos.start.column + textEndIndex
          : lastLine.length + 1 - leadingSpace.length,
        offset: pos.start.offset !== undefined ? pos.start.offset + textEndIndex : undefined
      }
    }
  }

  const textBeforeAttrs = textValue.slice(0, textEndIndex)

  if (textBeforeAttrs === '') {
    if (leadingSpace.length > 0) {
      // Preserve leading whitespace as a text node
      lastChild.value = leadingSpace
      // Update position to cover just the whitespace
      if (lastChild.position) {
        const pos = lastChild.position
        lastChild.position = {
          start: pos.start,
          end: {
            line: pos.start.line,
            column: pos.start.column + leadingSpace.length,
            offset: pos.start.offset !== undefined ? pos.start.offset + leadingSpace.length : undefined
          }
        }
      }
      node.children.push(attrNode)
    } else {
      // No text at all, replace with attrs
      node.children.splice(lastIndex, 1, attrNode)
    }
  } else {
    lastChild.value = textBeforeAttrs
    node.children.push(attrNode)
  }
}

/**
 * Process attributes on a code block.
 * Stores attributes in data.mdastAttributes since code blocks don't have children.
 * @param {Code} node
 */
function processCodeAttributes(node) {
  /** @type {Record<string, string> | null} */
  let attrs = null

  // Case: attributes span both lang and meta
  if (node.lang && node.lang.startsWith('{') && node.meta && node.meta.endsWith('}')) {
    const fullAttrStr = node.lang.slice(1) + ' ' + node.meta.slice(0, -1)
    attrs = parseAttributeString(fullAttrStr)
    if (attrs && Object.keys(attrs).length > 0) {
      node.lang = null
      node.meta = null
    }
  }

  // Check meta for attributes
  if (!attrs && node.meta) {
    const match = node.meta.match(trailingAttributesRegex)
    if (match) {
      attrs = parseAttributeString(match[2])
      if (attrs && Object.keys(attrs).length > 0) {
        node.meta = node.meta.slice(0, -match[0].length).trim() || null
      }
    }
  }

  // Check lang for attributes
  if (!attrs && node.lang) {
    const fullMatch = node.lang.match(/^\{([^}]+)\}$/)
    if (fullMatch) {
      attrs = parseAttributeString(fullMatch[1])
      if (attrs && Object.keys(attrs).length > 0) {
        node.lang = null
      }
    } else {
      const match = node.lang.match(trailingAttributesRegex)
      if (match) {
        attrs = parseAttributeString(match[2])
        if (attrs && Object.keys(attrs).length > 0) {
          node.lang = node.lang.slice(0, -match[0].length).trim() || null
        }
      }
    }
  }

  // Store attributes in data for transform to handle
  if (attrs && Object.keys(attrs).length > 0) {
    node.data = node.data || {}
    node.data.mdastAttributes = attrs
  }
}

/**
 * Parse an attribute string like "#id .class key=value"
 * @param {string} str
 * @returns {Record<string, string>}
 */
function parseAttributeString(str) {
  /** @type {Record<string, string>} */
  const attrs = {}

  let match
  attributeRegex.lastIndex = 0

  while ((match = attributeRegex.exec(str)) !== null) {
    const [, id, cls, name, quotedDouble, quotedSingle, unquoted] = match

    if (id) {
      attrs.id = id
    } else if (cls) {
      attrs.class = attrs.class ? attrs.class + ' ' + cls : cls
    } else if (name) {
      const value = quotedDouble ?? quotedSingle ?? unquoted ?? ''
      attrs[name] = parseEntities(value, {attribute: true})
    }
  }

  return attrs
}

// =============================================================================
// fromMarkdown handlers for inline attributes (from tokens)
// =============================================================================

/**
 * @this {CompileContext}
 * @param {Token} token
 */
function enterAttributes(token) {
  this.data.attributesList = []
  this.data.attributeName = undefined
  this.data.attributeValue = undefined
  this.data.attributesToken = token
}

/**
 * @this {CompileContext}
 * @param {Token} token
 */
function exitAttributeIdValue(token) {
  const list = this.data.attributesList || []
  const value = parseEntities(this.sliceSerialize(token), {attribute: true})
  list.push(['id', value])
  this.data.attributesList = list
}

/**
 * @this {CompileContext}
 * @param {Token} token
 */
function exitAttributeClassValue(token) {
  const list = this.data.attributesList || []
  const value = parseEntities(this.sliceSerialize(token), {attribute: true})
  list.push(['class', value])
  this.data.attributesList = list
}

/**
 * @this {CompileContext}
 * @param {Token} token
 */
function exitAttributeName(token) {
  this.data.attributeName = this.sliceSerialize(token)
}

/**
 * @this {CompileContext}
 * @param {Token} token
 */
function exitAttributeValueData(token) {
  const existing = this.data.attributeValue || ''
  const chunk = this.sliceSerialize(token)
  this.data.attributeValue = existing + chunk
}

/**
 * @this {CompileContext}
 * @param {Token} token
 */
function exitAttributeValue(token) {
  const list = this.data.attributesList || []
  const name = this.data.attributeName
  const value = this.data.attributeValue || ''

  if (name) {
    const parsedValue = parseEntities(value, {attribute: true})
    list.push([name, parsedValue])
  }

  this.data.attributesList = list
  this.data.attributeName = undefined
  this.data.attributeValue = undefined
}

/**
 * Handle exit of a single attribute (for boolean attributes without value)
 * @this {CompileContext}
 * @param {Token} token
 */
function exitAttribute(token) {
  const list = this.data.attributesList || []
  const name = this.data.attributeName

  // If there's a pending name without a value, it's a boolean attribute
  if (name) {
    list.push([name, ''])
    this.data.attributesList = list
    this.data.attributeName = undefined
  }
}

/**
 * @this {CompileContext}
 * @param {Token} token
 */
function exitAttributes(token) {
  const list = this.data.attributesList || []
  const startToken = this.data.attributesToken

  this.data.attributesList = undefined
  this.data.attributesToken = undefined

  // Get the source text for the entire attributes block
  const sourceValue = this.sliceSerialize(token)

  if (list.length === 0) {
    return
  }

  /** @type {Record<string, string>} */
  const attributes = {}
  for (const [key, value] of list) {
    if (key === 'class' && attributes.class) {
      attributes.class += ' ' + value
    } else {
      attributes[key] = value
    }
  }

  // Create an mdastAttributes node with source value for text conversion
  /** @type {MdastAttributes} */
  const attrNode = {
    type: 'mdastAttributes',
    attributes,
    value: sourceValue
  }

  // Add position from token
  if (startToken && token) {
    attrNode.position = {
      start: {
        line: startToken.start.line,
        column: startToken.start.column,
        offset: startToken.start.offset
      },
      end: {
        line: token.end.line,
        column: token.end.column,
        offset: token.end.offset
      }
    }
  }

  // Add to parent's children
  const stack = this.stack
  if (!stack || stack.length === 0) return

  const parent = stack[stack.length - 1]
  if (!parent || !('children' in parent)) return

  // @ts-ignore - mdastAttributes is a custom node type
  parent.children.push(attrNode)
}

// =============================================================================
// toMarkdown
// =============================================================================

/**
 * Create an extension for `mdast-util-to-markdown` to serialize attributes.
 *
 * @returns {ToMarkdownExtension}
 */
export function attributesToMarkdown() {
  return {
    handlers: {
      emphasis: handleEmphasis,
      strong: handleStrong,
      link: handleLink,
      image: handleImage,
      inlineCode: handleInlineCode,
      heading: handleHeading,
      code: handleCode,
      mdastAttributes: handleMdastAttributes
    }
  }
}

/**
 * Serialize an mdastAttributes node
 * @type {ToMarkdownHandle}
 * @param {MdastAttributes} node
 */
function handleMdastAttributes(node, parent, state, info) {
  return serializeAttributes(node.attributes)
}

/**
 * Serialize attributes to markdown syntax
 * @param {Record<string, string> | undefined} props
 * @returns {string}
 */
function serializeAttributes(props) {
  if (!props || Object.keys(props).length === 0) {
    return ''
  }

  const parts = []

  if (props.id) {
    parts.push('#' + props.id)
  }

  if (props.class) {
    const classes = props.class.split(/\s+/)
    for (const cls of classes) {
      if (cls) {
        parts.push('.' + cls)
      }
    }
  }

  for (const [key, value] of Object.entries(props)) {
    if (key === 'id' || key === 'class') {
      continue
    }

    if (value === '' || value === true) {
      parts.push(key)
    } else {
      const escaped = stringifyEntitiesLight(String(value), {
        subset: ['"', '&']
      })
      parts.push(`${key}="${escaped}"`)
    }
  }

  if (parts.length === 0) {
    return ''
  }

  return '{' + parts.join(' ') + '}'
}

/**
 * Get attributes string from node's hProperties or mdastAttributes
 * @param {Nodes} node
 * @returns {string}
 */
function getAttributesString(node) {
  const props = node.data?.hProperties
  if (props && Object.keys(props).length > 0) {
    return serializeAttributes(props)
  }

  const mdastAttrs = node.data?.mdastAttributes
  if (mdastAttrs && Object.keys(mdastAttrs).length > 0) {
    return serializeAttributes(mdastAttrs)
  }

  return ''
}

/**
 * @type {ToMarkdownHandle}
 * @param {Emphasis} node
 */
function handleEmphasis(node, parent, state, info) {
  const tracker = state.createTracker(info)
  const marker = state.options.emphasis || '*'

  let value = tracker.move(marker)
  value += tracker.move(
    state.containerPhrasing(node, {
      before: value,
      after: marker,
      ...tracker.current()
    })
  )
  value += tracker.move(marker)
  value += getAttributesString(node)

  return value
}

/**
 * @type {ToMarkdownHandle}
 * @param {Strong} node
 */
function handleStrong(node, parent, state, info) {
  const tracker = state.createTracker(info)
  const marker = state.options.strong || '*'
  const doubleMarker = marker + marker

  let value = tracker.move(doubleMarker)
  value += tracker.move(
    state.containerPhrasing(node, {
      before: value,
      after: doubleMarker,
      ...tracker.current()
    })
  )
  value += tracker.move(doubleMarker)
  value += getAttributesString(node)

  return value
}

/**
 * @type {ToMarkdownHandle}
 * @param {Link} node
 */
function handleLink(node, parent, state, info) {
  const tracker = state.createTracker(info)

  let value = tracker.move('[')
  value += tracker.move(
    state.containerPhrasing(node, {
      before: value,
      after: '](',
      ...tracker.current()
    })
  )
  value += tracker.move('](')

  const url = state.safe(node.url, {before: value, after: ')'})
  value += tracker.move(url)

  if (node.title) {
    value += tracker.move(' "')
    value += tracker.move(
      state.safe(node.title, {before: '"', after: '"'})
    )
    value += tracker.move('"')
  }

  value += tracker.move(')')
  value += getAttributesString(node)

  return value
}

/**
 * @type {ToMarkdownHandle}
 * @param {Image} node
 */
function handleImage(node, parent, state, info) {
  const tracker = state.createTracker(info)

  let value = tracker.move('![')
  value += tracker.move(state.safe(node.alt || '', {before: '![', after: ']'}))
  value += tracker.move('](')

  const url = state.safe(node.url, {before: '](', after: ')'})
  value += tracker.move(url)

  if (node.title) {
    value += tracker.move(' "')
    value += tracker.move(
      state.safe(node.title, {before: '"', after: '"'})
    )
    value += tracker.move('"')
  }

  value += tracker.move(')')
  value += getAttributesString(node)

  return value
}

/**
 * @type {ToMarkdownHandle}
 * @param {InlineCode} node
 */
function handleInlineCode(node, parent, state, info) {
  const tracker = state.createTracker(info)
  const value = node.value || ''

  const backtickMatch = value.match(/`+/g)
  let backtickCount = 1

  if (backtickMatch) {
    const max = Math.max(...backtickMatch.map(m => m.length))
    backtickCount = max + 1
  }

  const backticks = '`'.repeat(backtickCount)

  const needsSpace = value.startsWith('`') ||
    value.endsWith('`') ||
    (value.startsWith(' ') && value.endsWith(' ') && value.trim())

  let result = tracker.move(backticks)
  if (needsSpace) {
    result += tracker.move(' ')
  }
  result += tracker.move(value)
  if (needsSpace) {
    result += tracker.move(' ')
  }
  result += tracker.move(backticks)
  result += getAttributesString(node)

  return result
}

/**
 * @type {ToMarkdownHandle}
 * @param {Heading} node
 */
function handleHeading(node, parent, state, info) {
  const tracker = state.createTracker(info)
  const depth = node.depth || 1
  const marker = '#'.repeat(depth)

  let value = tracker.move(marker + ' ')
  value += tracker.move(
    state.containerPhrasing(node, {
      before: value,
      after: '\n',
      ...tracker.current()
    })
  )

  const attrs = getAttributesString(node)
  if (attrs) {
    value += ' ' + attrs
  }

  return value
}

/**
 * @type {ToMarkdownHandle}
 * @param {Code} node
 */
function handleCode(node, parent, state, info) {
  const tracker = state.createTracker(info)
  const fence = '```'

  let value = tracker.move(fence)

  if (node.lang) {
    value += tracker.move(node.lang)
  }

  const attrs = getAttributesString(node)
  if (attrs) {
    value += ' ' + attrs
  }

  value += tracker.move('\n')

  if (node.value) {
    value += tracker.move(node.value)
    if (!node.value.endsWith('\n')) {
      value += tracker.move('\n')
    }
  }

  value += tracker.move(fence)

  return value
}
