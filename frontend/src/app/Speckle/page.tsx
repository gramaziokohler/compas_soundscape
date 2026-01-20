import { SpeckleViewer } from "@/components/scene/SpeckleViewer_Deprecated";

/**
 * Speckle Viewer Demo Page
 *
 * This page demonstrates the SpeckleViewer component.
 * In production, the viewer_url comes from the backend after uploading a 3D model.
 *
 * See: backend/services/speckle_service.py for how viewer_url is generated
 * See: frontend/src/hooks/useAnalysis.ts for how speckleData is received
 */
function App() {
  // Example 1: Pass viewer_url directly
  // const viewerUrl = "https://app.speckle.systems/projects/{projectId}/models/{modelId}";

  // Example 2: Pass speckleData object (as received from backend)
  // const speckleData = {
  //   model_id: "...",
  //   version_id: "...",
  //   file_id: "...",
  //   url: "https://app.speckle.systems/projects/{projectId}/models/{modelId}",
  //   object_id: "..."
  // };

  return (
    <div className="App">
      <h1>My Speckle Project</h1>
      {/* Without props, uses default demo URL */}
      <SpeckleViewer />

      {/* With viewer_url prop: */}
      {/* <SpeckleViewer viewer_url={viewerUrl} /> */}

      {/* With speckleData prop: */}
      {/* <SpeckleViewer speckleData={speckleData} /> */}
    </div>
  );
}

export default App;