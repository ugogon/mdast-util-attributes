# mdast-util-attributes

[mdast][github-mdast] extensions to parse and serialize
attribute syntax
(`*emphasis*{.highlight}`,
`# Heading {#my-id}`,
and such).

## Contents

* [What is this?](#what-is-this)
* [When to use this](#when-to-use-this)
* [Install](#install)
* [Use](#use)
* [API](#api)
  * [`attributesFromMarkdown()`](#attributesfrommarkdown)
  * [`attributesToMarkdown()`](#attributestomarkdown)
  * [`MdastAttributes`](#mdastattributes)
* [Syntax](#syntax)
* [Syntax tree](#syntax-tree)
  * [Nodes](#nodes)
* [Types](#types)
* [Compatibility](#compatibility)
* [Related](#related)
* [License](#license)

## What is this?

This package contains two extensions that add support for attribute syntax in
markdown to [mdast][github-mdast].
These extensions plug into
[`mdast-util-from-markdown`][github-mdast-util-from-markdown]
(to support parsing attributes in markdown into a syntax tree)
and
[`mdast-util-to-markdown`][github-mdast-util-to-markdown]
(to support serializing attributes in syntax trees to markdown).

Attributes allow you to add IDs, classes, and arbitrary key-value pairs to
markdown elements using `{#id .class key="value"}` syntax.

## When to use this

You can use these extensions when you are working with
`mdast-util-from-markdown` and `mdast-util-to-markdown` already.

When working with `mdast-util-from-markdown`,
you must combine this package with
[`micromark-extension-attributes`][github-micromark-extension-attributes].

When you don't need a syntax tree,
you can use [`micromark`][github-micromark] directly with
`micromark-extension-attributes`.

All these packages are used in
[`remark-attributes`][github-remark-attributes],
which focusses on making it easier to transform content by abstracting these
internals away.

## Install

This package is [ESM only][github-gist-esm].
In Node.js (version 16+),
install with [npm][npmjs-install]:

```sh
npm install mdast-util-attributes
```

## Use

Say our document `example.md` contains:

```markdown
*emphasis*{.highlight} and **strong**{#my-id}

# Heading {#intro .title}

```js {.code-example}
const x = 1
```
```

…and our module `example.js` looks as follows:

```js
import fs from 'node:fs/promises'
import {fromMarkdown} from 'mdast-util-from-markdown'
import {toMarkdown} from 'mdast-util-to-markdown'
import {attributes} from 'micromark-extension-attributes'
import {attributesFromMarkdown, attributesToMarkdown} from 'mdast-util-attributes'

const doc = await fs.readFile('example.md')

const tree = fromMarkdown(doc, {
  extensions: [attributes()],
  mdastExtensions: [attributesFromMarkdown()]
})

console.log(JSON.stringify(tree, null, 2))

const out = toMarkdown(tree, {extensions: [attributesToMarkdown()]})

console.log(out)
```

…now running `node example.js` yields a tree with `mdastAttributes` nodes
(positional info removed for brevity):

```js
{
  type: 'root',
  children: [
    {
      type: 'paragraph',
      children: [
        {
          type: 'emphasis',
          children: [{type: 'text', value: 'emphasis'}]
        },
        {
          type: 'mdastAttributes',
          attributes: {class: 'highlight'},
          value: '{.highlight}'
        },
        {type: 'text', value: ' and '},
        {
          type: 'strong',
          children: [{type: 'text', value: 'strong'}]
        },
        {
          type: 'mdastAttributes',
          attributes: {id: 'my-id'},
          value: '{#my-id}'
        }
      ]
    },
    {
      type: 'heading',
      depth: 1,
      children: [
        {type: 'text', value: 'Heading '},
        {
          type: 'mdastAttributes',
          attributes: {id: 'intro', class: 'title'},
          value: '{#intro .title}'
        }
      ]
    }
  ]
}
```

The serialized markdown output preserves the attribute syntax:

```markdown
*emphasis*{.highlight} and **strong**{#my-id}

# Heading {#intro .title}
```

## API

This package exports the identifiers
[`attributesFromMarkdown`][api-attributes-from-markdown] and
[`attributesToMarkdown`][api-attributes-to-markdown].
There is no default export.

### `attributesFromMarkdown()`

Create an extension for
[`mdast-util-from-markdown`][github-mdast-util-from-markdown]
to enable attributes in markdown.

This extension creates `mdastAttributes` nodes with correct position
information.
It also includes a transform that processes block-level attributes in
headings, paragraphs, code blocks, blockquotes, lists, and tables.

For setext-style attribute headings (`{.class}\n---`), the extension converts
the heading to a `thematicBreak` node with the attributes as children.

###### Returns

Extension for `mdast-util-from-markdown` to enable attributes
([`FromMarkdownExtension`][github-mdast-from-markdown-extension]).

### `attributesToMarkdown()`

Create an extension for
[`mdast-util-to-markdown`][github-mdast-util-to-markdown]
to enable attributes in markdown.

Provides custom handlers for emphasis, strong, link, image, inlineCode,
heading, code, thematicBreak, and mdastAttributes nodes.
Attributes are serialized in `{#id .class key="value"}` syntax.

Thematic breaks with attributes are serialized as `{.class}\n---` (which
will be parsed back correctly through the setext-to-thematic-break
conversion).

###### Returns

Extension for `mdast-util-to-markdown` to enable attributes
([`ToMarkdownExtension`][github-mdast-to-markdown-extension]).

### `MdastAttributes`

An `mdastAttributes` node in the syntax tree (TypeScript type).

###### Type

```ts
interface MdastAttributes {
  type: 'mdastAttributes'
  attributes: Record<string, string>
  value: string
  position?: Position
}
```

The `attributes` field contains the parsed key-value pairs.
The `value` field contains the original source text (e.g., `{.highlight}`)
so orphan attributes can be converted back to text.

## Syntax

See [*Syntax* in
`micromark-extension-attributes`][github-micromark-extension-attributes-syntax].

## Syntax tree

The following interfaces are added to **[mdast][github-mdast]** by this
utility.

### Nodes

#### `MdastAttributes`

```idl
interface MdastAttributes {
  type: 'mdastAttributes'
  attributes: Attributes
  value: string
}
```

**MdastAttributes** represents a parsed attribute block.
It can appear as a child of any block or inline parent node.

The `attributes` field is a record mapping attribute names to string values.
ID shortcuts (`#id`) are stored as `{id: 'value'}`,
class shortcuts (`.class`) are stored as `{class: 'value'}` (multiple
classes are space-separated).

The `value` field contains the original source text for the attribute block,
including the curly braces.

For example, the following markdown:

```markdown
*emphasis*{#my-id .highlight data-value="test"}
```

Yields an `mdastAttributes` node:

```js
{
  type: 'mdastAttributes',
  attributes: {id: 'my-id', class: 'highlight', 'data-value': 'test'},
  value: '{#my-id .highlight data-value="test"}'
}
```

## Types

This package is fully typed with [TypeScript][].
It exports the additional type [`MdastAttributes`][api-mdast-attributes].

## Compatibility

This utility works with `mdast-util-from-markdown` version 2+ and
`mdast-util-to-markdown` version 2+.

## Related

*   [`remark-attributes`][github-remark-attributes]
    — remark plugin to support attributes
*   [`micromark-extension-attributes`][github-micromark-extension-attributes]
    — micromark extension to parse attributes
*   [`mdast-util-directive`][github-mdast-util-directive]
    — mdast utility to support directives

## License

[MIT][file-license] © Ugo

<!-- Definitions -->

[api-attributes-from-markdown]: #attributesfrommarkdown

[api-attributes-to-markdown]: #attributestomarkdown

[api-mdast-attributes]: #mdastattributes

[file-license]: license

[github-gist-esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[github-mdast]: https://github.com/syntax-tree/mdast

[github-mdast-from-markdown-extension]: https://github.com/syntax-tree/mdast-util-from-markdown#extension

[github-mdast-to-markdown-extension]: https://github.com/syntax-tree/mdast-util-to-markdown#options

[github-mdast-util-directive]: https://github.com/syntax-tree/mdast-util-directive

[github-mdast-util-from-markdown]: https://github.com/syntax-tree/mdast-util-from-markdown

[github-mdast-util-to-markdown]: https://github.com/syntax-tree/mdast-util-to-markdown

[github-micromark]: https://github.com/micromark/micromark

[github-micromark-extension-attributes]: https://github.com/ugogon/micromark-extension-attributes

[github-micromark-extension-attributes-syntax]: https://github.com/ugogon/micromark-extension-attributes#syntax

[github-remark-attributes]: https://github.com/ugogon/remark-attributes

[npmjs-install]: https://docs.npmjs.com/cli/install

[typescript]: https://www.typescriptlang.org
