import { useEffect, useRef, useState } from "react";
import { createEditor, type EditorGraph, type EditorNodeInfo, type NodeType } from "./editor";
import ModelPreview from "./ModelPreview";

const paletteTypes: NodeType[] = ["number", "operation", "stdlTemplate", "stdlParameter", "stdlBox", "stdlPort"];

function generateJsFromGraph(graph: EditorGraph): string {
  const lines: string[] = [];
  lines.push("// Generated from node graph");
  lines.push("const model = {");
  lines.push("  boxes: [],");
  lines.push("  ports: []");
  lines.push("};");
  lines.push("");

  for (const node of graph.nodes) {
    if (node.type === "stdlBox") {
      lines.push(
        `model.boxes.push({ id: "${String(node.controls.id ?? "body")}", width: ${Number(node.controls.width ?? 0)}, height: ${Number(node.controls.height ?? 0)}, depth: ${Number(node.controls.depth ?? 0)} });`
      );
    }
    if (node.type === "stdlPort") {
      lines.push(
        `model.ports.push({ name: "${String(node.controls.name ?? "Port")}", x: ${Number(node.controls.x ?? 0)}, y: ${Number(node.controls.y ?? 0)}, z: ${Number(node.controls.z ?? 0)} });`
      );
    }
  }

  lines.push("");
  lines.push("export default model;");
  return lines.join("\n");
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorDropRef = useRef<HTMLDivElement | null>(null);
  const editorApiRef = useRef<null | Awaited<ReturnType<typeof createEditor>>>(null);
  const [graphJson, setGraphJson] = useState("");
  const [jsCode, setJsCode] = useState("");
  const [stdlCode, setStdlCode] = useState("");
  const [modelGraph, setModelGraph] = useState<EditorGraph | null>(null);
  const [nodes, setNodes] = useState<EditorNodeInfo[]>([]);
  const [removeNodeId, setRemoveNodeId] = useState("");
  const [deleteOnClick, setDeleteOnClick] = useState(false);
  const [status, setStatus] = useState("Editor ready");

  const refreshStateFromEditor = () => {
    const api = editorApiRef.current;
    if (!api) return;
    const graph = api.save();
    setGraphJson(JSON.stringify(graph, null, 2));
    setJsCode(generateJsFromGraph(graph));
    setStdlCode(api.generateStdl());
    setModelGraph(graph);
    setNodes(api.getNodes());
  };

  useEffect(() => {
    if (!containerRef.current) return;

    let destroy: null | (() => void) = null;
    let disposed = false;

    createEditor(containerRef.current)
      .then((value) => {
        if (disposed) {
          value.destroy();
          return;
        }
        editorApiRef.current = value;
        destroy = value.destroy;
        const graph = value.save();
        setGraphJson(JSON.stringify(graph, null, 2));
        setJsCode(generateJsFromGraph(graph));
        setModelGraph(graph);
        setStdlCode(value.generateStdl());
        setNodes(value.getNodes());
        setStatus("Editor initialized");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        setStatus(`Editor init failed: ${message}`);
      });

    return () => {
      disposed = true;
      if (destroy) destroy();
      editorApiRef.current = null;
    };
  }, []);

  const handleSave = () => {
    const api = editorApiRef.current;
    if (!api) return;
    refreshStateFromEditor();
    setStatus("Graph saved to JSON");
  };

  const handleLoad = async () => {
    const api = editorApiRef.current;
    if (!api) return;
    try {
      const parsed = JSON.parse(graphJson) as EditorGraph;
      await api.load(parsed);
      refreshStateFromEditor();
      setStatus("Graph loaded from JSON");
    } catch {
      setStatus("Invalid JSON");
    }
  };

  const handleAutoLayout = async () => {
    const api = editorApiRef.current;
    if (!api) return;
    await api.autoLayout();
    refreshStateFromEditor();
    setStatus("Auto layout applied");
  };

  const handleGenerateStdl = () => {
    const api = editorApiRef.current;
    if (!api) return;
    refreshStateFromEditor();
    setStdlCode(api.generateStdl());
    setStatus("STDL code generated");
  };

  const handleAddNode = async (type: NodeType) => {
    const api = editorApiRef.current;
    if (!api) return;
    await api.addNode(type);
    refreshStateFromEditor();
    setStatus(`Node added: ${type}`);
  };

  const handleRemoveNode = async () => {
    const api = editorApiRef.current;
    if (!api || !removeNodeId) return;
    await api.removeNode(removeNodeId);
    refreshStateFromEditor();
    setStatus("Node removed");
  };

  const handleToggleDeleteOnClick = () => {
    const api = editorApiRef.current;
    if (!api) return;
    const next = !deleteOnClick;
    setDeleteOnClick(next);
    api.setDeleteOnClick(next);
    setStatus(next ? "Delete mode ON: click node to remove" : "Delete mode OFF");
  };

  const handleDownloadLua = () => {
    const api = editorApiRef.current;
    if (!api) return;
    const content = api.generateStdl();
    setStdlCode(content);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "style-template.lua";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Downloaded style-template.lua");
  };

  const handleRefresh3d = () => {
    const api = editorApiRef.current;
    if (!api) return;
    setModelGraph(api.save());
    setStatus("3D preview updated");
  };

  const handleDragStart = (event: React.DragEvent<HTMLButtonElement>, type: NodeType) => {
    event.dataTransfer.setData("node/type", type);
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleDropOnEditor = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("node/type") as NodeType;
    const api = editorApiRef.current;
    const host = editorDropRef.current;
    if (!api || !host || !type) return;
    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    await api.addNodeAt(type, x, y);
    refreshStateFromEditor();
    setStatus(`Node dropped: ${type}`);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Rete.js + React</h1>
        <div className="actions">
          <button onClick={handleToggleDeleteOnClick}>{deleteOnClick ? "Delete Click: ON" : "Delete Click: OFF"}</button>
          <input
            value={removeNodeId}
            onChange={(event) => setRemoveNodeId(event.target.value)}
            placeholder="node id to remove"
          />
          <button onClick={handleRemoveNode}>Remove Node</button>
          <button onClick={handleSave}>Save JSON</button>
          <button onClick={handleLoad}>Load JSON</button>
          <button onClick={handleAutoLayout}>Auto Layout</button>
          <button onClick={handleGenerateStdl}>Generate STDL</button>
          <button onClick={handleDownloadLua}>Download .lua</button>
          <button onClick={handleRefresh3d}>Refresh 3D</button>
        </div>
      </header>
      <div className="status">{status}</div>
      <div className="status">Nodes: {nodes.map((node) => `${node.label} (${node.id})`).join(", ")}</div>
      <div className="workspace">
        <aside className="palette">
          <h3>Nodes</h3>
          {paletteTypes.map((type) => (
            <button key={type} draggable onDragStart={(event) => handleDragStart(event, type)} onClick={() => handleAddNode(type)}>
              {type}
            </button>
          ))}
          <p>Drag into editor area</p>
        </aside>

        <section
          className="editor-host"
          ref={editorDropRef}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDropOnEditor}
        >
          <div className="editor" ref={containerRef} />
        </section>

        <section className="code-pane">
          <textarea className="json js" value={jsCode} readOnly spellCheck={false} />
          <textarea className="json stdl" value={stdlCode} readOnly spellCheck={false} />
        </section>

        <section className="preview-pane">
          <ModelPreview graph={modelGraph} />
          <textarea
            className="json graph"
            value={graphJson}
            onChange={(event) => setGraphJson(event.target.value)}
            spellCheck={false}
          />
        </section>
      </div>
    </div>
  );
}
