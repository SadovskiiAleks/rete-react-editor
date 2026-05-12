import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { EditorGraph } from "./editor";

type Props = {
  graph: EditorGraph | null;
};

function getNumber(value: string | number | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function ModelPreview({ graph }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const mount = mountRef.current;
    const width = mount.clientWidth || 640;
    const height = mount.clientHeight || 320;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101317);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000);
    camera.position.set(600, 450, 900);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(400, 700, 600);
    scene.add(light);

    const grid = new THREE.GridHelper(1200, 24, 0x3b3b3b, 0x262626);
    scene.add(grid);

    const root = new THREE.Group();
    scene.add(root);

    const boxNode = graph?.nodes.find((node) => node.type === "stdlBox");
    const portNodes = graph?.nodes.filter((node) => node.type === "stdlPort") ?? [];

    const bw = getNumber(boxNode?.controls.width, 600);
    const bh = getNumber(boxNode?.controls.height, 300);
    const bd = getNumber(boxNode?.controls.depth, 250);

    const bodyGeometry = new THREE.BoxGeometry(bw, bh, bd);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f88ff,
      roughness: 0.5,
      metalness: 0.15
    });
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    bodyMesh.position.set(0, bh / 2, 0);
    root.add(bodyMesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeometry),
      new THREE.LineBasicMaterial({ color: 0x9fb8ff })
    );
    edges.position.copy(bodyMesh.position);
    root.add(edges);

    for (const port of portNodes) {
      const px = getNumber(port.controls.x, 0);
      const py = getNumber(port.controls.y, 0);
      const pz = getNumber(port.controls.z, 0);

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(12, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xff8f4f })
      );
      marker.position.set(px, py, pz);
      root.add(marker);
    }

    const axis = new THREE.AxesHelper(280);
    root.add(axis);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      root.rotation.y += 0.004;
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth || width;
      const h = mount.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      bodyGeometry.dispose();
      bodyMaterial.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [graph]);

  return <div className="model-preview" ref={mountRef} />;
}
