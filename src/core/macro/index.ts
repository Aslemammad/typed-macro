import { CallExpression, File, Program } from '@babel/types'
import { NodePath } from '@babel/traverse'

import { State } from '@/core/helper/state'
import { createHelper, MacroHelper } from './helper'
import { Babel, BABEL_TOOLS } from './babel'
import { ImportedMacro } from '@/core/helper/traverse'
import { versionedMacro } from '@/core/compat'

export type MacroContext = {
  /**
   * The file path of the module currently being handled.
   */
  filepath: string
  /**
   * The original source code of the module currently being handled.
   */
  code: string
  /**
   * The arguments nodes of the call-macro expression currently being handled.
   */
  args: CallExpression['arguments']
  /**
   * The NodePath of the call-macro expression currently being handled.
   */
  path: NodePath<CallExpression>
  /**
   * The AST being traversed.
   */
  ast: File
  /**
   * Whether in ssr mode.
   */
  ssr: boolean
  /**
   * Traversal state.
   */
  state: {
    /**
     * In order to recursively expand all macros in a file,
     * the transformer will traverse the AST many times until all macros
     * are expanded.
     *
     * - {@link traversal} is the state shared during one traversal, and
     * - {@link transform} is the state shared during the whole transformation.
     */
    traversal: State
    /**
     * @see traversal
     */
    transform: State
  }
}

export type MacroHandler = (
  /**
   * Context about the macro caller.
   */
  ctx: MacroContext,
  /**
   * Babel tools to help operate node paths and nodes.
   */
  babel: Readonly<Babel>,
  /**
   * Wrappers upon babel tools to simplify operations.
   */
  helper: Readonly<MacroHelper>
) => void

type RawMacroCall = {
  filepath: string
  code: string
  path: NodePath<CallExpression>
  ast: File
  program: NodePath<Program>
  ssr: boolean
  traversalState: State
  transformState: State
  importedMacros: ImportedMacro[]
}

export type Macro = (call: RawMacroCall) => void

export type MacroMeta = {
  signatures: {
    comment?: string
    signature: string
  }[]
  types: string[]
}

type InternalMacro = Macro & {
  __types: string
}

export function macro(
  name: string,
  meta: MacroMeta,
  handler: MacroHandler
): Macro {
  const normalizer = getNormalizer(handler)
  const m = {
    [name](call: RawMacroCall) {
      const { ctx, babel, helper } = normalizer(call)
      handler(ctx, babel as Babel, helper as MacroHelper)
    },
  }[name]
  ;(m as InternalMacro).__types = renderMetaType(name, meta)
  return versionedMacro(m)
}

type MacroCallNormalizer = (raw: RawMacroCall) => {
  ctx: MacroContext
  babel?: Readonly<Babel>
  helper?: Readonly<MacroHelper>
}

function normalizeContext(raw: RawMacroCall): MacroContext {
  const { filepath, ssr, ast, code, path, transformState, traversalState } = raw
  return {
    filepath,
    code,
    ast,
    path,
    args: path.node.arguments,
    state: {
      transform: transformState,
      traversal: traversalState,
    },
    ssr,
  }
}

export function getNormalizer(handler: MacroHandler): MacroCallNormalizer {
  switch (handler.length) {
    case 0:
      throw new Error('not a valid macro handler')
    case 1:
      return (raw: RawMacroCall) => ({
        ctx: normalizeContext(raw),
      })

    case 2:
      return (raw: RawMacroCall) => ({
        ctx: normalizeContext(raw),
        babel: BABEL_TOOLS,
      })

    default:
      return (raw: RawMacroCall) => {
        const { path, filepath, program, importedMacros } = raw
        const ctx = normalizeContext(raw)
        return {
          ctx,
          babel: BABEL_TOOLS,
          helper: createHelper(path, program, filepath, importedMacros),
        }
      }
  }
}

export function isMacro(o: unknown): o is InternalMacro {
  return (o as InternalMacro)?.__types !== undefined ?? false
}

export function renderMetaType(name: string, meta: MacroMeta) {
  return [
    meta.types.join('\n'),
    meta.signatures
      .map((s) =>
        s.comment
          ? `  /* ${s.comment} */
  export function ${name}${s.signature}`
          : `  export function ${name}${s.signature}`
      )
      .join('\n'),
  ]
    .filter((t) => !!t)
    .join('\n')
}
