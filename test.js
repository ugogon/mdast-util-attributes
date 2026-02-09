/**
 * @import {Root, Nodes, Parents, Code} from 'mdast'
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {fromMarkdown} from 'mdast-util-from-markdown'
import {toMarkdown} from 'mdast-util-to-markdown'
import {attributes} from 'micromark-extension-attributes'
import {attributesFromMarkdown, attributesToMarkdown} from './lib/index.js'

// =============================================================================
// Minimal transform for testing (since transform is now in remark-attributes)
// This is a simplified version - the full version is in remark-attributes
// =============================================================================

/** @type {Set<string>} Inline element types */
const INLINE_TYPES = new Set(['emphasis', 'strong', 'link', 'image', 'inlineCode'])

/** @type {Set<string>} Block element types */
const BLOCK_TYPES = new Set(['heading', 'paragraph', 'code', 'blockquote', 'list', 'listItem'])

/**
 * Transform mdastAttributes nodes to hProperties (for testing)
 * @param {Root} tree
 * @returns {Root}
 */
function attributesTransform(tree) {
  processCodeBlocks(tree)
  processStandaloneAttributeParagraphs(tree)
  processNode(tree)
  return tree
}

/** @param {Nodes} node */
function processCodeBlocks(node) {
  if (node.type === 'code') {
    const code = /** @type {Code} */ (node)
    if (code.data?.mdastAttributes) {
      code.data.hProperties = code.data.hProperties || {}
      mergeAttributes(code.data.hProperties, code.data.mdastAttributes)
      delete code.data.mdastAttributes
    }
    return
  }
  if ('children' in node) {
    for (const child of node.children) processCodeBlocks(child)
  }
}

/** @param {Root} tree */
function processStandaloneAttributeParagraphs(tree) {
  processStandaloneInParent(tree)
}

/** @param {Parents} parent */
function processStandaloneInParent(parent) {
  if (!('children' in parent)) return
  for (let i = parent.children.length - 1; i >= 0; i--) {
    const child = parent.children[i]
    if (child.type === 'paragraph' && child.children.length === 1 &&
        child.children[0].type === 'mdastAttributes' && i > 0) {
      const prev = parent.children[i - 1]
      if (BLOCK_TYPES.has(prev.type)) {
        mergeAttributesToNode(prev, child.children[0].attributes)
        parent.children.splice(i, 1)
        continue
      }
    }
    if ('children' in child) processStandaloneInParent(/** @type {Parents} */ (child))
  }
}

/** @param {Nodes} node */
function processNode(node) {
  if (!('children' in node)) return
  const nodeWithChildren = /** @type {Parents} */ (node)
  for (let i = nodeWithChildren.children.length - 1; i >= 0; i--) {
    const child = nodeWithChildren.children[i]
    if (child.type === 'mdastAttributes') {
      handleAttributeNode(nodeWithChildren, i, child)
    } else {
      processNode(child)
    }
  }
}

/** @param {Parents} parent @param {number} index @param {*} attrNode */
function handleAttributeNode(parent, index, attrNode) {
  const children = parent.children
  const prev = index > 0 ? children[index - 1] : null

  if (prev && INLINE_TYPES.has(prev.type)) {
    const gap = (attrNode.position?.start?.offset ?? -1) - (prev.position?.end?.offset ?? 0)
    if (gap === 0) {
      mergeAttributesToNode(prev, attrNode.attributes)
      children.splice(index, 1)
      return
    }
  }

  if (index === children.length - 1 && BLOCK_TYPES.has(parent.type)) {
    mergeAttributesToNode(parent, attrNode.attributes)
    children.splice(index, 1)
    return
  }

  children[index] = {type: 'text', value: '{...}', position: attrNode.position}
}

/** @param {Nodes} node @param {Record<string,string>} attrs */
function mergeAttributesToNode(node, attrs) {
  // @ts-ignore
  node.data = node.data || {}
  // @ts-ignore
  node.data.hProperties = node.data.hProperties || {}
  mergeAttributes(node.data.hProperties, attrs)
}

/** @param {Record<string,string>} target @param {Record<string,string>} source */
function mergeAttributes(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (key === 'class' && target.class) target.class += ' ' + value
    else target[key] = value
  }
}

// =============================================================================
// Test helpers
// =============================================================================

/**
 * Parse markdown to mdast with attributes extension (both phases)
 * @param {string} markdown
 * @returns {Root}
 */
function parse(markdown) {
  const tree = fromMarkdown(markdown, {
    extensions: [attributes()],
    mdastExtensions: [attributesFromMarkdown()]
  })
  return attributesTransform(tree)
}

/**
 * Parse markdown to mdast with attributes extension (phase 1 only)
 * @param {string} markdown
 * @returns {Root}
 */
function parsePhase1(markdown) {
  return fromMarkdown(markdown, {
    extensions: [attributes()],
    mdastExtensions: [attributesFromMarkdown()]
  })
}

/**
 * Serialize mdast to markdown with attributes extension
 * @param {Root} tree
 * @returns {string}
 */
function serialize(tree) {
  return toMarkdown(tree, {
    extensions: [attributesToMarkdown()]
  })
}

// =============================================================================
// fromMarkdown: Emphasis with attributes
// =============================================================================

test('fromMarkdown: emphasis with class', async (t) => {
  const tree = parse('*em*{.highlight}')
  const paragraph = tree.children[0]

  assert.equal(paragraph.type, 'paragraph')
  assert.equal(paragraph.children.length, 1)

  const emphasis = paragraph.children[0]
  assert.equal(emphasis.type, 'emphasis')
  assert.deepEqual(emphasis.data?.hProperties, {class: 'highlight'})
})

test('fromMarkdown: emphasis with id', async (t) => {
  const tree = parse('*em*{#my-id}')
  const paragraph = tree.children[0]
  const emphasis = paragraph.children[0]

  assert.equal(emphasis.type, 'emphasis')
  assert.deepEqual(emphasis.data?.hProperties, {id: 'my-id'})
})

test('fromMarkdown: strong with multiple classes', async (t) => {
  const tree = parse('**strong**{.class1 .class2}')
  const paragraph = tree.children[0]
  const strong = paragraph.children[0]

  assert.equal(strong.type, 'strong')
  assert.deepEqual(strong.data?.hProperties, {class: 'class1 class2'})
})

test('fromMarkdown: emphasis with combined attributes', async (t) => {
  const tree = parse('*em*{#my-id .highlight data-value="test"}')
  const paragraph = tree.children[0]
  const emphasis = paragraph.children[0]

  assert.equal(emphasis.type, 'emphasis')
  assert.deepEqual(emphasis.data?.hProperties, {
    id: 'my-id',
    class: 'highlight',
    'data-value': 'test'
  })
})

// =============================================================================
// fromMarkdown: Links with attributes
// =============================================================================

test('fromMarkdown: link with target', async (t) => {
  const tree = parse('[link](https://example.com){target="_blank"}')
  const paragraph = tree.children[0]
  const link = paragraph.children[0]

  assert.equal(link.type, 'link')
  assert.equal(link.url, 'https://example.com')
  assert.deepEqual(link.data?.hProperties, {target: '_blank'})
})

test('fromMarkdown: link with multiple attributes', async (t) => {
  const tree = parse('[link](url){rel="noopener" target="_blank"}')
  const paragraph = tree.children[0]
  const link = paragraph.children[0]

  assert.equal(link.type, 'link')
  assert.deepEqual(link.data?.hProperties, {
    rel: 'noopener',
    target: '_blank'
  })
})

test('fromMarkdown: link with id and class', async (t) => {
  const tree = parse('[link](url){#nav-link .external}')
  const paragraph = tree.children[0]
  const link = paragraph.children[0]

  assert.equal(link.type, 'link')
  assert.deepEqual(link.data?.hProperties, {
    id: 'nav-link',
    class: 'external'
  })
})

// =============================================================================
// fromMarkdown: Inline code with attributes
// =============================================================================

test('fromMarkdown: inline code with class', async (t) => {
  const tree = parse('`code`{.language-js}')
  const paragraph = tree.children[0]
  const code = paragraph.children[0]

  assert.equal(code.type, 'inlineCode')
  assert.deepEqual(code.data?.hProperties, {class: 'language-js'})
})

// =============================================================================
// fromMarkdown: Images with attributes
// =============================================================================

test('fromMarkdown: image with class', async (t) => {
  const tree = parse('![alt](image.png){.responsive}')
  const paragraph = tree.children[0]
  const image = paragraph.children[0]

  assert.equal(image.type, 'image')
  assert.deepEqual(image.data?.hProperties, {class: 'responsive'})
})

test('fromMarkdown: image with dimensions', async (t) => {
  const tree = parse('![alt](image.png){width="100" height="100"}')
  const paragraph = tree.children[0]
  const image = paragraph.children[0]

  assert.equal(image.type, 'image')
  assert.deepEqual(image.data?.hProperties, {
    width: '100',
    height: '100'
  })
})

// =============================================================================
// fromMarkdown: Space prevents attachment
// =============================================================================

test('fromMarkdown: space prevents inline attachment', async (t) => {
  const tree = parse('*em* {.class}')
  const paragraph = tree.children[0]

  // Emphasis should NOT have attributes (space prevents inline attachment)
  const emphasis = paragraph.children[0]
  assert.equal(emphasis.type, 'emphasis')
  assert.equal(emphasis.data?.hProperties, undefined)

  // Paragraph SHOULD have attributes (trailing block attributes)
  assert.deepEqual(paragraph.data?.hProperties, {class: 'class'})
})

// =============================================================================
// fromMarkdown: Mixed content
// =============================================================================

test('fromMarkdown: text before and after', async (t) => {
  const tree = parse('text *em*{.class} more text')
  const paragraph = tree.children[0]

  // Should have: text, emphasis with attrs, text
  assert.ok(paragraph.children.length >= 3)

  const emphasis = paragraph.children.find(c => c.type === 'emphasis')
  assert.ok(emphasis)
  assert.deepEqual(emphasis.data?.hProperties, {class: 'class'})
})

test('fromMarkdown: nested elements with attributes', async (t) => {
  const tree = parse('*outer `inner`{.inner}*{.outer}')
  const paragraph = tree.children[0]

  const emphasis = paragraph.children[0]
  assert.equal(emphasis.type, 'emphasis')
  assert.deepEqual(emphasis.data?.hProperties, {class: 'outer'})

  // Find the inline code inside emphasis
  const code = emphasis.children.find(c => c.type === 'inlineCode')
  assert.ok(code)
  assert.deepEqual(code.data?.hProperties, {class: 'inner'})
})

// =============================================================================
// toMarkdown: Serialize attributes
// =============================================================================

test('toMarkdown: emphasis with class', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'paragraph',
      children: [{
        type: 'emphasis',
        data: {hProperties: {class: 'highlight'}},
        children: [{type: 'text', value: 'em'}]
      }]
    }]
  }

  const result = serialize(tree)
  assert.ok(result.includes('*em*'))
  assert.ok(result.includes('{.highlight}'))
})

test('toMarkdown: emphasis with id', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'paragraph',
      children: [{
        type: 'emphasis',
        data: {hProperties: {id: 'my-id'}},
        children: [{type: 'text', value: 'em'}]
      }]
    }]
  }

  const result = serialize(tree)
  assert.ok(result.includes('*em*'))
  assert.ok(result.includes('{#my-id}'))
})

test('toMarkdown: link with attributes', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'paragraph',
      children: [{
        type: 'link',
        url: 'https://example.com',
        data: {hProperties: {target: '_blank'}},
        children: [{type: 'text', value: 'link'}]
      }]
    }]
  }

  const result = serialize(tree)
  assert.ok(result.includes('[link](https://example.com)'))
  assert.ok(result.includes('{target="_blank"}'))
})

test('toMarkdown: multiple classes', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'paragraph',
      children: [{
        type: 'emphasis',
        data: {hProperties: {class: 'class1 class2'}},
        children: [{type: 'text', value: 'em'}]
      }]
    }]
  }

  const result = serialize(tree)
  assert.ok(result.includes('*em*'))
  assert.ok(result.includes('{.class1 .class2}'))
})

// =============================================================================
// Roundtrip tests
// =============================================================================

test('roundtrip: emphasis with class', async (t) => {
  const input = '*em*{.highlight}'
  const tree = parse(input)
  const output = serialize(tree)

  assert.ok(output.includes('*em*'))
  assert.ok(output.includes('{.highlight}'))
})

test('roundtrip: link with attributes', async (t) => {
  const input = '[link](url){target="_blank"}'
  const tree = parse(input)
  const output = serialize(tree)

  assert.ok(output.includes('[link](url)'))
  assert.ok(output.includes('{target="_blank"}'))
})

// =============================================================================
// Block elements: Headings
// =============================================================================

test('fromMarkdown: heading with id', async (t) => {
  const tree = parse('# Heading {#my-id}')

  assert.equal(tree.children[0].type, 'heading')
  assert.equal(tree.children[0].depth, 1)
  assert.deepEqual(tree.children[0].data?.hProperties, {id: 'my-id'})

  // The text should NOT contain the attributes
  const text = tree.children[0].children[0]
  assert.equal(text.type, 'text')
  assert.equal(text.value.trim(), 'Heading')
})

test('fromMarkdown: heading with class', async (t) => {
  const tree = parse('## Heading {.important}')

  assert.equal(tree.children[0].type, 'heading')
  assert.equal(tree.children[0].depth, 2)
  assert.deepEqual(tree.children[0].data?.hProperties, {class: 'important'})
})

test('fromMarkdown: heading with multiple attributes', async (t) => {
  const tree = parse('### Heading {#id .class1 .class2 data-level="3"}')

  const heading = tree.children[0]
  assert.equal(heading.type, 'heading')
  assert.deepEqual(heading.data?.hProperties, {
    id: 'id',
    class: 'class1 class2',
    'data-level': '3'
  })
})

test('fromMarkdown: heading with inline formatting and attributes', async (t) => {
  const tree = parse('# **Bold** Heading {#my-id}')

  const heading = tree.children[0]
  assert.equal(heading.type, 'heading')
  assert.deepEqual(heading.data?.hProperties, {id: 'my-id'})

  // Should have strong element
  const strong = heading.children.find(c => c.type === 'strong')
  assert.ok(strong)
})

// =============================================================================
// Block elements: Fenced code
// =============================================================================

test('fromMarkdown: fenced code with class', async (t) => {
  const tree = parse('```js {.highlight}\nconst x = 1\n```')

  const code = tree.children[0]
  assert.equal(code.type, 'code')
  assert.equal(code.lang, 'js')
  assert.deepEqual(code.data?.hProperties, {class: 'highlight'})
})

test('fromMarkdown: fenced code with id', async (t) => {
  const tree = parse('```python {#code-block}\nx = 1\n```')

  const code = tree.children[0]
  assert.equal(code.type, 'code')
  assert.equal(code.lang, 'python')
  assert.deepEqual(code.data?.hProperties, {id: 'code-block'})
})

test('fromMarkdown: fenced code with multiple attributes', async (t) => {
  const tree = parse('``` {#example .demo data-line="1-3"}\ncode\n```')

  const code = tree.children[0]
  assert.equal(code.type, 'code')
  assert.deepEqual(code.data?.hProperties, {
    id: 'example',
    class: 'demo',
    'data-line': '1-3'
  })
})

// =============================================================================
// Block elements: Paragraphs (trailing attributes)
// =============================================================================

test('fromMarkdown: paragraph with trailing class', async (t) => {
  const tree = parse('This is a paragraph. {.note}')

  const paragraph = tree.children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.deepEqual(paragraph.data?.hProperties, {class: 'note'})

  // The text should NOT contain the attributes
  const text = paragraph.children[0]
  assert.equal(text.type, 'text')
  assert.ok(!text.value.includes('{.note}'))
})

test('fromMarkdown: paragraph with trailing id and class', async (t) => {
  const tree = parse('Important content. {#notice .warning}')

  const paragraph = tree.children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.deepEqual(paragraph.data?.hProperties, {
    id: 'notice',
    class: 'warning'
  })
})

// =============================================================================
// Block elements: Mixed content paragraphs
// =============================================================================

test('fromMarkdown: paragraph with emphasis and trailing attributes', async (t) => {
  const tree = parse('Some *emphasized* text. {.note}')

  const paragraph = tree.children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.deepEqual(paragraph.data?.hProperties, {class: 'note'})

  // Should have text, emphasis, text (without attrs)
  const lastChild = paragraph.children[paragraph.children.length - 1]
  assert.equal(lastChild.type, 'text')
  assert.ok(!lastChild.value.includes('{.note}'))
})

test('fromMarkdown: paragraph with link and trailing attributes', async (t) => {
  const tree = parse('Check out [this link](url) for more. {.info}')

  const paragraph = tree.children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.deepEqual(paragraph.data?.hProperties, {class: 'info'})
})

test('fromMarkdown: paragraph with multiple inline elements and attributes', async (t) => {
  const tree = parse('The *quick* **brown** fox. {#fox .animal}')

  const paragraph = tree.children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.deepEqual(paragraph.data?.hProperties, {
    id: 'fox',
    class: 'animal'
  })
})

test('fromMarkdown: paragraph with inline code and trailing attributes', async (t) => {
  const tree = parse('Use the `console.log()` function. {.tip}')

  const paragraph = tree.children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.deepEqual(paragraph.data?.hProperties, {class: 'tip'})
})

test('fromMarkdown: space prevents inline attachment but attaches to paragraph', async (t) => {
  const tree = parse('*emphasis* {.class}')

  const paragraph = tree.children[0]
  // The emphasis should NOT have attributes (space prevents inline attachment)
  const emphasis = paragraph.children[0]
  assert.equal(emphasis.type, 'emphasis')
  assert.equal(emphasis.data?.hProperties, undefined)

  // The paragraph SHOULD have attributes (trailing block attributes)
  assert.deepEqual(paragraph.data?.hProperties, {class: 'class'})
})

// =============================================================================
// Block elements: Separate line attributes
// =============================================================================

test('fromMarkdown: separate line attributes after paragraph', async (t) => {
  const tree = parse('Paragraph text.\n{.special}')

  // Should have one paragraph with attributes
  assert.equal(tree.children.length, 1)
  const paragraph = tree.children[0]
  assert.equal(paragraph.type, 'paragraph')
  assert.deepEqual(paragraph.data?.hProperties, {class: 'special'})
})

test('fromMarkdown: separate line attributes after heading', async (t) => {
  const tree = parse('# Heading\n{#heading-id}')

  const heading = tree.children[0]
  assert.equal(heading.type, 'heading')
  assert.deepEqual(heading.data?.hProperties, {id: 'heading-id'})
})

// =============================================================================
// toMarkdown: Block elements
// =============================================================================

test('toMarkdown: heading with id', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'heading',
      depth: 1,
      data: {hProperties: {id: 'my-id'}},
      children: [{type: 'text', value: 'Heading'}]
    }]
  }

  const result = serialize(tree)
  assert.ok(result.includes('# Heading'))
  assert.ok(result.includes('{#my-id}'))
})

test('toMarkdown: heading with class', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'heading',
      depth: 2,
      data: {hProperties: {class: 'important'}},
      children: [{type: 'text', value: 'Heading'}]
    }]
  }

  const result = serialize(tree)
  assert.ok(result.includes('## Heading'))
  assert.ok(result.includes('{.important}'))
})

test('toMarkdown: code block with attributes', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'code',
      lang: 'js',
      data: {hProperties: {class: 'highlight'}},
      value: 'const x = 1'
    }]
  }

  const result = serialize(tree)
  assert.ok(result.includes('```js'))
  assert.ok(result.includes('{.highlight}'))
})

test('toMarkdown: thematic break with attributes', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'thematicBreak',
      data: {hProperties: {class: 'divider'}}
    }]
  }

  const result = serialize(tree)
  // Should output attributes on line before ---
  assert.ok(result.includes('{.divider}'))
  assert.ok(result.includes('---'))
})

test('toMarkdown: thematic break with id and class', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'thematicBreak',
      data: {hProperties: {id: 'separator', class: 'fancy'}}
    }]
  }

  const result = serialize(tree)
  assert.ok(result.includes('#separator'))
  assert.ok(result.includes('.fancy'))
  assert.ok(result.includes('---'))
})

test('toMarkdown: thematic break without attributes', async (t) => {
  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'thematicBreak'
    }]
  }

  const result = serialize(tree)
  assert.ok(result.includes('---'))
  // Should not have attribute braces
  assert.ok(!result.includes('{'))
})

test('roundtrip: thematic break with attributes (serialize only)', async (t) => {
  // Note: The setext-to-hr conversion is in remark-attributes, not mdast-util-attributes
  // So we test that serialize produces valid output that will be converted to hr
  // when parsed with the full remark-attributes plugin

  /** @type {Root} */
  const tree = {
    type: 'root',
    children: [{
      type: 'thematicBreak',
      data: {hProperties: {class: 'divider'}}
    }]
  }

  const result = serialize(tree)
  // Should produce {.divider}\n---
  assert.ok(result.includes('{.divider}'))
  assert.ok(result.includes('---'))
})

console.log('All mdast-util-attributes tests defined')
