// src/app/page.tsx

"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// Define a type for our COMPAS geometry data for TypeScript
interface CompasGeometry {
  vertices: number[][]; // Array of [x, y, z]
  faces: number[][];    // Array of [i, j, k, ...]
}

// Helper function to triangulate faces (e.g., convert quads to two triangles)
function triangulate(faces: number[][]): number[] {
  const indices: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue; // Skip points and lines
    // The first vertex is the pivot
    const v0 = face[0];
    for (let i = 1; i < face.length - 1; i++) {
      const v1 = face[i];
      const v2 = face[i + 1];
      indices.push(v0, v1, v2);
    }
  }
  return indices;
}


function ThreeScene() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [geometryData, setGeometryData] = useState<CompasGeometry | null>(null);

  // Effect to fetch data from the backend
  useEffect(() => {
    const fetchGeometry = async () => {
      try {
        // Fetch data from your FastAPI backend
        const response = await fetch("http://127.0.0.1:8000/api/geometry");
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const data: CompasGeometry = await response.json();
        setGeometryData(data);
      } catch (error) {
        console.error("Failed to fetch geometry:", error);
      }
    };

    fetchGeometry();
  }, []); // Empty dependency array means this runs once on mount

  // Effect to set up the Three.js scene and render the fetched geometry
  useEffect(() => {
    if (!mountRef.current || !geometryData) return;

    // === THREE.JS SCENE SETUP ===
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    // === GEOMETRY CREATION FROM FETCHED DATA ===
    const vertices = new Float32Array(geometryData.vertices.flat());
    const indices = triangulate(geometryData.faces);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // For lighting, if you add it later

    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: false, fog: true });
    const fog = new THREE.Fog(0x3453E0, 1, 10);
    scene.fog = fog;
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // === ANIMATION LOOP ===
    const animate = () => {
      mesh.rotation.x += 0.005;
      mesh.rotation.y += 0.005;
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(animate);
    
    // === RESIZE HANDLING AND CLEANUP ===
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.setAnimationLoop(null);
      geometry.dispose();
      material.dispose();
    };
  }, [geometryData]); // This effect re-runs if geometryData changes

  return (
    <div
      ref={mountRef}
      style={{
        position: "fixed",
        top: -200,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: -1,
      }}
    />
  );
}

// Your original page component remains the same
export default function Home() {
  return (
    <>
      <ThreeScene />
      <div className="font-sans grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
        <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
          <Image
            className="dark:invert"
            src="/next.svg"
            alt="Next.js logo"
            width={180}
            height={38}
            priority
          />
          <ol className="font-mono list-inside list-decimal text-sm/6 text-center sm:text-left">
              Compas geometry fetched from the FastAPI backend at{" "}
              <code className="bg-black/[.05] dark:bg-white/[.06] font-mono font-semibold px-1 py-0.5 rounded">
                http://127.0.0.1:8000/api/geometry
              </code>.
          </ol>
          {/* ... The rest of your page content ... */}
        </main>
        {/* ... The rest of your page content ... */}
      </div>
    </>
  );
}