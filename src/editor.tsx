import { useState } from "react";
import { ClassicPreset, NodeEditor, type GetSchemes } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { ReactPlugin, Presets as ReactPresets } from "rete-react-plugin";
import { AutoArrangePlugin, Presets as ArrangePresets } from "rete-auto-arrange-plugin";
import { MinimapPlugin } from "rete-minimap-plugin";
import { createRoot } from "react-dom/client";

class BaseNode extends ClassicPreset.Node {
  width = 220;
  height = 160;
}

class Connection<N extends BaseNode> extends ClassicPreset.Connection<N, N> {}

type Schemes = GetSchemes<BaseNode, Connection<BaseNode>>;

export type NodeType = "number" | "operation" | "stdlTemplate" | "stdlParameter" | "stdlBox" | "stdlPort";

type SerializedNode = {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  controls: Record<string, string | number>;
};

type SerializedConnection = {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
};

export type EditorGraph = {
  nodes: SerializedNode[];
  connections: SerializedConnection[];
};

export type EditorNodeInfo = {
  id: string;
  label: string;
  type: NodeType;
};

class SelectControl extends ClassicPreset.Control {
  value: string;
  options: string[];
  readonly onChange?: (value: string) => void;

  constructor(options: string[], initial: string, onChange?: (value: string) => void) {
    super();
    this.options = options;
    this.value = initial;
    this.onChange = onChange;
  }

  setValue(value: string) {
    this.value = value;
    if (this.onChange) this.onChange(value);
  }
}

function SelectControlView({ data }: { data: SelectControl }) {
  const [value, setValue] = useState(data.value);

  return (
    <select
      value={value}
      onChange={(event) => {
        const nextValue = event.target.value;
        setValue(nextValue);
        data.setValue(nextValue);
      }}
      style={{ width: "100%", padding: "6px 8px", borderRadius: 8 }}
    >
      {data.options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

type EditorApi = {
  destroy: () => void;
  save: () => EditorGraph;
  load: (graph: EditorGraph) => Promise<void>;
  autoLayout: () => Promise<void>;
  generateStdl: () => string;
  addNode: (type: NodeType) => Promise<void>;
  addNodeAt: (type: NodeType, x: number, y: number) => Promise<void>;
  removeNode: (id: string) => Promise<void>;
  getNodes: () => EditorNodeInfo[];
  setDeleteOnClick: (enabled: boolean) => void;
};

function getControlValue(node: BaseNode, key: string): string | number {
  const control = node.controls[key];
  if (!control) return "";
  if (control instanceof SelectControl) return control.value;
  if (control instanceof ClassicPreset.InputControl) return control.value ?? "";
  return "";
}

function generateStdlFromGraph(graph: EditorGraph): string {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, SerializedConnection[]>();

  for (const connection of graph.connections) {
    const bucket = incoming.get(connection.target) ?? [];
    bucket.push(connection);
    incoming.set(connection.target, bucket);
  }

  const template = graph.nodes.find((node) => node.type === "stdlTemplate");
  if (!template) {
    return "-- STDL template node is missing\n-- Add 'STDL Template' node and connect geometry/ports.";
  }

  const templateInputs = incoming.get(template.id) ?? [];
  const connectedNodes = templateInputs
    .map((connection) => nodeById.get(connection.source))
    .filter((node): node is SerializedNode => Boolean(node));

  const parameters = graph.nodes.filter((node) => node.type === "stdlParameter");
  const boxes = connectedNodes.filter((node) => node.type === "stdlBox");
  const ports = connectedNodes.filter((node) => node.type === "stdlPort");

  const styleName = String(template.controls.name ?? "CustomStyle");

  const parameterLines = parameters.map((node) => {
    const id = String(node.controls.id ?? "param");
    const value = Number(node.controls.value ?? 100);
    return `local ${id} = ${Number.isFinite(value) ? value : 100}`;
  });

  const geometryLines = boxes.map((node) => {
    const id = String(node.controls.id ?? "body");
    const width = Number(node.controls.width ?? 100);
    const height = Number(node.controls.height ?? 80);
    const depth = Number(node.controls.depth ?? 100);
    return `local ${id} = CreateBlock(${width}, ${height}, ${depth})`;
  });

  const portLines = ports.map((node) => {
    const name = String(node.controls.name ?? "Port");
    const x = Number(node.controls.x ?? 0);
    const y = Number(node.controls.y ?? 0);
    const z = Number(node.controls.z ?? 0);
    return `AddPort("${name}", Point3D(${x}, ${y}, ${z}), Vector3D(1, 0, 0))`;
  });

  const firstBody = boxes[0] ? String(boxes[0].controls.id ?? "body") : "nil";

  return [
    `-- Generated from Rete STDL graph`,
    `-- Style: ${styleName}`,
    "",
    ...parameterLines,
    ...(parameterLines.length ? [""] : []),
    "function CreateGeometry()",
    ...geometryLines.map((line) => `  ${line}`),
    `  return ${firstBody}`,
    "end",
    "",
    "function ConfigurePorts()",
    ...portLines.map((line) => `  ${line}`),
    "end",
    "",
    "function CreateStyleTemplate()",
    "  local body = CreateGeometry()",
    "  ConfigurePorts()",
    "  return body",
    "end"
  ].join("\n");
}

export async function createEditor(container: HTMLElement): Promise<EditorApi> {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaPlugin<Schemes>["area"]>(container);
  const connection = new ConnectionPlugin<Schemes, AreaPlugin<Schemes>["area"]>();
  const arrange = new AutoArrangePlugin<Schemes>();
  const minimap = new MinimapPlugin<Schemes>();
  const render = new ReactPlugin<Schemes, AreaPlugin<Schemes>["area"]>({ createRoot });
  let deleteOnClick = false;

  editor.use(area);

  area.use(connection);
  area.use(arrange);
  area.use(minimap);
  area.use(render);

  connection.addPreset(ConnectionPresets.classic.setup());
  arrange.addPreset(ArrangePresets.classic.setup());
  render.addPreset(
    ReactPresets.classic.setup({
      customize: {
        control(context) {
          if (context.payload instanceof SelectControl) return SelectControlView;
          return null;
        }
      }
    })
  );
  render.addPreset(ReactPresets.minimap.setup({ size: 180 }));

  const socket = new ClassicPreset.Socket("socket");

  const stdlTemplate = new BaseNode("STDL Template");
  const stdlParameter = new BaseNode("STDL Parameter");
  const stdlBox = new BaseNode("STDL Box");
  const stdlPort = new BaseNode("STDL Port");

  stdlTemplate.addInput("geometry", new ClassicPreset.Input(socket, "geometry"));
  stdlTemplate.addInput("port", new ClassicPreset.Input(socket, "port", true));
  stdlTemplate.addControl("name", new ClassicPreset.InputControl("text", { initial: "AirTerminalStyle" }));

  stdlParameter.addOutput("value", new ClassicPreset.Output(socket, "value"));
  stdlParameter.addControl("id", new ClassicPreset.InputControl("text", { initial: "DN" }));
  stdlParameter.addControl("value", new ClassicPreset.InputControl("number", { initial: 100 }));

  stdlBox.addInput("widthIn", new ClassicPreset.Input(socket, "width"));
  stdlBox.addOutput("geometry", new ClassicPreset.Output(socket, "geometry"));
  stdlBox.addControl("id", new ClassicPreset.InputControl("text", { initial: "body" }));
  stdlBox.addControl("width", new ClassicPreset.InputControl("number", { initial: 600 }));
  stdlBox.addControl("height", new ClassicPreset.InputControl("number", { initial: 300 }));
  stdlBox.addControl("depth", new ClassicPreset.InputControl("number", { initial: 250 }));

  stdlPort.addOutput("port", new ClassicPreset.Output(socket, "port"));
  stdlPort.addControl("name", new ClassicPreset.InputControl("text", { initial: "Inlet" }));
  stdlPort.addControl("x", new ClassicPreset.InputControl("number", { initial: 0 }));
  stdlPort.addControl("y", new ClassicPreset.InputControl("number", { initial: 150 }));
  stdlPort.addControl("z", new ClassicPreset.InputControl("number", { initial: 0 }));

  await editor.addNode(stdlTemplate);
  await editor.addNode(stdlParameter);
  await editor.addNode(stdlBox);
  await editor.addNode(stdlPort);

  await editor.addConnection(new Connection(stdlParameter, "value", stdlBox, "widthIn"));
  await editor.addConnection(new Connection(stdlBox, "geometry", stdlTemplate, "geometry"));
  await editor.addConnection(new Connection(stdlPort, "port", stdlTemplate, "port"));

  await area.translate(stdlParameter.id, { x: 760, y: 120 });
  await area.translate(stdlBox.id, { x: 1060, y: 120 });
  await area.translate(stdlPort.id, { x: 1060, y: 420 });
  await area.translate(stdlTemplate.id, { x: 1360, y: 260 });

  AreaExtensions.zoomAt(area, editor.getNodes());

  const resolveNodeType = (node: BaseNode): NodeType => {
    if (node.label === "STDL Template") return "stdlTemplate";
    if (node.label === "STDL Parameter") return "stdlParameter";
    if (node.label === "STDL Box") return "stdlBox";
    if (node.label === "STDL Port") return "stdlPort";
    if ("operator" in node.controls) return "operation";
    return "number";
  };

  const readNodeControls = (node: BaseNode) => {
    const controls: Record<string, string | number> = {};
    for (const [key, control] of Object.entries(node.controls)) {
      if (!control) continue;
      if (control instanceof SelectControl) controls[key] = control.value;
      if (control instanceof ClassicPreset.InputControl) controls[key] = control.value ?? "";
    }
    return controls;
  };

  const buildNode = (entry: SerializedNode) => {
    if (entry.type === "operation") {
      const node = new BaseNode(entry.label || "Operation");
      node.addInput("left", new ClassicPreset.Input(socket, "left"));
      node.addInput("right", new ClassicPreset.Input(socket, "right"));
      node.addControl(
        "operator",
        new SelectControl(
          ["add", "subtract", "multiply", "divide"],
          typeof entry.controls.operator === "string" ? entry.controls.operator : "add"
        )
      );
      return node;
    }

    if (entry.type === "stdlTemplate") {
      const node = new BaseNode(entry.label || "STDL Template");
      node.addInput("geometry", new ClassicPreset.Input(socket, "geometry"));
      node.addInput("port", new ClassicPreset.Input(socket, "port", true));
      node.addControl(
        "name",
        new ClassicPreset.InputControl("text", {
          initial: typeof entry.controls.name === "string" ? entry.controls.name : "AirTerminalStyle"
        })
      );
      return node;
    }

    if (entry.type === "stdlParameter") {
      const node = new BaseNode(entry.label || "STDL Parameter");
      node.addOutput("value", new ClassicPreset.Output(socket, "value"));
      node.addControl(
        "id",
        new ClassicPreset.InputControl("text", {
          initial: typeof entry.controls.id === "string" ? entry.controls.id : "DN"
        })
      );
      node.addControl(
        "value",
        new ClassicPreset.InputControl("number", {
          initial: typeof entry.controls.value === "number" ? entry.controls.value : 100
        })
      );
      return node;
    }

    if (entry.type === "stdlBox") {
      const node = new BaseNode(entry.label || "STDL Box");
      node.addInput("widthIn", new ClassicPreset.Input(socket, "width"));
      node.addOutput("geometry", new ClassicPreset.Output(socket, "geometry"));
      node.addControl(
        "id",
        new ClassicPreset.InputControl("text", {
          initial: typeof entry.controls.id === "string" ? entry.controls.id : "body"
        })
      );
      node.addControl(
        "width",
        new ClassicPreset.InputControl("number", {
          initial: typeof entry.controls.width === "number" ? entry.controls.width : 600
        })
      );
      node.addControl(
        "height",
        new ClassicPreset.InputControl("number", {
          initial: typeof entry.controls.height === "number" ? entry.controls.height : 300
        })
      );
      node.addControl(
        "depth",
        new ClassicPreset.InputControl("number", {
          initial: typeof entry.controls.depth === "number" ? entry.controls.depth : 250
        })
      );
      return node;
    }

    if (entry.type === "stdlPort") {
      const node = new BaseNode(entry.label || "STDL Port");
      node.addOutput("port", new ClassicPreset.Output(socket, "port"));
      node.addControl(
        "name",
        new ClassicPreset.InputControl("text", {
          initial: typeof entry.controls.name === "string" ? entry.controls.name : "Inlet"
        })
      );
      node.addControl(
        "x",
        new ClassicPreset.InputControl("number", {
          initial: typeof entry.controls.x === "number" ? entry.controls.x : 0
        })
      );
      node.addControl(
        "y",
        new ClassicPreset.InputControl("number", {
          initial: typeof entry.controls.y === "number" ? entry.controls.y : 150
        })
      );
      node.addControl(
        "z",
        new ClassicPreset.InputControl("number", {
          initial: typeof entry.controls.z === "number" ? entry.controls.z : 0
        })
      );
      return node;
    }

    const node = new BaseNode(entry.label || "Number");
    node.addOutput("value", new ClassicPreset.Output(socket, "value"));
    node.addControl(
      "value",
      new ClassicPreset.InputControl("number", {
        initial: typeof entry.controls.value === "number" ? entry.controls.value : 0
      })
    );
    return node;
  };

  const createNodeByType = (type: NodeType): BaseNode => {
    if (type === "operation") {
      const node = new BaseNode("Operation");
      node.addInput("left", new ClassicPreset.Input(socket, "left"));
      node.addInput("right", new ClassicPreset.Input(socket, "right"));
      node.addControl("operator", new SelectControl(["add", "subtract", "multiply", "divide"], "add"));
      return node;
    }
    if (type === "stdlTemplate") {
      const node = new BaseNode("STDL Template");
      node.addInput("geometry", new ClassicPreset.Input(socket, "geometry"));
      node.addInput("port", new ClassicPreset.Input(socket, "port", true));
      node.addControl("name", new ClassicPreset.InputControl("text", { initial: "AirTerminalStyle" }));
      return node;
    }
    if (type === "stdlParameter") {
      const node = new BaseNode("STDL Parameter");
      node.addOutput("value", new ClassicPreset.Output(socket, "value"));
      node.addControl("id", new ClassicPreset.InputControl("text", { initial: "DN" }));
      node.addControl("value", new ClassicPreset.InputControl("number", { initial: 100 }));
      return node;
    }
    if (type === "stdlBox") {
      const node = new BaseNode("STDL Box");
      node.addInput("widthIn", new ClassicPreset.Input(socket, "width"));
      node.addOutput("geometry", new ClassicPreset.Output(socket, "geometry"));
      node.addControl("id", new ClassicPreset.InputControl("text", { initial: "body" }));
      node.addControl("width", new ClassicPreset.InputControl("number", { initial: 600 }));
      node.addControl("height", new ClassicPreset.InputControl("number", { initial: 300 }));
      node.addControl("depth", new ClassicPreset.InputControl("number", { initial: 250 }));
      return node;
    }
    if (type === "stdlPort") {
      const node = new BaseNode("STDL Port");
      node.addOutput("port", new ClassicPreset.Output(socket, "port"));
      node.addControl("name", new ClassicPreset.InputControl("text", { initial: "Inlet" }));
      node.addControl("x", new ClassicPreset.InputControl("number", { initial: 0 }));
      node.addControl("y", new ClassicPreset.InputControl("number", { initial: 150 }));
      node.addControl("z", new ClassicPreset.InputControl("number", { initial: 0 }));
      return node;
    }

    const node = new BaseNode("Number");
    node.addOutput("value", new ClassicPreset.Output(socket, "value"));
    node.addControl("value", new ClassicPreset.InputControl("number", { initial: 0 }));
    return node;
  };

  const save = (): EditorGraph => {
    const nodes = editor.getNodes().map((node) => {
      const view = area.nodeViews.get(node.id);
      return {
        id: node.id,
        type: resolveNodeType(node),
        label: node.label,
        x: view?.position.x ?? 0,
        y: view?.position.y ?? 0,
        controls: readNodeControls(node)
      };
    });

    const connections = editor.getConnections().map((connectionItem) => ({
      source: connectionItem.source,
      sourceOutput: String(connectionItem.sourceOutput),
      target: connectionItem.target,
      targetInput: String(connectionItem.targetInput)
    }));

    return { nodes, connections };
  };

  const clearGraph = async () => {
    for (const connectionItem of [...editor.getConnections()]) {
      await editor.removeConnection(connectionItem.id);
    }
    for (const node of [...editor.getNodes()]) {
      await editor.removeNode(node.id);
    }
  };

  const load = async (graph: EditorGraph) => {
    await clearGraph();

    const idMap = new Map<string, BaseNode>();

    for (const nodeEntry of graph.nodes) {
      const node = buildNode(nodeEntry);
      await editor.addNode(node);
      await area.translate(node.id, { x: nodeEntry.x, y: nodeEntry.y });
      idMap.set(nodeEntry.id, node);
    }

    for (const connectionEntry of graph.connections) {
      const source = idMap.get(connectionEntry.source);
      const target = idMap.get(connectionEntry.target);
      if (!source || !target) continue;

      await editor.addConnection(
        new Connection(
          source,
          connectionEntry.sourceOutput as keyof typeof source.outputs,
          target,
          connectionEntry.targetInput as keyof typeof target.inputs
        )
      );
    }

    AreaExtensions.zoomAt(area, editor.getNodes());
  };

  const autoLayout = async () => {
    await arrange.layout({
      options: {
        "elk.spacing.nodeNode": 80,
        "elk.layered.spacing.nodeNodeBetweenLayers": 80
      }
    });
    AreaExtensions.zoomAt(area, editor.getNodes());
  };

  const generateStdl = () => generateStdlFromGraph(save());

  const addNode = async (type: NodeType) => {
    const node = createNodeByType(type);
    await editor.addNode(node);
    const count = editor.getNodes().length;
    await area.translate(node.id, { x: 120 + count * 40, y: 120 + count * 20 });
  };

  const addNodeAt = async (type: NodeType, x: number, y: number) => {
    const node = createNodeByType(type);
    await editor.addNode(node);
    await area.translate(node.id, { x, y });
  };

  const removeNode = async (id: string) => {
    const node = editor.getNodes().find((item) => item.id === id);
    if (!node) return;
    const relatedConnections = editor
      .getConnections()
      .filter((connectionItem) => connectionItem.source === id || connectionItem.target === id);
    for (const connectionItem of relatedConnections) {
      await editor.removeConnection(connectionItem.id);
    }
    await editor.removeNode(node.id);
  };

  area.addPipe((context) => {
    if ("type" in context && context.type === "nodepicked" && deleteOnClick) {
      void removeNode(context.data.id);
    }
    return context;
  });

  const getNodes = (): EditorNodeInfo[] =>
    editor.getNodes().map((node) => ({
      id: node.id,
      label: node.label,
      type: resolveNodeType(node)
    }));

  const setDeleteOnClick = (enabled: boolean) => {
    deleteOnClick = enabled;
  };

  return {
    destroy: () => area.destroy(),
    save,
    load,
    autoLayout,
    generateStdl,
    addNode,
    addNodeAt,
    removeNode,
    getNodes,
    setDeleteOnClick
  };
}
