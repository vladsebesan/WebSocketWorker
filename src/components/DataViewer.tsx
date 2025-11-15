import { useEffect, useState } from "react";
import type { IFlowModel, IToolboxModel } from "../interfaces/IFlow";
import { usePiApi } from "../custom-communication/PiApi";

export const DataViewer = () : JSX.Element => {
  const piApi = usePiApi();
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolbox, setToolbox] = useState<IToolboxModel | null>(null);
  const [flow, setFlow] = useState<IFlowModel | null>(null);
  
  useEffect(() => {
    if (!piApi) return;

    // Setup connection callbacks
    piApi.onConnected = async () => {
      console.log('DataViewer connected');
      setIsConnected(true);
      setError(null);

      // Fetch data after connection
      try {
        const [toolboxData, flowData] = await Promise.all([
          piApi.getToolbox(),
          piApi.getFlow()
        ]);
        
        setToolbox(toolboxData);
        setFlow(flowData);
        console.log('DataViewer received toolbox:', toolboxData);
        console.log('DataViewer received flow:', flowData);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to fetch data';
        console.error('DataViewer failed to fetch data:', errorMsg);
        setError(errorMsg);
      }
    };

    piApi.onConnectionError = (err) => {
      console.error('DataViewer connection failed:', err);
      setError(err.message);
      setIsConnected(false);
    };

    piApi.onDisconnected = () => {
      console.log('DataViewer disconnected');
      setIsConnected(false);
    };

    // Initiate connection
    piApi.connect();

    // Cleanup
    return () => {
      piApi.onConnected = null;
      piApi.onConnectionError = null;
      piApi.onDisconnected = null;
    };
  }, [piApi]);

  // Handle loading state while piApi is initializing
  if (!piApi) {
    return <div>Loading PIApi...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!isConnected) {
    return <div>Connecting...</div>;
  }

  return (
    <div>
      <h2>Data Viewer Component</h2>
      {toolbox && <div>Toolbox loaded with {Object.keys(toolbox).length} items</div>}
      {flow && <div>Flow loaded</div>}
    </div>
  );
}