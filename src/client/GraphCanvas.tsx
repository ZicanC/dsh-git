import { useEffect, useMemo, useRef, useState } from 'react'
import { orderedNodes, primaryPath } from './graph.ts'
import type { GraphState, TurnNodeId } from './types.ts'

const NODE_WIDTH = 72
const NODE_HEIGHT = 42
const HORIZONTAL_GAP = 28
const VERTICAL_GAP = 78
const STAGE_PADDING = 32

interface TreePosition {
  readonly nodeId: TurnNodeId
  readonly x: number
  readonly y: number
}

interface TreeLayout {
  readonly positions: readonly TreePosition[]
  readonly width: number
  readonly height: number
}

/** Presentation-only props for the compact conversation tree. */
export interface GraphCanvasProps {
  readonly state: GraphState
  readonly previewNodeId: TurnNodeId | null
  readonly onPreview: (nodeId: TurnNodeId) => void
}

function nodeLabels(state: GraphState): ReadonlyMap<TurnNodeId, string> {
  return new Map(orderedNodes(state).map((node, index) => [node.id, `PA${index + 1}`]))
}

/** Lay out the primary-parent tree; secondary parents are drawn as merge edges. */
function layoutTree(state: GraphState): TreeLayout {
  const nodes = orderedNodes(state)
  const nodeIds = new Set(nodes.map(node => node.id))
  const children = new Map<TurnNodeId, TurnNodeId[]>()
  const roots: TurnNodeId[] = []

  for (const node of nodes) {
    if (node.primaryParentId === null || !nodeIds.has(node.primaryParentId)) roots.push(node.id)
    else children.set(node.primaryParentId, [...(children.get(node.primaryParentId) ?? []), node.id])
  }

  const widths = new Map<TurnNodeId, number>()
  const measuring = new Set<TurnNodeId>()
  const measure = (nodeId: TurnNodeId): number => {
    if (widths.has(nodeId)) return widths.get(nodeId)!
    if (measuring.has(nodeId)) return NODE_WIDTH
    measuring.add(nodeId)
    const childIds = children.get(nodeId) ?? []
    const childWidth = childIds.reduce((total, childId, index) =>
      total + measure(childId) + (index === 0 ? 0 : HORIZONTAL_GAP), 0)
    const width = Math.max(NODE_WIDTH, childWidth)
    widths.set(nodeId, width)
    measuring.delete(nodeId)
    return width
  }

  const positioned = new Set<TurnNodeId>()
  const positions: TreePosition[] = []
  const place = (nodeId: TurnNodeId, left: number, depth: number): void => {
    if (positioned.has(nodeId)) return
    positioned.add(nodeId)
    const width = measure(nodeId)
    positions.push({ nodeId, x: left + width / 2, y: STAGE_PADDING + depth * (NODE_HEIGHT + VERTICAL_GAP) })
    let childLeft = left
    for (const childId of children.get(nodeId) ?? []) {
      place(childId, childLeft, depth + 1)
      childLeft += measure(childId) + HORIZONTAL_GAP
    }
  }

  let rootLeft = STAGE_PADDING
  for (const rootId of roots) {
    place(rootId, rootLeft, 0)
    rootLeft += measure(rootId) + HORIZONTAL_GAP
  }
  // Malformed cyclic data should remain inspectable instead of disappearing.
  for (const node of nodes) {
    if (positioned.has(node.id)) continue
    place(node.id, rootLeft, 0)
    rootLeft += measure(node.id) + HORIZONTAL_GAP
  }

  const maxDepthY = Math.max(STAGE_PADDING, ...positions.map(position => position.y))
  return {
    positions,
    width: Math.max(320, rootLeft - HORIZONTAL_GAP + STAGE_PADDING),
    height: maxDepthY + NODE_HEIGHT + STAGE_PADDING,
  }
}

function connector(parent: TreePosition, child: TreePosition): string {
  const startY = parent.y + NODE_HEIGHT
  const endY = child.y
  const middleY = startY + (endY - startY) / 2
  return `M ${parent.x} ${startY} V ${middleY} H ${child.x} V ${endY}`
}

/** Compact tree visualization: node details are intentionally kept out of the graph. */
export function GraphCanvas({ state, previewNodeId, onPreview }: GraphCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const layout = useMemo(() => layoutTree(state), [state])
  const labels = useMemo(() => nodeLabels(state), [state])
  const byId = useMemo(() => new Map(layout.positions.map(position => [position.nodeId, position])), [layout])
  const activePath = useMemo(() => new Set(primaryPath(state, state.headNodeId)), [state])
  const context = new Set(state.contextManifest)

  useEffect(() => {
    const element = viewportRef.current
    if (element === null) return
    const update = (): void => setViewport({ width: element.clientWidth, height: element.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (layout.positions.length === 0) {
    return <div className="dsh-git-empty">完成第一轮对话后，这里会出现第一条 branch。</div>
  }

  const availableWidth = Math.max(0, viewport.width - 24)
  const availableHeight = Math.max(0, viewport.height - 24)
  const scale = viewport.width === 0 || viewport.height === 0
    ? 1
    : Math.min(1, availableWidth / layout.width, availableHeight / layout.height)
  const fittedWidth = layout.width * scale
  const fittedHeight = layout.height * scale

  return <div ref={viewportRef} className="dsh-git-tree-viewport">
    <div className="dsh-git-tree-fit" style={{ width: fittedWidth, height: fittedHeight }}>
      <div
        className="dsh-git-tree-stage"
        style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
      >
      <svg className="dsh-git-tree-svg" width={layout.width} height={layout.height} aria-hidden="true">
        {orderedNodes(state).flatMap(node => node.parentIds.map(parentId => {
          const parent = byId.get(parentId)
          const child = byId.get(node.id)
          if (parent === undefined || child === undefined) return null
          const merge = parentId !== node.primaryParentId
          const active = !merge && activePath.has(parentId) && activePath.has(node.id)
          return <path
            key={`${parentId}:${node.id}`}
            d={connector(parent, child)}
            className={`dsh-git-tree-edge ${merge ? 'dsh-git-tree-edge-merge' : active ? 'dsh-git-tree-edge-active' : ''}`}
          />
        }))}
      </svg>
      {layout.positions.map(position => {
        const node = state.nodes[position.nodeId]
        if (node === undefined) return null
        const label = labels.get(node.id) ?? 'PA'
        const isHead = node.id === state.headNodeId
        const isPreview = node.id === previewNodeId
        const inContext = context.has(node.id)
        return <button
          type="button"
          className={`dsh-git-tree-node ${isPreview ? 'dsh-git-tree-node-preview' : ''} ${inContext ? 'dsh-git-tree-node-context' : ''}`}
          style={{ left: position.x - NODE_WIDTH / 2, top: position.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
          key={node.id}
          title={`${label}: ${node.prompt || '（无文字问题）'}`}
          aria-label={`查看 ${label} context`}
          aria-current={isHead ? 'true' : undefined}
          onClick={() => onPreview(node.id)}
        >
          <span>{label}</span>
          {isHead ? <span className="dsh-git-tree-head">HEAD</span> : null}
        </button>
      })}
      </div>
    </div>
  </div>
}
