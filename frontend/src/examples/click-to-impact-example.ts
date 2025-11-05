/**
 * Example: 3D Click-to-Impact Integration
 * 
 * This example shows how to integrate modal impact synthesis with a Three.js scene.
 * Users can click on the mesh to trigger physically-based impact sounds.
 * 
 * Integration Steps:
 * 1. Perform modal analysis when mesh is loaded
 * 2. Add click event handler to mesh
 * 3. Synthesize and play impact sound on click
 */

import { useEffect, useRef } from 'react';
import { useModalImpact, createImpactParameters } from '@/hooks/useModalImpact';
import type { ModalAnalysisRequest } from '@/types/modal';
import type { CompasGeometry } from '@/types';

/**
 * Example hook showing how to integrate modal impact with mesh geometry
 */
export function useClickToImpact(
  geometry: CompasGeometry | null,
  material: string = 'steel'
) {
  const {
    modalState,
    impactState,
    analyzeModal,
    synthesizeImpact,
    playImpact,
  } = useModalImpact();

  const isAnalyzedRef = useRef(false);

  // Step 1: Analyze mesh when geometry loads
  useEffect(() => {
    if (!geometry || isAnalyzedRef.current) return;

    const analyzeGeometry = async () => {
      try {
        const request: ModalAnalysisRequest = {
          vertices: geometry.vertices,
          faces: geometry.faces,
          num_modes: 15,
          material,
        };

        console.log('[ClickToImpact] Analyzing geometry...');
        await analyzeModal(request);
        console.log('[ClickToImpact] Analysis complete');
        
        isAnalyzedRef.current = true;
      } catch (error) {
        console.error('[ClickToImpact] Analysis failed:', error);
      }
    };

    analyzeGeometry();
  }, [geometry, material, analyzeModal]);

  /**
   * Handle click on mesh at specific 3D position
   * 
   * @param point - Intersection point from raycaster
   * @param velocity - Impact velocity (0.1-10, default 5)
   */
  const handleImpact = async (
    point: { x: number; y: number; z: number },
    velocity: number = 5.0
  ) => {
    if (!modalState.result) {
      console.warn('[ClickToImpact] No modal analysis result yet');
      return;
    }

    try {
      // Create impact parameters from click position
      const params = createImpactParameters(
        point.x,
        point.y,
        point.z,
        velocity,
        material
      );

      // Synthesize the impact sound
      await synthesizeImpact(params);

      // Play immediately (auto-plays in 50ms to ensure buffer is ready)
      setTimeout(() => {
        playImpact();
      }, 50);

      console.log('[ClickToImpact] Impact at:', point, 'velocity:', velocity);
    } catch (error) {
      console.error('[ClickToImpact] Impact synthesis failed:', error);
    }
  };

  return {
    modalState,
    impactState,
    handleImpact,
    isReady: modalState.result !== null,
  };
}

/**
 * Example: Adding click handler to Three.js mesh
 * 
 * ```typescript
 * // In your Three.js scene component:
 * 
 * import { useClickToImpact } from './click-to-impact-example';
 * 
 * function Scene({ geometry }) {
 *   const { handleImpact, isReady } = useClickToImpact(geometry, 'steel');
 * 
 *   const onMeshClick = (event: ThreeEvent<MouseEvent>) => {
 *     if (!isReady) return;
 * 
 *     // Get intersection point
 *     const point = event.point;
 * 
 *     // Optional: Calculate velocity from mouse movement
 *     const velocity = 5.0; // Or: calculateVelocity(event);
 * 
 *     // Trigger impact
 *     handleImpact(point, velocity);
 *   };
 * 
 *   return (
 *     <mesh onClick={onMeshClick}>
 *       <bufferGeometry>
 *         <bufferAttribute
 *           attach="attributes-position"
 *           count={geometry.vertices.length}
 *           array={new Float32Array(geometry.vertices.flat())}
 *           itemSize={3}
 *         />
 *       </bufferGeometry>
 *       <meshStandardMaterial color={isReady ? 0x00ff00 : 0xff0000} />
 *     </mesh>
 *   );
 * }
 * ```
 */

/**
 * Helper: Calculate impact velocity from mouse movement
 * 
 * This can be used to create more realistic impacts based on how fast
 * the user moves the mouse before clicking.
 */
export function calculateImpactVelocity(
  mouseDelta: { x: number; y: number },
  maxVelocity: number = 10.0
): number {
  const speed = Math.sqrt(mouseDelta.x ** 2 + mouseDelta.y ** 2);
  
  // Map mouse speed to impact velocity (0.1 - 10 m/s)
  const normalized = Math.min(speed / 100, 1.0); // Normalize to [0, 1]
  const velocity = 0.1 + normalized * (maxVelocity - 0.1);
  
  return velocity;
}

/**
 * Helper: Visualize impact point
 * 
 * Create a temporary visual effect at the impact point
 */
export function createImpactMarker(
  scene: any, // THREE.Scene
  point: { x: number; y: number; z: number },
  duration: number = 500
): void {
  // This is a conceptual example - actual implementation depends on your Three.js setup
  
  /* Example implementation:
  
  const geometry = new THREE.SphereGeometry(0.1, 16, 16);
  const material = new THREE.MeshBasicMaterial({ 
    color: 0xff0000,
    transparent: true,
    opacity: 1.0
  });
  const marker = new THREE.Mesh(geometry, material);
  
  marker.position.set(point.x, point.y, point.z);
  scene.add(marker);
  
  // Fade out animation
  const startTime = Date.now();
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = elapsed / duration;
    
    if (progress < 1.0) {
      material.opacity = 1.0 - progress;
      marker.scale.setScalar(1.0 + progress * 2.0);
      requestAnimationFrame(animate);
    } else {
      scene.remove(marker);
      geometry.dispose();
      material.dispose();
    }
  };
  
  animate();
  */
}
