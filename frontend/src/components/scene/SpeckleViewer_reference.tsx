'use client';
import React, { useEffect, useRef } from 'react';
import {
  Viewer,
  DefaultViewerParams,
  SpeckleLoader,
  UrlHelper,
  CameraController,
  SelectionExtension,
} from '@speckle/viewer';

export const SpeckleViewer = () => {
  // 1. Create a ref for the HTML container
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 2. Create a ref to store the viewer instance so we can clean it up later
  const viewerRef = useRef<Viewer | null>(null);

  useEffect(() => {
    // Define the async initialization function
    const initViewer = async () => {
      // Prevent double initialization (React Strict Mode compatibility)
      if (!containerRef.current || viewerRef.current) return;

      /** Configure the viewer params */
      const params = DefaultViewerParams;
      params.showStats = false;
      params.verbose = true;

      /** Create Viewer instance */
      const viewer = new Viewer(containerRef.current, params);
      viewerRef.current = viewer;

      /** Initialise the viewer */
      await viewer.init();

      /** Add extensions */
      viewer.createExtension(CameraController);
      viewer.createExtension(SelectionExtension);

      /** Create a loader for the speckle stream */
      // Ideally, pass this URL in as a prop to the component
      const urls = await UrlHelper.getResourceUrls(
        'https://app.speckle.systems/projects/24c98619ac/models/38639656b8'
      );

      for (const url of urls) {
        const loader = new SpeckleLoader(viewer.getWorldTree(), url, '');
        /** Load the speckle data */
        await viewer.loadObject(loader, true);
      }
    };

    initViewer();

    // 3. Cleanup function: runs when component unmounts
    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    };
  }, []); // Empty dependency array means this runs once on mount

  // 4. Render the container. Important: Give it a width/height!
  return (
    <div 
      ref={containerRef} 
      style={{ width: '100%', height: '100vh' }} 
      id="renderer" 
    />
  );
};