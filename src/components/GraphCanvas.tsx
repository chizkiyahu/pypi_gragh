import cytoscape from 'cytoscape'
import { useEffect, useRef } from 'preact/hooks'
import type { GraphEdge, GraphNode } from '../types.ts'

interface GraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}

function prefersDarkTheme(): boolean {
  return typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

function buildGraphStyles(isDark: boolean) {
  const nodeBackground = isDark ? '#243329' : '#f6f0dc'
  const nodeBorder = isDark ? '#75a48e' : '#d1b85a'
  const nodeInk = isDark ? '#eef4ef' : '#1f1d16'
  const rootBackground = isDark ? '#df7b1c' : '#f08a24'
  const unresolvedBackground = isDark ? '#5f3636' : '#f4d7d7'
  const unresolvedBorder = isDark ? '#d98a8a' : '#ad4d4d'
  const edgeColor = isDark ? '#9ac6b3' : '#718f81'
  const edgeInk = isDark ? '#d7efe4' : '#375548'
  const edgeLabelBackground = isDark ? '#17211c' : '#f7f3e6'

  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: '190px',
        height: '64px',
        padding: '10px',
        'background-color': nodeBackground,
        'border-width': '2px',
        'border-color': nodeBorder,
        label: 'data(label)',
        color: nodeInk,
        'font-size': '14px',
        'font-family': 'IBM Plex Sans, sans-serif',
        'text-wrap': 'wrap',
        'text-max-width': '160px',
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    {
      selector: 'node[root = "true"]',
      style: {
        'background-color': rootBackground,
        'border-color': isDark ? '#ffc58b' : '#7b3d10',
        color: '#fffef5',
      },
    },
    {
      selector: 'node[unresolved = "true"]',
      style: {
        'background-color': unresolvedBackground,
        'border-color': unresolvedBorder,
        'border-style': 'dashed',
      },
    },
    {
      selector: 'node[selected = "true"]',
      style: {
        'border-width': '4px',
        'border-color': isDark ? '#fff3c4' : '#123329',
      },
    },
    {
      selector: 'edge',
      style: {
        width: '2px',
        'line-color': edgeColor,
        'target-arrow-color': edgeColor,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        label: 'data(label)',
        'font-size': '10px',
        'text-wrap': 'wrap',
        'text-max-width': '180px',
        color: edgeInk,
        'text-background-color': edgeLabelBackground,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
        'text-rotation': 'autorotate',
      },
    },
  ] as cytoscape.StylesheetJson
}

export function GraphCanvas(props: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cytoscapeRef = useRef<cytoscape.Core | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const instance =
      cytoscapeRef.current ??
      cytoscape({
        container,
        minZoom: 0.15,
        maxZoom: 2.2,
        style: buildGraphStyles(prefersDarkTheme()),
      })

    cytoscapeRef.current = instance
    instance.on('tap', 'node', (event) => {
      props.onSelectNode(event.target.id())
    })

    return () => {
      instance.removeAllListeners()
    }
  }, [props.onSelectNode])

  useEffect(() => {
    const instance = cytoscapeRef.current
    if (!instance) {
      return
    }

    instance.style(buildGraphStyles(prefersDarkTheme()))
    instance.json({
      elements: {
        nodes: props.nodes.map((node) => ({
          data: {
            id: node.id,
            label: `${node.packageName}\n${node.displayVersion}`,
            root: String(node.depth === 0),
            unresolved: String(node.kind === 'unresolved'),
            selected: String(node.id === props.selectedNodeId),
          },
        })),
        edges: props.edges.map((edge) => ({
          data: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.requirement.length > 60 ? `${edge.requirement.slice(0, 57)}...` : edge.requirement,
          },
        })),
      },
    })

    instance.layout({
      name: 'breadthfirst',
      animate: true,
      animationDuration: 250,
      directed: true,
      fit: true,
      spacingFactor: props.nodes.length > 50 ? 1.3 : 1.65,
      padding: 40,
    }).run()
  }, [props.nodes, props.edges, props.selectedNodeId])

  useEffect(() => {
    const instance = cytoscapeRef.current
    if (!instance || !props.selectedNodeId) {
      return
    }

    instance.nodes().forEach((node) => {
      node.data('selected', String(node.id() === props.selectedNodeId))
    })
    const selected = instance.getElementById(props.selectedNodeId)
    if (selected.nonempty()) {
      instance.animate({
        fit: {
          eles: selected,
          padding: 100,
        },
        duration: 250,
      })
    }
  }, [props.selectedNodeId])

  useEffect(() => {
    return () => {
      cytoscapeRef.current?.destroy()
      cytoscapeRef.current = null
    }
  }, [])

  return <div class="graph-canvas" ref={containerRef} />
}
